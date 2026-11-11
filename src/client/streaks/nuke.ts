// Бомба: отсчёт и вспышка.
import * as THREE from 'three';
import type { NukeMsg } from '../../shared/protocol.js';
import { STREAK } from '../../shared/map.js';
import { beep, shotSound } from '../core/audio.js';
import { box, scene } from '../core/scene.js';
import { state } from '../core/state.js';
import { $ } from '../core/util.js';
import { fireworks } from '../fx/fireworks.js';
import { feedNote } from '../ui/hud.js';

let nukeAt = 0;

let nukeMesh: THREE.Group | null = null;

export function onNuke(m: NukeMsg): void {
  nukeAt = performance.now() + m.ms;
  const who = state.roster.find((p) => p.id === m.by)?.name ?? '';
  feedNote(`☢ ${who} сбросил бомбу!`);
  nukeMesh = new THREE.Group();
  const body = box(1.6, 1.6, 3.6, 0x2d2f2a);
  const tail = box(2.6, 0.15, 0.8, 0x2d2f2a);
  tail.position.z = 1.8;
  const tail2 = box(0.15, 2.6, 0.8, 0x2d2f2a);
  tail2.position.z = 1.8;
  const stripe = box(1.65, 1.65, 0.3, 0xf1c232);
  stripe.position.z = -0.8;
  nukeMesh.add(body, tail, tail2, stripe);
  nukeMesh.rotation.x = Math.PI / 2; // носом вниз
  scene.add(nukeMesh);
  beep(220, 1.2, 0.2);
}

export function updateNuke(now: number): void {
  if (!nukeAt) return;
  const left = nukeAt - now;
  if (left > 0) {
    if (nukeMesh) nukeMesh.position.set(0, 2 + 80 * (left / STREAK.nukeMs) ** 1.5, 0);
    $('center-msg').textContent = `☢ БОМБА через ${Math.ceil(left / 1000)}`;
    return;
  }
  // Удар: белая вспышка на весь экран и грохот
  nukeAt = 0;
  if (nukeMesh) { scene.remove(nukeMesh); nukeMesh = null; }
  $('center-msg').textContent = '';
  const flash = $('flash');
  flash.classList.remove('fade');
  flash.classList.add('on');
  void flash.offsetWidth; // перезапуск анимации
  flash.classList.add('fade');
  shotSound('boom', 1);
  setTimeout(() => shotSound('boom', 0.8), 120);
  // Бомба — огромный салют над центром карты
  fireworks(0, 6, 0, 3);
  setTimeout(() => fireworks(0, 14, 0, 2.5), 250);
}
