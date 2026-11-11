// Патроны, выпавшие из погибших.
import * as THREE from 'three';
import type { AmmoPacksMsg, Vec3 } from '../../shared/protocol.js';
import { box, scene } from '../core/scene.js';

interface PackFx { g: THREE.Group; at: Vec3 }

export const packFx = new Map<number, PackFx>();

/** Зелёный ящик с патронами и жёлтой полосой. */
function buildPack(): THREE.Group {
  const g = new THREE.Group();
  const base = box(0.5, 0.28, 0.32, 0x3d5a2a);
  base.position.y = 0.14;
  const stripe = box(0.52, 0.06, 0.34, 0xf1c232, false);
  stripe.position.y = 0.2;
  g.add(base, stripe);
  return g;
}

export function onAmmoPacks(m: AmmoPacksMsg): void {
  const seen = new Set<number>();
  for (const a of m.list) {
    seen.add(a.id);
    if (packFx.has(a.id)) continue;
    const g = buildPack();
    g.position.set(a.at[0], a.at[1], a.at[2]);
    scene.add(g);
    packFx.set(a.id, { g, at: a.at });
  }
  for (const [id, fx] of packFx) {
    if (seen.has(id)) continue;
    scene.remove(fx.g);
    packFx.delete(id);
  }
}

export function updateAmmoPacks(now: number): void {
  for (const fx of packFx.values()) fx.g.rotation.y = now / 600;
}
