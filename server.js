// Сервер: раздаёт статику и ведёт одну игровую комнату на 4 игроков.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { WEAPONS, PLAYER, SPAWNS, lineOfSight } from './public/shared/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 4;
const TEAM_SIZE = 2;
const RESPAWN_MS = 3000;
const ROUND_PAUSE_MS = 8000;
const LIMIT = { tdm: 20, ffa: 15 };

// ---------- статика ----------
const ROOTS = [
  ['/vendor/', path.join(__dirname, 'node_modules', 'three', 'build')],
  ['/', path.join(__dirname, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  for (const [prefix, root] of ROOTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.join(root, urlPath.slice(prefix.length));
    if (!file.startsWith(root + path.sep)) break;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404).end('Not found');
});

// ---------- игра ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const players = new Map(); // id -> player
let nextId = 1;
let mode = 'tdm';
let roundOver = false;
let roundTimer = null;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}
function teamCount(team) {
  let n = 0;
  for (const p of players.values()) if (p.team === team) n++;
  return n;
}
function lobbyInfo() {
  return { t: 'info', mode, count: players.size, green: teamCount('green'), red: teamCount('red'), max: MAX_PLAYERS };
}
function broadcastInfo() {
  const data = JSON.stringify(lobbyInfo());
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(data);
}
function teamScores() {
  const s = { green: 0, red: 0 };
  for (const p of players.values()) s[p.team] += p.kills;
  return s;
}
function broadcastPlayers() {
  broadcast({
    t: 'players',
    mode,
    limit: LIMIT[mode],
    scores: teamScores(),
    list: [...players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, alive: p.alive, kills: p.kills, deaths: p.deaths,
    })),
  });
}

function pickSpawn(p) {
  const list = mode === 'tdm' ? SPAWNS[p.team] : SPAWNS.ffa;
  // Выбираем точку, максимально удалённую от остальных живых игроков
  let best = list[0], bestDist = -1;
  for (const s of list) {
    let d = Infinity;
    for (const o of players.values()) {
      if (o.id === p.id || !o.alive) continue;
      d = Math.min(d, Math.hypot(o.pos[0] - s[0], o.pos[2] - s[1]));
    }
    d += Math.random() * 3;
    if (d > bestDist) { bestDist = d; best = s; }
  }
  return best;
}

function spawn(p) {
  const s = pickSpawn(p);
  p.pos = [s[0], 0, s[1]];
  p.yaw = s[2];
  p.hp = 100;
  p.alive = true;
  broadcast({ t: 'spawn', id: p.id, p: p.pos, yaw: p.yaw });
}

function resetRound() {
  roundOver = false;
  roundTimer = null;
  for (const p of players.values()) {
    p.kills = 0;
    p.deaths = 0;
    clearTimeout(p.respawnTimer);
    p.alive = false;
  }
  for (const p of players.values()) spawn(p);
  broadcast({ t: 'reset' });
  broadcastPlayers();
}

function checkWin() {
  let winner = null;
  if (mode === 'tdm') {
    const s = teamScores();
    if (s.green >= LIMIT.tdm) winner = { team: 'green' };
    else if (s.red >= LIMIT.tdm) winner = { team: 'red' };
  } else {
    for (const p of players.values()) if (p.kills >= LIMIT.ffa) winner = { id: p.id, name: p.name };
  }
  if (!winner) return;
  roundOver = true;
  broadcast({ t: 'over', winner, pause: ROUND_PAUSE_MS });
  roundTimer = setTimeout(resetRound, ROUND_PAUSE_MS);
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 1000);
}

function handleShoot(p, msg) {
  const w = WEAPONS[msg.w];
  if (!w || !p.alive) return;
  const now = Date.now();
  if (now - p.lastShot < w.rate * 0.7) return;
  p.lastShot = now;

  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, w.pellets).filter(isVec3) : [];
  broadcast({ t: 'shot', id: p.id, w: msg.w, ends }, p.id);

  if (roundOver || !msg.hits || typeof msg.hits !== 'object') return;
  let budget = w.pellets;
  const eye = [p.pos[0], p.pos[1] + PLAYER.eye, p.pos[2]];
  for (const [idStr, nRaw] of Object.entries(msg.hits)) {
    const v = players.get(Number(idStr));
    const n = Math.min(budget, Math.floor(Number(nRaw)) || 0);
    if (!v || n <= 0 || !v.alive || v.id === p.id) continue;
    if (mode === 'tdm' && v.team === p.team) continue;
    // Проверка, что между стрелком и целью нет стены
    const chest = [v.pos[0], v.pos[1] + PLAYER.h / 2, v.pos[2]];
    const head = [v.pos[0], v.pos[1] + PLAYER.h - 0.1, v.pos[2]];
    const feet = [v.pos[0], v.pos[1] + 0.2, v.pos[2]];
    if (!lineOfSight(eye, chest) && !lineOfSight(eye, head) && !lineOfSight(eye, feet)) continue;
    budget -= n;

    let dmg = w.dmg;
    if (msg.w === 'shotgun') {
      const dist = Math.hypot(v.pos[0] - p.pos[0], v.pos[2] - p.pos[2]);
      dmg *= Math.max(0.3, Math.min(1, 1 - (dist - 8) / 30));
    }
    v.hp = Math.max(0, Math.round(v.hp - dmg * n));
    if (v.hp <= 0) {
      v.alive = false;
      v.deaths++;
      p.kills++;
      broadcast({ t: 'kill', killer: p.id, victim: v.id, w: msg.w });
      v.respawnTimer = setTimeout(() => {
        if (players.has(v.id) && !roundOver) {
          spawn(v);
          broadcastPlayers();
        }
      }, RESPAWN_MS);
    }
  }
  broadcastPlayers();
  checkWin();
}

function handleJoin(ws, msg) {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'error', text: 'Сервер заполнен (максимум 4 игрока)' });
    return null;
  }
  if (players.size === 0) {
    mode = msg.mode === 'ffa' ? 'ffa' : 'tdm';
    roundOver = false;
    clearTimeout(roundTimer);
  }
  let team = msg.team === 'red' ? 'red' : 'green';
  if (mode === 'tdm' && teamCount(team) >= TEAM_SIZE) team = team === 'red' ? 'green' : 'red';

  const name = String(msg.name || '').replace(/[<>&]/g, '').trim().slice(0, 14) || 'Игрок';
  const p = {
    id: nextId++, ws, name, team,
    pos: [0, 0, 0], yaw: 0, pitch: 0, w: 'pistol',
    hp: 100, alive: false, kills: 0, deaths: 0, lastShot: 0, respawnTimer: null,
  };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, mode });
  broadcastPlayers();
  spawn(p);
  broadcastPlayers();
  // Новичку — где сейчас остальные
  for (const o of players.values()) {
    if (o.id !== p.id) send(ws, { t: 'spawn', id: o.id, p: o.pos, yaw: o.yaw });
  }
  broadcastInfo();
  console.log(`+ ${p.name} (${team}), игроков: ${players.size}, режим: ${mode}`);
  return p;
}

wss.on('connection', (ws) => {
  let me = null;
  send(ws, lobbyInfo());

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      if (!me) me = handleJoin(ws, msg);
      return;
    }
    if (!me) return;

    if (msg.t === 'state') {
      if (me.alive && isVec3(msg.p)) me.pos = msg.p;
      if (Number.isFinite(msg.yaw)) me.yaw = msg.yaw;
      if (Number.isFinite(msg.pitch)) me.pitch = msg.pitch;
      if (WEAPONS[msg.w]) me.w = msg.w;
    } else if (msg.t === 'shoot') {
      handleShoot(me, msg);
    }
  });

  ws.on('close', () => {
    if (!me) return;
    clearTimeout(me.respawnTimer);
    players.delete(me.id);
    console.log(`- ${me.name}, игроков: ${players.size}`);
    if (players.size === 0) {
      clearTimeout(roundTimer);
      roundTimer = null;
      roundOver = false;
    }
    broadcastPlayers();
    broadcastInfo();
  });
  ws.on('error', () => {});
});

// Рассылка позиций 20 раз в секунду
setInterval(() => {
  if (players.size < 2) return;
  const ps = [];
  for (const p of players.values()) {
    ps.push([p.id, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch, p.w]);
  }
  broadcast({ t: 'snap', ps });
}, 50);

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
