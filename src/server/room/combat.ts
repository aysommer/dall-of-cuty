// Бой: выстрелы, урон, смерть, взрывы и рисунки на стенах.
import type { KillWeapon, Vec3 } from '../../shared/protocol.js';
import { rankOf } from '../../shared/ranks.js';
import { CROUCH, type Low, bodyPoints, HEAD, isWeapon, lineOfSight, PLAYER, playerBox, SLIDE, STREAK, WEAPONS } from '../../shared/map.js';
import { EMOJIS, SPRAY } from '../../shared/emoji.js';
import { checkWin, spawn } from './match.js';
import { broadcast, broadcastPlayers, isVec3, send, sendProfile } from './net.js';
import { cancelOpening, dropAmmo, setRockets } from './pickups.js';
import { dropCookedGrenade } from './projectiles.js';
import { type Incoming, type Player, RESPAWN_MS, type Room } from './state.js';
import { addStreak, sendLoadout } from './streaks.js';
import { damageBreakable, worldBoxes } from './world.js';

/** killer = null — игрока убил взорвавшийся ящик: убийство никому не засчитывается. */
export function killPlayer(room: Room, killer: Player | null, v: Player, w: KillWeapon, head = false): void {
  v.hp = 0;
  v.armor = 0;
  v.big = false;
  v.helmet = 0;
  v.alive = false;
  v.deaths++;
  v.profile.deaths++;
  sendProfile(v);
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
  broadcast(room, { t: 'kill', killer: killer?.id ?? null, victim: v.id, w, head });
  // Убит с сорванной чекой — граната выпадает из руки и взорвётся по своему отсчёту
  if (v.cookStart) dropCookedGrenade(room, v);
  // Погибший теряет ракетницу и перестаёт открывать ящик, а на месте гибели остаются патроны
  setRockets(v, 0);
  dropAmmo(room, v.pos);
  if (room.crate.state === 'opening' && room.crate.by === v.id) cancelOpening(room);
  v.respawnTimer = setTimeout(() => {
    if (room.players.has(v.id) && !room.roundOver) {
      spawn(room, v);
      broadcastPlayers(room);
    }
  }, RESPAWN_MS);
}

/**
 * Взрыв по области: убивает противников и самого хозяина в радиусе (если их не закрывает стена).
 * Союзников не задевает.
 */
export function blast(room: Room, owner: Player, at: Vec3, radius: number, w: KillWeapon, from: Vec3 = [at[0], at[1] + 0.3, at[2]]): void {
  if (room.roundOver) return;
  const walls = worldBoxes(room);
  let killed = false;
  for (const v of room.players.values()) {
    if (!v.alive || (v !== owner && !isEnemy(room, owner, v))) continue;
    if (distToPlayer(v, at) > radius) continue;
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    killPlayer(room, owner, v, w);
    killed = true;
  }
  if (killed) {
    broadcastPlayers(room);
    checkWin(room);
  }
}

export function isEnemy(room: Room, a: Player, b: Player): boolean {
  return a.id !== b.id && (room.mode === 'ffa' || a.team !== b.team);
}

export function scaleOf(p: Player): number {
  return p.big ? STREAK.bigScale : 1;
}

export function eyeOf(p: Player): Vec3 {
  return [p.pos[0], p.pos[1] + (p.slide ? SLIDE.eye : p.crouch ? CROUCH.eye : PLAYER.eye) * scaleOf(p), p.pos[2]];
}

/** Расстояние от точки до ближайшей точки хитбокса игрока. */
/** Насколько игрок низкий — для хитбокса и точек тела */
export const lowOf = (p: Player): Low => p.slide ? true : p.crouch ? 'crouch' : false;

export function distToPlayer(v: Player, at: Vec3): number {
  const [min, max] = playerBox(v.pos, v.yaw, lowOf(v), scaleOf(v));
  return Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
}

/** T: эмодзи на стене. Не чаще раза в минуту, только на вертикальной стене рядом с игроком. */
export function handleSpray(room: Room, p: Player, msg: Incoming): void {
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
  broadcast(room, { t: 'spray', by: p.id, p: msg.p, n: [nx as number, nz as number], e: msg.e as number });
}

/** Урон сначала снимает броню, потом здоровье. */
export function hurt(room: Room, attacker: Player, v: Player, dmg: number, w: KillWeapon, head: boolean): void {
  const absorbed = Math.min(v.armor, dmg);
  v.armor = Math.round(v.armor - absorbed);
  // Суперброня кончилась — игрок снова обычного размера и без шлема
  if (v.armor <= 0) { v.big = false; v.helmet = 0; }
  v.hp = Math.max(0, Math.round(v.hp - (dmg - absorbed)));
  if (v.hp <= 0) killPlayer(room, attacker, v, w, head);
}

export function handleShoot(room: Room, p: Player, msg: Incoming): void {
  if (!isWeapon(msg.w) || msg.w === 'rocket' || !p.alive) return;
  // Стрелять можно только из своего набора; нож есть всегда
  if (msg.w !== 'knife' && !p.kit.includes(msg.w)) return;
  const weaponId = msg.w;
  const w = WEAPONS[weaponId];
  const now = Date.now();
  if (now - p.lastShot < w.rate * 0.7) return;
  p.lastShot = now;

  const ends = Array.isArray(msg.ends) ? msg.ends.slice(0, w.pellets).filter(isVec3) : [];
  broadcast(room, { t: 'shot', id: p.id, w: weaponId, ends }, p.id);

  // Пули по стёклам и дверям
  if (!room.roundOver && typeof msg.brk === 'object' && msg.brk !== null) {
    let left = w.pellets;
    for (const [idStr, nRaw] of Object.entries(msg.brk)) {
      const n = Math.min(left, Math.max(0, Math.floor(Number(nRaw)) || 0));
      left -= n;
      if (n > 0) damageBreakable(room, Number(idStr), w.dmg * n);
    }
  }
  if (room.roundOver || typeof msg.hits !== 'object' || msg.hits === null) return;
  let budget = w.pellets;
  const eye = eyeOf(p);
  const walls = worldBoxes(room);
  const count = (v: unknown) => Math.max(0, Math.floor(Number(v)) || 0);
  for (const [idStr, raw] of Object.entries(msg.hits)) {
    const v = room.players.get(Number(idStr));
    if (!v || !v.alive || v.id === p.id) continue;
    if (room.mode === 'tdm' && v.team === p.team) continue;
    // Нож бьёт только вплотную (с запасом на задержку сети) и только если он не брошен
    if (w.melee && (!p.hasKnife || distToPlayer(v, eye) > w.melee + 0.75)) continue;
    // Проверка, что между стрелком и целью нет стены
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, eye, pt))) continue;

    const [rawBody, rawHead] = Array.isArray(raw) ? raw : [raw, 0];
    let head = Math.min(count(rawHead), budget);
    budget -= head;
    let body = Math.min(count(rawBody), budget);
    budget -= body;
    if (head + body === 0) continue;
    // Голову засчитываем, только если её видно и игрок стоит (в подкате головы как зоны нет)
    const headPt: Vec3 = [v.pos[0], v.pos[1] + ((v.crouch ? CROUCH.height : PLAYER.h) - 0.1) * scaleOf(v), v.pos[2]];
    if (head && (v.slide || !lineOfSight(walls, eye, headPt))) { body += head; head = 0; }
    // Шлем Джаггернаута: выстрел в голову урона не наносит, а только сбивает шлем (одно попадание за выстрел)
    if (head && v.helmet > 0) {
      v.helmet--;
      head = 0;
      broadcast(room, { t: 'helmet', id: v.id, by: p.id, left: v.helmet });
      if (body === 0) { broadcastPlayers(room); continue; }
    }

    if (w.melee) { killPlayer(room, p, v, weaponId); continue; }
    if (head && w.headKill) { killPlayer(room, p, v, weaponId, true); continue; }
    let dmg = w.dmg;
    if (weaponId === 'shotgun') {
      const dist = Math.hypot(v.pos[0] - p.pos[0], v.pos[2] - p.pos[2]);
      dmg *= Math.max(0.3, Math.min(1, 1 - (dist - 8) / 30));
    }
    hurt(room, p, v, dmg * body + dmg * HEAD.mul * head, weaponId, head > 0);
  }
  broadcastPlayers(room);
  checkWin(room);
}
