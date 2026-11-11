// Ракеты из ракетницы: полёт и взрывы на клиенте.
import * as THREE from 'three';
import type { BoomMsg, RocketMsg, Vec3 } from '../../shared/protocol.js';
import { rayWorld, ROCKET } from '../../shared/map.js';
import { shotSound } from '../core/audio.js';
import { box, camera, scene } from '../core/scene.js';
import { me } from '../core/state.js';
import { fireworks } from '../fx/fireworks.js';
import { effects } from '../fx/tracers.js';
import { remoteMissiles } from '../streaks/missile.js';
import { solids } from '../world/map.js';

interface RocketFx { mesh: THREE.Mesh; dir: THREE.Vector3; born: number }

const rocketFx = new Map<number, RocketFx>();

export function onRocket(m: RocketMsg): void {
  const mesh = box(0.14, 0.14, 0.5, 0xfff0c0, false);
  const dir = new THREE.Vector3(m.d[0], m.d[1], m.d[2]);
  mesh.position.set(m.o[0], m.o[1], m.o[2]).addScaledVector(dir, 0.8);
  mesh.lookAt(mesh.position.clone().add(dir));
  scene.add(mesh);
  rocketFx.set(m.id, { mesh, dir, born: performance.now() });
  const dist = mesh.position.distanceTo(camera.position);
  shotSound('rocket', m.by === me.id ? 1 : Math.max(0, 1 - dist / 70));
}

function removeRocket(id: number): void {
  const r = rocketFx.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  r.mesh.geometry.dispose();
  (r.mesh.material as THREE.Material).dispose();
  rocketFx.delete(id);
}

export function onBoom(m: BoomMsg): void {
  removeRocket(m.id);
  // Салют: разноцветные искры во все стороны (у ракеты с неба — крупнее)
  fireworks(m.p[0], m.p[1] + 0.3, m.p[2], m.id < 0 ? 1.4 : 1);
  // Ракета с неба (id < 0): после взрыва корпус сразу исчезает
  const missile = remoteMissiles.get(-m.id);
  if (m.id < 0 && missile) {
    remoteMissiles.delete(-m.id);
    scene.remove(missile);
    missile.geometry.dispose();
    (missile.material as THREE.Material).dispose();
  }
  const now = performance.now();
  // Взрыв — растущий и гаснущий куб размером с зону поражения
  for (const [color, size, life] of [[0xff8a1f, ROCKET.radius * 2, 380], [0xfff0a0, ROCKET.radius, 260]] as const) {
    const blast = box(1, 1, 1, color, false);
    (blast.material as THREE.Material).transparent = true;
    blast.position.set(m.p[0], m.p[1], m.p[2]);
    scene.add(blast);
    effects.push({ obj: blast, born: now, life, fade: true, grow: size });
  }
  const dist = Math.hypot(m.p[0] - camera.position.x, m.p[1] - camera.position.y, m.p[2] - camera.position.z);
  shotSound('boom', Math.max(0, 1 - dist / 90));
}

export function updateRockets(now: number, dt: number): void {
  for (const [id, r] of rocketFx) {
    // Сервер пришлёт точку взрыва; до тех пор ракета просто летит, а у стены замирает
    const p = r.mesh.position;
    const step = ROCKET.speed * dt;
    const d: Vec3 = [r.dir.x, r.dir.y, r.dir.z];
    if (rayWorld(solids, [p.x, p.y, p.z], d, step) >= step) p.addScaledVector(r.dir, step);
    if (now - r.born > ROCKET.lifeMs + 1000) removeRocket(id);
  }
}
