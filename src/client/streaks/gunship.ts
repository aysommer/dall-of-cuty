// Самолёт: облёт карты, пулемёт с перегревом и ракеты.
import * as THREE from 'three';
import { GUNSHIP, gunshipPos, PLAYER, playerBox, rayBox, rayWorld } from '../../shared/map.js';
import type { GunshipMsg, Vec3 } from '../../shared/protocol.js';
import { beep, shotSound } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { box, camera, scene } from '../core/scene.js';
import { me, remotes, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { fireworks } from '../fx/fireworks.js';
import { addTracer } from '../fx/tracers.js';
import { scaleOfRemote, lowOfRemote } from '../render/players.js';
import { feedNote, showHit, toast } from '../ui/hud.js';
import { _dir } from '../weapons/shooting.js';
import { currentMap, solids } from '../world/map.js';

interface GunshipFx { id: number; by: number; phase: number; start: number; mesh: THREE.Group }

export let gunshipFx: GunshipFx | null = null;

/** Я стреляю из самолёта: направление орудия, нагрев пулемёта и перезарядка ракет */
export let gunner: {
  yaw: number; pitch: number; heat: number; overheatUntil: number; nextShot: number; rocketReadyAt: number; lastT: number;
} | null = null;

/** Самолёт из блоков: фюзеляж, крылья, хвост и винты. */
function buildPlane(): THREE.Group {
  const g = new THREE.Group();
  const BODY = 0x5d6b4f, DARK = 0x2c3326;
  const body = box(1.4, 1.2, 7, BODY);
  const nose = box(1, 0.9, 1, DARK);
  nose.position.z = -3.9;
  const wing = box(9, 0.25, 1.8, BODY);
  wing.position.set(0, 0.1, -0.6);
  const tail = box(3.2, 0.2, 0.9, BODY);
  tail.position.set(0, 0.3, 3.1);
  const fin = box(0.2, 1.4, 1, BODY);
  fin.position.set(0, 1, 3.1);
  g.add(body, nose, wing, tail, fin);
  for (const side of [-1, 1]) {
    const engine = box(0.7, 0.7, 1.4, DARK);
    engine.position.set(side * 2.6, -0.1, -1);
    const prop = box(1.6, 0.12, 0.08, 0x111111);
    prop.position.set(side * 2.6, -0.1, -1.75);
    prop.name = 'prop';
    g.add(engine, prop);
  }
  return g;
}

function gunshipPoint(fx: GunshipFx, now: number): THREE.Vector3 {
  const [x, y, z] = gunshipPos(currentMap.half, fx.phase, (now - fx.start) / 1000);
  return new THREE.Vector3(x, y, z);
}

export function onGunship(m: GunshipMsg): void {
  if (gunshipFx) scene.remove(gunshipFx.mesh);
  const mesh = buildPlane();
  scene.add(mesh);
  gunshipFx = { id: m.id, by: m.by, phase: m.phase, start: performance.now() - m.elapsed, mesh };
  const who = state.roster.find((p) => p.id === m.by)?.name ?? '';
  if (m.by === me.id) {
    gunner = { yaw: me.yaw, pitch: -0.9, heat: 0, overheatUntil: 0, nextShot: 0, rocketReadyAt: 0, lastT: performance.now() };
    state.aimHeld = false;
    $('gunship-view').classList.remove('hidden');
    toast('✈ Ты в самолёте: ЛКМ — пулемёт, ПКМ — ракета');
  } else feedNote(`✈ ${who} в небе на самолёте! Сбей его двумя ракетами`);
  beep(180, 0.8, 0.12);
}

export function onGunshipEnd(id: number, by: number | null, p: Vec3): void {
  if (!gunshipFx || gunshipFx.id !== id) return;
  scene.remove(gunshipFx.mesh);
  if (by !== null) {
    // Сбит: большой огненный взрыв в небе
    fireworks(p[0], p[1], p[2], 2.2);
    const who = state.roster.find((q) => q.id === by)?.name ?? '';
    feedNote(`✈💥 ${who} сбил самолёт`);
  } else if (gunshipFx.by !== me.id) feedNote('✈ Самолёт улетел');
  if (gunshipFx.by === me.id) {
    gunner = null;
    $('gunship-view').classList.add('hidden');
    for (const el of markerEls.values()) el.remove();
    markerEls.clear();
  }
  gunshipFx = null;
}

/** ПКМ в самолёте: ракета, раз в 3 секунды. */
export function gunnerRocket(): void {
  const now = performance.now();
  if (!gunner || now < gunner.rocketReadyAt) return;
  gunner.rocketReadyAt = now + GUNSHIP.rocketCdMs;
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'gsrocket', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
}

/** Очередь пулемёта: луч из самолёта по прицелу, перегрев за 5 секунд непрерывной стрельбы. */
function gunnerFire(now: number): void {
  if (!gunner) return;
  gunner.nextShot = now + GUNSHIP.gunRateMs;
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  const sp = GUNSHIP.spread;
  const d = _dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp)).normalize();
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const dv: Vec3 = [d.x, d.y, d.z];
  let t = rayWorld(solids, eye, dv, 200);
  let victim: number | null = null;
  for (const [id, r] of remotes) {
    if (!r.info.alive || (state.mode === 'tdm' && r.info.team === me.team)) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, lowOfRemote(r), scaleOfRemote(r));
    const tp = rayBox(eye, dv, min, max);
    if (tp < t) { t = tp; victim = id; }
  }
  const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
  addTracer(camera.position.clone().addScaledVector(d, 2).add(new THREE.Vector3(0, -0.4, 0)), end);
  const hits: Record<number, number> = {};
  if (victim !== null) { hits[victim] = 1; showHit(false); beep(1400, 0.04, 0.06); }
  sendMsg({ t: 'gsfire', ends: [[+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]], hits });
  shotSound('lmg', 0.8);
}

/** Маркеры врагов поверх экрана — только у стрелка самолёта. */
export const markerEls = new Map<number, HTMLElement>();

function updateMarkers(): void {
  const layer = $('markers');
  const seen = new Set<number>();
  if (gunner) {
    for (const [id, r] of remotes) {
      if (!r.info.alive || (state.mode === 'tdm' && r.info.team === me.team)) continue;
      const v = r.pos.clone().add(new THREE.Vector3(0, PLAYER.h * scaleOfRemote(r) + 0.6, 0)).project(camera);
      if (v.z > 1) continue; // позади камеры
      seen.add(id);
      let el = markerEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker';
        layer.append(el);
        markerEls.set(id, el);
      }
      el.style.left = `${((v.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - v.y) / 2) * 100}%`;
    }
  }
  for (const [id, el] of markerEls) if (!seen.has(id)) { el.remove(); markerEls.delete(id); }
}

export function updateGunship(now: number, dt: number): void {
  const fx = gunshipFx;
  if (fx) {
    // Самолёт летит по кругу, нос — по направлению полёта; винты крутятся
    const p = gunshipPoint(fx, now);
    const ahead = gunshipPoint(fx, now + 100);
    fx.mesh.position.copy(p);
    fx.mesh.lookAt(p.clone().multiplyScalar(2).sub(ahead));
    fx.mesh.rotation.z += 0.35; // крен в вираж
    fx.mesh.traverse((o) => { if (o.name === 'prop') o.rotation.z += dt * 40; });
  }
  updateMarkers();
  const g = gunner;
  if (!g || !fx) return;
  // Камера — под брюхом самолёта, смотрит туда, куда повёрнуто орудие
  camera.position.copy(fx.mesh.position).add(new THREE.Vector3(0, -1.6, 0));
  camera.rotation.set(g.pitch, g.yaw, 0);
  // Нагрев — по настоящему времени, а не по шагу кадра: при низком FPS шаг кадра урезан
  const realMs = Math.min(250, now - g.lastT);
  g.lastT = now;
  const overheated = now < g.overheatUntil;
  if (state.mouseDown && !overheated && state.locked) {
    if (now >= g.nextShot) gunnerFire(now);
    g.heat = Math.min(1, g.heat + realMs / GUNSHIP.heatMs);
    if (g.heat >= 1) { g.overheatUntil = now + GUNSHIP.coolMs; beep(220, 0.3, 0.12); }
  } else if (overheated) {
    g.heat = Math.max(0, (g.overheatUntil - now) / GUNSHIP.coolMs); // за секунду остывает до нуля
  } else {
    g.heat = Math.max(0, g.heat - (realMs / 1000) * 0.5);
  }
  const left = Math.max(0, Math.ceil((GUNSHIP.ms - (now - fx.start)) / 1000));
  const rocketIn = Math.max(0, (g.rocketReadyAt - now) / 1000);
  $<HTMLElement>('gs-heat').style.width = `${Math.round(g.heat * 100)}%`;
  $('gs-heat').classList.toggle('over', overheated);
  $('gs-info').textContent =
    `✈ ${left} с · пулемёт: ${overheated ? 'ПЕРЕГРЕВ' : 'ЛКМ'} · ракета: ${rocketIn > 0 ? rocketIn.toFixed(1) + ' с' : 'ПКМ — готова'}`;
}
