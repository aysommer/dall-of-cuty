// Шаги: звук своих и чужих шагов.
import * as THREE from 'three';
import { audio, master } from '../core/audio.js';
import { me, remotes, state } from '../core/state.js';

const STRIDE = 1.8;

/** Сколько шагов было слышно (для проверки в тестах) */
export let stepCount = 0;

let myStepAcc = 0;

const myLastPos = new THREE.Vector3();

/** Глухой шаг; громкость падает с расстоянием, звук слышен с той стороны, где идёт игрок. */
function stepSound(volume: number, pan: number): void {
  if (volume <= 0.02) return;
  stepCount++;
  if (!audio || !master) return;
  const dur = 0.09;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 650;
  const gain = audio.createGain();
  gain.gain.value = 0.5 * volume;
  const panner = audio.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(filter).connect(gain).connect(panner).connect(master);
  src.start();
}

/** Шаги считаются по пройденному по земле пути: каждые STRIDE метров — один шаг. */
export function updateSteps(dt: number): void {
  if (!state.joined || dt <= 0) return;
  const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
  for (const r of remotes.values()) {
    const dx = r.pos.x - r.lastPos.x, dy = r.pos.y - r.lastPos.y, dz = r.pos.z - r.lastPos.z;
    r.lastPos.copy(r.pos);
    const moved = Math.hypot(dx, dz);
    // В прыжке, на лестнице, в подкате и при телепорте (возрождение) шагов нет
    if (!r.info.alive || r.slide || Math.abs(dy) > 0.02 || moved > 2) { r.stepAcc = 0; continue; }
    r.stepAcc += moved;
    if (r.stepAcc < STRIDE) continue;
    r.stepAcc -= STRIDE;
    const to = r.pos.clone().sub(me.pos);
    const dist = to.length();
    // Чем ближе игрок, тем громче: тишина дальше 30 м, у самого уха — в полную силу
    const vol = Math.max(0, 1 - dist / 30) ** 2;
    stepSound(vol, dist > 0.1 ? to.dot(right) / dist : 0);
  }
  if (!me.alive) { myLastPos.copy(me.pos); return; }
  const moved = Math.hypot(me.pos.x - myLastPos.x, me.pos.z - myLastPos.z);
  myLastPos.copy(me.pos);
  if (!me.grounded || state.low || moved > 2) { myStepAcc = 0; return; }
  myStepAcc += moved;
  if (myStepAcc >= STRIDE) { myStepAcc -= STRIDE; stepSound(0.25, 0); }
}
