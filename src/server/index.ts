// Сервер: раздаёт статику и ведёт одну игровую комнату на 4 игроков.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  AMMO_PACK, ARMOR, CRATE, DEFAULT_KIT, DOOR, GRENADE, GUNSHIP, HEAD, MAPS, MAP_ORDER, MATCH, MEDKIT, PLAYER, ROCKET, SLIDE, STREAK, THROW, WEAPONS,
  WEATHER, bodyPoints, clipWalls, gunshipPos, isKit, stepGrenade, isMapId, isWeapon, lineOfSight, playerBox, rayBox, rayWorld,
  type Box, type LimitKind, type MapId, type StreakKind, type WeatherKind,
} from '../shared/map.js';
import { chooseSpawn } from './spawn.js';
import { isStat, maxLevel, pointsLeft, type Profile } from '../shared/progress.js';
import { decodeProfile, encodeProfile } from './progress.js';
import { EMOJIS, SPRAY } from '../shared/emoji.js';
import { rankOf } from '../shared/ranks.js';
import type {
  CrateState, InfoMsg, KillWeapon, MeleeKind, Mode, ServerMsg, SnapRow, Team, Vec3, WeaponId, Winner,
} from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 4;
const TEAM_SIZE = 2;
const RESPAWN_MS = 3000;

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
  /** Что в слоте 1: нож или граната (выбор действует со следующей жизни) */
  melee: MeleeKind;
  /** Гранат в руках (одна на жизнь) */
  grenades: number;
  /** Когда сорвана чека гранаты в руке (0 — не держит) */
  cookStart: number;
  /** Метательный нож: один на жизнь */
  hasKnife: boolean;
  /** Убийств подряд без смерти */
  streak: number;
  /** Запас наград за серию: их можно применить и после смерти */
  uav: number;
  /** Самолёт в запасе */
  gunship: number;
  missile: number;
  nuke: number;
  /** До какого момента работает БПЛА этого игрока */
  uavUntil: number;
  /** Суперброня: игрок в 1,5 раза больше */
  big: boolean;
  /** Шлем Джаггернаута: сколько попаданий в голову ещё выдержит */
  helmet: number;
  /** Выбранные стволы (не больше двух), нож — всегда */
  kit: WeaponId[];
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
/** Матч ограничен временем (минуты) или числом убийств — на выбор первого игрока */
let limitKind: LimitKind = 'time';
let limitValue = 10;
let matchEndsAt = 0;
function startMatchClock(): void {
  matchEndsAt = limitKind === 'time' ? Date.now() + limitValue * 60_000 : Infinity;
}
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
  return { t: 'info', mode, map: mapId, limitKind, limitValue, count: players.size, green: teamCount('green'), red: teamCount('red'), max: MAX_PLAYERS };
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
    limit: limitKind === 'kills' ? limitValue : 0,
    left: roundOver || limitKind !== 'time' ? 0 : Math.max(0, matchEndsAt - Date.now()),
    scores: teamScores(),
    list: [...players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, armor: p.armor, alive: p.alive, kills: p.kills, deaths: p.deaths,
      big: p.big, rank: rankOf(p.profile.kills), helmet: p.helmet,
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
  p.helmet = 0;
  p.slide = false;
  // Нож или граната возвращаются после смерти — смотря что выбрано
  p.hasKnife = p.melee === 'knife';
  p.grenades = p.melee === 'grenade' ? 1 : 0;
  p.cookStart = 0;
  p.alive = true;
  sendLoadout(p);
  broadcast({ t: 'spawn', id: p.id, p: p.pos, yaw: p.yaw });
}

function resetRound(): void {
  roundOver = false;
  resetBreakables();
  endGunship(null);
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
  grenades = [];
  missiles.clear();
  clearCrate();
  clearMedkits();
  clearAmmoPacks();
  for (const p of players.values()) spawn(p);
  broadcast({ t: 'reset' });
  broadcastPlayers();
}

/** Матч кончается по лимиту убийств или по времени; дальше — голосование за карту. */
function checkWin(): void {
  if (roundOver) return;
  let winner: Winner | null = null;
  if (limitKind !== 'kills') return;
  if (mode === 'tdm') {
    const s = teamScores();
    if (s.green >= limitValue) winner = { team: 'green' };
    else if (s.red >= limitValue) winner = { team: 'red' };
  } else {
    for (const p of players.values()) if (p.kills >= limitValue) winner = { id: p.id, name: p.name };
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
  endGunship(null);
  votes.clear();
  rockets = [];
  knives = [];
  grenades = [];
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
  startMatchClock();
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
  v.helmet = 0;
  v.alive = false;
  v.deaths++;
  // Смерть обрывает серию; награды в запасе остаются
  v.streak = 0;
  sendLoadout(v);
  // Подорвавшемуся на своей ракете убийство не засчитывается
  if (killer && killer !== v) {
    killer.kills++;
    const rankBefore = rankOf(killer.profile.kills);
    killer.profile.kills++;
    sendProfile(killer);
    const rank = rankOf(killer.profile.kills);
    if (rank > rankBefore) send(killer.ws, { t: 'promoted', rank });
    // Убийства бомбой серию не продолжают
    if (w !== 'nuke' && killer.alive) addStreak(killer);
  }
  broadcast({ t: 'kill', killer: killer?.id ?? null, victim: v.id, w, head });
  // Убит с сорванной чекой — граната выпадает из руки и взорвётся по своему отсчёту
  if (v.cookStart) dropCookedGrenade(v);
  // Погибший теряет ракетницу и перестаёт открывать ящик, а на месте гибели остаются патроны
  setRockets(v, 0);
  dropAmmo(v.pos);
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
  send(p.ws, {
    t: 'loadout', knife: p.hasKnife, grenades: p.grenades, streak: p.streak, uav: p.uav, missile: p.missile, nuke: p.nuke, gunship: p.gunship,
  });
}

/** Награды выдаются ровно на пороге серии: 3 — БПЛА, 4 — ракета с неба, 5 — ракетница, 7 — суперброня, 15 — бомба. */
function addStreak(p: Player): void {
  p.streak++;
  if (p.streak === STREAK.uav) p.uav++;
  if (p.streak === STREAK.missile) p.missile++;
  if (p.streak === STREAK.launcher) setRockets(p, Math.max(p.rockets, 6));
  if (p.streak === STREAK.superArmor) {
    // Джаггернаут: суперброня, полтора размера и шлем, который держит выстрелы в голову
    p.armor = STREAK.superArmorHp;
    p.big = true;
    p.helmet = STREAK.helmetHits;
  }
  if (p.streak === GUNSHIP.streak) p.gunship++;
  if (p.streak === STREAK.nuke) p.nuke++;
  sendLoadout(p);
}

/** Применить награду из запаса. */
function useStreak(p: Player, kind: unknown): void {
  if (roundOver || (kind !== 'uav' && kind !== 'missile' && kind !== 'nuke' && kind !== 'gunship')) return;
  const k = kind as StreakKind;
  if (p[k] <= 0) return;
  if (k === 'missile' && [...missiles.values()].some((m) => m.owner === p.id)) return;
  if (k === 'nuke' && nukeTimer) return;
  if (k === 'gunship' && gunship) return; // в небе одновременно только один самолёт
  p[k]--;
  sendLoadout(p);
  if (k === 'uav') {
    p.uavUntil = Math.max(p.uavUntil, Date.now()) + STREAK.uavMs;
    for (const r of uavViewers(p)) send(r.ws, { t: 'uav', ms: p.uavUntil - Date.now() });
  } else if (k === 'missile') {
    launchMissile(p);
  } else if (k === 'gunship') {
    launchGunship(p);
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
  blastBreakables(at, STREAK.missileRadius);
  const owner = players.get(m.owner);
  if (owner) blast(owner, at, STREAK.missileRadius, 'missile');
}

/**
 * Взрыв по области: убивает противников и самого хозяина в радиусе (если их не закрывает стена).
 * Союзников не задевает.
 */
function blast(owner: Player, at: Vec3, radius: number, w: KillWeapon, from: Vec3 = [at[0], at[1] + 0.3, at[2]]): void {
  if (roundOver) return;
  const walls = worldBoxes();
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

// ---------- самолёт ----------
// Летит сам по кругу над картой (gunshipPos), хозяин только стреляет. Сбивают двумя попаданиями из ракетницы.
interface Gunship { id: number; owner: number; phase: number; start: number; hits: number; lastGun: number; lastRocket: number }
let gunship: Gunship | null = null;
let nextGunshipId = 1;

function gunshipNow(g: Gunship, now = Date.now()): Vec3 {
  return gunshipPos(MAPS[mapId].half, g.phase, (now - g.start) / 1000);
}
function gunshipMsg(g: Gunship): ServerMsg {
  const elapsed = Date.now() - g.start;
  return { t: 'gunship', id: g.id, by: g.owner, phase: g.phase, ms: Math.max(0, GUNSHIP.ms - elapsed), elapsed };
}
function launchGunship(p: Player): void {
  gunship = {
    id: nextGunshipId++, owner: p.id, phase: Math.random() * Math.PI * 2, start: Date.now(),
    hits: 0, lastGun: 0, lastRocket: 0,
  };
  broadcast(gunshipMsg(gunship));
}
/** Самолёт улетел (by = null) или сбит (by — кто сбил). */
function endGunship(by: Player | null): void {
  if (!gunship) return;
  const at = gunshipNow(gunship);
  broadcast({ t: 'gunship-end', id: gunship.id, by: by?.id ?? null, p: at });
  if (by) broadcast({ t: 'boom', id: -1000 - gunship.id, p: at });
  gunship = null;
}

/** Очередь пулемёта: попадания проверяем от самолёта, а не от тела стрелка. */
function gunshipFire(p: Player, msg: Incoming): void {
  const g = gunship;
  const now = Date.now();
  if (!g || g.owner !== p.id || roundOver || now - g.lastGun < GUNSHIP.gunRateMs * 0.7) return;
  g.lastGun = now;
  const from = gunshipNow(g, now);
  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, 1).filter(isVec3) : [];
  broadcast({ t: 'gsshot', id: g.id, ends }, p.id);
  if (typeof msg.hits !== 'object' || msg.hits === null) return;
  const walls = worldBoxes();
  let budget = 1;
  for (const idStr of Object.keys(msg.hits)) {
    const v = players.get(Number(idStr));
    if (!v || !v.alive || budget <= 0 || !isEnemy(p, v)) continue;
    if (bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    budget--;
    hurt(p, v, GUNSHIP.gunDmg, 'gunship', false);
  }
  broadcastPlayers();
  checkWin();
}

/** Ракета самолёта: раз в GUNSHIP.rocketCdMs, вылетает из самолёта. */
function gunshipRocket(p: Player, msg: Incoming): void {
  const g = gunship;
  const now = Date.now();
  if (!g || g.owner !== p.id || roundOver || !isVec3(msg.d) || now - g.lastRocket < GUNSHIP.rocketCdMs * 0.9) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  g.lastRocket = now;
  const dir: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const pos = gunshipNow(g, now);
  const r: Rocket = { id: nextRocketId++, owner: p.id, pos, dir, born: now, fromGunship: true };
  rockets.push(r);
  broadcast({ t: 'rocket', id: r.id, by: p.id, o: pos, d: dir });
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

// ---------- граната ----------
interface Grenade { id: number; owner: number; pos: Vec3; vel: Vec3; explodeAt: number }
let grenades: Grenade[] = [];
let nextGrenadeId = 1;

/** Зажал ЛКМ с гранатой — чека сорвана, пошёл отсчёт. */
function pullPin(p: Player): void {
  if (!p.alive || roundOver || p.grenades <= 0 || p.cookStart) return;
  p.grenades--;
  p.cookStart = Date.now();
  sendLoadout(p);
}
function spawnGrenade(p: Player, pos: Vec3, vel: Vec3): void {
  grenades.push({ id: nextGrenadeId++, owner: p.id, pos, vel, explodeAt: p.cookStart + GRENADE.fuseMs });
  p.cookStart = 0;
}
/** Отпустил ЛКМ — бросок: сколько держал, столько отсчёта уже прошло. */
function throwGrenade(p: Player, msg: Incoming): void {
  if (!p.alive || !p.cookStart || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  const d: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const eye = eyeOf(p);
  spawnGrenade(p, [eye[0] + d[0] * 0.4, eye[1] + d[1] * 0.4, eye[2] + d[2] * 0.4],
    [d[0] * GRENADE.speed, d[1] * GRENADE.speed + GRENADE.lift, d[2] * GRENADE.speed]);
}
function dropCookedGrenade(p: Player): void {
  spawnGrenade(p, [p.pos[0], p.pos[1] + 0.3, p.pos[2]], [0, 0, 0]);
}

/**
 * Взрыв гранаты: в killR — насмерть, дальше урон падает до нуля к maxR; стена закрывает.
 * Задевает противников и самого бросившего, союзников — нет.
 */
function explodeGrenade(ownerId: number, at: Vec3, id: number): void {
  broadcast({ t: 'boom', id: -5000 - id, p: at });
  blastBreakables(at, GRENADE.maxR * 0.6);
  const owner = players.get(ownerId);
  if (!owner || roundOver) return;
  const walls = worldBoxes();
  const from: Vec3 = [at[0], at[1] + 0.2, at[2]];
  for (const v of players.values()) {
    if (!v.alive || (v !== owner && !isEnemy(owner, v))) continue;
    const d = distToPlayer(v, at);
    if (d > GRENADE.maxR) continue;
    if (bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    if (d <= GRENADE.killR) killPlayer(owner, v, 'grenade');
    else hurt(owner, v, GRENADE.maxDmg * (1 - (d - GRENADE.killR) / (GRENADE.maxR - GRENADE.killR)), 'grenade', false);
  }
  broadcastPlayers();
  checkWin();
}

function stepGrenades(dt: number, now: number): void {
  // Передержал — граната взрывается в руке
  for (const p of players.values()) {
    if (p.cookStart && now - p.cookStart >= GRENADE.fuseMs) {
      p.cookStart = 0;
      explodeGrenade(p.id, eyeOf(p), nextGrenadeId++);
    }
  }
  if (!grenades.length) return;
  // Отскакивает от всех блоков карты и от невидимых стен по краю
  const solids = [...worldBoxes(), ...clipWalls(MAPS[mapId].half)];
  const left: Grenade[] = [];
  for (const g of grenades) {
    for (let i = 0; i < 5; i++) stepGrenade(solids, g, dt / 5);
    if (now >= g.explodeAt) explodeGrenade(g.owner, [...g.pos], g.id);
    else left.push(g);
  }
  grenades = left;
  broadcast({
    t: 'grenades',
    list: grenades.map((g) => [g.id, +g.pos[0].toFixed(2), +g.pos[1].toFixed(2), +g.pos[2].toFixed(2), g.explodeAt - now]),
  });
}

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
  const walls = worldBoxes();
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
      // Хитбокс для ножа чуть шире, чтобы бросок «впритирку» по краю засчитывался
      const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
      const pad = THROW.pad;
      const tv = rayBox(k.pos, dir, [min[0] - pad, min[1] - pad, min[2] - pad], [max[0] + pad, max[1] + pad, max[2] + pad]);
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
  if (!drops.length) return;
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
  ammoPacks = [];
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
  const at: Vec3 = [cx, cy + CRATE.height + 0.2, cz];
  broadcast({ t: 'boom', id: 0, p: at });
  blastBreakables(at, CRATE.trapRadius);
  for (const v of players.values()) {
    if (!v.alive) continue;
    const [min, max] = playerBox(v.pos, v.yaw, v.slide, scaleOf(v));
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d > CRATE.trapRadius) continue;
    const covered = bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(worldBoxes(), at, pt));
    if (!covered) killPlayer(null, v, 'crate');
  }
  broadcastPlayers();
}

// ---------- стёкла и двери ----------
// Целые разрушаемые блоки твёрдые: закрывают видимость, останавливают пули, ракеты и гранаты.
const brokenIds = new Set<number>();
const breakHp = new Map<number, number>();
/** Открытые двери не мешают ни движению, ни выстрелам */
const openDoors = new Set<number>();
let solidsVersion = 0;
let solidCache: { map: MapId; version: number; boxes: Box[] } | null = null;

/** Неподвижная геометрия карты плюс ещё не разбитые стёкла и закрытые двери. */
function worldBoxes(): Box[] {
  if (solidCache && solidCache.map === mapId && solidCache.version === solidsVersion) return solidCache.boxes;
  const map = MAPS[mapId];
  const intact = (map.breakables ?? []).filter((x) => !brokenIds.has(x.id) && !openDoors.has(x.id)).map((x) => x.box);
  solidCache = { map: mapId, version: solidsVersion, boxes: [...map.boxes, ...intact] };
  return solidCache.boxes;
}

/** F у двери: открыть или закрыть. Закрыть нельзя, если в проёме стоит игрок — он бы застрял. */
function toggleDoor(p: Player, id: unknown): void {
  const door = (MAPS[mapId].breakables ?? []).find((x) => x.id === id && x.kind === 'door');
  if (!door || !p.alive || brokenIds.has(door.id)) return;
  const { min, max } = door.box;
  const d = distToPlayer(p, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
  if (d > DOOR.reach) return;
  if (openDoors.has(door.id)) {
    const r = PLAYER.w / 2;
    const blocked = [...players.values()].some((v) => v.alive && v.pos[0] + r > min[0] && v.pos[0] - r < max[0] &&
      v.pos[1] + PLAYER.h > min[1] && v.pos[1] < max[1] && v.pos[2] + r > min[2] && v.pos[2] - r < max[2]);
    if (blocked) return;
    openDoors.delete(door.id);
  } else openDoors.add(door.id);
  solidsVersion++;
  broadcast({ t: 'doors', open: [...openDoors] });
}

function resetBreakables(): void {
  brokenIds.clear();
  breakHp.clear();
  openDoors.clear();
  solidsVersion++;
  broadcast({ t: 'doors', open: [] });
  for (const x of MAPS[mapId].breakables ?? []) breakHp.set(x.id, x.hp);
  solidCache = null;
  broadcast({ t: 'breaks', broken: [] });
}
function damageBreakable(id: number, dmg: number): void {
  if (brokenIds.has(id) || !breakHp.has(id)) return;
  const hp = (breakHp.get(id) ?? 0) - dmg;
  breakHp.set(id, hp);
  if (hp > 0) return;
  brokenIds.add(id);
  solidsVersion++;
  broadcast({ t: 'breaks', broken: [...brokenIds] });
}
/** Взрыв рядом — стекло бьётся сразу, двери получают большой урон. */
function blastBreakables(at: Vec3, radius: number): void {
  for (const x of MAPS[mapId].breakables ?? []) {
    const { min, max } = x.box;
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d <= radius) damageBreakable(x.id, 200);
  }
}

// ---------- погода ----------
let weather: { kind: WeatherKind; until: number } | null = null;
let lastWeatherRoll = 0;
function weatherMsg(): ServerMsg {
  const now = Date.now();
  return weather && weather.until > now
    ? { t: 'weather', kind: weather.kind, ms: weather.until - now }
    : { t: 'weather', kind: null, ms: 0 };
}
/** Раз в WEATHER.everyMs с вероятностью WEATHER.chance — дождь или снег на минуту. */
function stepWeather(now: number): void {
  if (weather && now >= weather.until) {
    weather = null;
    broadcast(weatherMsg());
  }
  if (!lastWeatherRoll) lastWeatherRoll = now;
  if (now - lastWeatherRoll < WEATHER.everyMs) return;
  lastWeatherRoll = now;
  if (weather || roundOver || Math.random() >= WEATHER.chance) return;
  weather = { kind: Math.random() < 0.5 ? 'rain' : 'snow', until: now + WEATHER.ms };
  broadcast(weatherMsg());
}

// ---------- патроны с трупов ----------
interface AmmoPack { id: number; at: Vec3; until: number }
let ammoPacks: AmmoPack[] = [];
let nextPackId = 1;

function packsMsg(): ServerMsg {
  return { t: 'ammopacks', list: ammoPacks.map((a) => ({ id: a.id, at: a.at })) };
}
function dropAmmo(pos: Vec3): void {
  if (roundOver) return;
  ammoPacks.push({ id: nextPackId++, at: [pos[0], pos[1], pos[2]], until: Date.now() + AMMO_PACK.lifeMs });
  broadcast(packsMsg());
}
function clearAmmoPacks(): void {
  ammoPacks = [];
  broadcast(packsMsg());
}
/** Подобрать патроны — подойти вплотную; сам пополняет запас клиент (половина полного запаса к своим стволам). */
function pickAmmo(p: Player): void {
  if (!p.alive || !ammoPacks.length) return;
  const i = ammoPacks.findIndex((a) =>
    Math.hypot(p.pos[0] - a.at[0], p.pos[2] - a.at[2]) <= AMMO_PACK.reach && Math.abs(p.pos[1] - a.at[1]) <= 1.2);
  if (i < 0) return;
  ammoPacks.splice(i, 1);
  send(p.ws, { t: 'ammo' });
  broadcast(packsMsg());
}
function expireAmmoPacks(now: number): void {
  const before = ammoPacks.length;
  ammoPacks = ammoPacks.filter((a) => a.until > now);
  if (ammoPacks.length !== before) broadcast(packsMsg());
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
interface Rocket { id: number; owner: number; pos: Vec3; dir: Vec3; born: number; fromGunship?: boolean }
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
  blastBreakables(at, r.fromGunship ? GUNSHIP.rocketRadius : ROCKET.radius);
  const owner = players.get(r.owner);
  if (!owner || roundOver) return;
  const walls = worldBoxes();
  // Точку взрыва чуть отодвигаем от поверхности, иначе она сама закроет обзор
  const from: Vec3 = [at[0] - r.dir[0] * 0.2, at[1] - r.dir[1] * 0.2, at[2] - r.dir[2] * 0.2];
  let killed = false;
  for (const v of players.values()) {
    // Взрыв задевает противников и самого стрелка, если он слишком близко; союзников — нет.
    // Ракета самолёта хозяина не задевает: он в небе
    if (!v.alive || (v !== owner && !isEnemy(owner, v)) || (r.fromGunship && v === owner)) continue;
    // Расстояние от взрыва до ближайшей точки игрока
    if (distToPlayer(v, at) > (r.fromGunship ? GUNSHIP.rocketRadius : ROCKET.radius)) continue;
    const covered = bodyPoints(v.pos, v.slide, scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt));
    if (covered) continue; // за стеной взрыв не достаёт
    killPlayer(owner, v, r.fromGunship ? 'gunship' : 'rocket');
    killed = true;
  }
  if (killed) {
    broadcastPlayers();
    checkWin();
  }
}

function stepRockets(dt: number): void {
  if (!rockets.length) return;
  const walls = worldBoxes();
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
    // Ракета из ракетницы может попасть в чужой самолёт
    let hitPlane = false;
    if (gunship && !r.fromGunship && isEnemy(owner, players.get(gunship.owner) ?? owner)) {
      const c = gunshipNow(gunship, now), h = GUNSHIP.half;
      const tp = rayBox(r.pos, r.dir, [c[0] - h[0], c[1] - h[1], c[2] - h[2]], [c[0] + h[0], c[1] + h[1], c[2] + h[2]]);
      if (tp < t) { t = tp; hitPlane = true; }
    }
    const at: Vec3 = [r.pos[0] + r.dir[0] * t, r.pos[1] + r.dir[1] * t, r.pos[2] + r.dir[2] * t];
    if (t < step || now - r.born > ROCKET.lifeMs) {
      explode(r, at);
      if (hitPlane && gunship) {
        gunship.hits++;
        broadcast({ t: 'gunship-hit', id: gunship.id, left: GUNSHIP.hitsToDown - gunship.hits });
        if (gunship.hits >= GUNSHIP.hitsToDown) endGunship(owner);
      }
    } else { r.pos = at; flying.push(r); }
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
  // Суперброня кончилась — игрок снова обычного размера и без шлема
  if (v.armor <= 0) { v.big = false; v.helmet = 0; }
  v.hp = Math.max(0, Math.round(v.hp - (dmg - absorbed)));
  if (v.hp <= 0) killPlayer(attacker, v, w, head);
}

function handleShoot(p: Player, msg: Incoming): void {
  if (!isWeapon(msg.w) || msg.w === 'rocket' || !p.alive) return;
  // Стрелять можно только из своего набора; нож есть всегда
  if (msg.w !== 'knife' && !p.kit.includes(msg.w)) return;
  const weaponId = msg.w;
  const w = WEAPONS[weaponId];
  const now = Date.now();
  if (now - p.lastShot < w.rate * 0.7) return;
  p.lastShot = now;

  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, w.pellets).filter(isVec3) : [];
  broadcast({ t: 'shot', id: p.id, w: weaponId, ends }, p.id);

  // Пули по стёклам и дверям
  if (!roundOver && typeof msg.brk === 'object' && msg.brk !== null) {
    let left = w.pellets;
    for (const [idStr, nRaw] of Object.entries(msg.brk)) {
      const n = Math.min(left, Math.max(0, Math.floor(Number(nRaw)) || 0));
      left -= n;
      if (n > 0) damageBreakable(Number(idStr), w.dmg * n);
    }
  }
  if (roundOver || typeof msg.hits !== 'object' || msg.hits === null) return;
  let budget = w.pellets;
  const eye = eyeOf(p);
  const walls = worldBoxes();
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
    // Шлем Джаггернаута: выстрел в голову урона не наносит, а только сбивает шлем (одно попадание за выстрел)
    if (head && v.helmet > 0) {
      v.helmet--;
      head = 0;
      broadcast({ t: 'helmet', id: v.id, by: p.id, left: v.helmet });
      if (body === 0) { broadcastPlayers(); continue; }
    }

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
    const value = Number(msg.limitValue);
    if (msg.limitKind === 'kills' && (MATCH.kills as readonly number[]).includes(value)) {
      limitKind = 'kills';
      limitValue = value;
    } else {
      limitKind = 'time';
      limitValue = (MATCH.minutes as readonly number[]).includes(value) ? value : 10;
    }
    startMatchClock();
    roundOver = false;
    resetBreakables();
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
    hasKnife: true, streak: 0, uav: 0, missile: 0, nuke: 0, gunship: 0, uavUntil: 0, big: false, helmet: 0,
    kit: isKit(msg.kit) ? msg.kit : [...DEFAULT_KIT],
    melee: msg.melee === 'grenade' ? 'grenade' : 'knife', grenades: 0, cookStart: 0,
  };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, mode, map: mapId });
  if (roundOver) send(ws, voteMsg(p));
  sendProfile(p);
  send(ws, crateMsg());
  send(ws, medkitsMsg());
  send(ws, packsMsg());
  send(ws, weatherMsg());
  send(ws, { t: 'breaks', broken: [...brokenIds] });
  send(ws, { t: 'doors', open: [...openDoors] });
  if (gunship) send(ws, gunshipMsg(gunship));
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
      pickAmmo(me);
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
    } else if (msg.t === 'gsfire') {
      gunshipFire(me, msg);
    } else if (msg.t === 'pin') {
      pullPin(me);
    } else if (msg.t === 'gthrow') {
      throwGrenade(me, msg);
    } else if (msg.t === 'door') {
      toggleDoor(me, msg.id);
    } else if (msg.t === 'melee') {
      // Новый выбор вступит в силу со следующей жизни
      if (msg.kind === 'knife' || msg.kind === 'grenade') me.melee = msg.kind;
    } else if (msg.t === 'gsrocket') {
      gunshipRocket(me, msg);
    } else if (msg.t === 'mhit') {
      missileHit(me, msg);
    } else if (msg.t === 'kit') {
      if (isKit(msg.guns)) me.kit = msg.guns;
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
    if (gunship?.owner === me.id) endGunship(null);
    if (crate.state === 'opening' && crate.by === me.id) cancelOpening();
    console.log(`- ${me.name}, игроков: ${players.size}`);
    if (players.size === 0) {
      clearTimeout(voteTimer);
      voteTimer = undefined;
      clearTimeout(nukeTimer);
      nukeTimer = undefined;
      votes.clear();
      roundOver = false;
      weather = null;
      lastWeatherRoll = 0;
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
  stepGrenades(0.05, Date.now());
  const now = Date.now();
  if (players.size) {
    sendPings(now);
    expireAmmoPacks(now);
    if (gunship && now - gunship.start >= GUNSHIP.ms) endGunship(null); // облетел карту — улетает
    stepWeather(now);
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
