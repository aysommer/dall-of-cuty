// Типы карт. Вся геометрия — только прямоугольные блоки.
import type { Team, Vec3 } from '../protocol.js';

export type MapId = 'sands' | 'bricks' | 'depot' | 'jumps' | 'town' | 'house' | 'fall' | 'store';

export interface Box {
  min: Vec3;
  max: Vec3;
  color: string;
  /** Цвет верхней грани, если он другой (у плиты земли верх — земля, бока и низ — тёмные) */
  top?: string;
}

/** Лестница: объём, в котором игрок может карабкаться, и направление «от стены» по X/Z. */
export interface Ladder {
  min: Vec3;
  max: Vec3;
  normal: [number, number];
}

/** Разрушаемый блок: стекло или дверь. Пока цел — твёрдый; набрал урон hp — разлетается и исчезает. */
export interface Breakable {
  id: number;
  box: Box;
  hp: number;
  kind: 'glass' | 'door';
}

/** Трамплин: встал на него — подбрасывает со скоростью vel. */
export interface JumpPad {
  min: Vec3;
  max: Vec3;
  vel: Vec3;
}

/** Точка появления: [x, z, yaw, высота пола (по умолчанию 0)] */
export type SpawnPoint = [x: number, z: number, yaw: number, y?: number];

export interface GameMap {
  id: MapId;
  name: string;
  /** Карта из раздела «Новые»; без отметки — из раздела «Старые» */
  fresh?: boolean;
  /** Половина размера арены по X и Z (без внешних стен) */
  half: { x: number; z: number };
  floor: string;
  sky: string;
  boxes: Box[];
  ladders: Ladder[];
  /** Куда может упасть ящик с ракетницей: центр по X/Z и высота пола под ним */
  crateDrops: Vec3[];
  /** Куда могут падать аптечки (центр по X/Z и высота пола) */
  medkitDrops: Vec3[];
  /** Трамплины (есть не на всех картах) */
  pads?: JumpPad[];
  /** Разрушаемые стекло и двери */
  breakables?: Breakable[];
  /** Карта под крышей: погоды внутри нет, ящик и аптечки не падают сквозь крышу, а появляются на месте */
  indoor?: boolean;
  spawns: Record<Team | 'ffa', SpawnPoint[]>;
}

/** Помощник для описания блоков: b(x1, z1, x2, z2, высота, цвет, низ). */
export function builder() {
  const boxes: Box[] = [];
  const b = (x1: number, z1: number, x2: number, z2: number, h: number, color: string, y = 0): void => {
    boxes.push({ min: [x1, y, z1], max: [x2, y + h, z2], color });
  };
  /** Блок и его отражение через центр карты — чтобы обе стороны были в равных условиях. */
  const sym = (x1: number, z1: number, x2: number, z2: number, h: number, color: string, y = 0): void => {
    b(x1, z1, x2, z2, h, color, y);
    b(-x2, -z2, -x1, -z1, h, color, y);
  };
  return { boxes, b, sym };
}
