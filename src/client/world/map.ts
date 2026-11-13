// Карта: блоки, лестницы, фонари, туман и твёрдые тела для столкновений; стёкла и двери.
import * as THREE from 'three';
import { type Box, clipWalls, DOOR, type GameMap, type Ladder, type MapId, MAPS } from '../../shared/map.js';
import type { Vec3 } from '../../shared/protocol.js';
import { beep, shotSound } from '../core/audio.js';
import { box, scene, setSunFor } from '../core/scene.js';
import { me, state } from '../core/state.js';
import { fireworks } from '../fx/fireworks.js';
import { buildCrate, buildParachute } from '../pickups/crate.js';
import { applyFog } from './weather.js';
import { buildBlocks } from './blocks.js';

export let currentMap: GameMap = MAPS.sands;

/** Блоки, которые мешают движению и выстрелам: карта плюс целые стёкла и двери */
export let solids: Box[] = MAPS.sands.boxes;

export const brokenIds = new Set<number>();

const breakMeshes = new Map<number, THREE.Object3D>();

/** Открытые двери и их петли (дверь поворачивается вокруг края) */
export const openDoors = new Set<number>();

const doorHinges = new Map<number, { pivot: THREE.Group; angle: number }>();

/** Невидимые стены по краю текущей карты */
export let clips: Box[] = clipWalls(MAPS.sands.half);


let loadedMap: MapId | null = null;

const mapGroup = new THREE.Group();

/** Лестница из блоков: две стойки и перекладины, прижатые к стене. */
function buildLadder(l: Ladder): THREE.Group {
  const g = new THREE.Group();
  const COLOR = 0x3b3f46;
  const alongX = l.normal[0] === 0; // лестница на стене, смотрящей вдоль Z, тянется по X
  const height = l.max[1] - l.min[1];
  const lo = alongX ? l.min[0] : l.min[2];
  const hi = alongX ? l.max[0] : l.max[2];
  // Плоскость лестницы — в 12 см от стены
  const wall = alongX
    ? (l.normal[1] > 0 ? l.min[2] : l.max[2])
    : (l.normal[0] > 0 ? l.min[0] : l.max[0]);
  const depth = wall + (alongX ? l.normal[1] : l.normal[0]) * 0.12;
  const place = (m: THREE.Mesh, side: number, y: number): void => {
    if (alongX) m.position.set(side, y, depth);
    else m.position.set(depth, y, side);
    g.add(m);
  };
  for (const side of [lo + 0.06, hi - 0.06]) {
    place(box(0.1, height, 0.1, COLOR), side, l.min[1] + height / 2);
  }
  const width = hi - lo;
  for (let y = l.min[1] + 0.4; y < l.max[1] - 0.1; y += 0.45) {
    place(alongX ? box(width, 0.07, 0.07, COLOR) : box(0.07, 0.07, width, COLOR), (lo + hi) / 2, y);
  }
  return g;
}

export function loadMap(id: MapId): void {
  if (loadedMap === id) return;
  loadedMap = id;
  currentMap = MAPS[id];
  clips = clipWalls(currentMap.half);
  brokenIds.clear();
  mapGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const materials = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
      for (const mat of materials) {
        if (mat.userData.shared) continue; // общий материал блоков живёт между картами
        (mat as THREE.MeshLambertMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
  mapGroup.clear();

  applyFog(); // небо, туман и свет — под эту карту и текущую погоду
  for (const m of buildBlocks(currentMap)) mapGroup.add(m);
  setSunFor(currentMap.half, !currentMap.indoor); // на открытых картах солнце ходит по кругу
  for (const l of currentMap.ladders) {
    const ladder = buildLadder(l);
    ladder.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    mapGroup.add(ladder);
  }
  breakMeshes.clear();
  doorHinges.clear();
  for (const x of currentMap.breakables ?? []) {
    const { min, max } = x.box;
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const m = box(w, h, d, x.box.color);
    m.receiveShadow = true;
    if (x.kind === 'glass') {
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.transparent = true;
      mat.opacity = 0.45;
    } else {
      // Дверь: филёнки и ручка
      const knob = box(0.08, 0.08, 0.08, 0xd4b04a);
      knob.position.set(w > d ? w * 0.35 : 0, -0.1, w > d ? 0 : d * 0.35);
      knob.scale.set(w > d ? 1 : 3.5, 1, w > d ? 3.5 : 1);
      m.add(knob);
    }
    if (x.kind === 'door') {
      // Петля — на одном краю двери: открытая дверь поворачивается на 90° внутрь комнаты
      const alongZ = d > w;
      const pivot = new THREE.Group();
      pivot.position.set(alongZ ? min[0] + w / 2 : min[0], min[1], alongZ ? min[2] : min[2] + d / 2);
      m.position.set(alongZ ? 0 : w / 2, h / 2, alongZ ? d / 2 : 0);
      pivot.add(m);
      pivot.visible = !brokenIds.has(x.id);
      breakMeshes.set(x.id, pivot);
      doorHinges.set(x.id, { pivot, angle: 0 });
      mapGroup.add(pivot);
      continue;
    }
    m.position.set(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);
    m.visible = !brokenIds.has(x.id);
    breakMeshes.set(x.id, m);
    mapGroup.add(m);
  }
  rebuildSolids();
  for (const pad of currentMap.pads ?? []) {
    const cx = (pad.min[0] + pad.max[0]) / 2, cz = (pad.min[2] + pad.max[2]) / 2;
    const glow = box(pad.max[0] - pad.min[0] - 0.4, 0.04, pad.max[2] - pad.min[2] - 0.4, 0xffb3d9, false);
    glow.position.set(cx, pad.max[1] + 0.02, cz);
    mapGroup.add(glow);
    // Стрелка из двух полосок, острием к цели прыжка
    const yaw = Math.atan2(pad.vel[0], pad.vel[2]);
    for (const side of [-1, 1]) {
      const bar = box(0.12, 0.05, 0.9, 0xff3d9a, false);
      bar.position.set(cx, pad.max[1] + 0.05, cz);
      bar.rotation.y = yaw + side * 0.6;
      bar.translateZ(0.25);
      bar.translateX(side * -0.2);
      mapGroup.add(bar);
    }
  }

  state.crateMesh = buildCrate();
  state.crateMesh.visible = false;
  mapGroup.add(state.crateMesh);
  state.crateChute = buildParachute();
  state.crateChute.visible = false;
  mapGroup.add(state.crateChute);
}

export function rebuildSolids(): void {
  const intact = (currentMap.breakables ?? []).filter((x) => !brokenIds.has(x.id) && !openDoors.has(x.id)).map((x) => x.box);
  solids = intact.length ? [...currentMap.boxes, ...intact] : currentMap.boxes;
}

/** Что-то разбили: исчезает, а на его месте разлетаются щепки (дверь) или осколки (стекло). */
export function onBreaks(broken: number[]): void {
  const now = new Set(broken);
  for (const x of currentMap.breakables ?? []) {
    const was = brokenIds.has(x.id), is = now.has(x.id);
    const mesh = breakMeshes.get(x.id);
    if (mesh) mesh.visible = !is;
    if (is && !was && state.joined) {
      const { min, max } = x.box;
      const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      if (x.kind === 'glass') {
        fireworks(c[0], c[1], c[2], 1.3, [0xbfe6ff, 0xe8f6ff, 0x9fd3ff, 0xffffff]);
        shotSound('knife', 1);
        beep(2600, 0.15, 0.08);
      } else {
        fireworks(c[0], c[1], c[2], 1, [0x5a3416, 0x7a4a22, 0x8f5a2c, 0xa8743a]);
        shotSound('shotgun', 0.6);
      }
    }
  }
  brokenIds.clear();
  for (const id of broken) brokenIds.add(id);
  rebuildSolids();
}

/** Ближайшая целая дверь, до которой можно дотянуться. */
export function nearDoor(): { id: number } | null {
  let best: { id: number } | null = null, bestD = DOOR.reach;
  for (const x of currentMap.breakables ?? []) {
    if (x.kind !== 'door' || brokenIds.has(x.id)) continue;
    const { min, max } = x.box;
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const d = Math.hypot(c.x - me.pos.x, c.z - me.pos.z) - 0.5;
    if (Math.abs(min[1] - me.pos.y) < 1.5 && d < bestD) { bestD = d; best = { id: x.id }; }
  }
  return best;
}

/** Двери плавно поворачиваются на петлях. */
export function updateDoors(dt: number): void {
  for (const [id, h] of doorHinges) {
    const target = openDoors.has(id) ? -Math.PI / 2 : 0;
    h.angle += (target - h.angle) * Math.min(1, dt * 8);
    h.pivot.rotation.y = h.angle;
  }
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initMap(): void {
  scene.add(mapGroup);
  loadMap('sands');
}
