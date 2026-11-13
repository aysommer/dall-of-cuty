// Стрельба: выстрелы, разброс, попадания, перезарядка, нож.
import * as THREE from 'three';
import { headFrom, hipSpread, playerBox, rayBox, rayWorld, WEAPONS } from '../../shared/map.js';
import type { Vec3, WeaponId } from '../../shared/protocol.js';
import { beep, shotSound } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { camera } from '../core/scene.js';
import { me, remotes, state } from '../core/state.js';
import { addTracer } from '../fx/tracers.js';
import { openingUntil } from '../pickups/crate.js';
import { type Remote, scaleOfRemote, lowOfRemote } from '../render/players.js';
import { gunner } from '../streaks/gunship.js';
import { missileCtl } from '../streaks/missile.js';
import { showHit, toast, updateHud } from '../ui/hud.js';
import { updateGrenadeHand } from './grenade.js';
import { BOLT_MS, SWING_MS, viewGun } from './viewmodel.js';
import { brokenIds, currentMap, solids } from '../world/map.js';

export function startReload(): void {
  const w = WEAPONS[me.weapon];
  if (me.weapon === 'rocket' || w.melee) return; // ракетница и нож не перезаряжаются
  if (me.reloadUntil || me.ammo[me.weapon] >= w.mag || !me.alive) return;
  if (me.reserve[me.weapon] <= 0) { toast('Патроны кончились — подбери с погибших'); return; }
  me.reloadMs = w.reload;
  me.reloadUntil = performance.now() + me.reloadMs;
  beep(300, 0.08, 0.08);
  updateHud();
}

export const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();

function fire(now: number): void {
  const w = WEAPONS[me.weapon];
  me.nextShot = now + w.rate;
  me.ammo[me.weapon]--;
  state.firedThisPress = true;

  camera.updateMatrixWorld(true);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  camera.getWorldDirection(_dir);
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);

  const hits: Record<number, [number, number]> = {};
  const brk: Record<number, number> = {};
  const ends: Vec3[] = [];
  let anyHead = false;
  let anyHit = false;
  // В прицеле — малый разброс (вес пули), от бедра — в HIP_SPREAD раз больше
  const hip = hipSpread(w);
  const spread = w.spread * (hip - (hip - 1) * state.adsK);
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
    const d = _dir.clone().addScaledVector(_right, Math.cos(a) * rad).addScaledVector(_up, Math.sin(a) * rad).normalize();
    const dv: Vec3 = [d.x, d.y, d.z];
    let t = rayWorld(solids, eye, dv);
    let victim: number | null = null;
    let victimR: Remote | null = null;
    for (const [id, r] of remotes) {
      if (!r.info.alive) continue;
      if (state.mode === 'tdm' && r.info.team === me.team) continue;
      const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, lowOfRemote(r), scaleOfRemote(r));
      const tp = rayBox(eye, dv, min, max);
      if (tp < t) { t = tp; victim = id; victimR = r; }
    }
    if (victim === null) {
      // Пуля упёрлась в целое стекло или дверь — засчитываем по ним
      for (const x of currentMap.breakables ?? []) {
        if (brokenIds.has(x.id)) continue;
        if (Math.abs(rayBox(eye, dv, x.box.min, x.box.max) - t) < 1e-4) { brk[x.id] = (brk[x.id] ?? 0) + 1; break; }
      }
    }
    if (victim !== null && victimR) {
      // Голова — верх стоящего прямоугольника; в подкате головы как зоны нет
      const from = headFrom(lowOfRemote(victimR));
      const head = from !== null && eye[1] + dv[1] * t - victimR.pos.y >= from * scaleOfRemote(victimR);
      const h = (hits[victim] ??= [0, 0]);
      h[head ? 1 : 0]++;
      anyHit = true;
      anyHead ||= head;
    }
    const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
    // Свой трассер идёт по линии прицела, а не из ствола сбоку — так видно, куда летит пуля
    addTracer(new THREE.Vector3(eye[0] + dv[0] * 1.2, eye[1] + dv[1] * 1.2 - 0.04, eye[2] + dv[2] * 1.2), end);
  }
  sendMsg({ t: 'shoot', w: me.weapon, ends, hits, brk });
  if (anyHit) { showHit(false); beep(anyHead ? 1900 : 1400, 0.05, 0.08); }

  shotSound(me.weapon);
  if (me.weapon === 'sniper' && me.ammo.sniper > 0) state.boltUntil = now + BOLT_MS;
  const RECOIL: Partial<Record<WeaponId, [number, number]>> = {
    // Пулемёт бьёт вдвое сильнее автомата
    shotgun: [0.12, 0.035], rifle: [0.05, 0.012], m6: [0.045, 0.011], smg: [0.035, 0.008], lmg: [0.1, 0.024], sniper: [0.14, 0.05],
  };
  const [k, lift] = RECOIL[me.weapon] ?? [0.05, 0.015];
  state.kick = k;
  state.recoil += lift;
  const flash = viewGun.flash;
  flash.visible = true;
  setTimeout(() => { flash.visible = false; }, 45);
  if (me.ammo[me.weapon] <= 0) startReload();
  updateHud();
}

/** Нож: удар по ближайшему противнику перед собой (узкий конус, дальность WEAPONS.knife.melee). */
function stab(now: number): void {
  const w = WEAPONS[me.weapon];
  const reach = w.melee ?? 0;
  me.nextShot = now + w.rate;
  state.firedThisPress = true;
  state.swingUntil = now + SWING_MS;
  camera.updateMatrixWorld(true);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  camera.getWorldDirection(_dir);
  let victim: number | null = null, best = Infinity;
  for (const [id, r] of remotes) {
    if (!r.info.alive || (state.mode === 'tdm' && r.info.team === me.team)) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, lowOfRemote(r), scaleOfRemote(r));
    const near = ([0, 1, 2] as const).map((i) => Math.max(min[i]!, Math.min(eye[i], max[i]!)));
    const dist = Math.hypot(near[0]! - eye[0], near[1]! - eye[1], near[2]! - eye[2]);
    if (dist > reach || dist >= best) continue;
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const to = c.sub(camera.position);
    const flat = Math.hypot(to.x, to.z);
    // Попадание, если противник примерно перед нами (по горизонтали) и между нами нет стены
    const ang = Math.acos(Math.max(-1, Math.min(1, (to.x * _dir.x + to.z * _dir.z) / ((flat || 1) * (Math.hypot(_dir.x, _dir.z) || 1)))));
    if (ang > 0.6) continue;
    const toV: Vec3 = [to.x / to.length(), to.y / to.length(), to.z / to.length()];
    if (rayWorld(solids, eye, toV, to.length()) < to.length() - 0.5) continue;
    victim = id;
    best = dist;
  }
  const hits: Record<number, [number, number]> = {};
  if (victim !== null) { hits[victim] = [1, 0]; showHit(false); beep(1400, 0.05, 0.08); }
  sendMsg({ t: 'shoot', w: me.weapon, ends: [], hits });
  shotSound('knife');
}

function fireRocket(now: number): void {
  if (me.ammo.rocket <= 0) return;
  me.nextShot = now + WEAPONS.rocket.rate;
  state.firedThisPress = true;
  me.ammo.rocket--; // сервер пришлёт точное число
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'rocket', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
  state.kick = 0.16;
  state.recoil += 0.04;
  updateHud();
}

export function updateShooting(now: number): void {
  if (me.reloadUntil && now >= me.reloadUntil) {
    // В магазин идёт столько, сколько есть в запасе
    const take = Math.min(WEAPONS[me.weapon].mag - me.ammo[me.weapon], me.reserve[me.weapon]);
    me.ammo[me.weapon] += take;
    me.reserve[me.weapon] -= take;
    me.reloadUntil = 0;
    updateHud();
  }
  if (me.weapon === 'grenade') { updateGrenadeHand(now); return; }
  if (!state.mouseDown || !me.alive || !state.locked || me.reloadUntil || now < me.nextShot || openingUntil || now < state.boltUntil) return;
  if (missileCtl || gunner) return; // ЛКМ сейчас — ускорение ракеты или пулемёт самолёта
  const w = WEAPONS[me.weapon];
  if (!w.auto && state.firedThisPress) return;
  if (me.weapon === 'rocket') { fireRocket(now); return; }
  if (w.melee) { stab(now); return; }
  if (me.ammo[me.weapon] <= 0) {
    if (me.reserve[me.weapon] <= 0 && !state.firedThisPress) { beep(180, 0.05, 0.06); state.firedThisPress = true; } // щелчок: пусто
    startReload();
    return;
  }
  fire(now);
}
