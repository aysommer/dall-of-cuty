// Граната: чека, бросок, отскоки, писк и взрыв.
import * as THREE from 'three';
import { GRENADE } from '../../shared/map.js';
import type { GrenadesMsg } from '../../shared/protocol.js';
import { beep, shotSound } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { box, camera, scene } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { openingUntil } from '../pickups/crate.js';
import { _dir } from './shooting.js';
import { setWeapon, viewGun } from './viewmodel.js';

/** Когда сорвана чека гранаты в руке (0 — не держу) */
export let cookStart = 0;

let cookBeepAt = 0;

/** Писк гранаты: чем меньше осталось до взрыва, тем чаще. */
function beepInterval(msLeft: number): number {
  return 120 + 560 * Math.max(0, Math.min(1, msLeft / GRENADE.fuseMs));
}

/** Зажал ЛКМ — чека сорвана (пищит в руке); отпустил — бросок; передержал — взрыв в руке (решает сервер). */
export function updateGrenadeHand(now: number): void {
  const flash = viewGun.group.children[0] as THREE.Mesh | undefined;
  if (!cookStart) {
    if (state.mouseDown && state.locked && me.alive && state.myGrenades > 0 && !openingUntil && !state.firedThisPress) {
      cookStart = now;
      cookBeepAt = now;
      state.firedThisPress = true;
      sendMsg({ t: 'pin' });
      beep(900, 0.06, 0.1); // щелчок чеки
    }
    $('cook').classList.add('hidden');
    return;
  }
  const left = GRENADE.fuseMs - (now - cookStart);
  if (now >= cookBeepAt) { beep(1800, 0.05, 0.1); cookBeepAt = now + beepInterval(left); }
  if (flash) (flash.material as THREE.MeshLambertMaterial).emissive.setHex(Math.floor(now / 120) % 2 ? 0xff2020 : 0x330000);
  $('cook').classList.remove('hidden');
  $('cook').textContent = `💣 ${Math.max(0, left / 1000).toFixed(1)} с — отпусти ЛКМ, чтобы бросить`;
  if (left <= 0) { cookStart = 0; $('cook').classList.add('hidden'); return; } // взорвалась в руке
  if (!state.mouseDown || !me.alive) {
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_dir);
    sendMsg({ t: 'gthrow', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
    cookStart = 0;
    $('cook').classList.add('hidden');
    shotSound('knife', 0.8);
    setTimeout(() => { if (me.weapon === 'grenade' && !cookStart) setWeapon(settings.kit[0]!); }, 300);
  }
}

interface GrenadeFx { mesh: THREE.Mesh; target: THREE.Vector3; msLeft: number; seen: number; nextBeep: number }

export const grenadeFx = new Map<number, GrenadeFx>();

/** Позиции гранат с сервера: плавно догоняем, мигаем красным и пищим всё чаще. */
export function onGrenades(m: GrenadesMsg): void {
  const now = performance.now();
  const seen = new Set<number>();
  for (const [id, x, y, z, ms] of m.list) {
    seen.add(id);
    let fx = grenadeFx.get(id);
    if (!fx) {
      const mesh = box(0.22, 0.26, 0.22, 0xff1020);
      (mesh.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x660000);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      fx = { mesh, target: new THREE.Vector3(x, y, z), msLeft: ms, seen: now, nextBeep: now };
      grenadeFx.set(id, fx);
    }
    fx.target.set(x, y, z);
    fx.msLeft = ms;
    fx.seen = now;
  }
  for (const [id, fx] of grenadeFx) {
    if (seen.has(id)) continue;
    scene.remove(fx.mesh);
    grenadeFx.delete(id);
  }
}

export function updateGrenades(now: number): void {
  for (const fx of grenadeFx.values()) {
    fx.mesh.position.lerp(fx.target, 0.35);
    fx.mesh.rotation.x += 0.15;
    const left = fx.msLeft - (now - fx.seen);
    // Мигает: ярко-красный — тёмно-красный, чаще к концу
    const period = beepInterval(left) / 2;
    (fx.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(Math.floor(now / period) % 2 ? 0xff3030 : 0x440000);
    if (now >= fx.nextBeep) {
      const dist = fx.mesh.position.distanceTo(camera.position);
      if (dist < 30) beep(1900, 0.05, 0.12 * (1 - dist / 30));
      fx.nextBeep = now + beepInterval(left);
    }
  }
}
