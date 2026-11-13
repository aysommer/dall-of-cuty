// Метательный нож: полёт и попадание.
import * as THREE from 'three';
import type { ThrowEndMsg, ThrowMsg } from '../../shared/protocol.js';
import { THROW } from '../../shared/map.js';
import { beep, shotSound } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { box, camera, scene } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { openingUntil } from '../pickups/crate.js';
import { missileCtl } from '../streaks/missile.js';
import { showHit, updateHud } from '../ui/hud.js';
import { _dir } from './shooting.js';
import { setWeapon, startOffhandThrow, startThrow } from './viewmodel.js';

interface KnifeFx { mesh: THREE.Group; vel: THREE.Vector3 }

const knifeFx = new Map<number, KnifeFx>();

function knifeModel(): THREE.Group {
  const g = new THREE.Group();
  const blade = box(0.02, 0.06, 0.3, 0xd0d4da);
  blade.position.z = -0.1;
  const handle = box(0.04, 0.05, 0.14, 0x1c1c1c);
  handle.position.z = 0.1;
  g.add(blade, handle);
  return g;
}

/** G (или ПКМ с ножом в руке): бросить нож туда, куда смотришь. */
export function throwKnife(): void {
  if (!me.alive || !state.hasKnife || openingUntil || missileCtl || state.roundOver) return;
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'throw', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
  state.hasKnife = false; // сервер подтвердит
  // Бросок виден: нож в руке уходит замахом вперёд, а если в руках ствол — бросает свободная рука
  const now = performance.now();
  if (me.weapon === 'knife') {
    startThrow(now);
    setTimeout(() => { if (me.weapon === 'knife') setWeapon(settings.kit[0]!); }, 300);
  } else startOffhandThrow(now);
  shotSound('knife', 1);
  updateHud();
}

/** Свои брошенные ножи — чтобы показать попадание */
const myKnives = new Set<number>();

export function onThrow(m: ThrowMsg): void {
  if (m.by === me.id) myKnives.add(m.id);
  const mesh = knifeModel();
  mesh.position.set(m.o[0], m.o[1], m.o[2]);
  scene.add(mesh);
  knifeFx.set(m.id, { mesh, vel: new THREE.Vector3(m.d[0], m.d[1], m.d[2]).multiplyScalar(THROW.speed) });
}

export function onThrown(m: ThrowEndMsg): void {
  if (myKnives.delete(m.id) && m.hit) { showHit(false); beep(1400, 0.05, 0.08); }
  const fx = knifeFx.get(m.id);
  if (!fx) return;
  knifeFx.delete(m.id);
  if (m.hit) {
    scene.remove(fx.mesh);
    return;
  }
  // Промах — нож торчит из стены или пола ещё 5 секунд
  fx.mesh.position.set(m.p[0], m.p[1], m.p[2]);
  fx.mesh.lookAt(fx.mesh.position.clone().sub(fx.vel));
  setTimeout(() => scene.remove(fx.mesh), 5000);
}

export function updateKnives(dt: number): void {
  for (const fx of knifeFx.values()) {
    fx.vel.y -= THROW.gravity * dt;
    fx.mesh.position.addScaledVector(fx.vel, dt);
    fx.mesh.rotation.x -= dt * 20; // летит, вращаясь
  }
}
