// Сервер: раздаёт статику и ведёт одну игровую комнату на 4 игроков.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  CRATE, MAPS, PLAYER, ROCKET, WEAPONS, isMapId, isWeapon, lineOfSight, rayBox, rayWorld, type MapId,
} from '../shared/map.js';
import { chooseSpawn } from './spawn.js';
import { isStat, maxLevel, pointsLeft, type Profile } from '../shared/progress.js';
import { decodeProfile, encodeProfile } from './progress.js';
import type { CrateState, InfoMsg, Mode, ServerMsg, SnapRow, Team, Vec3, WeaponId, Winner } from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 4;
const TEAM_SIZE = 2;
const RESPAWN_MS = 3000;
const ROUND_PAUSE_MS = 8000;
const LIMIT: Record<Mode, number> = { tdm: 20, ffa: 15 };

interface Player {
  id: number;
  ws: WebSocket;
  name: string;
  team: Team;
  pos: Vec3;
  yaw: number;
  pitch: number;
  w: WeaponId;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  lastShot: number;
  profile: Profile;
  /** Сколько ракет осталось (ракетница из ящика) */
  rockets: number;
  respawnTimer?: NodeJS.Timeout;
}

/** Входящее сообщение: клиенту не доверяем, поля проверяем вручную. */
type Incoming = Record<string, unknown>;

// ---------- статика ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(PUBLIC_DIR, urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- игра ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const players = new Map<number, Player>();
let nextId = 1;
let mode: Mode = 'tdm';
let mapId: MapId = 'sands';
let roundOver = false;
let roundTimer: NodeJS.Timeout | undefined;

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg, exceptId: number | null = null): void {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}
function sendProfile(p: Player): void {
  send(p.ws, { t: 'profile', token: encodeProfile(p.profile), kills: p.profile.kills, levels: p.profile.levels });
}
function teamCount(team: Team): number {
  let n = 0;
  for (const p of players.values()) if (p.team === team) n++;
  return n;
}
function lobbyInfo(): InfoMsg {
  return { t: 'info', mode, map: mapId, count: players.size, green: teamCount('green'), red: teamCount('red'), max: MAX_PLAYERS };
}
function broadcastInfo(): void {
  const data = JSON.stringify(lobbyInfo());
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(data);
}
function teamScores(): Record<Team, number> {
  const s: Record<Team, number> = { green: 0, red: 0 };
  for (const p of players.values()) s[p.team] += p.kills;
  return s;
}
function broadcastPlayers(): void {
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

function spawn(p: Player): void {
  const s = chooseSpawn(MAPS[mapId], mode, p, players.values());
  p.pos = [s[0], s[3] ?? 0, s[1]];
  p.yaw = s[2];
  p.hp = 100;
  p.alive = true;
  broadcast({ t: 'spawn', id: p.id, p: p.pos, yaw: p.yaw });
}

function resetRound(): void {
  roundOver = false;
  roundTimer = undefined;
  for (const p of players.values()) {
    p.kills = 0;
    p.deaths = 0;
    clearTimeout(p.respawnTimer);
    p.alive = false;
    setRockets(p, 0);
  }
  // Новый раунд — ящик снова на месте
  rockets = [];
  setCrate('idle');
  for (const p of players.values()) spawn(p);
  broadcast({ t: 'reset' });
  broadcastPlayers();
}

function checkWin(): void {
  let winner: Winner | null = null;
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

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** killer = null — игрока убил взорвавшийся ящик: убийство никому не засчитывается. */
function killPlayer(killer: Player | null, v: Player, w: WeaponId | 'crate'): void {
  v.hp = 0;
  v.alive = false;
  v.deaths++;
  if (killer) {
    killer.kills++;
    killer.profile.kills++;
    sendProfile(killer);
  }
  broadcast({ t: 'kill', killer: killer?.id ?? null, victim: v.id, w });
  // Погибший теряет ракетницу и перестаёт открывать ящик
  setRockets(v, 0);
  if (crate.state === 'opening' && crate.by === v.id) setCrate('idle');
  v.respawnTimer = setTimeout(() => {
    if (players.has(v.id) && !roundOver) {
      spawn(v);
      broadcastPlayers();
    }
  }, RESPAWN_MS);
}

// ---------- ящик с ракетницей ----------
const ROCKETS_IN_CRATE = 6;
const crate: { state: CrateState; by: number | null; start: Vec3; timer?: NodeJS.Timeout } = {
  state: 'idle', by: null, start: [0, 0, 0],
};

function crateMsg(): ServerMsg {
  return { t: 'crate', state: crate.state, by: crate.by, ms: crate.state === 'opening' ? CRATE.openMs : 0 };
}
function setCrate(state: CrateState, by: number | null = null): void {
  clearTimeout(crate.timer);
  crate.state = state;
  crate.by = by;
  broadcast(crateMsg());
}
function setRockets(p: Player, n: number): void {
  if (p.rockets === n) return;
  p.rockets = n;
  send(p.ws, { t: 'rockets', n });
}

function handleOpen(p: Player, on: boolean): void {
  if (!on) {
    // Отмена сбрасывает прогресс: открывать придётся заново
    if (crate.state === 'opening' && crate.by === p.id) setCrate('idle');
    return;
  }
  if (crate.state !== 'idle' || !p.alive || roundOver) return;
  const c = MAPS[mapId].crate;
  if (Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]) > CRATE.reach || Math.abs(p.pos[1] - c[1]) > 1.5) return;
  crate.start = [...p.pos];
  setCrate('opening', p.id);
  crate.timer = setTimeout(() => {
    const opener = players.get(p.id);
    if (!opener || !opener.alive) { setCrate('idle'); return; }
    setCrate('gone');
    // Сюрприз: иногда вместо ракетницы ящик взрывается
    if (Math.random() < CRATE.trapChance) explodeCrate();
    else setRockets(opener, ROCKETS_IN_CRATE);
  }, CRATE.openMs);
}

/** Ящик-ловушка: убивает всех рядом, включая открывшего и его союзников. Стена закрывает. */
function explodeCrate(): void {
  const map = MAPS[mapId];
  const [cx, cy, cz] = map.crate;
  const at: Vec3 = [cx, cy + CRATE.height + 0.2, cz];
  broadcast({ t: 'boom', id: 0, p: at });
  for (const v of players.values()) {
    if (!v.alive) continue;
    const [min, max] = playerBox(v);
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d > CRATE.trapRadius) continue;
    const covered = [0.2, PLAYER.h / 2, PLAYER.h - 0.1]
      .every((h) => !lineOfSight(map.boxes, at, [v.pos[0], v.pos[1] + h, v.pos[2]]));
    if (!covered) killPlayer(null, v, 'crate');
  }
  broadcastPlayers();
}

// ---------- ракеты ----------
interface Rocket { id: number; owner: number; pos: Vec3; dir: Vec3; born: number }
let rockets: Rocket[] = [];
let nextRocketId = 1;

function isEnemy(a: Player, b: Player): boolean {
  return a.id !== b.id && (mode === 'ffa' || a.team !== b.team);
}
function playerBox(p: Player): [Vec3, Vec3] {
  const r = PLAYER.w / 2;
  return [[p.pos[0] - r, p.pos[1], p.pos[2] - r], [p.pos[0] + r, p.pos[1] + PLAYER.h, p.pos[2] + r]];
}

function handleRocket(p: Player, msg: Incoming): void {
  if (!p.alive || p.rockets <= 0 || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  const now = Date.now();
  if (len < 0.5 || now - p.lastShot < WEAPONS.rocket.rate * 0.7) return;
  p.lastShot = now;
  setRockets(p, p.rockets - 1);
  const dir: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const pos: Vec3 = [p.pos[0], p.pos[1] + PLAYER.eye, p.pos[2]];
  const r: Rocket = { id: nextRocketId++, owner: p.id, pos, dir, born: now };
  rockets.push(r);
  broadcast({ t: 'rocket', id: r.id, by: p.id, o: pos, d: dir });
}

function explode(r: Rocket, at: Vec3): void {
  broadcast({ t: 'boom', id: r.id, p: at });
  const owner = players.get(r.owner);
  if (!owner || roundOver) return;
  const walls = MAPS[mapId].boxes;
  // Точку взрыва чуть отодвигаем от поверхности, иначе она сама закроет обзор
  const from: Vec3 = [at[0] - r.dir[0] * 0.2, at[1] - r.dir[1] * 0.2, at[2] - r.dir[2] * 0.2];
  let killed = false;
  for (const v of players.values()) {
    if (!v.alive || !isEnemy(owner, v)) continue;
    const [min, max] = playerBox(v);
    // Расстояние от взрыва до ближайшей точки игрока
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d > ROCKET.radius) continue;
    const covered = [0.2, PLAYER.h / 2, PLAYER.h - 0.1]
      .every((h) => !lineOfSight(walls, from, [v.pos[0], v.pos[1] + h, v.pos[2]]));
    if (covered) continue; // за стеной взрыв не достаёт
    killPlayer(owner, v, 'rocket');
    killed = true;
  }
  if (killed) {
    broadcastPlayers();
    checkWin();
  }
}

function stepRockets(dt: number): void {
  if (!rockets.length) return;
  const walls = MAPS[mapId].boxes;
  const now = Date.now();
  const flying: Rocket[] = [];
  for (const r of rockets) {
    const owner = players.get(r.owner);
    if (!owner) continue;
    const step = ROCKET.speed * dt;
    let t = rayWorld(walls, r.pos, r.dir, step);
    for (const v of players.values()) {
      if (!v.alive || !isEnemy(owner, v)) continue;
      const [min, max] = playerBox(v);
      t = Math.min(t, rayBox(r.pos, r.dir, min, max));
    }
    const at: Vec3 = [r.pos[0] + r.dir[0] * t, r.pos[1] + r.dir[1] * t, r.pos[2] + r.dir[2] * t];
    if (t < step || now - r.born > ROCKET.lifeMs) explode(r, at);
    else { r.pos = at; flying.push(r); }
  }
  rockets = flying;
}

function handleShoot(p: Player, msg: Incoming): void {
  if (!isWeapon(msg.w) || msg.w === 'rocket' || !p.alive) return;
  const weaponId = msg.w;
  const w = WEAPONS[weaponId];
  const now = Date.now();
  if (now - p.lastShot < w.rate * 0.7) return;
  p.lastShot = now;

  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, w.pellets).filter(isVec3) : [];
  broadcast({ t: 'shot', id: p.id, w: weaponId, ends }, p.id);

  if (roundOver || typeof msg.hits !== 'object' || msg.hits === null) return;
  let budget = w.pellets;
  const eye: Vec3 = [p.pos[0], p.pos[1] + PLAYER.eye, p.pos[2]];
  for (const [idStr, nRaw] of Object.entries(msg.hits)) {
    const v = players.get(Number(idStr));
    const n = Math.min(budget, Math.floor(Number(nRaw)) || 0);
    if (!v || n <= 0 || !v.alive || v.id === p.id) continue;
    if (mode === 'tdm' && v.team === p.team) continue;
    // Проверка, что между стрелком и целью нет стены
    const chest: Vec3 = [v.pos[0], v.pos[1] + PLAYER.h / 2, v.pos[2]];
    const head: Vec3 = [v.pos[0], v.pos[1] + PLAYER.h - 0.1, v.pos[2]];
    const feet: Vec3 = [v.pos[0], v.pos[1] + 0.2, v.pos[2]];
    const walls = MAPS[mapId].boxes;
    if (!lineOfSight(walls, eye, chest) && !lineOfSight(walls, eye, head) && !lineOfSight(walls, eye, feet)) continue;
    budget -= n;

    let dmg = w.dmg;
    if (weaponId === 'shotgun') {
      const dist = Math.hypot(v.pos[0] - p.pos[0], v.pos[2] - p.pos[2]);
      dmg *= Math.max(0.3, Math.min(1, 1 - (dist - 8) / 30));
    }
    v.hp = Math.max(0, Math.round(v.hp - dmg * n));
    if (v.hp <= 0) killPlayer(p, v, weaponId);
  }
  broadcastPlayers();
  checkWin();
}

function handleJoin(ws: WebSocket, msg: Incoming): Player | null {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'error', text: 'Сервер заполнен (максимум 4 игрока)' });
    return null;
  }
  if (players.size === 0) {
    mode = msg.mode === 'ffa' ? 'ffa' : 'tdm';
    mapId = isMapId(msg.map) ? msg.map : 'sands';
    roundOver = false;
    clearTimeout(roundTimer);
    clearTimeout(crate.timer);
    crate.state = 'idle';
    crate.by = null;
    rockets = [];
  }
  let team: Team = msg.team === 'red' ? 'red' : 'green';
  if (mode === 'tdm' && teamCount(team) >= TEAM_SIZE) team = team === 'red' ? 'green' : 'red';

  const rawName = typeof msg.name === 'string' ? msg.name : '';
  const name = rawName.replace(/[<>&]/g, '').trim().slice(0, 14) || 'Игрок';
  const p: Player = {
    id: nextId++, ws, name, team,
    pos: [0, 0, 0], yaw: 0, pitch: 0, w: 'pistol',
    hp: 100, alive: false, kills: 0, deaths: 0, lastShot: 0,
    profile: decodeProfile(msg.token),
    rockets: 0,
  };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, mode, map: mapId });
  sendProfile(p);
  send(ws, crateMsg());
  broadcastPlayers();
  spawn(p);
  broadcastPlayers();
  // Новичку — где сейчас остальные
  for (const o of players.values()) {
    if (o.id !== p.id) send(ws, { t: 'spawn', id: o.id, p: o.pos, yaw: o.yaw });
  }
  broadcastInfo();
  console.log(`+ ${p.name} (${team}), игроков: ${players.size}, режим: ${mode}, карта: ${mapId}`);
  return p;
}

wss.on('connection', (ws) => {
  let me: Player | null = null;
  send(ws, lobbyInfo());

  ws.on('message', (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); } catch { return; }
    if (typeof parsed !== 'object' || parsed === null) return;
    const msg = parsed as Incoming;

    if (msg.t === 'join') {
      if (!me) me = handleJoin(ws, msg);
      return;
    }
    if (!me) return;

    if (msg.t === 'state') {
      if (me.alive && isVec3(msg.p)) me.pos = msg.p;
      // Во время открытия ящика двигаться нельзя: сдвинулся — открытие сорвано
      if (crate.state === 'opening' && crate.by === me.id &&
          Math.hypot(me.pos[0] - crate.start[0], me.pos[1] - crate.start[1], me.pos[2] - crate.start[2]) > 0.5) {
        setCrate('idle');
      }
      if (isNum(msg.yaw)) me.yaw = msg.yaw;
      if (isNum(msg.pitch)) me.pitch = msg.pitch;
      if (isWeapon(msg.w)) me.w = msg.w;
    } else if (msg.t === 'shoot') {
      handleShoot(me, msg);
    } else if (msg.t === 'open') {
      handleOpen(me, msg.on === true);
    } else if (msg.t === 'rocket') {
      handleRocket(me, msg);
    } else if (msg.t === 'upgrade') {
      if (isStat(msg.stat) && pointsLeft(me.profile) > 0 && me.profile.levels[msg.stat] < maxLevel(msg.stat)) {
        me.profile.levels[msg.stat]++;
      }
      sendProfile(me);
    }
  });

  ws.on('close', () => {
    if (!me) return;
    clearTimeout(me.respawnTimer);
    players.delete(me.id);
    if (crate.state === 'opening' && crate.by === me.id) setCrate('idle');
    console.log(`- ${me.name}, игроков: ${players.size}`);
    if (players.size === 0) {
      clearTimeout(roundTimer);
      roundTimer = undefined;
      roundOver = false;
    }
    broadcastPlayers();
    broadcastInfo();
  });
  ws.on('error', () => {});
});

// Рассылка позиций 20 раз в секунду
setInterval(() => {
  stepRockets(0.05);
  if (players.size < 2) return;
  const ps: SnapRow[] = [];
  for (const p of players.values()) {
    ps.push([p.id, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch, p.w]);
  }
  broadcast({ t: 'snap', ps });
}, 50);

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});

// Быстрая остановка контейнера по `docker stop`
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => process.exit(0));
}
