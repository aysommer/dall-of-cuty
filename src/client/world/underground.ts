// Канализация: что уходит под землю и вид из-под земли.
import * as THREE from 'three';
import { UNDERGROUND_Y } from '../../shared/maps/sewer.js';
import { camera, scene } from '../core/scene.js';
import { state } from '../core/state.js';
import { lampLights } from './map.js';

export const sinking: Array<{ obj: THREE.Object3D; born: number; baseY: number }> = [];

/** Секунду лежит, потом за секунду проваливается и исчезает — как тело. */
export function updateSinking(now: number): void {
  for (let i = sinking.length - 1; i >= 0; i--) {
    const s = sinking[i]!;
    const k = Math.max(0, Math.min(1, (now - s.born - 1000) / 1000));
    s.obj.position.y = s.baseY - 1.6 * k;
    if (k >= 1) {
      scene.remove(s.obj);
      sinking.splice(i, 1);
    }
  }
}

/** Под землёй выключаем «солнце» и небо, включаем фонари — светло только рядом с ними. */
export function updateUnderground(): void {
  const now = camera.position.y < UNDERGROUND_Y - 0.2;
  if (now === state.underground) return;
  state.underground = now;
  // Внизу темно за счёт тёмного бетона; солнце и небо остаются — из люка видно улицу.
  // Фонарь включаем только себе и только под землёй, чтобы он не подсвечивал улицу.
  for (const l of lampLights) l.visible = now;
}
