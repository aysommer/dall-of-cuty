// Граната: чека, бросок, отскоки, писк и взрыв.
import * as THREE from 'three';
import { GEAR, GRENADE, isThrown } from '../../shared/map.js';
import type { GrenadesMsg, MeleeKind } from '../../shared/protocol.js';
import { beep, shotSound } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { box, camera, scene } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { openingUntil } from '../pickups/crate.js';
import { gear } from '../ui/hotbar.js';
import { toast } from '../ui/hud.js';
import { _dir } from './shooting.js';
import { setWeapon, startThrow, viewGun } from './viewmodel.js';

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
  // В руке — то устройство, что выбрано на эту жизнь: свой цвет, а мина и растяжка — плоские
  if (flash && me.weapon === 'grenade') {
    const look = HAND_LOOK[gear === 'knife' ? 'grenade' : gear];
    const mat = flash.material as THREE.MeshLambertMaterial;
    mat.color.setHex(look.color);
    if (!cookStart) mat.emissive.setHex(0x000000);
    flash.scale.set(look.wide, look.flat, look.wide);
    // Мина — круглая: вместо кубика в руке диск
    flash.userData.box ??= flash.geometry;
    flash.geometry = gear === 'mine' ? MINE_DISC : flash.userData.box as THREE.BufferGeometry;
  }
  if (!cookStart) {
    const press = state.mouseDown && state.locked && me.alive && me.weapon === 'grenade' && state.myGrenades > 0 && !openingUntil && !state.firedThisPress;
    if (press && !isThrown(gear)) {
      // Мину и растяжку ставят под ноги одним нажатием
      state.firedThisPress = true;
      sendMsg({ t: 'pin' });
      beep(500, 0.08, 0.12);
      toast(gear === 'mine' ? '🔴 Мина поставлена' : '🪢 Растяжка поставлена');
      setTimeout(() => { if (me.weapon === 'grenade') setWeapon(settings.kit[0]!); }, 300);
    } else if (press) {
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
  $('cook').textContent = `${GEAR[gear].icon} ${Math.max(0, left / 1000).toFixed(1)} с — отпусти ЛКМ, чтобы бросить`;
  if (left <= 0) { cookStart = 0; $('cook').classList.add('hidden'); return; } // взорвалась в руке
  if (!state.mouseDown || !me.alive) {
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_dir);
    sendMsg({ t: 'gthrow', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
    cookStart = 0;
    $('cook').classList.add('hidden');
    shotSound('knife', 0.8);
    startThrow(now);
    setTimeout(() => { if (me.weapon === 'grenade' && !cookStart) setWeapon(settings.kit[0]!); }, 340);
  }
}

const MINE_DISC = new THREE.CylinderGeometry(0.05, 0.058, 0.11, 20);

/** Как устройство выглядит в руке: цвет и пропорции (мина — широкая и плоская) */
const HAND_LOOK: Record<Exclude<MeleeKind, 'knife'>, { color: number; wide: number; flat: number }> = {
  grenade: { color: 0xe0101a, wide: 1, flat: 1 },
  flash: { color: 0xe6ecf2, wide: 0.85, flat: 1.25 },
  sticky: { color: 0x3fae4a, wide: 1, flat: 1 },
  mine: { color: 0x3d4a2e, wide: 1.9, flat: 0.4 },
  tripwire: { color: 0x5a4a32, wide: 1.1, flat: 1.3 },
};
/** Цвета летящих гранат: осколочная, световая, липучка — тёмный и яркий (мигает между ними) */
const FLY_COLORS = [[0xff1020, 0x440000, 0xff3030], [0xdfe6ee, 0x55606c, 0xffffff], [0x3fae4a, 0x0e3a14, 0x7dff8a]] as const;

interface GrenadeFx { mesh: THREE.Mesh; target: THREE.Vector3; msLeft: number; seen: number; nextBeep: number; kind: 0 | 1 | 2 }

export const grenadeFx = new Map<number, GrenadeFx>();

/** Позиции гранат с сервера: плавно догоняем, мигаем красным и пищим всё чаще. */
export function onGrenades(m: GrenadesMsg): void {
  const now = performance.now();
  const seen = new Set<number>();
  for (const [id, x, y, z, ms, kind] of m.list) {
    seen.add(id);
    let fx = grenadeFx.get(id);
    if (!fx) {
      const mesh = box(0.22, 0.26, 0.22, FLY_COLORS[kind][0]);
      (mesh.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x660000);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      fx = { mesh, target: new THREE.Vector3(x, y, z), msLeft: ms, seen: now, nextBeep: now, kind };
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
    // Летит — кувыркается; прилипла или легла — замирает
    if (fx.mesh.position.distanceToSquared(fx.target) > 1e-4) fx.mesh.rotation.x += 0.15;
    const left = fx.msLeft - (now - fx.seen);
    // Мигает: ярко-красный — тёмно-красный, чаще к концу
    const period = beepInterval(left) / 2;
    (fx.mesh.material as THREE.MeshLambertMaterial).emissive.setHex(Math.floor(now / period) % 2 ? FLY_COLORS[fx.kind][2] : FLY_COLORS[fx.kind][1]);
    if (now >= fx.nextBeep) {
      const dist = fx.mesh.position.distanceTo(camera.position);
      if (dist < 30) beep(1900, 0.05, 0.12 * (1 - dist / 30));
      fx.nextBeep = now + beepInterval(left);
    }
  }
}
