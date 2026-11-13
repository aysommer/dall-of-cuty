// Частицы взрывов (огненный салют).
import * as THREE from 'three';
import { scene } from '../core/scene.js';

interface Burst { points: THREE.Points; vel: Float32Array; born: number; life: number }

export const bursts: Burst[] = [];

/** Цвета огня настоящего взрыва: красный, оранжевый, жёлтый и белый — по нарастанию жара */
const FIRE_COLORS = [0xff2a12, 0xff6a14, 0xffa31a, 0xffd23a, 0xfff3c4, 0xffffff];

/**
 * Взрыв как салют: искры разлетаются шаром, падают под тяжестью, мерцают и гаснут.
 * scale — размер: 1 для ракеты, больше — для ракеты с неба и бомбы.
 */
export function fireworks(x: number, y: number, z: number, scale = 1, colors: number[] = FIRE_COLORS): void {
  const n = Math.round(140 * scale);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos.set([x, y, z], i * 3);
    // Направление — равномерно по сфере, скорость — с разбросом, чтобы получился «шар» искр
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const heat = Math.random();
    // Горячие (белые, жёлтые) искры летят быстрее, остывшие (оранжевые, красные) — медленнее
    const speed = (4 + heat * 9) * Math.sqrt(scale);
    vel.set([r * Math.cos(a) * speed, u * speed + 3, r * Math.sin(a) * speed], i * 3);
    c.set(colors[Math.min(colors.length - 1, Math.floor(heat * colors.length))]!);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.22 * Math.sqrt(scale), vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // Искры ярче белого: горячие светятся (bloom)
  mat.color.setScalar(5);
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  bursts.push({ points, vel, born: performance.now(), life: 1400 + 600 * (scale - 1) });
}

export function updateFireworks(dt: number): void {
  const now = performance.now();
  for (let i = bursts.length - 1; i >= 0; i--) {
    const bu = bursts[i]!;
    const age = now - bu.born;
    const mat = bu.points.material as THREE.PointsMaterial;
    if (age > bu.life) {
      scene.remove(bu.points);
      bu.points.geometry.dispose();
      mat.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const pos = bu.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array, v = bu.vel;
    const drag = Math.exp(-1.6 * dt);
    for (let k = 0; k < arr.length; k += 3) {
      v[k]! *= drag; v[k + 2]! *= drag;
      v[k + 1] = v[k + 1]! * drag - 9 * dt;           // искры тормозят и падают
      arr[k] += v[k]! * dt; arr[k + 1] += v[k + 1]! * dt; arr[k + 2] += v[k + 2]! * dt;
    }
    pos.needsUpdate = true;
    // Гаснут к концу и слегка мерцают
    const t = age / bu.life;
    mat.opacity = (1 - t * t) * (0.75 + 0.25 * Math.sin(age / 35));
  }
}
