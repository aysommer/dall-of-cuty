// Земля: плита толщиной 1 м под всей ареной (верх — цвет газона или пола, бока и низ — тёмные).
// Подвалов и канализации нет.
import type { Box } from './types.js';

/** Цвет боков и низа плиты */
const DARK = '#26282b';

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

/** Добавляет к карте плиту земли на всю арену с запасом под внешние стены. */
export function addGround(boxes: Box[], half: { x: number; z: number }, ground: string): void {
  boxes.push({ min: [-half.x - 1, -1, -half.z - 1], max: [half.x + 1, 0, half.z + 1], color: DARK, top: ground });
}
