// Превью карты для голосования: вид сверху, нарисованный из геометрии самой карты.
// Блоки рисуются от низких к высоким, у каждого — тень по высоте, чем выше — тем светлее.
// Потолок закрытых карт не рисуется, чтобы было видно зал. Точки появления команд — цветные метки.
import { MAPS, type MapId } from '../../shared/map.js';
import type { Box } from '../../shared/maps/types.js';

const cache = new Map<MapId, string>();
const W = 360;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Картинка (data URL) с видом карты сверху; север — вверху. */
export function mapPreview(id: MapId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const m = MAPS[id];
  const ex = m.half.x + 1, ez = m.half.z + 1;                    // с внешними стенами
  const s = W / (2 * ex);
  const H = Math.round(2 * ez * s);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const px = (x: number): number => (x + ex) * s;
  const pz = (z: number): number => (ez - z) * s;
  const area = 4 * m.half.x * m.half.z;
  const boxes: Box[] = [...m.boxes, ...(m.breakables ?? []).map((br) => br.box)]
    // потолок закрытой карты закрыл бы всё
    .filter((bx) => !(m.indoor && bx.min[1] > 2 && (bx.max[0] - bx.min[0]) * (bx.max[2] - bx.min[2]) > area * 0.3))
    .sort((a, b) => a.max[1] - b.max[1]);
  g.fillStyle = '#15171b';
  g.fillRect(0, 0, W, H);
  for (const bx of boxes) {
    const x = px(bx.min[0]), y = pz(bx.max[2]);
    const w = (bx.max[0] - bx.min[0]) * s, h = (bx.max[2] - bx.min[2]) * s;
    const top = bx.max[1];
    if (top > 0.05) {
      const d = Math.min(top, 6) * s * 0.35;                     // тень на юго-восток
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(x + d, y + d, w, h);
    }
    g.fillStyle = shade(bx.top ?? bx.color, 0.78 + 0.32 * Math.min(1, Math.max(0, top) / 9));
    g.fillRect(x, y, Math.max(w, 1), Math.max(h, 1));
  }
  const dots = (pts: Array<[number, number, ...unknown[]]>, color: string): void => {
    for (const [x, z] of pts) {
      g.beginPath();
      g.arc(px(x), pz(z), Math.max(3, s * 0.7), 0, Math.PI * 2);
      g.fillStyle = color; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#0b0c0e'; g.stroke();
    }
  };
  dots(m.spawns.green, '#4fe36a');
  dots(m.spawns.red, '#ff5a52');
  const url = cv.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
