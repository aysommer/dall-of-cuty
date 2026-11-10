// Земля и канализация. Пол карты — плита толщиной 1 м с двумя люками,
// под ней коридор канализации; в каждом люке лестница вниз и наверх, посередине коридора — фонарь.
import type { Box, Ladder } from './types.js';
import type { Vec3 } from '../protocol.js';

export const SEWER = {
  /** Низ плиты земли (= потолок канализации) и пол канализации */
  ceil: -1, floor: -4,
  /** Ширина коридора, размер люка, толщина стен */
  width: 3, hole: 2, wall: 0.5,
};
/** Ниже этой высоты — под землёй: там темно и светит только фонарь. */
export const UNDERGROUND_Y = SEWER.ceil;
/** Бетон канализации: тёмный, чтобы внизу было темно и без выключения солнца */
const DARK = '#26282b';

/** Коридор вдоль оси axis от from до to; по другой оси — посередине at. Люки — на обоих концах. */
export interface SewerSpec { axis: 'x' | 'z'; from: number; to: number; at: number }

type Rect = [x1: number, z1: number, x2: number, z2: number];

/** Прямоугольник area без дыр — набором прямоугольников (полосы по X). */
export function subtract(area: Rect, holes: Rect[]): Rect[] {
  const xs = [...new Set([area[0], area[2], ...holes.flatMap((h) => [h[0], h[2]])])]
    .filter((x) => x >= area[0] && x <= area[2]).sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x1 = xs[i]!, x2 = xs[i + 1]!;
    const cut = holes.filter((h) => h[0] <= x1 && h[2] >= x2).map((h) => [h[1], h[3]] as const)
      .sort((a, b) => a[0] - b[0]);
    let z = area[1];
    for (const [z1, z2] of cut) {
      if (z1 > z) out.push([x1, z, x2, z1]);
      z = Math.max(z, z2);
    }
    if (z < area[3]) out.push([x1, z, x2, area[3]]);
  }
  return out;
}

export interface SewerResult { lamps: Vec3[]; holes: Rect[] }

/**
 * Добавляет к карте плиту земли (с люками) и канализацию.
 * half — половина арены; ground — цвет земли; walls — цвет стен канализации.
 */
export function addGroundAndSewer(
  boxes: Box[], ladders: Ladder[], half: { x: number; z: number }, s: SewerSpec, ground: string, _walls?: string,
): SewerResult {
  const walls = DARK;
  const { ceil, floor, width, hole, wall } = SEWER;
  const w = width / 2, h = hole / 2;
  // Всё строим «вдоль X», а для оси Z меняем координаты местами
  const put = (a1: number, b1: number, a2: number, b2: number, y1: number, y2: number, color: string): void => {
    const [x1, z1, x2, z2] = s.axis === 'x' ? [a1, b1, a2, b2] : [b1, a1, b2, a2];
    boxes.push({ min: [x1, y1, z1], max: [x2, y2, z2], color });
  };
  const rect = (a1: number, b1: number, a2: number, b2: number): Rect =>
    s.axis === 'x' ? [a1, b1, a2, b2] : [b1, a1, b2, a2];

  // Люки на концах коридора
  const holes: Rect[] = [rect(s.from, s.at - h, s.from + hole, s.at + h), rect(s.to - hole, s.at - h, s.to, s.at + h)];
  // Плита: сверху — земля, снизу и в шахтах люков — тёмный бетон (из канализации наружу видно небо, а не свет внутри)
  for (const [x1, z1, x2, z2] of subtract([-half.x - 1, -half.z - 1, half.x + 1, half.z + 1], holes)) {
    boxes.push({ min: [x1, ceil, z1], max: [x2, 0, z2], color: DARK, top: ground });
  }
  // Коридор: пол, две длинные стены и торцы
  put(s.from - wall, s.at - w - wall, s.to + wall, s.at + w + wall, floor - 1, floor, walls);
  put(s.from - wall, s.at - w - wall, s.to + wall, s.at - w, floor, ceil, walls);
  put(s.from - wall, s.at + w, s.to + wall, s.at + w + wall, floor, ceil, walls);
  put(s.from - wall, s.at - w, s.from, s.at + w, floor, ceil, walls);
  put(s.to, s.at - w, s.to + wall, s.at + w, floor, ceil, walls);

  // Лестницы — на торцевых стенах под люками, от пола канализации до края люка
  const ladder = (a1: number, a2: number, normal: number): void => {
    const [x1, z1, x2, z2] = rect(a1, s.at - 0.7, a2, s.at + 0.7);
    ladders.push({
      min: [x1, floor, z1], max: [x2, 0.4, z2],
      normal: s.axis === 'x' ? [normal, 0] : [0, normal],
    });
  };
  ladder(s.from, s.from + 0.45, 1);
  ladder(s.to - 0.45, s.to, -1);

  const mid = (s.from + s.to) / 2;
  const lamp: Vec3 = s.axis === 'x' ? [mid, ceil - 0.4, s.at] : [s.at, ceil - 0.4, mid];
  return { lamps: [lamp], holes };
}
