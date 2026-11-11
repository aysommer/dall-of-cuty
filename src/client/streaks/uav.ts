// БПЛА: мини-карта с эхо-локацией противников.
import type { PingMsg } from '../../shared/protocol.js';
import { STREAK } from '../../shared/map.js';
import { beep } from '../core/audio.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { voting } from '../ui/match.js';
import { currentMap } from '../world/map.js';

let lastPingAt = 0;

let pingDots: Array<[number, number]> = [];

export function onPing(m: PingMsg): void {
  pingDots = m.list.map(([, x, z]) => [x, z]);
  lastPingAt = performance.now();
  if (state.uavUntil > lastPingAt) beep(1600, 0.06, 0.04);
}

/** Карта сверху: стены, ты (стрелка) и отметки противников, которые гаснут до следующего импульса. */
export function updateMinimap(now: number): void {
  const c = $<HTMLCanvasElement>('minimap');
  const on = state.joined && now < state.uavUntil && !voting;
  c.classList.toggle('hidden', !on);
  if (!on) return;
  const ctx = c.getContext('2d')!;
  const size = c.width, mid = size / 2;
  const half = currentMap.half;
  const k = (mid - 8) / Math.max(half.x, half.z);
  const sx = (x: number) => mid + x * k, sz = (z: number) => mid + z * k;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(10, 20, 14, 0.82)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(150, 190, 160, 0.55)';
  for (const b of currentMap.boxes) {
    if (b.max[1] <= 0.05) continue; // земля и канализация
    if (b.max[1] - b.min[1] < 0.6 && b.min[1] > 0) continue; // тонкие крыши и полки не рисуем
    ctx.fillRect(sx(b.min[0]), sz(b.min[2]), (b.max[0] - b.min[0]) * k, (b.max[2] - b.min[2]) * k);
  }
  // Эхо: кольцо расходится от тебя после каждого импульса.
  // Время кадра бывает чуть раньше времени прихода отметки — не даём возрасту уйти в минус.
  const age = Math.max(0, now - lastPingAt);
  if (age < 900) {
    ctx.strokeStyle = `rgba(90, 255, 140, ${1 - age / 900})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(me.pos.x), sz(me.pos.z), (age / 900) * size * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fade = Math.max(0, 1 - age / STREAK.pingMs);
  ctx.fillStyle = `rgba(255, 70, 70, ${0.25 + 0.75 * fade})`;
  for (const [x, z] of pingDots) {
    ctx.beginPath();
    ctx.arc(sx(x), sz(z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ты: стрелка по направлению взгляда
  ctx.save();
  ctx.translate(sx(me.pos.x), sz(me.pos.z));
  ctx.rotate(-me.yaw);
  ctx.fillStyle = '#5cf07a';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c8ffd6';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`БПЛА ${Math.ceil((state.uavUntil - now) / 1000)} с`, 6, 14);
}
