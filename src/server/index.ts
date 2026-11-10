// Сервер: раздаёт статику и ведёт одну игровую комнату на 4 игроков.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ARMOR, CRATE, HEAD, MAPS, MAP_ORDER, MATCH, MEDKIT, PLAYER, ROCKET, SLIDE, STREAK, THROW, WEAPONS,
  bodyPoints, isMapId, isWeapon, lineOfSight, playerBox, rayBox, rayWorld,
  type MapId, type StreakKind,
} from '../shared/map.js';
import { chooseSpawn } from './spawn.js';
import { isStat, maxLevel, pointsLeft, type Profile } from '../shared/progress.js';
import { decodeProfile, encodeProfile } from './progress.js';
import { EMOJIS, SPRAY } from '../shared/emoji.js';
import type {
  CrateState, InfoMsg, KillWeapon, Mode, ServerMsg, SnapRow, Team, Vec3, WeaponId, Winner,
} from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 4;
const TEAM_SIZE = 2;
const RESPAWN_MS = 3000;
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
  /** Лежит ли в подкате (меняет хитбокс) */
  slide: boolean;
  hp: number;
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  lastShot: number;
  /** Когда последний раз рисовал на стене */
  lastSpray: number;
  profile: Profile;
  /** Сколько ракет осталось (ракетница из ящика или за серию) */
  rockets: number;
  /** Метательный нож: один на жизнь */
  hasKnife: boolean;
  /** Убийств подряд без смерти */
  streak: number;
  /** Запас наград за серию: их можно применить и после смерти */
  uav: number;
  missile: number;
  nuke: number;
  /** До какого момента работает БПЛА этого игрока */
  uavUntil: number;
  /** Суперброня: игрок в 1,5 раза больше */
  big: boolean;
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
/** Матч окончен — идёт голосование за карту; урон и награды не засчитываются */
let roundOver = false;
let matchMinutes = 10;
let matchEndsAt = 0;
let voteTimer: NodeJS.Timeout | undefined;
/** Голоса за карту: id игрока → карта */
const votes = new Map<number, MapId>();

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
  return { t: 'info', mode, map: mapId, minutes: matchMinutes, count: players.size, green: teamCount('green'), red: teamCount('red'), max: MAX_PLAYERS };
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
    left: roundOver ? 0 : Math.max(0, matchEndsAt - Date.now()),
    scores: teamScores(),
    list: [...players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, armor: p.armor, alive: p.alive, kills: p.kills, deaths: p.deaths,
      big: p.big,
    })),
  });
}

function spawn(p: Player): void {
  const s = chooseSpawn(MAPS[mapId], mode, p, players.values());
  p.pos = [s[0], s[3] ?? 0, s[1]];
  p.yaw = s[2];
  p.hp = 100;
  p.armor = 0;
  p.big = false;
  p.slide = false;
  p.hasKnife = true; // нож возвращается после смерти
  p.alive = true;
  sendLoadout(p);
  broadcast({ t: 'spawn', id: p.id, p: p.pos, yaw: p.yaw });
}

function resetRound(): void {
  roundOver = false;
  for (const p of players.values()) {
    p.kills = 0;
    p.deaths = 0;
    clearTimeout(p.respawnTimer);
    p.alive = false;
    setRockets(p, 0);
  }
  // Новый раунд начинается без ящика; следующий упадёт по расписанию
  rockets = [];
  knives = [];
  missiles.clear();
  clearCrate();
  clearMedkits();
  for (const p of players.values()) spawn(p);
  broadcast({ t: 'reset' });
  broadcastPlayers();
}

/** Матч кончается по лимиту убийств или по времени; дальше — голосование за карту. */
function checkWin(): void {
  if (roundOver) return;
  let winner: Winner | null = null;
  if (mode === 'tdm') {
    const s = teamScores();
    if (s.green >= LIMIT.tdm) winner = { team: 'green' };
    else if (s.red >= LIMIT.tdm) winner = { team: 'red' };
  } else {
    for (const p of players.values()) if (p.kills >= LIMIT.ffa) winner = { id: p.id, name: p.name };
  }
  if (winner) endMatch(winner);
}

/** Победитель по счёту на момент окончания времени; при равенстве — ничья. */
function winnerByScore(): Winner {
  if (mode === 'tdm') {
    const s = teamScores();
    if (s.green === s.red) return { draw: true };
    return { team: s.green > s.red ? 'green' : 'red' };
  }
  const list = [...players.values()].sort((a, b) => b.kills - a.kills);
  const [first, second] = list;
  if (!first || (second && second.kills === first.kills)) return { draw: true };
  return { id: first.id, name: first.name };
}

function voteMsg(p: Player | null): ServerMsg {
  const counts = Object.fromEntries(MAP_ORDER.map((m) => [m, 0])) as Record<MapId, number>;
  for (const m of votes.values()) counts[m]++;
  return { t: 'vote', counts, ms: MATCH.voteMs, mine: p ? votes.get(p.id) ?? null : null };
}
function broadcastVotes(): void {
  for (const p of players.values()) send(p.ws, voteMsg(p));
}

function endMatch(winner: Winner): void {
  roundOver = true;
  votes.clear();
  rockets = [];
  knives = [];
  missiles.clear();
  clearTimeout(nukeTimer);
  nukeTimer = undefined;
  broadcast({ t: 'over', winner, pause: MATCH.voteMs });
  broadcastVotes();
  clearTimeout(voteTimer);
  voteTimer = setTimeout(finishVote, MATCH.voteMs);
}

function handleVote(p: Player, map: unknown): void {
  if (!roundOver || !isMapId(map)) return;
  votes.set(p.id, map);
  broadcastVotes();
}

/** Карта с большинством голосов; при равенстве (или если никто не голосовал) — случайная из лидеров. */
function finishVote(): void {
  const counts = new Map<MapId, number>(MAP_ORDER.map((m) => [m, 0]));
  for (const m of votes.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
  const best = Math.max(...counts.values());
  const leaders = MAP_ORDER.filter((m) => counts.get(m) === best);
  mapId = leaders[Math.floor(Math.random() * leaders.length)]!;
  votes.clear();
  voteTimer = undefined;
  broadcast({ t: 'newmap', map: mapId });
  matchEndsAt = Date.now() + matchMinutes * 60_000;
  resetRound();
  broadcastInfo();
  console.log(`Новый матч на карте ${mapId}`);
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** killer = null — игрока убил взорвавшийся ящик: убийство никому не засчитывается. */
function killPlayer(killer: Player | null, v: Player, w: KillWeapon, head = false): void {
  v.hp = 0;
  v.armor = 0;
  v.big = false;
  v.alive = false;
  v.deaths++;
  // Смерть обрывает серию; награды в запасе остаются
  v.streak = 0;
  sendLoadout(v);
  // Подорвавшемуся на своей ракете убийство не засчитывается
  if (killer && killer !== v) {
    killer.kills++;
    killer.profile.kills++;
    sendProfile(killer);
    // Убийства бомбой серию не продолжают
    if (w !== 'nuke' && killer.alive) addStreak(killer);
  }
  broadcast({ t: 'kill', killer: killer?.id ?? null, victim: v.id, w, head });
  // Погибший теряет ракетницу и перестаёт открывать ящик
  setRockets(v, 0);
  if (crate.state === 'opening' && crate.by === v.id) cancelOpening();
  v.respawnTimer = setTimeout(() => {
    if (players.has(v.id) && !roundOver) {
      spawn(v);
      broadcastPlayers();
    }
  }, RESPAWN_MS);
}

// ---------- серия убийств ----------
function sendLoadout(p: Player): void {
  send(p.ws, { t: 'loadout', knife: p.hasKnife, streak: p.streak, uav: p.uav, missile: p.missile, nuke: p.nuke });
}

/** Награды выдаются ровно на пороге серии: 3 — БПЛА, 4 — ракета с неба, 5 — ракетница, 7 — суперброня, 15 — бомба. */
function addStreak(p: Player): void {
  p.streak++;
  if (p.streak === STREAK.uav) p.uav++;
  if (p.streak === STREAK.missile) p.missile++;
  if (p.streak === STREAK.launcher) setRockets(p, Math.max(p.rockets, 6));
  if (p.streak === STREAK.superArmor) {
    p.armor = STREAK.superArmorHp;
    p.big = true;
  }
  if (p.streak === STREAK.nuke) p.nuke++;
  sendLoadout(p);
}

/** Применить награду из запаса. */
function useStreak(p: Player, kind: unknown): void {
  if (roundOver || (kind !== 'uav' && kind !== 'missile' && kind !== 'nuke')) return;
  const k = kind as StreakKind;
  if (p[k] <= 0) return;
  if (k === 'missile' && [...missiles.values()].some((m) => m.owner === p.id)) return;
  if (k === 'nuke' && nukeTimer) return;
  p[k]--;
  sendLoadout(p);
  if (k === 'uav') {
    p.uavUntil = Math.max(p.uavUntil, Date.now()) + STREAK.uavMs;
    for (const r of uavViewers(p)) send(r.ws, { t: 'uav', ms: p.uavUntil - Date.now() });
  } else if (k === 'missile') {
    launchMissile(p);
  } else {
    callNuke(p);
  }
}

// ---------- БПЛА ----------
/** Кто видит отметки этого БПЛА: в командах — вся команда, иначе — только хозяин. */
function uavViewers(owner: Player): Player[] {
  return [...players.values()].filter((p) => p === owner || (mode === 'tdm' && p.team === owner.team));
}
let lastPing = 0;
/** Раз в STREAK.pingMs каждому, у кого (или у чьей команды) работает БПЛА, — где сейчас противники. */
function sendPings(now: number): void {
  if (now - lastPing < STREAK.pingMs) return;
  lastPing = now;
  const seeing = new Set<Player>();
  for (const p of players.values()) {
    if (p.uavUntil > now) for (const v of uavViewers(p)) seeing.add(v);
  }
  for (const viewer of seeing) {
    const list: Array<[number, number, number]> = [];
    for (const e of players.values()) {
      if (e.alive && isEnemy(viewer, e)) list.push([e.id, +e.pos[0].toFixed(1), +e.pos[2].toFixed(1)]);
    }
    send(viewer.ws, { t: 'ping', list });
  }
}

// ---------- ракета с неба ----------
// Игрок ведёт её сам с высоты STREAK.missileHeight; сервер принимает точку попадания и взрывает по области.
interface Missile { id: number; owner: number; born: number; last: Vec3 }
const missiles = new Map<number, Missile>();
let nextMissileId = 1;

function launchMissile(p: Player): void {
  const half = MAPS[mapId].half;
  const start: Vec3 = [p.pos[0] * 0.3, STREAK.missileHeight, p.pos[2] * 0.3 + (p.pos[2] > 0 ? half.z * 0.3 : -half.z * 0.3)];
  const m: Missile = { id: nextMissileId++, owner: p.id, born: Date.now(), last: start };
  missiles.set(m.id, m);
  send(p.ws, { t: 'missile-go', id: m.id, p: start });
}

function missilePos(p: Player, msg: Incoming): void {
  const m = missiles.get(Number(msg.id));
  if (!m || m.owner !== p.id || !isVec3(msg.p)) return;
  m.last = msg.p;
  broadcast({ t: 'missile', id: m.id, by: p.id, p: msg.p }, p.id);
}

function missileHit(p: Player, msg: Incoming): void {
  const m = missiles.get(Number(msg.id));
  if (!m || m.owner !== p.id || !isVec3(msg.p)) return;
  // Ракета не может долететь быстрее, чем позволяет форсаж
  const minMs = ((STREAK.missileHeight - msg.p[1]) / STREAK.missileBoost) * 1000 * 0.8;
  if (Date.now() - m.born < minMs) return;
  detonateMissile(m, msg.p);
}

function detonateMissile(m: Missile, at: Vec3): void {
  missiles.delete(m.id);
  broadcast({ t: 'boom', id: -m.id, p: at });
  const owner = players.get(m.owner);
  if (owner) blast(owner, at, STREAK.missileRadius, 'missile');
}

/**
 * Взрыв по области: убивает противников и самого хозяина в радиусе (если их не закрывает стена).
 * Союзников не задевает.
 */
function blast(owner: Player, at: Vec3, radius: number, w: KillWeapon, from: Vec3 = [at[0], at[1] + 0.3, at[2]]): void {
  if (roundOver) return;
  const walls = MAPS[mapId].boxes;
  let killed = false;
  for (const v of players.values()) {
    if (!v.alive || (v !== owner && !isEnemy(owner, v))) continue;
    if (distToPlayer(v, at) > radius) continue;
    if (bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    killPlayer(owner, v, w);
    killed = true;
  }
  if (killed) {
    broadcastPlayers();
    checkWin();
  }
}

// ---------- бомба ----------
let nukeTimer: NodeJS.Timeout | undefined;
function callNuke(p: Player): void {
  broadcast({ t: 'nuke', by: p.id, ms: STREAK.nukeMs });
  nukeTimer = setTimeout(() => {
    nukeTimer = undefined;
    if (roundOver) return;
    const owner = players.get(p.id) ?? null;
    // Убивает вообще всех; убийства противников засчитываются вызвавшему
    for (const v of players.values()) {
      if (!v.alive) continue;
      killPlayer(owner && isEnemy(owner, v) ? owner : null, v, 'nuke');
    }
    broadcastPlayers();
    checkWin();
  }, STREAK.nukeMs);
}

// ---------- метательный нож ----------
interface Knife { id: number; owner: number; pos: Vec3; vel: Vec3; born: number }
let knives: Knife[] = [];
let nextKnifeId = 1;

function handleThrow(p: Player, msg: Incoming): void {
  if (!p.alive || !p.hasKnife || roundOver || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  const d: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  p.hasKnife = false;
  sendLoadout(p);
  const k: Knife = {
    id: nextKnifeId++, owner: p.id, pos: eyeOf(p),
    vel: [d[0] * THROW.speed, d[1] * THROW.speed, d[2] * THROW.speed], born: Date.now(),
  };
  knives.push(k);
  broadcast({ t: 'throw', id: k.id, by: p.id, o: k.pos, d });
}

function stepKnives(dt: number): void {
  if (!knives.length) return;
  const walls = MAPS[mapId].boxes;
  const now = Date.now();
  const flying: Knife[] = [];
  for (const k of knives) {
    const owner = players.get(k.owner);
    if (!owner) continue;
    k.vel[1] -= THROW.gravity * dt;
    const speed = Math.hypot(...k.vel);
    const dir: Vec3 = [k.vel[0] / speed, k.vel[1] / speed, k.vel[2] / speed];
    const step = speed * dt;
    let t = rayWorld(walls, k.pos, dir, step);
    let victim: Player | null = null;
    for (const v of players.values()) {
      if (!v.alive || !isEnemy(owner, v)) continue;
      const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
      const tv = rayBox(k.pos, dir, min, max);
      if (tv < t) { t = tv; victim = v; }
    }
    const at: Vec3 = [k.pos[0] + dir[0] * t, k.pos[1] + dir[1] * t, k.pos[2] + dir[2] * t];
    if (t < step || now - k.born > THROW.lifeMs) {
      broadcast({ t: 'thrown', id: k.id, p: at, hit: victim !== null });
      if (victim && !roundOver) {
        hurt(owner, victim, THROW.dmg, 'throw', false);
        broadcastPlayers();
        checkWin();
      }
    } else {
      k.pos = at;
      flying.push(k);
    }
  }
  knives = flying;
}

// ---------- ящик с ракетницей ----------
// Раз в CRATE.dropEveryMs с вероятностью CRATE.dropChance ящик падает с неба в одну из точек карты.
// Упав, он лежит CRATE.lifeMs; если за это время его не открыли — исчезает.
const ROCKETS_IN_CRATE = 6;
const crate: {
  state: CrateState;
  at: Vec3 | null;
  by: number | null;
  /** Где стоял открывающий: сдвинулся — открытие сорвано */
  start: Vec3;
  /** Когда закончится падение или открытие */
  until: number;
  /** Когда ящик исчезнет, если его не открыть */
  expiresAt: number;
  /** Срок вышел, пока ящик открывали: при отмене открытия он исчезнет */
  expired: boolean;
  timer?: NodeJS.Timeout;
  expireTimer?: NodeJS.Timeout;
} = { state: 'gone', at: null, by: null, start: [0, 0, 0], until: 0, expiresAt: 0, expired: false };
let dropTimer: NodeJS.Timeout | undefined;

function crateMsg(): ServerMsg {
  const now = Date.now();
  const busy = crate.state === 'falling' || crate.state === 'opening';
  const lying = crate.state === 'idle' || crate.state === 'opening';
  return {
    t: 'crate', state: crate.state, at: crate.at, by: crate.by,
    ms: busy ? Math.max(0, crate.until - now) : 0,
    left: lying ? Math.max(0, crate.expiresAt - now) : 0,
  };
}
function setCrate(state: CrateState, by: number | null = null): void {
  clearTimeout(crate.timer);
  crate.state = state;
  crate.by = by;
  broadcast(crateMsg());
}
function clearCrate(): void {
  clearTimeout(crate.expireTimer);
  crate.at = null;
  setCrate('gone');
}

function dropCrate(): void {
  const drops = MAPS[mapId].crateDrops;
  crate.at = [...drops[Math.floor(Math.random() * drops.length)]!];
  crate.until = Date.now() + CRATE.fallMs;
  setCrate('falling');
  crate.timer = setTimeout(() => {
    crate.expiresAt = Date.now() + CRATE.lifeMs;
    crate.expired = false;
    setCrate('idle');
    clearTimeout(crate.expireTimer);
    crate.expireTimer = setTimeout(() => {
      // Пока ящик открывают, не убираем его: решит исход открытия
      if (crate.state === 'idle') clearCrate();
      else crate.expired = true;
    }, CRATE.lifeMs);
  }, CRATE.fallMs);
}

/** Расписание сбросов: идёт, пока на сервере есть игроки. */
function startDrops(): void {
  clearInterval(medkitTimer);
  medkitTimer = setInterval(dropMedkit, MEDKIT.everyMs);
  clearInterval(dropTimer);
  dropTimer = setInterval(() => {
    if (crate.state === 'gone' && !roundOver && Math.random() < CRATE.dropChance) dropCrate();
  }, CRATE.dropEveryMs);
}
function stopDrops(): void {
  clearInterval(medkitTimer);
  medkitTimer = undefined;
  medkits = [];
  clearInterval(dropTimer);
  dropTimer = undefined;
  clearTimeout(crate.timer);
  clearTimeout(crate.expireTimer);
  crate.state = 'gone';
  crate.at = null;
  crate.by = null;
}

/** Отмена открытия сбрасывает прогресс; если срок ящика уже вышел — он исчезает. */
function cancelOpening(): void {
  if (crate.expired) clearCrate();
  else setCrate('idle');
}

function setRockets(p: Player, n: number): void {
  if (p.rockets === n) return;
  p.rockets = n;
  send(p.ws, { t: 'rockets', n });
}

function handleOpen(p: Player, on: boolean): void {
  if (!on) {
    if (crate.state === 'opening' && crate.by === p.id) cancelOpening();
    return;
  }
  const c = crate.at;
  if (crate.state !== 'idle' || !c || !p.alive || roundOver) return;
  if (Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]) > CRATE.reach || Math.abs(p.pos[1] - c[1]) > 1.5) return;
  crate.start = [...p.pos];
  crate.until = Date.now() + CRATE.openMs;
  setCrate('opening', p.id);
  crate.timer = setTimeout(() => {
    const opener = players.get(p.id);
    if (!opener || !opener.alive) { cancelOpening(); return; }
    const at = c;
    clearCrate();
    // Что внутри: взрыв, ракетница или броня
    const roll = Math.random();
    if (roll < CRATE.trapChance) explodeCrate(at);
    else if (roll < CRATE.trapChance + CRATE.rocketChance) setRockets(opener, ROCKETS_IN_CRATE);
    else {
      opener.armor = Math.max(opener.armor, ARMOR.amount);
      broadcastPlayers();
    }
  }, CRATE.openMs);
}

/** Ящик-ловушка: убивает всех рядом, включая открывшего и его союзников. Стена закрывает. */
function explodeCrate([cx, cy, cz]: Vec3): void {
  const map = MAPS[mapId];
  const at: Vec3 = [cx, cy + CRATE.height + 0.2, cz];
  broadcast({ t: 'boom', id: 0, p: at });
  for (const v of players.values()) {
    if (!v.alive) continue;
    const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d > CRATE.trapRadius) continue;
    const covered = bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(map.boxes, at, pt));
    if (!covered) killPlayer(null, v, 'crate');
  }
  broadcastPlayers();
}

// ---------- аптечки ----------
// Каждые MEDKIT.everyMs аптечка падает с неба в свободную точку карты (не больше MEDKIT.max сразу).
// Подобрать — подойти вплотную, если здоровье не полное.
interface Medkit { id: number; at: Vec3; landAt: number }
let medkits: Medkit[] = [];
let nextMedkitId = 1;
let medkitTimer: NodeJS.Timeout | undefined;

function medkitsMsg(): ServerMsg {
  const now = Date.now();
  return { t: 'medkits', list: medkits.map((m) => ({ id: m.id, at: m.at, ms: Math.max(0, m.landAt - now) })) };
}
function dropMedkit(): void {
  if (roundOver || medkits.length >= MEDKIT.max) return;
  const taken = (pt: Vec3) => medkits.some((m) => m.at[0] === pt[0] && m.at[2] === pt[2]);
  const free = MAPS[mapId].medkitDrops.filter((pt) => !taken(pt));
  if (!free.length) return;
  const at = free[Math.floor(Math.random() * free.length)]!;
  const kit: Medkit = { id: nextMedkitId++, at: [...at], landAt: Date.now() + MEDKIT.fallMs };
  medkits.push(kit);
  broadcast(medkitsMsg());
  // Не подобрали за MEDKIT.lifeMs после приземления — аптечка исчезает
  setTimeout(() => {
    const i = medkits.indexOf(kit);
    if (i < 0) return;
    medkits.splice(i, 1);
    broadcast(medkitsMsg());
  }, MEDKIT.fallMs + MEDKIT.lifeMs);
}
function clearMedkits(): void {
  medkits = [];
  broadcast(medkitsMsg());
}
function pickMedkit(p: Player): void {
  if (!p.alive || p.hp >= 100 || !medkits.length) return;
  const now = Date.now();
  const i = medkits.findIndex((m) => now >= m.landAt &&
    Math.hypot(p.pos[0] - m.at[0], p.pos[2] - m.at[2]) <= MEDKIT.reach && Math.abs(p.pos[1] - m.at[1]) <= 1.2);
  if (i < 0) return;
  medkits.splice(i, 1);
  p.hp = Math.min(100, p.hp + MEDKIT.heal);
  broadcast(medkitsMsg());
  broadcastPlayers();
}

// ---------- ракеты ----------
interface Rocket { id: number; owner: number; pos: Vec3; dir: Vec3; born: number }
let rockets: Rocket[] = [];
let nextRocketId = 1;

function isEnemy(a: Player, b: Player): boolean {
  return a.id !== b.id && (mode === 'ffa' || a.team !== b.team);
}

function handleRocket(p: Player, msg: Incoming): void {
  if (!p.alive || p.rockets <= 0 || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  const now = Date.now();
  if (len < 0.5 || now - p.lastShot < WEAPONS.rocket.rate * 0.7) return;
  p.lastShot = now;
  setRockets(p, p.rockets - 1);
  const dir: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const pos = eyeOf(p);
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
    // Взрыв задевает противников и самого стрелка, если он слишком близко; союзников — нет
    if (!v.alive || (v !== owner && !isEnemy(owner, v))) continue;
    // Расстояние от взрыва до ближайшей точки игрока
    if (distToPlayer(v, at) > ROCKET.radius) continue;
    const covered = bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt));
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
      const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
      t = Math.min(t, rayBox(r.pos, r.dir, min, max));
    }
    const at: Vec3 = [r.pos[0] + r.dir[0] * t, r.pos[1] + r.dir[1] * t, r.pos[2] + r.dir[2] * t];
    if (t < step || now - r.born > ROCKET.lifeMs) explode(r, at);
    else { r.pos = at; flying.push(r); }
  }
  rockets = flying;
}

function scaleOf(p: Player): number {
  return p.big ? STREAK.bigScale : 1;
}
function eyeOf(p: Player): Vec3 {
  return [p.pos[0], p.pos[1] + (p.slide ? SLIDE.eye : PLAYER.eye) * scaleOf(p), p.pos[2]];
}
/** Расстояние от точки до ближайшей точки хитбокса игрока. */
function distToPlayer(v: Player, at: Vec3): number {
  const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
  return Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
}

/** T: эмодзи на стене. Не чаще раза в минуту, только на вертикальной стене рядом с игроком. */
function handleSpray(p: Player, msg: Incoming): void {
  const now = Date.now();
  if (!p.alive || now - p.lastSpray < SPRAY.cooldownMs || !isVec3(msg.p)) return;
  const n = msg.n;
  if (!Array.isArray(n) || n.length !== 2) return;
  const [nx, nz] = n as unknown[];
  const axis = (a: unknown, b: unknown) => (a === 1 || a === -1) && b === 0;
  if (!axis(nx, nz) && !axis(nz, nx)) return;
  if (!Number.isInteger(msg.e) || (msg.e as number) < 0 || (msg.e as number) >= EMOJIS.length) return;
  const eye = eyeOf(p);
  if (Math.hypot(msg.p[0] - eye[0], msg.p[1] - eye[1], msg.p[2] - eye[2]) > SPRAY.reach + 1) return;
  p.lastSpray = now;
  broadcast({ t: 'spray', by: p.id, p: msg.p, n: [nx as number, nz as number], e: msg.e as number });
}

/** Урон сначала снимает броню, потом здоровье. */
function hurt(attacker: Player, v: Player, dmg: number, w: KillWeapon, head: boolean): void {
  const absorbed = Math.min(v.armor, dmg);
  v.armor = Math.round(v.armor - absorbed);
  if (v.armor <= 0) v.big = false; // суперброня кончилась — игрок снова обычного размера
  v.hp = Math.max(0, Math.round(v.hp - (dmg - absorbed)));
  if (v.hp <= 0) killPlayer(attacker, v, w, head);
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
  const eye = eyeOf(p);
  const walls = MAPS[mapId].boxes;
  const count = (v: unknown) => Math.max(0, Math.floor(Number(v)) || 0);
  for (const [idStr, raw] of Object.entries(msg.hits)) {
    const v = players.get(Number(idStr));
    if (!v || !v.alive || v.id === p.id) continue;
    if (mode === 'tdm' && v.team === p.team) continue;
    // Нож бьёт только вплотную (с запасом на задержку сети) и только если он не брошен
    if (w.melee && (!p.hasKnife || distToPlayer(v, eye) > w.melee + 0.75)) continue;
    // Проверка, что между стрелком и целью нет стены
    if (bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, eye, pt))) continue;

    const [rawBody, rawHead] = Array.isArray(raw) ? raw : [raw, 0];
    let head = Math.min(count(rawHead), budget);
    budget -= head;
    let body = Math.min(count(rawBody), budget);
    budget -= body;
    if (head + body === 0) continue;
    // Голову засчитываем, только если её видно и игрок стоит (в подкате головы как зоны нет)
    const headPt: Vec3 = [v.pos[0], v.pos[1] + (PLAYER.h - 0.1) * scaleOf(v), v.pos[2]];
    if (head && (v.slide || !lineOfSight(walls, eye, headPt))) { body += head; head = 0; }

    if (w.melee) { killPlayer(p, v, weaponId); continue; }
    if (head && w.headKill) { killPlayer(p, v, weaponId, true); continue; }
    let dmg = w.dmg;
    if (weaponId === 'shotgun') {
      const dist = Math.hypot(v.pos[0] - p.pos[0], v.pos[2] - p.pos[2]);
      dmg *= Math.max(0.3, Math.min(1, 1 - (dist - 8) / 30));
    }
    hurt(p, v, dmg * body + dmg * HEAD.mul * head, weaponId, head > 0);
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
    const minutes = Number(msg.minutes);
    matchMinutes = (MATCH.minutes as readonly number[]).includes(minutes) ? minutes : 10;
    matchEndsAt = Date.now() + matchMinutes * 60_000;
    roundOver = false;
    clearTimeout(voteTimer);
    votes.clear();
    stopDrops();
    startDrops();
    rockets = [];
  }
  let team: Team = msg.team === 'red' ? 'red' : 'green';
  if (mode === 'tdm' && teamCount(team) >= TEAM_SIZE) team = team === 'red' ? 'green' : 'red';

  const rawName = typeof msg.name === 'string' ? msg.name : '';
  const name = rawName.replace(/[<>&]/g, '').trim().slice(0, 14) || 'Игрок';
  const p: Player = {
    id: nextId++, ws, name, team,
    pos: [0, 0, 0], yaw: 0, pitch: 0, w: 'pistol', slide: false,
    hp: 100, armor: 0, alive: false, kills: 0, deaths: 0, lastShot: 0, lastSpray: 0,
    profile: decodeProfile(msg.token),
    rockets: 0,
    hasKnife: true, streak: 0, uav: 0, missile: 0, nuke: 0, uavUntil: 0, big: false,
  };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, mode, map: mapId });
  if (roundOver) send(ws, voteMsg(p));
  sendProfile(p);
  send(ws, crateMsg());
  send(ws, medkitsMsg());
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
      me.slide = me.alive && msg.sl === true;
      pickMedkit(me);
      // Во время открытия ящика двигаться нельзя: сдвинулся — открытие сорвано
      if (crate.state === 'opening' && crate.by === me.id &&
          Math.hypot(me.pos[0] - crate.start[0], me.pos[1] - crate.start[1], me.pos[2] - crate.start[2]) > 0.5) {
        cancelOpening();
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
    } else if (msg.t === 'spray') {
      handleSpray(me, msg);
    } else if (msg.t === 'throw') {
      handleThrow(me, msg);
    } else if (msg.t === 'use') {
      useStreak(me, msg.kind);
    } else if (msg.t === 'mpos') {
      missilePos(me, msg);
    } else if (msg.t === 'mhit') {
      missileHit(me, msg);
    } else if (msg.t === 'vote') {
      handleVote(me, msg.map);
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
    votes.delete(me.id);
    for (const [id, m] of missiles) if (m.owner === me.id) missiles.delete(id);
    if (crate.state === 'opening' && crate.by === me.id) cancelOpening();
    console.log(`- ${me.name}, игроков: ${players.size}`);
    if (players.size === 0) {
      clearTimeout(voteTimer);
      voteTimer = undefined;
      clearTimeout(nukeTimer);
      nukeTimer = undefined;
      votes.clear();
      roundOver = false;
      stopDrops();
    }
    broadcastPlayers();
    broadcastInfo();
  });
  ws.on('error', () => {});
});

// Рассылка позиций 20 раз в секунду
setInterval(() => {
  stepRockets(0.05);
  stepKnives(0.05);
  const now = Date.now();
  if (players.size) {
    sendPings(now);
    // Ракета с неба, которую не довели до цели, взрывается сама
    for (const m of missiles.values()) if (now - m.born > STREAK.missileMaxMs) detonateMissile(m, m.last);
    // Время матча вышло
    if (!roundOver && now >= matchEndsAt) endMatch(winnerByScore());
  }
  if (players.size < 2) return;
  const ps: SnapRow[] = [];
  for (const p of players.values()) {
    ps.push([p.id, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch, p.w, p.slide ? 1 : 0]);
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
