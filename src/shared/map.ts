// Общие данные для клиента и сервера: карты, оружие, размеры игрока.

import type { Vec3, WeaponId } from './protocol.js';
import { SANDS } from './maps/sands.js';
import { BRICKS } from './maps/bricks.js';
import { DEPOT } from './maps/depot.js';
import { JUMPS } from './maps/jumps.js';
import { TOWN } from './maps/town.js';
import type { Box, GameMap, MapId } from './maps/types.js';

export type { Box, GameMap, JumpPad, Ladder, MapId, SpawnPoint } from './maps/types.js';

export interface Weapon {
  name: string;
  dmg: number;
  pellets: number;
  /** Пауза между выстрелами, мс */
  rate: number;
  mag: number;
  /** Запас патронов сверх магазина (всего патронов = mag + reserve) */
  reserve: number;
  reload: number;
  /** Разброс при прицеливании (ПКМ), радианы. От бедра — в HIP_SPREAD раз больше. */
  spread: number;
  auto: boolean;
  /** Угол обзора камеры при прицеливании; null — прицелиться нельзя */
  zoom: number | null;
  /** Ближний бой: дальность удара в метрах, удар убивает сразу */
  melee?: number;
  /** Попадание в голову убивает сразу, даже сквозь броню */
  headKill?: boolean;
}

export const PLAYER = { w: 0.8, h: 1.8, eye: 1.6 };

/** Стрельба от бедра в два раза менее точная, чем прицельная. */
export const HIP_SPREAD = 2;

/**
 * Распределение урона: голова — верхняя часть стоящего прямоугольника (от HEAD.from метров над ногами).
 * В голову урон умножается на HEAD.mul; у снайперки попадание в голову убивает сразу.
 */
export const HEAD = { from: 1.45, mul: 1.5 };

/** Броня из ящика: ещё 100 единиц «здоровья», которые тратятся первыми. */
export const ARMOR = { amount: 100 };

/** Аптечки: падают с неба каждые everyMs, лечат на heal (не выше 100); не подобранная исчезает через lifeMs. */
export const MEDKIT = {
  everyMs: 60_000, fallMs: 2500, fallHeight: 40, heal: 50, max: 3, lifeMs: 15_000,
  size: 0.6, height: 0.35, reach: 1.1,
};

export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol:  { name: 'Пистолет', dmg: 25, pellets: 1, rate: 280, mag: 12, reserve: 24, reload: 1200, spread: 0.006, auto: false, zoom: 60 },
  shotgun: { name: 'Дробовик', dmg: 13, pellets: 8, rate: 900, mag: 6, reserve: 18, reload: 2200, spread: 0.045, auto: false, zoom: 62 },
  // Пулемёт: лента на 100 патронов, отдача вдвое сильнее, чем у автомата
  lmg:     { name: 'Пулемёт', dmg: 22, pellets: 1, rate: 95, mag: 100, reserve: 0, reload: 4200, spread: 0.014, auto: true, zoom: 58 },
  rifle:   { name: 'Автомат', dmg: 21, pellets: 1, rate: 110, mag: 30, reserve: 60, reload: 2000, spread: 0.009, auto: true, zoom: 55 },
  sniper:  { name: 'Снайперка', dmg: 80, pellets: 1, rate: 1300, mag: 5, reserve: 19, reload: 2800, spread: 0.0015, auto: false, zoom: 20, headKill: true },
  knife:   { name: 'Нож', dmg: 100, pellets: 1, rate: 650, mag: 0, reserve: 0, reload: 0, spread: 0, auto: false, zoom: null, melee: 2 },
  // Ракетница достаётся только из ящика: 6 ракет, без перезарядки
  rocket:  { name: 'Ракетница', dmg: 999, pellets: 1, rate: 900, mag: 6, reserve: 0, reload: 0, spread: 0, auto: false, zoom: 60 },
};

/**
 * Ящик с ракетницей. Раз в dropEveryMs с вероятностью dropChance падает с неба (fallMs),
 * лежит на земле lifeMs и, если его никто не открыл, исчезает.
 */
export const CRATE = {
  size: 1.2, height: 0.9, reach: 2.4, openMs: 1000,
  dropEveryMs: 60_000, dropChance: 0.5, fallMs: 4000, fallHeight: 40, lifeMs: 120_000,
  // Что внутри: 10% — взрыв, 40% — ракетница, остальные 50% — броня
  trapChance: 0.1, rocketChance: 0.4, trapRadius: 5,
};
export const ROCKET = { speed: 70, radius: 4, lifeMs: 4000 };

/** Метательный нож: один на жизнь, после смерти появляется снова. */
/** pad — насколько попадание ножом «прощает» промах мимо края хитбокса, м. */
export const THROW = { dmg: 50, speed: 42, gravity: 1.5, lifeMs: 3000, pad: 0.15 };

/** Длительность матча на выбор и голосование за карту после него. */
/**
 * Ограничение матча — на выбор первого игрока: по времени (минуты) или по убийствам
 * (команды — сумма убийств команды, «каждый сам за себя» — убийства игрока).
 */
export const MATCH = { minutes: [5, 10, 15] as const, kills: [50, 100, 150] as const, voteMs: 15_000 };
export type LimitKind = 'time' | 'kills';

/** Погода: раз в everyMs с вероятностью chance начинается дождь или снег на ms. */
export const WEATHER = { everyMs: 180_000, chance: 0.25, ms: 60_000 };
export type WeatherKind = 'rain' | 'snow';

/**
 * Серия убийств (без смертей): награды за 3, 4, 5, 7 и 15 убийств подряд.
 * БПЛА, ракету с неба и бомбу можно использовать и после смерти — они лежат в запасе, пока их не применят.
 */
export const STREAK = {
  uav: 3, missile: 4, launcher: 5, superArmor: 7, nuke: 15,
  uavMs: 30_000, pingMs: 2000,
  missileHeight: 60, missileSpeed: 18, missileBoost: 55, missileRadius: 6, missileMaxMs: 20_000,
  superArmorHp: 500, bigScale: 1.5,
  /** Шлем Джаггернаута: голова неуязвима, пока шлем не собьют этим числом попаданий */
  helmetHits: 3,
  nukeMs: 4000,
};
export type StreakKind = 'uav' | 'missile' | 'nuke';
export const WEAPON_ORDER: WeaponId[] = ['pistol', 'shotgun', 'rifle', 'lmg', 'sniper', 'knife'];

/** Огнестрел, из которого собирают набор: не больше двух стволов, нож есть всегда. */
export const GUNS: WeaponId[] = ['pistol', 'shotgun', 'rifle', 'lmg', 'sniper'];
export const KIT_SIZE = 2;
export const DEFAULT_KIT: WeaponId[] = ['rifle', 'pistol'];
export function isKit(v: unknown): v is WeaponId[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= KIT_SIZE && new Set(v).size === v.length &&
    v.every((w) => GUNS.includes(w as WeaponId));
}

/** Патроны с трупов: подобрав, получаешь половину полного запаса к своим стволам. */
export const AMMO_PACK = { share: 0.5, lifeMs: 30_000, reach: 1.1 };

/** Подкат: из спринта по C, игрок ложится и скользит ms миллисекунд. */
export const SLIDE = { ms: 1000, height: 0.8, eye: 0.6, boost: 1.35, endSpeed: 0.35, cooldownMs: 500 };

/**
 * Хитбокс игрока. Стоя — столб PLAYER.w × PLAYER.h. В подкате — лежащий прямоугольник
 * длиной PLAYER.h вдоль взгляда и высотой SLIDE.height (берём охватывающий его AABB).
 */
export function playerBox(pos: Vec3, yaw: number, sliding: boolean, scale = 1): [Vec3, Vec3] {
  let hx = PLAYER.w / 2, hz = PLAYER.w / 2, h = PLAYER.h;
  if (sliding) {
    const s = Math.abs(Math.sin(yaw)), c = Math.abs(Math.cos(yaw));
    hx = (PLAYER.h / 2) * s + (PLAYER.w / 2) * c;
    hz = (PLAYER.h / 2) * c + (PLAYER.w / 2) * s;
    h = SLIDE.height;
  }
  hx *= scale; hz *= scale; h *= scale;
  return [[pos[0] - hx, pos[1], pos[2] - hz], [pos[0] + hx, pos[1] + h, pos[2] + hz]];
}

/** Точки тела для проверки прямой видимости: низ, середина и верх. */
export function bodyPoints(pos: Vec3, sliding: boolean, scale = 1): Vec3[] {
  const h = (sliding ? SLIDE.height : PLAYER.h) * scale;
  return [0.2, h / 2, h - 0.1].map((y) => [pos[0], pos[1] + y, pos[2]] as Vec3);
}

export const MAPS: Record<MapId, GameMap> = { sands: SANDS, bricks: BRICKS, depot: DEPOT, jumps: JUMPS, town: TOWN };
export const MAP_ORDER: MapId[] = ['sands', 'bricks', 'depot', 'jumps', 'town'];

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
/** Дно мира: ниже ничего нет (пол карты — плита из блоков, под ней канализация). */
export const WORLD_BOTTOM = -6;

export function rayWorld(boxes: Box[], o: Vec3, d: Vec3, maxDist = 200): number {
  let t = maxDist;
  if (d[1] < -1e-9) {
    const tf = (WORLD_BOTTOM - o[1]) / d[1];
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
