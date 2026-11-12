// Что уходит под землю: брошенное и сбитое лежит секунду и проваливается.
import * as THREE from 'three';
import { scene } from '../core/scene.js';

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
