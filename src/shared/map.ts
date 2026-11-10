// Общие данные для клиента и сервера: карты, оружие, размеры игрока.

import type { Vec3, WeaponId } from './protocol.js';
import { SANDS } from './maps/sands.js';
import { BRICKS } from './maps/bricks.js';
import { DEPOT } from './maps/depot.js';
import type { Box, GameMap, MapId } from './maps/types.js';

export type { Box, GameMap, Ladder, MapId, SpawnPoint } from './maps/types.js';

export interface Weapon {
  name: string;
  dmg: number;
  pellets: number;
  rate: number;
  mag: number;
  reload: number;
  spread: number;
  auto: boolean;
}

export const PLAYER = { w: 0.8, h: 1.8, eye: 1.6 };

export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol:  { name: 'Пистолет', dmg: 25, pellets: 1, rate: 280, mag: 12, reload: 1200, spread: 0.008, auto: false },
  shotgun: { name: 'Дробовик', dmg: 13, pellets: 8, rate: 900, mag: 6,  reload: 2200, spread: 0.07,  auto: false },
  rifle:   { name: 'Винтовка', dmg: 30, pellets: 1, rate: 110, mag: 30, reload: 2000, spread: 0.018, auto: true },
  // Ракетница достаётся только из ящика: 6 ракет, без перезарядки
  rocket:  { name: 'Ракетница', dmg: 999, pellets: 1, rate: 900, mag: 6, reload: 0, spread: 0, auto: false },
};

/** Ящик с ракетницей и сами ракеты. */
export const CRATE = { size: 1.2, height: 0.9, reach: 2.4, openMs: 5000, spawnChance: 0.15, trapChance: 0.1, trapRadius: 5 };
export const ROCKET = { speed: 35, radius: 4, lifeMs: 4000 };
export const WEAPON_ORDER: WeaponId[] = ['pistol', 'shotgun', 'rifle'];

export const MAPS: Record<MapId, GameMap> = { sands: SANDS, bricks: BRICKS, depot: DEPOT };
export const MAP_ORDER: MapId[] = ['sands', 'bricks', 'depot'];

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && Object.hasOwn(MAPS, v);
}

// Пересечение луча с блоком (метод «слэбов»).
// Возвращает расстояние вдоль луча либо Infinity.
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let a = (min[i] - o[i]) / d[i];
      let c = (max[i] - o[i]) / d[i];
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// Ближайшее пересечение луча с геометрией карты (включая пол).
export function rayWorld(boxes: Box[], o: Vec3, d: Vec3, maxDist = 200): number {
  let t = maxDist;
  if (d[1] < -1e-9) {
    const tf = -o[1] / d[1];
    if (tf >= 0 && tf < t) t = tf;
  }
  for (const box of boxes) {
    const tb = rayBox(o, d, box.min, box.max);
    if (tb < t) t = tb;
  }
  return t;
}

// Есть ли прямая видимость между двумя точками.
export function lineOfSight(boxes: Box[], a: Vec3, c: Vec3): boolean {
  const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return true;
  d[0] /= len; d[1] /= len; d[2] /= len;
  return rayWorld(boxes, a, d, len) >= len - 0.05;
}

export function isWeapon(w: unknown): w is WeaponId {
  return typeof w === 'string' && Object.hasOwn(WEAPONS, w);
}
