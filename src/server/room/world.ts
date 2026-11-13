// Мир комнаты: разрушаемые стёкла и двери (что твёрдое для пуль и взрывов) и погода.
import { type Box, DOOR, MAPS, PLAYER, WEATHER } from '../../shared/map.js';
import type { ServerMsg, Vec3 } from '../../shared/protocol.js';
import { distToPlayer } from './combat.js';
import { broadcast } from './net.js';
import type { Player, Room } from './state.js';

/** Неподвижная геометрия карты плюс ещё не разбитые стёкла и закрытые двери. */
export function worldBoxes(room: Room): Box[] {
  if (room.solidCache && room.solidCache.map === room.mapId && room.solidCache.version === room.solidsVersion) return room.solidCache.boxes;
  const map = MAPS[room.mapId];
  const intact = (map.breakables ?? []).filter((x) => !room.brokenIds.has(x.id) && !room.openDoors.has(x.id)).map((x) => x.box);
  room.solidCache = { map: room.mapId, version: room.solidsVersion, boxes: [...map.boxes, ...intact] };
  return room.solidCache.boxes;
}

/** F у двери: открыть или закрыть. Закрыть нельзя, если в проёме стоит игрок — он бы застрял. */
export function toggleDoor(room: Room, p: Player, id: unknown): void {
  const door = (MAPS[room.mapId].breakables ?? []).find((x) => x.id === id && x.kind === 'door');
  if (!door || !p.alive || room.brokenIds.has(door.id)) return;
  const { min, max } = door.box;
  const d = distToPlayer(p, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
  if (d > DOOR.reach) return;
  if (room.openDoors.has(door.id)) {
    const r = PLAYER.w / 2;
    const blocked = [...room.players.values()].some((v) => v.alive && v.pos[0] + r > min[0] && v.pos[0] - r < max[0] &&
      v.pos[1] + PLAYER.h > min[1] && v.pos[1] < max[1] && v.pos[2] + r > min[2] && v.pos[2] - r < max[2]);
    if (blocked) return;
    room.openDoors.delete(door.id);
  } else room.openDoors.add(door.id);
  room.solidsVersion++;
  broadcast(room, { t: 'doors', open: [...room.openDoors] });
}

export function resetBreakables(room: Room): void {
  room.brokenIds.clear();
  room.breakHp.clear();
  room.openDoors.clear();
  room.solidsVersion++;
  broadcast(room, { t: 'doors', open: [] });
  for (const x of MAPS[room.mapId].breakables ?? []) room.breakHp.set(x.id, x.hp);
  room.solidCache = null;
  broadcast(room, { t: 'breaks', broken: [] });
}

export function damageBreakable(room: Room, id: number, dmg: number): void {
  if (room.brokenIds.has(id) || !room.breakHp.has(id)) return;
  const hp = (room.breakHp.get(id) ?? 0) - dmg;
  room.breakHp.set(id, hp);
  if (hp > 0) return;
  room.brokenIds.add(id);
  room.solidsVersion++;
  broadcast(room, { t: 'breaks', broken: [...room.brokenIds] });
}

/** Взрыв рядом — стекло бьётся сразу, двери получают большой урон. */
export function blastBreakables(room: Room, at: Vec3, radius: number): void {
  for (const x of MAPS[room.mapId].breakables ?? []) {
    const { min, max } = x.box;
    const d = Math.hypot(...([0, 1, 2] as const).map((i) => Math.max(min[i] - at[i], 0, at[i] - max[i])));
    if (d <= radius) damageBreakable(room, x.id, 200);
  }
}

export function weatherMsg(room: Room): ServerMsg {
  const now = Date.now();
  return room.weather && room.weather.until > now
    ? { t: 'weather', kind: room.weather.kind, ms: room.weather.until - now }
    : { t: 'weather', kind: null, ms: 0 };
}

/** Раз в WEATHER.everyMs с вероятностью WEATHER.chance — дождь или снег на минуту. */
export function stepWeather(room: Room, now: number): void {
  if (room.weather && now >= room.weather.until) {
    room.weather = null;
    broadcast(room, weatherMsg(room));
  }
  if (!room.lastWeatherRoll) room.lastWeatherRoll = now;
  if (now - room.lastWeatherRoll < WEATHER.everyMs) return;
  room.lastWeatherRoll = now;
  if (!WEATHER.enabled || room.weather || room.roundOver || Math.random() >= WEATHER.chance) return;
  room.weather = { kind: Math.random() < 0.5 ? 'rain' : 'snow', until: now + WEATHER.ms };
  broadcast(room, weatherMsg(room));
}
