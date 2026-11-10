// Типы карт. Вся геометрия — только прямоугольные блоки.
import type { Team, Vec3 } from '../protocol.js';

export type MapId = 'sands' | 'bricks' | 'depot' | 'jumps' | 'town';

export interface Box {
  min: Vec3;
  max: Vec3;
  color: string;
  /** Цвет верхней грани, если он другой (у плиты земли верх — земля, бока и низ — тёмный потолок канализации) */
  top?: string;
}

/** Лестница: объём, в котором игрок может карабкаться, и направление «от стены» по X/Z. */
export interface Ladder {
  min: Vec3;
  max: Vec3;
  normal: [number, number];
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
  /** Фонари в канализации */
  lamps: Vec3[];
  /** Трамплины (есть не на всех картах) */
  pads?: JumpPad[];
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
