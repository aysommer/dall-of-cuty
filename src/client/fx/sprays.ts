// Эмодзи на стенах (T).
import * as THREE from 'three';
import type { SprayMsg, Vec3 } from '../../shared/protocol.js';
import { EMOJIS, SPRAY } from '../../shared/emoji.js';
import { type Box, rayBox } from '../../shared/map.js';
import { sendMsg } from '../core/net.js';
import { camera, scene } from '../core/scene.js';
import { me } from '../core/state.js';
import { toast } from '../ui/hud.js';
import { _dir } from '../weapons/shooting.js';
import { currentMap } from '../world/map.js';

interface Spray { mesh: THREE.Mesh; born: number }

export const sprays: Spray[] = [];

let sprayReadyAt = 0;

/** T: найти стену под прицелом и попросить сервер нарисовать на ней случайный эмодзи. */
export function trySpray(now: number): void {
  if (!me.alive) return;
  if (now < sprayReadyAt) {
    toast(`Рисовать можно раз в минуту — ещё ${Math.ceil((sprayReadyAt - now) / 1000)} сек.`);
    return;
  }
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const d: Vec3 = [_dir.x, _dir.y, _dir.z];
  let best = SPRAY.reach;
  let wall: Box | null = null;
  for (const b of currentMap.boxes) {
    const t = rayBox(eye, d, b.min, b.max);
    if (t < best) { best = t; wall = b; }
  }
  if (!wall) { toast('Наведи прицел на стену поближе'); return; }
  const p: Vec3 = [eye[0] + d[0] * best, eye[1] + d[1] * best, eye[2] + d[2] * best];
  // Какой грани блока принадлежит точка: ближайшая по расстоянию
  const faces: Array<[number, number, number, number]> = [
    [-1, 0, 0, Math.abs(p[0] - wall.min[0])], [1, 0, 0, Math.abs(p[0] - wall.max[0])],
    [0, -1, 0, Math.abs(p[1] - wall.min[1])], [0, 1, 0, Math.abs(p[1] - wall.max[1])],
    [0, 0, -1, Math.abs(p[2] - wall.min[2])], [0, 0, 1, Math.abs(p[2] - wall.max[2])],
  ];
  const [nx, ny, nz] = faces.reduce((a, b) => (b[3] < a[3] ? b : a));
  if (ny !== 0) { toast('Рисовать можно только на стене'); return; }
  const e = Math.floor(Math.random() * EMOJIS.length);
  sendMsg({ t: 'spray', p: [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)], n: [nx, nz], e });
  sprayReadyAt = now + SPRAY.cooldownMs;
}

function emojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '100px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  return new THREE.CanvasTexture(c);
}

export function onSpray(m: SprayMsg): void {
  const emoji = EMOJIS[m.e];
  if (!emoji) return;
  const mat = new THREE.MeshBasicMaterial({
    map: emojiTexture(emoji), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRAY.size, SPRAY.size), mat);
  const [nx, nz] = m.n;
  mesh.position.set(m.p[0] + nx * 0.02, m.p[1], m.p[2] + nz * 0.02);
  mesh.lookAt(mesh.position.x + nx, mesh.position.y, mesh.position.z + nz);
  scene.add(mesh);
  sprays.push({ mesh, born: performance.now() });
}

export function updateSprays(now: number): void {
  for (let i = sprays.length - 1; i >= 0; i--) {
    const s = sprays[i]!;
    const age = now - s.born;
    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    // Последнюю секунду рисунок тает
    mat.opacity = Math.min(1, (SPRAY.lifeMs - age) / 1000);
    if (age >= SPRAY.lifeMs) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      mat.map?.dispose();
      mat.dispose();
      sprays.splice(i, 1);
    }
  }
}
