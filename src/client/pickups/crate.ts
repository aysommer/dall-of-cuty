// Ящик с неба: падение, столб света, открытие на F, взрыв-ловушка.
import * as THREE from 'three';
import { type Box, CRATE } from '../../shared/map.js';
import type { CrateMsg } from '../../shared/protocol.js';
import { beep } from '../core/audio.js';
import { me, state } from '../core/state.js';
import { feedNote } from '../ui/hud.js';
import { currentMap } from '../world/map.js';

// до ответа сервера считаем, что ящика нет
export let crateBy: number | null = null;

/** Когда ящик коснётся земли и когда исчезнет (по часам браузера) */
let crateLandAt = 0;

export let crateExpiresAt = 0;

/** Когда закончится открытие, которое веду я (0 — не открываю). */
export let openingUntil = 0;

/** Сторона ящика: доски, нарисованный смайлик с рожками и надпись. */
function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b07a3a';
  ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = '#6b4520';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 182);
  ctx.lineWidth = 3;
  for (const y of [66, 128]) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(248, y); ctx.stroke(); }

  // Смайлик: круг, рожки, хитрые брови, глаза и ухмылка
  const x = 128, y = 74, r = 46;
  ctx.fillStyle = '#7b3fc4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * 20, y - 38); ctx.lineTo(x + side * 44, y - 62); ctx.lineTo(x + side * 42, y - 22);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x + side * 30, y - 24); ctx.lineTo(x + side * 8, y - 12); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + side * 17, y - 4, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y + 4, 28, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 34px system-ui, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Open me 😈', 128, 158);
  return new THREE.CanvasTexture(c);
}

export function buildCrate(): THREE.Mesh {
  const side = new THREE.MeshLambertMaterial({ map: crateTexture() });
  const wood = new THREE.MeshLambertMaterial({ color: 0x9a6a30 });
  // Порядок граней куба: +x, -x, +y, -y, +z, -z — картинка на четырёх боковых
  return new THREE.Mesh(
    new THREE.BoxGeometry(CRATE.size, CRATE.height, CRATE.size),
    [side, side, wood, wood, side, side],
  );
}

/** Лежащий ящик твёрдый; падающий — ещё нет. */
export function crateSolid(): Box | null {
  if (!state.crateAt || (state.crateState !== 'idle' && state.crateState !== 'opening')) return null;
  const [cx, cy, cz] = state.crateAt;
  const h = CRATE.size / 2;
  return { min: [cx - h, cy, cz - h], max: [cx + h, cy + CRATE.height, cz + h], color: '' };
}

export function nearCrate(): boolean {
  if (!state.crateAt) return false;
  const [cx, cy, cz] = state.crateAt;
  return Math.hypot(me.pos.x - cx, me.pos.z - cz) <= CRATE.reach && Math.abs(me.pos.y - cy) <= 1.5;
}

export function onCrate(m: CrateMsg): void {
  const prev = state.crateState;
  const now = performance.now();
  state.crateState = m.state;
  crateBy = m.by;
  state.crateAt = m.at;
  crateLandAt = m.state === 'falling' ? now + m.ms : 0;
  crateExpiresAt = m.left > 0 ? now + m.left : 0;
  openingUntil = m.state === 'opening' && m.by === me.id ? now + m.ms : 0;
  if (!state.joined) return;
  if (m.state === 'falling' && prev === 'gone') { feedNote('📦 С неба падает ящик'); beep(700, 0.25, 0.1); }
  if (m.state === 'gone' && prev === 'idle') feedNote('📦 Ящик исчез');
  if (m.state === 'gone' && prev === 'opening') beep(520, 0.3, 0.1);
}

/** Падение (с ускорением), столб света и мигание в последние 10 секунд. */
export function updateCrate(now: number): void {
  if (!state.crateMesh || !state.crateBeam) return;
  const show = state.crateAt !== null && state.crateState !== 'gone';
  state.crateMesh.visible = show;
  state.crateBeam.visible = show && state.crateState !== 'falling';
  if (!show || !state.crateAt) return;
  const [x, y, z] = state.crateAt;
  let lift = 0;
  if (state.crateState === 'falling') {
    const left = Math.max(0, Math.min(1, (crateLandAt - now) / CRATE.fallMs));
    lift = currentMap.indoor ? 0 : CRATE.fallHeight * (1 - (1 - left) ** 2);
  }
  state.crateMesh.position.set(x, y + CRATE.height / 2 + lift, z);
  state.crateBeam.position.set(x, y + CRATE.height + 15, z);
  if (state.crateState === 'idle' && crateExpiresAt && crateExpiresAt - now < 10_000) {
    state.crateMesh.visible = Math.floor(now / 250) % 2 === 0;
  }
}
