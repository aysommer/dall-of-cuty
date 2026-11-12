// Ракета с неба: управление полётом.
import * as THREE from 'three';
import type { MissileMsg, Vec3 } from '../../shared/protocol.js';
import { playerBox, rayBox, rayWorld, STREAK } from '../../shared/map.js';
import { beep } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { box, camera, canvas, scene } from '../core/scene.js';
import { me, remotes, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { scaleOfRemote, lowOfRemote } from '../render/players.js';
import { feedNote } from '../ui/hud.js';
import { solids } from '../world/map.js';

export let missileCtl: { id: number; pos: THREE.Vector3; yaw: number; pitch: number; born: number; sendAcc: number } | null = null;

export const remoteMissiles = new Map<number, THREE.Mesh>();

function missileMesh(): THREE.Mesh {
  const m = box(0.35, 0.35, 1.4, 0xdddddd);
  m.material = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x552200 });
  return m;
}

/** Камера переходит в ракету над картой; ведёшь её мышью, ЛКМ — ускорение. */
export function startMissile(id: number, p: Vec3): void {
  missileCtl = { id, pos: new THREE.Vector3(p[0], p[1], p[2]), yaw: me.yaw, pitch: -1.3, born: performance.now(), sendAcc: 0 };
  state.aimHeld = false;
  $('missile-view').classList.remove('hidden');
  canvas.classList.add('thermal');
  beep(500, 0.4, 0.1);
}

export function endMissile(): void {
  if (!missileCtl) return;
  missileCtl = null;
  $('missile-view').classList.add('hidden');
  canvas.classList.remove('thermal');
}

export function updateMissile(now: number, dt: number): void {
  const m = missileCtl;
  if (!m) return;
  const speed = state.mouseDown ? STREAK.missileBoost : STREAK.missileSpeed;
  const dir = new THREE.Vector3(-Math.sin(m.yaw) * Math.cos(m.pitch), Math.sin(m.pitch), -Math.cos(m.yaw) * Math.cos(m.pitch));
  const step = speed * dt;
  const from: Vec3 = [m.pos.x, m.pos.y, m.pos.z];
  const d: Vec3 = [dir.x, dir.y, dir.z];
  let t = rayWorld(solids, from, d, step);
  for (const r of remotes.values()) {
    if (!r.info.alive) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, lowOfRemote(r), scaleOfRemote(r));
    t = Math.min(t, rayBox(from, d, min, max));
  }
  const expired = now - m.born > STREAK.missileMaxMs - 500;
  if (t < step || expired) {
    const at = m.pos.clone().addScaledVector(dir, Math.min(t, step));
    sendMsg({ t: 'mhit', id: m.id, p: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)] });
    endMissile();
    return;
  }
  m.pos.addScaledVector(dir, step);
  m.sendAcc += dt;
  if (m.sendAcc >= 0.1) {
    m.sendAcc = 0;
    sendMsg({ t: 'mpos', id: m.id, p: [+m.pos.x.toFixed(2), +m.pos.y.toFixed(2), +m.pos.z.toFixed(2)] });
  }
  camera.position.copy(m.pos);
  camera.rotation.set(m.pitch, m.yaw, 0);
  $('missile-alt').textContent = `${Math.max(0, Math.round(m.pos.y))} м · ${state.mouseDown ? 'ускорение' : 'ЛКМ — ускорение'}`;
}

export function onMissile(m: MissileMsg): void {
  let mesh = remoteMissiles.get(m.id);
  if (!mesh) {
    mesh = missileMesh();
    scene.add(mesh);
    remoteMissiles.set(m.id, mesh);
    if (state.joined) feedNote('🚀 С неба летит ракета!');
  }
  const target = new THREE.Vector3(m.p[0], m.p[1], m.p[2]);
  mesh.lookAt(target);
  mesh.position.copy(target);
}
