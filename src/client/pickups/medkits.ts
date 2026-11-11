// Аптечки: падение с неба и подбор.
import * as THREE from 'three';
import type { MedkitsMsg, Vec3 } from '../../shared/protocol.js';
import { MEDKIT } from '../../shared/map.js';
import { box, scene } from '../core/scene.js';
import { state } from '../core/state.js';
import { feedNote } from '../ui/hud.js';
import { currentMap } from '../world/map.js';

interface MedkitFx { g: THREE.Group; at: Vec3; landAt: number }

export const medkitFx = new Map<number, MedkitFx>();

/** Белый кубик с красным крестом сверху и по бокам. */
function buildMedkit(): THREE.Group {
  const g = new THREE.Group();
  const base = box(MEDKIT.size, MEDKIT.height, MEDKIT.size, 0xf2f2f2);
  base.position.y = MEDKIT.height / 2;
  g.add(base);
  for (const [w, d] of [[0.42, 0.12], [0.12, 0.42]] as const) {
    const cross = box(w, 0.02, d, 0xe02424, false);
    cross.position.y = MEDKIT.height + 0.01;
    g.add(cross);
  }
  for (const side of [-1, 1]) {
    const v = box(0.12, 0.24, 0.02, 0xe02424, false);
    v.position.set(0, MEDKIT.height / 2, side * (MEDKIT.size / 2 + 0.01));
    const h = box(0.24, 0.12, 0.02, 0xe02424, false);
    h.position.copy(v.position);
    g.add(v, h);
  }
  return g;
}

export function onMedkits(m: MedkitsMsg): void {
  const now = performance.now();
  const seen = new Set<number>();
  for (const k of m.list) {
    seen.add(k.id);
    if (medkitFx.has(k.id)) continue;
    const g = buildMedkit();
    scene.add(g);
    medkitFx.set(k.id, { g, at: k.at, landAt: now + k.ms });
    if (state.joined && k.ms > 0) feedNote('❤ С неба падает аптечка');
  }
  for (const [id, fx] of medkitFx) {
    if (seen.has(id)) continue;
    scene.remove(fx.g);
    fx.g.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    medkitFx.delete(id);
  }
}

export function updateMedkits(now: number): void {
  for (const fx of medkitFx.values()) {
    const left = Math.max(0, Math.min(1, (fx.landAt - now) / MEDKIT.fallMs));
    const lift = currentMap.indoor ? 0 : MEDKIT.fallHeight * (1 - (1 - left) ** 2);
    fx.g.position.set(fx.at[0], fx.at[1] + lift, fx.at[2]);
    fx.g.rotation.y = now / 700; // медленно вращается, чтобы бросалась в глаза
    // Последние 3 секунды перед исчезновением мигает
    const left2 = fx.landAt + MEDKIT.lifeMs - now;
    fx.g.visible = left2 > 3000 || Math.floor(now / 200) % 2 === 0;
  }
}
