// Трассеры пуль и вспышки.
import * as THREE from 'three';
import { box, scene } from '../core/scene.js';

interface Effect {
  obj: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | THREE.Mesh;
  born: number;
  life: number;
  fade: boolean;
  /** Во сколько раз объект вырастает за время жизни (взрыв) */
  grow?: number;
}

export const effects: Effect[] = [];

export function addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
  const now = performance.now();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from, to]),
    new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 }),
  );
  scene.add(line);
  effects.push({ obj: line, born: now, life: 70, fade: true });
  // Искра в точке попадания
  const spark = box(0.08, 0.08, 0.08, 0xffe08a, false);
  spark.position.copy(to);
  scene.add(spark);
  effects.push({ obj: spark, born: now, life: 160, fade: false });
}

export function updateEffects(now: number): void {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]!;
    const age = now - e.born;
    const material = e.obj.material as THREE.Material;
    if (age > e.life) {
      scene.remove(e.obj);
      e.obj.geometry.dispose();
      material.dispose();
      effects.splice(i, 1);
    } else {
      if (e.fade) material.opacity = 0.9 * (1 - age / e.life);
      if (e.grow) e.obj.scale.setScalar(1 + (e.grow - 1) * (age / e.life));
    }
  }
}
