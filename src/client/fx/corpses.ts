// Тела погибших: падают и уходят под землю.
import * as THREE from 'three';
import type { Team } from '../../shared/protocol.js';
import { PLAYER } from '../../shared/map.js';
import { box, scene } from '../core/scene.js';
import { TEAM_COLOR } from '../core/util.js';

interface Corpse { g: THREE.Group; pivot: THREE.Group; born: number; lying: boolean }

export const corpses: Corpse[] = [];

const CORPSE = { fallMs: 350, lieMs: 1000, sinkMs: 1000, depth: 1 };

/** Прямоугольник падает на спину, через секунду уходит под землю и исчезает. */
export function spawnCorpse(pos: THREE.Vector3, yaw: number, team: Team, lying: boolean): void {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = yaw;
  // Ось вращения — задний нижний край, чтобы тело заваливалось назад, а не проваливалось в пол
  const pivot = new THREE.Group();
  pivot.position.z = PLAYER.w / 2;
  g.add(pivot);
  const body = box(PLAYER.w, PLAYER.h, PLAYER.w, TEAM_COLOR[team]);
  body.position.set(0, PLAYER.h / 2, -PLAYER.w / 2);
  pivot.add(body);
  scene.add(g);
  corpses.push({ g, pivot, born: performance.now(), lying });
}

export function updateCorpses(now: number): void {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i]!;
    const age = now - c.born;
    const fall = c.lying ? 1 : Math.min(1, age / CORPSE.fallMs);
    c.pivot.rotation.x = (Math.PI / 2) * fall * fall; // падает с ускорением
    const sinkStart = (c.lying ? 0 : CORPSE.fallMs) + CORPSE.lieMs;
    const sink = Math.max(0, Math.min(1, (age - sinkStart) / CORPSE.sinkMs));
    c.g.position.y = c.g.userData.baseY ?? (c.g.userData.baseY = c.g.position.y);
    c.g.position.y -= CORPSE.depth * sink;
    if (sink >= 1) {
      scene.remove(c.g);
      c.g.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      corpses.splice(i, 1);
    }
  }
}
