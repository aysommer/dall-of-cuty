// Мины, растяжки и световая граната на клиенте: модели на карте, мигающая лампочка, писк, ослепление.
import * as THREE from 'three';
import { FLASH, MINE } from '../../shared/map.js';
import type { MineInfo, Vec3 } from '../../shared/protocol.js';
import { beep } from '../core/audio.js';
import { camera, scene } from '../core/scene.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { fireworks } from '../fx/fireworks.js';

interface MineFx { g: THREE.Group; lamp: THREE.Mesh; info: MineInfo; seen: number; nextBeep: number }

export const mineFx = new Map<number, MineFx>();

/** Круглая мина — плоский диск с лампочкой; растяжка — коробочка с колышком, от неё тянется верёвка. */
function buildMine(info: MineInfo): MineFx {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: info.kind === 'mine' ? 0x3d4a2e : 0x5a4a32 });
  if (info.kind === 'mine') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.07, 24), dark);
    body.position.y = 0.035;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16), new THREE.MeshLambertMaterial({ color: 0x23291b }));
    rim.position.y = 0.08;
    g.add(body, rim);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), dark);
    body.position.y = 0.1;
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.03, MINE.wireY + 0.06, 0.03), new THREE.MeshLambertMaterial({ color: 0x23291b }));
    stake.position.y = (MINE.wireY + 0.06) / 2;
    g.add(body, stake);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3a0a0a }));
  lamp.position.y = info.kind === 'mine' ? 0.115 : 0.23;
  g.add(lamp);
  g.position.set(info.p[0], info.p[1], info.p[2]);
  if (info.to) {
    // Верёвка — тонкая светлая нить от мины до своего конца, там — второй колышек
    const from = new THREE.Vector3(info.p[0], info.p[1] + MINE.wireY, info.p[2]);
    const to = new THREE.Vector3(info.to[0], info.to[1], info.to[2]);
    const len = from.distanceTo(to);
    const wire = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, len), new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }));
    wire.position.copy(from).add(to).multiplyScalar(0.5).sub(g.position);
    wire.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); // нить вытянута вдоль своей оси Z
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.03, MINE.wireY + 0.06, 0.03), new THREE.MeshLambertMaterial({ color: 0x23291b }));
    stake.position.set(to.x - g.position.x, (MINE.wireY + 0.06) / 2, to.z - g.position.z);
    g.add(wire, stake);
  }
  scene.add(g);
  return { g, lamp, info, seen: performance.now(), nextBeep: 0 };
}

function removeMine(id: number): void {
  const fx = mineFx.get(id);
  if (!fx) return;
  scene.remove(fx.g);
  fx.g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  mineFx.delete(id);
}

/** Список мин с сервера: новые ставим, пропавшие (взорвались или убраны) снимаем. */
export function onMines(list: MineInfo[]): void {
  const now = performance.now();
  const seen = new Set<number>();
  for (const info of list) {
    seen.add(info.id);
    let fx = mineFx.get(info.id);
    if (!fx) { fx = buildMine(info); mineFx.set(info.id, fx); }
    if (info.armed && !fx.info.armed) fx.nextBeep = now; // только что взведена — пищит сразу
    fx.info = info;
    fx.seen = now;
  }
  for (const id of [...mineFx.keys()]) if (!seen.has(id)) removeMine(id);
}

/** Лампочка: у спокойной мины тускло тлеет, у взведённой — часто мигает красным и пищит. */
export function updateMines(now: number): void {
  for (const fx of mineFx.values()) {
    const mat = fx.lamp.material as THREE.MeshBasicMaterial;
    if (!fx.info.armed) { mat.color.setHex(0x4a1010); fx.lamp.scale.setScalar(1); continue; }
    const on = Math.floor(now / 70) % 2 === 0;
    mat.color.setHex(on ? 0xff2a2a : 0x4a1010);
    fx.lamp.scale.setScalar(on ? 1.7 : 1);
    if (now >= fx.nextBeep) {
      const dist = fx.g.position.distanceTo(camera.position);
      if (dist < 25) beep(2400, 0.04, 0.16 * (1 - dist / 25));
      fx.nextBeep = now + 110;
    }
  }
}

// ---------- световая граната ----------
let blindFrom = 0, blindUntil = 0;

/** Вспышка в точке: белые искры и хлопок (ослепление приходит отдельным сообщением тем, кто рядом). */
export function onFlash(p: Vec3): void {
  fireworks(p[0], p[1] + 0.2, p[2], 0.7, [0xffffff, 0xf2f6ff, 0xfff6c8]);
  const dist = Math.hypot(p[0] - me.pos.x, p[1] - me.pos.y, p[2] - me.pos.z);
  if (dist < 40) beep(3200, 0.25, 0.25 * (1 - dist / 40));
}

/** Ослепило: экран белый, потом зрение возвращается; в ушах звенит. */
export function onBlind(ms: number): void {
  blindFrom = performance.now();
  blindUntil = blindFrom + ms;
  beep(4200, Math.min(2.5, ms / 1000 * 0.7), 0.1);
}

/** Доля ослепления: первые 40% времени — полная, дальше плавно сходит на нет. */
export function blindK(now: number): number {
  if (now >= blindUntil || !state.joined) return 0;
  const t = (now - blindFrom) / (blindUntil - blindFrom);
  return t < 0.4 ? 1 : Math.pow(1 - (t - 0.4) / 0.6, 1.6);
}

export function updateBlind(now: number): void {
  const k = me.alive ? blindK(now) : 0;
  const el = $('blind');
  el.style.opacity = String(k);
  el.classList.toggle('hidden', k <= 0);
}

/** Для сведения: радиус ослепления — в подсказках и тестах */
export const FLASH_RADIUS = FLASH.radius;
