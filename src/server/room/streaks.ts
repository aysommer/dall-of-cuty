// Награды за серию убийств: БПЛА, ракета с неба, самолёт, бомба.
import { REWARD_KILLS, type RewardKind, bodyPoints, GUNSHIP, gunshipPos, lineOfSight, MAPS, STREAK, type StreakKind } from '../../shared/map.js';
import type { ServerMsg, Vec3 } from '../../shared/protocol.js';
import { blast, hurt, isEnemy, killPlayer, scaleOf, lowOf } from './combat.js';
import { checkWin } from './match.js';
import { broadcast, broadcastPlayers, isVec3, send } from './net.js';
import { setRockets } from './pickups.js';
import type { Gunship, Incoming, Missile, Player, Rocket, Room } from './state.js';
import { blastBreakables, worldBoxes } from './world.js';

export function sendLoadout(p: Player): void {
  send(p.ws, {
    t: 'loadout', gear: p.gear, knife: p.hasKnife, grenades: p.grenades, streak: p.streak, uav: p.uav, missile: p.missile, nuke: p.nuke, gunship: p.gunship,
  });
}

/** Награды выдаются ровно на пороге серии: 3 — БПЛА, 4 — ракета с неба, 5 — ракетница, 7 — суперброня, 15 — бомба. */
/** Выдать награду — за серию убийств или из ящика. */
export function grantReward(p: Player, kind: RewardKind): void {
  if (kind === 'launcher') setRockets(p, Math.max(p.rockets, 6));
  else if (kind === 'juggernaut') {
    // Джаггернаут: суперброня, чуть больший размер и шлем, который держит выстрелы в голову
    p.armor = STREAK.superArmorHp;
    p.big = true;
    p.helmet = STREAK.helmetHits;
  } else p[kind]++;
  sendLoadout(p);
}

export function addStreak(p: Player): void {
  p.streak++;
  for (const kind of Object.keys(REWARD_KILLS) as RewardKind[]) {
    if (p.streak === REWARD_KILLS[kind]) grantReward(p, kind);
  }
  sendLoadout(p);
}

/** Применить награду из запаса. */
export function useStreak(room: Room, p: Player, kind: unknown): void {
  if (room.roundOver || (kind !== 'uav' && kind !== 'missile' && kind !== 'nuke' && kind !== 'gunship')) return;
  const k = kind as StreakKind;
  if (p[k] <= 0) return;
  if (k === 'missile' && [...room.missiles.values()].some((m) => m.owner === p.id)) return;
  if (k === 'nuke' && room.nukeTimer) return;
  if (k === 'gunship' && room.gunship) return; // в небе одновременно только один самолёт
  p[k]--;
  sendLoadout(p);
  if (k === 'uav') {
    p.uavUntil = Math.max(p.uavUntil, Date.now()) + STREAK.uavMs;
    for (const r of uavViewers(room, p)) send(r.ws, { t: 'uav', ms: p.uavUntil - Date.now() });
  } else if (k === 'missile') {
    launchMissile(room, p);
  } else if (k === 'gunship') {
    launchGunship(room, p);
  } else {
    callNuke(room, p);
  }
}

/** Кто видит отметки этого БПЛА: в командах — вся команда, иначе — только хозяин. */
export function uavViewers(room: Room, owner: Player): Player[] {
  return [...room.players.values()].filter((p) => p === owner || (room.mode === 'tdm' && p.team === owner.team));
}

/** Раз в STREAK.pingMs каждому, у кого (или у чьей команды) работает БПЛА, — где сейчас противники. */
export function sendPings(room: Room, now: number): void {
  if (now - room.lastPing < STREAK.pingMs) return;
  room.lastPing = now;
  const seeing = new Set<Player>();
  for (const p of room.players.values()) {
    if (p.uavUntil > now) for (const v of uavViewers(room, p)) seeing.add(v);
  }
  for (const viewer of seeing) {
    const list: Array<[number, number, number]> = [];
    for (const e of room.players.values()) {
      if (e.alive && isEnemy(room, viewer, e)) list.push([e.id, +e.pos[0].toFixed(1), +e.pos[2].toFixed(1)]);
    }
    send(viewer.ws, { t: 'ping', list });
  }
}

export function launchMissile(room: Room, p: Player): void {
  const half = MAPS[room.mapId].half;
  const start: Vec3 = [p.pos[0] * 0.3, STREAK.missileHeight, p.pos[2] * 0.3 + (p.pos[2] > 0 ? half.z * 0.3 : -half.z * 0.3)];
  const m: Missile = { id: room.nextMissileId++, owner: p.id, born: Date.now(), last: start };
  room.missiles.set(m.id, m);
  send(p.ws, { t: 'missile-go', id: m.id, p: start });
}

export function missilePos(room: Room, p: Player, msg: Incoming): void {
  const m = room.missiles.get(Number(msg.id));
  if (!m || m.owner !== p.id || !isVec3(msg.p)) return;
  m.last = msg.p;
  broadcast(room, { t: 'missile', id: m.id, by: p.id, p: msg.p }, p.id);
}

export function missileHit(room: Room, p: Player, msg: Incoming): void {
  const m = room.missiles.get(Number(msg.id));
  if (!m || m.owner !== p.id || !isVec3(msg.p)) return;
  // Ракета не может долететь быстрее, чем позволяет форсаж
  const minMs = ((STREAK.missileHeight - msg.p[1]) / STREAK.missileBoost) * 1000 * 0.8;
  if (Date.now() - m.born < minMs) return;
  detonateMissile(room, m, msg.p);
}

export function detonateMissile(room: Room, m: Missile, at: Vec3): void {
  room.missiles.delete(m.id);
  broadcast(room, { t: 'boom', id: -m.id, p: at });
  blastBreakables(room, at, STREAK.missileRadius);
  const owner = room.players.get(m.owner);
  if (owner) blast(room, owner, at, STREAK.missileRadius, 'missile');
}

export function gunshipNow(room: Room, g: Gunship, now = Date.now()): Vec3 {
  return gunshipPos(MAPS[room.mapId].half, g.phase, (now - g.start) / 1000);
}

export function gunshipMsg(g: Gunship): ServerMsg {
  const elapsed = Date.now() - g.start;
  return { t: 'gunship', id: g.id, by: g.owner, phase: g.phase, ms: Math.max(0, GUNSHIP.ms - elapsed), elapsed };
}

export function launchGunship(room: Room, p: Player): void {
  room.gunship = {
    id: room.nextGunshipId++, owner: p.id, phase: Math.random() * Math.PI * 2, start: Date.now(),
    hits: 0, lastGun: 0, lastRocket: 0,
  };
  broadcast(room, gunshipMsg(room.gunship));
}

/** Самолёт улетел (by = null) или сбит (by — кто сбил). */
export function endGunship(room: Room, by: Player | null): void {
  if (!room.gunship) return;
  const at = gunshipNow(room, room.gunship);
  broadcast(room, { t: 'gunship-end', id: room.gunship.id, by: by?.id ?? null, p: at });
  if (by) broadcast(room, { t: 'boom', id: -1000 - room.gunship.id, p: at });
  room.gunship = null;
}

/** Очередь пулемёта: попадания проверяем от самолёта, а не от тела стрелка. */
export function gunshipFire(room: Room, p: Player, msg: Incoming): void {
  const g = room.gunship;
  const now = Date.now();
  if (!g || g.owner !== p.id || room.roundOver || now - g.lastGun < GUNSHIP.gunRateMs * 0.7) return;
  g.lastGun = now;
  const from = gunshipNow(room, g, now);
  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, 1).filter(isVec3) : [];
  broadcast(room, { t: 'gsshot', id: g.id, ends }, p.id);
  if (typeof msg.hits !== 'object' || msg.hits === null) return;
  const walls = worldBoxes(room);
  let budget = 1;
  for (const idStr of Object.keys(msg.hits)) {
    const v = room.players.get(Number(idStr));
    if (!v || !v.alive || budget <= 0 || !isEnemy(room, p, v)) continue;
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    budget--;
    hurt(room, p, v, GUNSHIP.gunDmg, 'gunship', false);
  }
  broadcastPlayers(room);
  checkWin(room);
}

/** Ракета самолёта: раз в GUNSHIP.rocketCdMs, вылетает из самолёта. */
export function gunshipRocket(room: Room, p: Player, msg: Incoming): void {
  const g = room.gunship;
  const now = Date.now();
  if (!g || g.owner !== p.id || room.roundOver || !isVec3(msg.d) || now - g.lastRocket < GUNSHIP.rocketCdMs * 0.9) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  g.lastRocket = now;
  const dir: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const pos = gunshipNow(room, g, now);
  const r: Rocket = { id: room.nextRocketId++, owner: p.id, pos, dir, born: now, fromGunship: true };
  room.rockets.push(r);
  broadcast(room, { t: 'rocket', id: r.id, by: p.id, o: pos, d: dir });
}

export function callNuke(room: Room, p: Player): void {
  broadcast(room, { t: 'nuke', by: p.id, ms: STREAK.nukeMs });
  room.nukeTimer = setTimeout(() => {
    room.nukeTimer = undefined;
    if (room.roundOver) return;
    const owner = room.players.get(p.id) ?? null;
    // Убивает вообще всех; убийства противников засчитываются вызвавшему
    for (const v of room.players.values()) {
      if (!v.alive) continue;
      killPlayer(room, owner && isEnemy(room, owner, v) ? owner : null, v, 'nuke');
    }
    broadcastPlayers(room);
    checkWin(room);
  }, STREAK.nukeMs);
}
