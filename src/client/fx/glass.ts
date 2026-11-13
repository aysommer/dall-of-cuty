// Разбитое стекло: стекло раскалывается на треугольные осколки (у точки удара — мелкие, к краям — крупные),
// они разлетаются с физикой — тяжесть, кувырок, отскок и скольжение по полу, стенам и ящикам — и ложатся плашмя.
// Через 3 секунды осколки проваливаются под пол и исчезают.
import * as THREE from 'three';
import type { Box } from '../../shared/map.js';
import { camera, scene } from '../core/scene.js';

const GLASS = {
  /** Сколько осколок лежит, прежде чем провалиться; сколько проваливается */
  lifeMs: 3000, sinkMs: 700, sinkDepth: 0.35,
  gravity: 9.8,
  /** Отскок (доля скорости по нормали) и трение (сколько скорости вдоль поверхности остаётся при ударе) */
  bounce: 0.25, friction: 0.55,
  /** Точек разлома на квадратный метр стекла (и не меньше/больше) */
  density: 22, minPoints: 10, maxPoints: 46,
};

/** normal — нормаль плоскости осколка в его собственных координатах */
interface Shard { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; normal: THREE.Vector3; born: number; resting: boolean; near: Box[] }

const shards: Shard[] = [];
/** Сколько осколок лежит до провала (для отладки можно продлить — game.glassLife) */
let lifeMs = GLASS.lifeMs;
export const setGlassLife = (ms: number | null): void => { lifeMs = ms ?? GLASS.lifeMs; };
const material = new THREE.MeshLambertMaterial({
  color: 0xc8e8ff, emissive: 0x16242e, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
});

type P = [number, number];

/** Триангуляция Делоне (Боуэр — Уотсон): для пары десятков точек — мгновенно. */
function delaunay(pts: P[]): Array<[number, number, number]> {
  const big = 1e4;
  const all: P[] = [...pts, [-big, -big], [big, -big], [0, big]];
  const n = pts.length;
  let tris: Array<[number, number, number]> = [[n, n + 1, n + 2]];
  const circum = (t: [number, number, number]): [number, number, number] => {
    const [ax, ay] = all[t[0]]!, [bx, by] = all[t[1]]!, [cx, cy] = all[t[2]]!;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
  };
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i]!;
    const bad = tris.filter((t) => { const [ux, uy, r2] = circum(t); return (px - ux) ** 2 + (py - uy) ** 2 < r2; });
    const edges: Array<[number, number]> = [];
    for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const) {
      const k = edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (k >= 0) edges.splice(k, 1); else edges.push([a, b]);
    }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [a, b] of edges) tris.push([a, b, i]);
  }
  return tris.filter((t) => t.every((v) => v < n));
}

/** Осколок — треугольная пластина толщиной стекла; точки — в координатах осколка (от его центра). */
function shardGeometry(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3, thick: number): THREE.BufferGeometry {
  const h = normal.clone().multiplyScalar(thick / 2);
  const top = [a, b, c].map((p) => p.clone().add(h)), bot = [a, b, c].map((p) => p.clone().sub(h));
  const tri: number[] = [];
  const push = (...ps: THREE.Vector3[]): void => { for (const p of ps) tri.push(p.x, p.y, p.z); };
  push(top[0]!, top[1]!, top[2]!);
  push(bot[0]!, bot[2]!, bot[1]!);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    push(top[i]!, bot[i]!, bot[j]!);
    push(top[i]!, bot[j]!, top[j]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Стекло (box) разбилось. Удар — в случайной точке ближе к середине; осколки летят от смотрящего
 * (у горизонтального стекла — вниз). solids — с чем осколки сталкиваются.
 */
export function shatterGlass(box: Box, solids: Box[]): void {
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  // Тонкая ось — нормаль стекла; две другие — его плоскость
  const thinAxis = size.indexOf(Math.min(...size));
  const [ua, va] = [0, 1, 2].filter((i) => i !== thinAxis) as [number, number];
  const W = size[ua]!, H = size[va]!, thick = Math.min(0.03, size[thinAxis]!);
  const center = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
  const axis = (i: number): THREE.Vector3 => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
  const U = axis(ua), V = axis(va), N = axis(thinAxis);
  // Куда летят: от камеры; горизонтальное стекло — вниз
  const away = thinAxis === 1 ? new THREE.Vector3(0, -1, 0)
    : N.clone().multiplyScalar(Math.sign(center.clone().sub(camera.getWorldPosition(_c)).dot(N)) || 1);

  // Точки разлома: углы, точки по краям и внутри — гуще вокруг точки удара
  const hit: P = [(Math.random() - 0.5) * W * 0.4, (Math.random() - 0.5) * H * 0.4];
  const count = Math.round(Math.min(GLASS.maxPoints, Math.max(GLASS.minPoints, W * H * GLASS.density)));
  const pts: P[] = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2], hit];
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5 + (Math.random() - 0.5) * 0.6) / 6;
    pts.push([-W / 2 + W * t, -H / 2], [-W / 2 + W * t, H / 2], [-W / 2, -H / 2 + H * t], [W / 2, -H / 2 + H * t]);
  }
  for (let i = 0; i < count; i++) {
    // Ближе к удару — чаще: радиус с квадратом случайного числа
    const a = Math.random() * Math.PI * 2, r = Math.random() ** 1.8 * Math.max(W, H) * 0.75;
    const x = hit[0] + Math.cos(a) * r, y = hit[1] + Math.sin(a) * r;
    if (Math.abs(x) < W / 2 - 0.01 && Math.abs(y) < H / 2 - 0.01) pts.push([x, y]);
  }
  const near = solids.filter((b) => b.max[0] > center.x - 8 && b.min[0] < center.x + 8 && b.max[2] > center.z - 8 && b.min[2] < center.z + 8
    && b.min[1] < center.y + 2 && b.max[1] > center.y - 12 && b !== box);
  const now = performance.now();
  const hitWorld = center.clone().addScaledVector(U, hit[0]).addScaledVector(V, hit[1]);
  for (const [i, j, k] of delaunay(pts)) {
    const p = [pts[i]!, pts[j]!, pts[k]!].map(([x, y]) => center.clone().addScaledVector(U, x).addScaledVector(V, y));
    const mid = p[0]!.clone().add(p[1]!).add(p[2]!).divideScalar(3);
    const geo = shardGeometry(p[0]!.sub(mid), p[1]!.sub(mid), p[2]!.sub(mid), N, thick);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(mid);
    scene.add(mesh);
    // Чем ближе к удару, тем быстрее осколок вылетает; крайние почти просто падают
    const dist = mid.distanceTo(hitWorld);
    const push = Math.max(0.2, 3.2 - dist * 2.4) * (0.7 + Math.random() * 0.6);
    const vel = away.clone().multiplyScalar(push)
      .addScaledVector(U, (Math.random() - 0.5) * 1.2).addScaledVector(V, (Math.random() - 0.3) * 0.8);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14 * Math.min(1, push / 2));
    shards.push({ mesh, vel, spin, normal: N.clone(), born: now, resting: false, near });
  }
}

/** Точка внутри блока — вытолкнуть по кратчайшей оси; возвращает нормаль поверхности или null. */
function pushOut(p: THREE.Vector3, b: Box, r: number): THREE.Vector3 | null {
  const inside = [0, 1, 2].every((i) => p.getComponent(i) > b.min[i]! - r && p.getComponent(i) < b.max[i]! + r);
  if (!inside) return null;
  let best = Infinity, axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    const lo = p.getComponent(i) - (b.min[i]! - r), hi = b.max[i]! + r - p.getComponent(i);
    if (lo < best) { best = lo; axis = i; sign = -1; }
    if (hi < best) { best = hi; axis = i; sign = 1; }
  }
  p.setComponent(axis, p.getComponent(axis) + sign * best);
  return new THREE.Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
}

const _q = new THREE.Quaternion(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _down = new THREE.Vector3(0, -1, 0);

/**
 * Кадр: полёт, удары о поверхности, укладка плашмя; через 3 с — проваливаются под пол и исчезают.
 * frameDt — настоящее время кадра: физика догоняет его шагами не длиннее 1/60 с (до 0,12 с за кадр),
 * чтобы и при низкой частоте кадров осколки успевали упасть, пока не исчезли.
 */
export function updateGlass(now: number, frameDt: number): void {
  const total = Math.min(0.12, frameDt);
  const steps = Math.max(1, Math.ceil(total / (1 / 60)));
  for (let k = 0; k < steps; k++) stepGlass(now, total / steps);
}

function stepGlass(now: number, dt: number): void {
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i]!;
    const age = now - s.born;
    if (age > lifeMs) {
      const k = (age - lifeMs) / GLASS.sinkMs;
      if (k >= 1) { scene.remove(s.mesh); s.mesh.geometry.dispose(); shards.splice(i, 1); continue; }
      s.mesh.position.y -= GLASS.sinkDepth * dt * 1000 / GLASS.sinkMs;
      continue;
    }
    if (s.resting) continue;
    s.vel.y -= GLASS.gravity * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    if (s.spin.lengthSq() > 1e-4) s.mesh.quaternion.premultiply(_q.setFromAxisAngle(_c.copy(s.spin).normalize(), s.spin.length() * dt));
    // Удары: отскок по нормали, трение вдоль поверхности, кувырок гаснет
    for (const b of s.near) {
      const n = pushOut(s.mesh.position, b, 0.012);
      if (!n) continue;
      const vn = s.vel.dot(n);
      // Скорость вдоль поверхности: при ударе теряет долю сразу, при скольжении — плавно
      const along = _v.copy(s.vel).addScaledVector(n, -vn).multiplyScalar(vn < 0 ? GLASS.friction : Math.exp(-6 * dt));
      s.vel.copy(along).addScaledVector(n, vn < 0 ? -vn * GLASS.bounce : vn);
      s.spin.multiplyScalar(vn < 0 ? 0.5 : Math.exp(-8 * dt));
      if (n.y > 0.5) {
        // Лёг на пол или ящик: плоскостью вниз, а когда почти остановился — замер
        _n.copy(s.normal).applyQuaternion(s.mesh.quaternion);
        const flat = _q.setFromUnitVectors(_n, _n.y >= 0 ? _up : _down);
        s.mesh.quaternion.premultiply(new THREE.Quaternion().slerp(flat, 0.35));
        if (s.vel.lengthSq() < 0.05) { s.resting = true; s.vel.set(0, 0, 0); }
      }
    }
    if (s.mesh.position.y < -5) s.resting = true;
  }
}

/** Для отладки и тестов: сколько осколков и сколько из них уже лежит */
export const glassState = (): { shards: number; resting: number; lowest: number; highest: number } => ({
  shards: shards.length, resting: shards.filter((s) => s.resting).length,
  lowest: +Math.min(...shards.map((s) => s.mesh.position.y), 99).toFixed(3), highest: +Math.max(...shards.map((s) => s.mesh.position.y), -99).toFixed(3),
});
