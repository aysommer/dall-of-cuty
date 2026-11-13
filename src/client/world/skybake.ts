// Запечённое небесное освещение. При загрузке карты для каждой вершины блоков считается, какая доля неба
// из неё видна (лучи в полусферу вокруг нормали): рассеянный свет неба умножается на эту долю — комнаты, проходы
// под навесами, переулки и щели между стеллажами становятся темнее открытых мест. Лучи, упёршиеся в блок,
// приносят его цвет — отражённый свет: красная стена слегка подкрашивает пол рядом.
// Расчёт — в фоновом потоке (Web Worker): карта сразу рисуется как раньше, а через долю секунды освещение
// подменяется запечённым. В кадре это ничего не стоит — результат лежит в атрибуте вершин aSky.
import * as THREE from 'three';
import type { Box } from '../../shared/map.js';

/** Сколько лучей на вершину, как далеко они ищут преграду (дальше — небо), минимум рассеянного света в глухом углу */
export const SKY_BAKE = { rays: 40, reach: 10, floor: 0.16, blur: 3 };

/** Преграда для лучей: блок и его цвет сбоку и сверху (в линейных цветах) */
export interface Occluder { box: Box; side: THREE.Color; top: THREE.Color }

/**
 * Работа фонового потока: всё в одной функции без внешних ссылок — она превращается в текст и запускается в Worker.
 * На входе: блоки (min, max, цвет сбоку, цвет сверху — по 12 чисел), вершины и нормали; на выходе — по 4 числа
 * на вершину: доля неба и отражённый цвет.
 */
function workerMain(): void {
  const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, t: Transferable[]) => void };
  ctx.onmessage = (e: MessageEvent): void => {
    const { id, boxes, pos, norm, rays, reach, floor } = e.data as {
      id: number; boxes: Float32Array; pos: Float32Array; norm: Float32Array; rays: number; reach: number; floor: number;
    };
    const nb = boxes.length / 12, nv = pos.length / 3;
    const out = new Float32Array(nv * 4);
    // Направления в полусфере с косинусным весом (больше лучей ближе к нормали — как падает рассеянный свет)
    const dirs: number[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < rays; i++) {
      const r = Math.sqrt((i + 0.5) / rays), a = i * golden;
      dirs.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r)));
    }
    // Блоки рядом с гранью отбираются один раз на группу вершин с одной нормалью и близким положением
    const near = new Int32Array(nb);
    let nearN = 0, lastKey = '';
    for (let v = 0; v < nv; v++) {
      const px = pos[v * 3]!, py = pos[v * 3 + 1]!, pz = pos[v * 3 + 2]!;
      const nx = norm[v * 3]!, ny = norm[v * 3 + 1]!, nz = norm[v * 3 + 2]!;
      // Новая группа — каждые 4 м: пересобрать список ближних блоков
      const key = `${nx},${ny},${nz},${Math.floor(px / 4)},${Math.floor(py / 4)},${Math.floor(pz / 4)}`;
      if (key !== lastKey) {
        lastKey = key;
        nearN = 0;
        const cx = (Math.floor(px / 4) + 0.5) * 4, cy = (Math.floor(py / 4) + 0.5) * 4, cz = (Math.floor(pz / 4) + 0.5) * 4;
        const R = reach + 3;
        for (let b = 0; b < nb; b++) {
          const o = b * 12;
          const dx = Math.max(boxes[o]! - cx, 0, cx - boxes[o + 3]!), dy = Math.max(boxes[o + 1]! - cy, 0, cy - boxes[o + 4]!), dz = Math.max(boxes[o + 2]! - cz, 0, cz - boxes[o + 5]!);
          if (dx * dx + dy * dy + dz * dz < R * R) near[nearN++] = b;
        }
      }
      // Касательные к нормали
      let tx = 0, ty = 0, tz = 0;
      if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 1; ty = 0; tz = 0; }
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      // Поворот набора лучей от вершины к вершине — чтобы не было полос от одинаковых направлений
      const spin = ((Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453) % 1) * Math.PI * 2;
      const cs = Math.cos(spin), sn = Math.sin(spin);
      const ox = px + nx * 0.03, oy = py + ny * 0.03, oz = pz + nz * 0.03;
      let sky = 0, br = 0, bg = 0, bb = 0, counted = 0;
      for (let i = 0; i < rays; i++) {
        const lx = dirs[i * 3]! * cs - dirs[i * 3 + 1]! * sn, ly = dirs[i * 3]! * sn + dirs[i * 3 + 1]! * cs, lz = dirs[i * 3 + 2]!;
        const dx = tx * lx + bx * ly + nx * lz, dy = ty * lx + by * ly + ny * lz, dz = tz * lx + bz * ly + nz * lz;
        // Лучи вниз смотрят в землю — её свет уже учтён в рассеянном свете (нижняя половина неба); их не считаем
        if (dy < -0.2) continue;
        counted++;
        const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
        let best = reach, hitBox = -1, hitTop = false;
        for (let k = 0; k < nearN; k++) {
          const o = near[k]! * 12;
          let t1 = (boxes[o]! - ox) * ix, t2 = (boxes[o + 3]! - ox) * ix;
          let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), axis = 0;
          t1 = (boxes[o + 1]! - oy) * iy; t2 = (boxes[o + 4]! - oy) * iy;
          let a = Math.min(t1, t2);
          if (a > tmin) { tmin = a; axis = 1; }
          tmax = Math.min(tmax, Math.max(t1, t2));
          t1 = (boxes[o + 2]! - oz) * iz; t2 = (boxes[o + 5]! - oz) * iz;
          a = Math.min(t1, t2);
          if (a > tmin) { tmin = a; axis = 2; }
          tmax = Math.min(tmax, Math.max(t1, t2));
          // Начало луча внутри блока (вершина утоплена в соседний блок) — этот блок не считается
          if (tmax < 0 || tmin > tmax || tmin < 0 || tmin >= best) continue;
          best = tmin; hitBox = o; hitTop = axis === 1 && dy < 0;
        }
        if (hitBox < 0) { sky++; continue; }
        const c = hitBox + (hitTop ? 9 : 6);
        br += boxes[c]!; bg += boxes[c + 1]!; bb += boxes[c + 2]!;
      }
      const f = counted ? sky / counted : 1;
      out[v * 4] = floor + (1 - floor) * f;
      const k = counted || 1;
      out[v * 4 + 1] = br / k; out[v * 4 + 2] = bg / k; out[v * 4 + 3] = bb / k;
    }
    ctx.postMessage({ id, out }, [out.buffer]);
  };
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (out: Float32Array) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e: MessageEvent): void => {
      const { id, out } = e.data as { id: number; out: Float32Array };
      pending.get(id)?.(out);
      pending.delete(id);
    };
  } catch { worker = null; }
  return worker;
}

/**
 * Сгладить запечённое по соседним вершинам (вершины граней разных блоков не общие — шов между блоками
 * не размывается): убирает пятна от того, что на вершину приходится всего несколько десятков лучей.
 */
function smooth(data: Float32Array, index: THREE.BufferAttribute, passes: number): Float32Array {
  const n = data.length / 4;
  const idx = index.array;
  // Соседи по рёбрам треугольников
  const nb: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      if (!nb[x]!.includes(y)) nb[x]!.push(y);
      if (!nb[y]!.includes(x)) nb[y]!.push(x);
    }
  }
  let cur: Float32Array = data, next: Float32Array = new Float32Array(data.length);
  for (let p = 0; p < passes; p++) {
    for (let v = 0; v < n; v++) {
      const list = nb[v]!;
      for (let k = 0; k < 4; k++) {
        let sum = cur[v * 4 + k]! * 2;
        for (const u of list) sum += cur[u * 4 + k]!;
        next[v * 4 + k] = sum / (list.length + 2);
      }
    }
    [cur, next] = [next, cur];
  }
  return cur;
}

/** Атрибут «без запекания»: всё небо видно, отражённого света нет — так выглядит до окончания расчёта. */
export function skyAttribute(count: number): THREE.BufferAttribute {
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) a[i * 4] = 1;
  return new THREE.BufferAttribute(a, 4);
}

/** Запечь освещение для меша (атрибут aSky обновится, когда фоновый поток закончит). */
export function bakeSky(mesh: THREE.Mesh, occluders: Occluder[], done?: () => void): void {
  const w = getWorker();
  if (!w) return;
  const boxes = new Float32Array(occluders.length * 12);
  occluders.forEach((o, i) => {
    boxes.set([...o.box.min, ...o.box.max, o.side.r, o.side.g, o.side.b, o.top.r, o.top.g, o.top.b], i * 12);
  });
  const geo = mesh.geometry;
  const pos = new Float32Array((geo.getAttribute('position') as THREE.BufferAttribute).array);
  const norm = new Float32Array((geo.getAttribute('normal') as THREE.BufferAttribute).array);
  const id = nextId++;
  pending.set(id, (out) => {
    const attr = geo.getAttribute('aSky') as THREE.BufferAttribute | undefined;
    if (!attr || attr.count * 4 !== out.length) return; // карта уже сменилась
    (attr.array as Float32Array).set(smooth(out, geo.getIndex()!, SKY_BAKE.blur));
    attr.needsUpdate = true;
    done?.();
  });
  w.postMessage({ id, boxes, pos, norm, rays: SKY_BAKE.rays, reach: SKY_BAKE.reach, floor: SKY_BAKE.floor }, [boxes.buffer, pos.buffer, norm.buffer]);
}
