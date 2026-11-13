// Ящик с неба: спуск на парашюте, открытие на F.
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

/**
 * Доски: тёмно-оливковая армейская краска поверх древесины — волокна, сучки, потёртости и пазы между досками.
 * Без надписей. Одна текстура на все доски (повторяется по размеру грани).
 */
function plankTexture(): THREE.CanvasTexture {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4f5a36';
  g.fillRect(0, 0, W, H);
  // Волокна: тонкие светлые и тёмные полосы вдоль доски
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * H, shade = Math.random() < 0.5 ? 'rgba(20,24,12,0.18)' : 'rgba(150,160,110,0.12)';
    g.strokeStyle = shade;
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 1.5);
    g.stroke();
  }
  // Сучки
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    g.fillStyle = 'rgba(25,28,15,0.35)';
    g.beginPath(); g.ellipse(x, y, 5 + Math.random() * 4, 2.5, 0, 0, Math.PI * 2); g.fill();
  }
  // Пазы между досками: четыре доски на грань
  g.fillStyle = 'rgba(12,14,8,0.75)';
  for (const y of [0, 64, 128, 192]) g.fillRect(0, y, W, 3);
  // Потёртости краски — пятна светлее и темнее
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] = img.data[i]! + n; img.data[i + 1] = img.data[i + 1]! + n; img.data[i + 2] = img.data[i + 2]! + n * 0.6;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 18; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,110,80,0.18)' : 'rgba(10,12,6,0.15)';
    g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 6 + Math.random() * 16, 3 + Math.random() * 8, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Ящик: корпус из досок, бруски-рамка по всем рёбрам, металлические уголки, две стальные ленты
 * через верх и навесной замок посередине передней и задней стенки. Размер — CRATE.size × CRATE.height.
 */
export function buildCrate(): THREE.Group {
  const g = new THREE.Group();
  const S = CRATE.size, H = CRATE.height, h = H / 2, s = S / 2;
  const planks = new THREE.MeshLambertMaterial({ map: plankTexture() });
  const frame = new THREE.MeshLambertMaterial({ color: 0x3b4428 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4d50 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2c2e });
  const brass = new THREE.MeshLambertMaterial({ color: 0x8a7440 });
  const part = (w: number, ht: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Корпус чуть утоплен относительно рамки
  part(S - 0.04, H - 0.04, S - 0.04, planks, 0, 0, 0);
  // Рамка: вертикальные бруски по углам и обвязка сверху и снизу
  const T = 0.07;
  for (const x of [-1, 1]) for (const z of [-1, 1]) part(T, H, T, frame, x * (s - T / 2), 0, z * (s - T / 2));
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) part(S, T, T, frame, 0, y * (h - T / 2), z * (s - T / 2));
    for (const x of [-1, 1]) part(T, T, S - 2 * T, frame, x * (s - T / 2), y * (h - T / 2), 0);
  }
  // Средняя поперечина на каждой стенке
  for (const z of [-1, 1]) part(S - 2 * T, 0.05, 0.03, frame, 0, 0, z * (s - 0.005));
  for (const x of [-1, 1]) part(0.03, 0.05, S - 2 * T, frame, x * (s - 0.005), 0, 0);
  // Металлические уголки на всех восьми углах
  const C = 0.11;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    part(C, C, C, steel, x * (s - C / 2 + 0.006), y * (h - C / 2 + 0.006), z * (s - C / 2 + 0.006));
  }
  // Две стальные ленты: через верх и вниз по боковым стенкам, с заклёпками
  for (const x of [-0.3, 0.3]) {
    part(0.06, 0.012, S + 0.02, steel, x * S, h + 0.006, 0);
    for (const z of [-1, 1]) {
      part(0.06, H, 0.012, steel, x * S, 0, z * (s + 0.006));
      for (const y of [-0.3, 0, 0.3]) part(0.018, 0.018, 0.012, dark, x * S, y * H, z * (s + 0.014));
    }
  }
  // Замок посередине передней и задней стенки: накладка с петлёй и навесной замок с дужкой
  for (const z of [-1, 1]) {
    const f = z * (s + 0.006);
    part(0.16, 0.2, 0.014, steel, 0, 0.06, f);                     // накладка
    part(0.05, 0.06, 0.02, dark, 0, 0.13, f + z * 0.008);         // петля
    part(0.11, 0.1, 0.045, brass, 0, -0.02, f + z * 0.03);        // корпус замка
    part(0.016, 0.06, 0.016, steel, -0.033, 0.055, f + z * 0.03); // дужка
    part(0.016, 0.06, 0.016, steel, 0.033, 0.055, f + z * 0.03);
    part(0.082, 0.016, 0.016, steel, 0, 0.085, f + z * 0.03);
    part(0.02, 0.034, 0.006, dark, 0, -0.03, f + z * 0.054);      // скважина
  }
  return g;
}

/** Цвета купола: приглушённо-красные полосы и светлые между ними */
const CHUTE_RED = new THREE.Color(0xa1423a), CHUTE_LIGHT = new THREE.Color(0xcdbfa8);

/** Парашют: купол из 12 полос, стропы к углам ящика. Начало координат — верх ящика. */
export function buildParachute(): THREE.Group {
  const g = new THREE.Group();
  const R = 2.3, LIFT = 3.6;
  // Без общих вершин: каждый треугольник красится целиком по своему центру — полосы чёткие, без размытия
  const geo = new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed();
  geo.scale(1, 0.62, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = Math.atan2(cz, cx) + Math.PI;
    const c = Math.floor(a / (Math.PI / 6)) % 2 ? CHUTE_LIGHT : CHUTE_RED;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const canopy = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  canopy.position.y = LIFT;
  g.add(canopy);
  // Стропы: от края купола к четырём верхним углам ящика
  const rimY = LIFT + R * 0.62 * Math.cos(Math.PI * 0.42);
  const rimR = R * Math.sin(Math.PI * 0.42);
  const pts: number[] = [];
  const s = CRATE.size / 2 - 0.05;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const cx = Math.sign(Math.cos(a)) * s || s, cz = Math.sign(Math.sin(a)) * s || s;
    pts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, cx, 0, cz);
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x2c2a26 })));
  return g;
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

/**
 * Падение на парашюте — равномерно (CRATE.fallHeight за CRATE.fallMs), ящик чуть раскачивается;
 * приземлился — парашют исчезает, ящик можно открыть. Мигание — в последние 10 секунд перед исчезновением.
 */
export function updateCrate(now: number): void {
  const mesh = state.crateMesh, chute = state.crateChute;
  if (!mesh || !chute) return;
  const show = state.crateAt !== null && state.crateState !== 'gone';
  mesh.visible = show;
  const falling = show && state.crateState === 'falling' && !currentMap.indoor;
  chute.visible = falling;
  if (!show || !state.crateAt) return;
  const [x, y, z] = state.crateAt;
  let lift = 0, sway = 0;
  if (falling) {
    const left = Math.max(0, Math.min(1, (crateLandAt - now) / CRATE.fallMs));
    lift = CRATE.fallHeight * left;
    sway = Math.sin(now / 700) * 0.08 * Math.min(1, left * 4);
  }
  mesh.position.set(x, y + CRATE.height / 2 + lift, z);
  mesh.rotation.set(sway, 0, sway * 0.6);
  chute.position.set(x, y + CRATE.height + lift, z);
  chute.rotation.set(sway, now / 6000, sway * 0.6);
  if (state.crateState === 'idle' && crateExpiresAt && crateExpiresAt - now < 10_000) {
    mesh.visible = Math.floor(now / 250) % 2 === 0;
  }
}
