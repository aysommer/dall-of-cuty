// Мины и растяжки: ставятся под ноги, срабатывают от врага и взрываются через секунду.
import { bodyPoints, lineOfSight, MINE, playerBox, rayBox, rayWorld } from '../../shared/map.js';
import type { ServerMsg, Vec3 } from '../../shared/protocol.js';
import { distToPlayer, hurt, isEnemy, killPlayer, scaleOf, lowOf } from './combat.js';
import { checkWin } from './match.js';
import { broadcast, broadcastPlayers } from './net.js';
import type { Mine, Player, Room } from './state.js';
import { sendLoadout } from './streaks.js';
import { blastBreakables, worldBoxes } from './world.js';

export function minesMsg(room: Room, now = Date.now()): ServerMsg {
  return {
    t: 'mines',
    list: room.mines.map((m) => {
      const owner = room.players.get(m.owner);
      return {
        id: m.id, kind: m.kind, by: m.owner, team: owner?.team ?? 'green', p: m.pos, to: m.to,
        armed: m.armedAt ? Math.max(1, m.armedAt + MINE.delayMs - now) : 0,
      };
    }),
  };
}

/** ЛКМ с миной или растяжкой в руке: устройство ложится под ноги. Растяжка тянет верёвку по взгляду — до стены, но не дальше MINE.wire. */
export function placeMine(room: Room, p: Player): void {
  if (!p.alive || room.roundOver || p.grenades <= 0 || (p.gear !== 'mine' && p.gear !== 'tripwire')) return;
  p.grenades--;
  sendLoadout(p);
  const pos: Vec3 = [p.pos[0], p.pos[1], p.pos[2]];
  let to: Vec3 | null = null;
  if (p.gear === 'tripwire') {
    const from: Vec3 = [pos[0], pos[1] + MINE.wireY, pos[2]];
    const dir: Vec3 = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
    const len = Math.min(MINE.wire, rayWorld(worldBoxes(room), from, dir, MINE.wire));
    to = [from[0] + dir[0] * len, from[1], from[2] + dir[2] * len];
  }
  room.mines.push({ id: room.nextMineId++, kind: p.gear, owner: p.id, pos, to, armedAt: 0 });
  // У игрока на карте не больше MINE.max устройств: самое старое убирается
  const mine = room.mines.filter((m) => m.owner === p.id);
  if (mine.length > MINE.max) room.mines.splice(room.mines.indexOf(mine[0]!), 1);
  broadcast(room, minesMsg(room));
}

/** Задел ли игрок верёвку: отрезок от мины до конца верёвки проходит сквозь его хитбокс. */
function touchesWire(v: Player, from: Vec3, to: Vec3): boolean {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  const [min, max] = playerBox(v.pos, v.yaw, lowOf(v), scaleOf(v));
  return rayBox(from, [d[0] / len, d[1] / len, d[2] / len], min, max) <= len;
}

/**
 * Взрыв: в MINE.killR — насмерть, до MINE.hurtR — MINE.dmg урона; стена закрывает.
 * Задевает противников и самого хозяина, союзников — нет.
 */
function explodeMine(room: Room, m: Mine): void {
  const at: Vec3 = [m.pos[0], m.pos[1] + 0.15, m.pos[2]];
  broadcast(room, { t: 'boom', id: -9000 - m.id, p: at });
  blastBreakables(room, at, MINE.hurtR);
  const owner = room.players.get(m.owner);
  if (!owner || room.roundOver) return;
  const walls = worldBoxes(room);
  for (const v of room.players.values()) {
    if (!v.alive || (v !== owner && !isEnemy(room, owner, v))) continue;
    const d = distToPlayer(v, at);
    if (d > MINE.hurtR) continue;
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, at, pt))) continue;
    if (d <= MINE.killR) killPlayer(room, owner, v, 'mine');
    else hurt(room, owner, v, MINE.dmg, 'mine', false);
  }
  broadcastPlayers(room);
  checkWin(room);
}

/** Такт: враг рядом с миной или на верёвке взводит её; через MINE.delayMs — взрыв. */
export function stepMines(room: Room, now: number): void {
  if (!room.mines.length) return;
  let changed = false;
  for (const m of [...room.mines]) {
    if (m.armedAt) {
      if (now - m.armedAt < MINE.delayMs) continue;
      room.mines.splice(room.mines.indexOf(m), 1);
      changed = true;
      explodeMine(room, m);
      continue;
    }
    const owner = room.players.get(m.owner);
    if (!owner || room.roundOver) continue;
    for (const v of room.players.values()) {
      // Взвести может только враг хозяина
      if (!v.alive || !isEnemy(room, owner, v)) continue;
      const hit = m.to ? touchesWire(v, [m.pos[0], m.pos[1] + MINE.wireY, m.pos[2]], m.to) : distToPlayer(v, m.pos) <= MINE.triggerR;
      if (hit) { m.armedAt = now; changed = true; break; }
    }
  }
  if (changed) broadcast(room, minesMsg(room, now));
}

/** Убрать все мины (новый раунд) или мины ушедшего игрока. */
export function clearMines(room: Room, ownerId: number | null = null): void {
  const before = room.mines.length;
  room.mines = ownerId === null ? [] : room.mines.filter((m) => m.owner !== ownerId);
  if (room.mines.length !== before) broadcast(room, minesMsg(room));
}
