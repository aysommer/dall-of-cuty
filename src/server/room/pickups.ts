// Подбираемое: ящик с неба (внутри — награда за серию убийств), аптечки и патроны с погибших.
import type { CrateState, ServerMsg, Vec3 } from '../../shared/protocol.js';
import { AMMO_PACK, CRATE, crateReward, MAPS, MEDKIT } from '../../shared/map.js';
import { broadcast, broadcastPlayers, send } from './net.js';
import type { Medkit, Player, Room } from './state.js';
import { grantReward } from './streaks.js';

// Раз в CRATE.dropEveryMs с вероятностью CRATE.dropChance ящик падает с неба в одну из точек карты.
// Упав, он лежит CRATE.lifeMs; если за это время его не открыли — исчезает.

export function crateMsg(room: Room): ServerMsg {
  const now = Date.now();
  const busy = room.crate.state === 'falling' || room.crate.state === 'opening';
  const lying = room.crate.state === 'idle' || room.crate.state === 'opening';
  return {
    t: 'crate', state: room.crate.state, at: room.crate.at, by: room.crate.by,
    ms: busy ? Math.max(0, room.crate.until - now) : 0,
    left: lying ? Math.max(0, room.crate.expiresAt - now) : 0,
  };
}

export function setCrate(room: Room, state: CrateState, by: number | null = null): void {
  clearTimeout(room.crate.timer);
  room.crate.state = state;
  room.crate.by = by;
  broadcast(room, crateMsg(room));
}

export function clearCrate(room: Room): void {
  clearTimeout(room.crate.expireTimer);
  room.crate.at = null;
  setCrate(room, 'gone');
}

export function dropCrate(room: Room): void {
  const drops = MAPS[room.mapId].crateDrops;
  if (!drops.length) return;
  room.crate.at = [...drops[Math.floor(Math.random() * drops.length)]!];
  room.crate.until = Date.now() + CRATE.fallMs;
  setCrate(room, 'falling');
  room.crate.timer = setTimeout(() => {
    room.crate.expiresAt = Date.now() + CRATE.lifeMs;
    room.crate.expired = false;
    setCrate(room, 'idle');
    clearTimeout(room.crate.expireTimer);
    room.crate.expireTimer = setTimeout(() => {
      // Пока ящик открывают, не убираем его: решит исход открытия
      if (room.crate.state === 'idle') clearCrate(room);
      else room.crate.expired = true;
    }, CRATE.lifeMs);
  }, CRATE.fallMs);
}

/** Расписание сбросов: идёт, пока на сервере есть игроки. */
export function startDrops(room: Room): void {
  clearInterval(room.medkitTimer);
  room.medkitTimer = setInterval(() => dropMedkit(room), MEDKIT.everyMs);
  clearInterval(room.dropTimer);
  room.dropTimer = setInterval(() => {
    if (room.crate.state === 'gone' && !room.roundOver && Math.random() < CRATE.dropChance) dropCrate(room);
  }, CRATE.dropEveryMs);
}

export function stopDrops(room: Room): void {
  clearInterval(room.medkitTimer);
  room.medkitTimer = undefined;
  room.medkits = [];
  room.ammoPacks = [];
  clearInterval(room.dropTimer);
  room.dropTimer = undefined;
  clearTimeout(room.crate.timer);
  clearTimeout(room.crate.expireTimer);
  room.crate.state = 'gone';
  room.crate.at = null;
  room.crate.by = null;
}

/** Отмена открытия сбрасывает прогресс; если срок ящика уже вышел — он исчезает. */
export function cancelOpening(room: Room): void {
  if (room.crate.expired) clearCrate(room);
  else setCrate(room, 'idle');
}

export function setRockets(p: Player, n: number): void {
  if (p.rockets === n) return;
  p.rockets = n;
  send(p.ws, { t: 'rockets', n });
}

export function handleOpen(room: Room, p: Player, on: boolean): void {
  if (!on) {
    if (room.crate.state === 'opening' && room.crate.by === p.id) cancelOpening(room);
    return;
  }
  const c = room.crate.at;
  if (room.crate.state !== 'idle' || !c || !p.alive || room.roundOver) return;
  if (Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]) > CRATE.reach || Math.abs(p.pos[1] - c[1]) > 1.5) return;
  room.crate.start = [...p.pos];
  room.crate.until = Date.now() + CRATE.openMs;
  setCrate(room, 'opening', p.id);
  room.crate.timer = setTimeout(() => {
    const opener = room.players.get(p.id);
    if (!opener || !opener.alive) { cancelOpening(room); return; }
    clearCrate(room);
    // Внутри — одна из наград за серию убийств: чем она дороже, тем реже попадается. Ловушек нет
    const kind = crateReward(Math.random());
    grantReward(opener, kind);
    send(opener.ws, { t: 'reward', kind });
    broadcastPlayers(room);
  }, CRATE.openMs);
}

export function packsMsg(room: Room): ServerMsg {
  return { t: 'ammopacks', list: room.ammoPacks.map((a) => ({ id: a.id, at: a.at })) };
}

export function dropAmmo(room: Room, pos: Vec3): void {
  if (room.roundOver) return;
  room.ammoPacks.push({ id: room.nextPackId++, at: [pos[0], pos[1], pos[2]], until: Date.now() + AMMO_PACK.lifeMs });
  broadcast(room, packsMsg(room));
}

export function clearAmmoPacks(room: Room): void {
  room.ammoPacks = [];
  broadcast(room, packsMsg(room));
}

/** Подобрать патроны — подойти вплотную; сам пополняет запас клиент (половина полного запаса к своим стволам). */
export function pickAmmo(room: Room, p: Player): void {
  if (!p.alive || !room.ammoPacks.length) return;
  const i = room.ammoPacks.findIndex((a) =>
    Math.hypot(p.pos[0] - a.at[0], p.pos[2] - a.at[2]) <= AMMO_PACK.reach && Math.abs(p.pos[1] - a.at[1]) <= 1.2);
  if (i < 0) return;
  room.ammoPacks.splice(i, 1);
  send(p.ws, { t: 'ammo' });
  broadcast(room, packsMsg(room));
}

export function expireAmmoPacks(room: Room, now: number): void {
  const before = room.ammoPacks.length;
  room.ammoPacks = room.ammoPacks.filter((a) => a.until > now);
  if (room.ammoPacks.length !== before) broadcast(room, packsMsg(room));
}

export function medkitsMsg(room: Room): ServerMsg {
  const now = Date.now();
  return { t: 'medkits', list: room.medkits.map((m) => ({ id: m.id, at: m.at, ms: Math.max(0, m.landAt - now) })) };
}

export function dropMedkit(room: Room): void {
  if (room.roundOver || room.medkits.length >= MEDKIT.max) return;
  const taken = (pt: Vec3) => room.medkits.some((m) => m.at[0] === pt[0] && m.at[2] === pt[2]);
  const free = MAPS[room.mapId].medkitDrops.filter((pt) => !taken(pt));
  if (!free.length) return;
  const at = free[Math.floor(Math.random() * free.length)]!;
  const kit: Medkit = { id: room.nextMedkitId++, at: [...at], landAt: Date.now() + MEDKIT.fallMs };
  room.medkits.push(kit);
  broadcast(room, medkitsMsg(room));
  // Не подобрали за MEDKIT.lifeMs после приземления — аптечка исчезает
  setTimeout(() => {
    const i = room.medkits.indexOf(kit);
    if (i < 0) return;
    room.medkits.splice(i, 1);
    broadcast(room, medkitsMsg(room));
  }, MEDKIT.fallMs + MEDKIT.lifeMs);
}

export function clearMedkits(room: Room): void {
  room.medkits = [];
  broadcast(room, medkitsMsg(room));
}

export function pickMedkit(room: Room, p: Player): void {
  if (!p.alive || p.hp >= 100 || !room.medkits.length) return;
  const now = Date.now();
  const i = room.medkits.findIndex((m) => now >= m.landAt &&
    Math.hypot(p.pos[0] - m.at[0], p.pos[2] - m.at[2]) <= MEDKIT.reach && Math.abs(p.pos[1] - m.at[1]) <= 1.2);
  if (i < 0) return;
  room.medkits.splice(i, 1);
  p.hp = Math.min(100, p.hp + MEDKIT.heal);
  broadcast(room, medkitsMsg(room));
  broadcastPlayers(room);
}
