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
  /** Пауза между выстрелами, мс */
  rate: number;
  mag: number;
  reload: number;
  /** Разброс при прицеливании (ПКМ), радианы. От бедра — в HIP_SPREAD раз больше. */
  spread: number;
  auto: boolean;
  /** Угол обзора камеры при прицеливании; null — прицелиться нельзя */
  zoom: number | null;
  /** Ближний бой: дальность удара в метрах */
  melee?: number;
}

export const PLAYER = { w: 0.8, h: 1.8, eye: 1.6 };

/** Стрельба от бедра в два раза менее точная, чем прицельная. */
export const HIP_SPREAD = 2;

export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol:  { name: 'Пистолет', dmg: 25, pellets: 1, rate: 280, mag: 12, reload: 1200, spread: 0.006, auto: false, zoom: 60 },
  shotgun: { name: 'Дробовик', dmg: 13, pellets: 8, rate: 900, mag: 6, reload: 2200, spread: 0.045, auto: false, zoom: 62 },
  rifle:   { name: 'Автомат', dmg: 21, pellets: 1, rate: 110, mag: 30, reload: 2000, spread: 0.009, auto: true, zoom: 55 },
  sniper:  { name: 'Снайперка', dmg: 100, pellets: 1, rate: 1300, mag: 5, reload: 2800, spread: 0.0015, auto: false, zoom: 20 },
  knife:   { name: 'Нож', dmg: 100, pellets: 1, rate: 650, mag: 0, reload: 0, spread: 0, auto: false, zoom: null, melee: 2 },
  // Ракетница достаётся только из ящика: 6 ракет, без перезарядки
  rocket:  { name: 'Ракетница', dmg: 999, pellets: 1, rate: 900, mag: 6, reload: 0, spread: 0, auto: false, zoom: 60 },
};

/**
 * Ящик с ракетницей. Раз в dropEveryMs с вероятностью dropChance падает с неба (fallMs),
 * лежит на земле lifeMs и, если его никто не открыл, исчезает.
 */
export const CRATE = {
  size: 1.2, height: 0.9, reach: 2.4, openMs: 1000,
  dropEveryMs: 60_000, dropChance: 0.5, fallMs: 4000, fallHeight: 40, lifeMs: 120_000,
  trapChance: 0.1, trapRadius: 5,
};
export const ROCKET = { speed: 35, radius: 4, lifeMs: 4000 };
export const WEAPON_ORDER: WeaponId[] = ['pistol', 'shotgun', 'rifle', 'sniper', 'knife'];

/** Подкат: из спринта по C, игрок ложится и скользит ms миллисекунд. */
export const SLIDE = { ms: 1000, height: 0.8, eye: 0.6, boost: 1.35, endSpeed: 0.35, cooldownMs: 500 };

/**
 * Хитбокс игрока. Стоя — столб PLAYER.w × PLAYER.h. В подкате — лежащий прямоугольник
 * длиной PLAYER.h вдоль взгляда и высотой SLIDE.height (берём охватывающий его AABB).
 */
export function playerBox(pos: Vec3, yaw: number, sliding: boolean): [Vec3, Vec3] {
  let hx = PLAYER.w / 2, hz = PLAYER.w / 2, h = PLAYER.h;
  if (sliding) {
    const s = Math.abs(Math.sin(yaw)), c = Math.abs(Math.cos(yaw));
    hx = (PLAYER.h / 2) * s + (PLAYER.w / 2) * c;
    hz = (PLAYER.h / 2) * c + (PLAYER.w / 2) * s;
    h = SLIDE.height;
  }
  return [[pos[0] - hx, pos[1], pos[2] - hz], [pos[0] + hx, pos[1] + h, pos[2] + hz]];
}

/** Точки тела для проверки прямой видимости: низ, середина и верх. */
export function bodyPoints(pos: Vec3, sliding: boolean): Vec3[] {
  const h = sliding ? SLIDE.height : PLAYER.h;
  return [0.2, h / 2, h - 0.1].map((y) => [pos[0], pos[1] + y, pos[2]] as Vec3);
}

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
