// Тела погибших: модель падает по физике — у каждой конечности свой вес и свои суставы (рэгдолл).
// Суставы — частицы (интегрирование Верле), кости — жёсткие связи между ними; частицы сталкиваются с блоками карты.
// Через несколько секунд тело уходит под землю и исчезает.
import * as THREE from 'three';
import type { Team } from '../../shared/protocol.js';
import { PLAYER, WORLD_BOTTOM } from '../../shared/map.js';
import type { Box } from '../../shared/maps/types.js';
import { box, scene } from '../core/scene.js';
import { TEAM_COLOR } from '../core/util.js';
import { aimBone, type BoneName, type Character, createCharacter, disposeCharacter, setCharacterLook } from '../render/character.js';
import { solids } from '../world/map.js';

const CORPSE = { physicsMs: 4500, sinkMs: 1200, depth: 0.7, max: 8 };
const GRAVITY = 19, SUBSTEP = 1 / 120, ITERATIONS = 6, FRICTION = 0.35, AIR_DRAG = 0.999;

/** Суставы-частицы и кости модели, по которым они ставятся */
const JOINTS: Array<{ bone: BoneName; r: number }> = [
  { bone: 'Hips', r: 0.11 }, { bone: 'Spine2', r: 0.12 }, { bone: 'Head', r: 0.11 },
  { bone: 'LeftArm', r: 0.07 }, { bone: 'LeftForeArm', r: 0.06 }, { bone: 'LeftHand', r: 0.05 },
  { bone: 'RightArm', r: 0.07 }, { bone: 'RightForeArm', r: 0.06 }, { bone: 'RightHand', r: 0.05 },
  { bone: 'LeftUpLeg', r: 0.09 }, { bone: 'LeftLeg', r: 0.07 }, { bone: 'LeftFoot', r: 0.06 },
  { bone: 'RightUpLeg', r: 0.09 }, { bone: 'RightLeg', r: 0.07 }, { bone: 'RightFoot', r: 0.06 },
];
const HIPS = 0, CHEST = 1, HEAD = 2, L_SHO = 3, L_ELB = 4, L_HAND = 5, R_SHO = 6, R_ELB = 7, R_HAND = 8,
  L_HIP = 9, L_KNEE = 10, L_FOOT = 11, R_HIP = 12, R_KNEE = 13, R_FOOT = 14;
/** Жёсткие связи: корпус — единый каркас, конечности — по две кости */
const TORSO = [HIPS, CHEST, L_SHO, R_SHO, L_HIP, R_HIP];
const STICKS: Array<[number, number]> = [
  [CHEST, HEAD],
  [L_SHO, L_ELB], [L_ELB, L_HAND], [R_SHO, R_ELB], [R_ELB, R_HAND],
  [L_HIP, L_KNEE], [L_KNEE, L_FOOT], [R_HIP, R_KNEE], [R_KNEE, R_FOOT],
];
for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) STICKS.push([TORSO[i]!, TORSO[j]!]);
/**
 * Пределы суставов: расстояние между частицами не меньше доли от исходного (k) или от заданного (min, метры).
 * Не дают шее сложиться, коленям и локтям — вывернуться сквозь тело, ногам — пройти друг через друга.
 */
const LIMITS: Array<{ a: number; b: number; k?: number; min?: number }> = [
  { a: HEAD, b: HIPS, k: 0.82 }, { a: HEAD, b: L_SHO, k: 0.8 }, { a: HEAD, b: R_SHO, k: 0.8 },
  { a: L_HAND, b: L_SHO, min: 0.2 }, { a: R_HAND, b: R_SHO, min: 0.2 },
  { a: L_FOOT, b: L_HIP, min: 0.35 }, { a: R_FOOT, b: R_HIP, min: 0.35 },
  { a: L_KNEE, b: R_KNEE, min: 0.14 }, { a: L_FOOT, b: R_FOOT, min: 0.14 },
  { a: L_KNEE, b: CHEST, min: 0.3 }, { a: R_KNEE, b: CHEST, min: 0.3 },
  { a: L_ELB, b: HIPS, min: 0.2 }, { a: R_ELB, b: HIPS, min: 0.2 },
  { a: L_HAND, b: HEAD, min: 0.15 }, { a: R_HAND, b: HEAD, min: 0.15 },
  { a: L_FOOT, b: HIPS, min: 0.3 }, { a: R_FOOT, b: HIPS, min: 0.3 },
];

interface Ragdoll {
  char: Character;
  pos: THREE.Vector3[];
  prev: THREE.Vector3[];
  sticks: Array<{ a: number; b: number; len: number }>;
  limits: Array<{ a: number; b: number; min: number }>;
  /** Блоки карты рядом с телом (обновляются, пока оно летит) */
  near: Box[];
  nearAt: THREE.Vector3;
  /** Ориентация таза в момент смерти и каркас корпуса тогда же — от них считается поворот */
  hipsQuat: THREE.Quaternion;
  basisInv: THREE.Quaternion;
  scale: number;
  acc: number;
  /** Сколько секунд тело почти не двигается; улеглось — физику больше не считаем */
  still: number;
}
interface Corpse { born: number; ragdoll: Ragdoll | null; fallback: THREE.Object3D | null; baseY: number; sunk: number }

export const corpses: Corpse[] = [];

export interface CorpseSource {
  pos: THREE.Vector3;
  yaw: number;
  team: Team;
  /** Лежал в подкате */
  lying: boolean;
  /** 1 или чуть больше у Джаггернаута */
  scale: number;
  /** Джаггернаут — серый; в бронежилете — чёрное туловище */
  grey: boolean;
  vest: boolean;
  /** Модель погибшего в её последней позе (у себя самого модели нет) */
  char: Character | null;
  /** Скорость тела в момент смерти и толчок от попадания или взрыва, м/с */
  vel: THREE.Vector3;
  impulse: THREE.Vector3;
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _v = new THREE.Vector3();

/** Ориентация корпуса по частицам: X — от правого бедра к левому, Y — от таза к груди. */
function torsoBasis(p: THREE.Vector3[], out: THREE.Quaternion): THREE.Quaternion {
  _x.subVectors(p[L_HIP]!, p[R_HIP]!).normalize();
  _y.subVectors(p[CHEST]!, p[HIPS]!);
  _y.addScaledVector(_x, -_y.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

/** Тело погибшего: копия модели в той же позе, дальше — физика. */
export function spawnCorpse(src: CorpseSource): void {
  while (corpses.length >= CORPSE.max) removeCorpse(0);
  const char = createCharacter(src.team);
  if (!char) { spawnBoxCorpse(src); return; }
  setCharacterLook(char, { vest: src.vest, grey: src.grey });
  // Поза — как у живой модели в последний кадр (у себя самого модели нет — берём стойку)
  const pose = (src.char ?? char).allBones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
  if (src.char) {
    src.char.root.updateWorldMatrix(true, false);
    src.char.root.matrixWorld.decompose(char.root.position, char.root.quaternion, char.root.scale);
  } else {
    char.root.position.copy(src.pos);
    char.root.rotation.set(src.lying ? -Math.PI / 2 : 0, src.yaw, 0, 'YXZ');
    if (src.lying) char.root.position.y += 0.2;
    char.root.scale.setScalar(src.scale);
  }
  char.mixer.stopAllAction(); // дальше кости ведёт физика, а не анимация (остановка сбрасывает позу — возвращаем)
  pose.forEach((t, i) => { char.allBones[i]!.position.copy(t.p); char.allBones[i]!.quaternion.copy(t.q); });
  scene.add(char.root);
  char.root.updateMatrixWorld(true);

  const scale = char.root.scale.y;
  const pos = JOINTS.map((j) => char.bones[j.bone].getWorldPosition(new THREE.Vector3()));
  // Толчок сильнее достаётся верху тела — так оно заваливается, а не скользит стоя
  const prev = pos.map((p, i) => {
    const high = Math.min(1, Math.max(0, (p.y - src.pos.y) / (PLAYER.h * scale)));
    _v.copy(src.vel).addScaledVector(src.impulse, 0.35 + 0.65 * high);
    _v.x += (Math.random() - 0.5) * 0.6; _v.z += (Math.random() - 0.5) * 0.6;
    if (i === HEAD) _v.addScaledVector(src.impulse, 0.25);
    return p.clone().addScaledVector(_v, -SUBSTEP);
  });
  const sticks = STICKS.map(([a, b]) => ({ a, b, len: pos[a]!.distanceTo(pos[b]!) }));
  const limits = LIMITS.map((l) => ({ a: l.a, b: l.b, min: l.k !== undefined ? pos[l.a]!.distanceTo(pos[l.b]!) * l.k : l.min! * scale }));
  const ragdoll: Ragdoll = {
    char, pos, prev, sticks, limits, near: [], nearAt: new THREE.Vector3(Infinity, 0, 0),
    hipsQuat: char.bones.Hips.getWorldQuaternion(new THREE.Quaternion()),
    basisInv: torsoBasis(pos, new THREE.Quaternion()).invert(),
    scale, acc: 0, still: 0,
  };
  corpses.push({ born: performance.now(), ragdoll, fallback: null, baseY: 0, sunk: 0 });
}

/** Модель не загрузилась — как раньше: прямоугольник заваливается на спину. */
function spawnBoxCorpse(src: CorpseSource): void {
  const g = new THREE.Group();
  g.position.copy(src.pos);
  g.rotation.y = src.yaw;
  const pivot = new THREE.Group();
  pivot.position.z = 0.15;
  pivot.name = 'pivot';
  g.add(pivot);
  const body = box(0.45, PLAYER.h, 0.3, TEAM_COLOR[src.team]);
  body.position.set(0, PLAYER.h / 2, -0.15);
  pivot.add(body);
  g.scale.setScalar(src.scale);
  scene.add(g);
  corpses.push({ born: performance.now(), ragdoll: null, fallback: g, baseY: src.pos.y, sunk: 0 });
}

function removeCorpse(i: number): void {
  const c = corpses[i]!;
  if (c.ragdoll) disposeCharacter(c.ragdoll.char);
  if (c.fallback) {
    scene.remove(c.fallback);
    c.fallback.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
  corpses.splice(i, 1);
}

/** Блоки в паре метров от тела: с остальными частицы столкнуться не могут. */
function refreshNear(r: Ragdoll): void {
  const c = r.pos[HIPS]!;
  if (c.distanceToSquared(r.nearAt) < 1) return;
  r.nearAt.copy(c);
  const R = 3.5;
  r.near = solids.filter((b) => b.min[0] < c.x + R && b.max[0] > c.x - R && b.min[1] < c.y + R && b.max[1] > c.y - R && b.min[2] < c.z + R && b.max[2] > c.z - R);
}

function collide(r: Ragdoll): void {
  for (let i = 0; i < r.pos.length; i++) {
    const p = r.pos[i]!, q = r.prev[i]!, rad = JOINTS[i]!.r * r.scale;
    for (const b of r.near) {
      const dx1 = p.x - (b.min[0] - rad), dx2 = (b.max[0] + rad) - p.x;
      if (dx1 <= 0 || dx2 <= 0) continue;
      const dy1 = p.y - (b.min[1] - rad), dy2 = (b.max[1] + rad) - p.y;
      if (dy1 <= 0 || dy2 <= 0) continue;
      const dz1 = p.z - (b.min[2] - rad), dz2 = (b.max[2] + rad) - p.z;
      if (dz1 <= 0 || dz2 <= 0) continue;
      // Выталкиваем по самой короткой оси; вдоль поверхности — трение, по нормали скорость гасится
      const m = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
      const vx = p.x - q.x, vy = p.y - q.y, vz = p.z - q.z;
      if (m === dy2 || m === dy1) {
        p.y += m === dy2 ? dy2 : -dy1;
        q.y = p.y; q.x = p.x - vx * (1 - FRICTION); q.z = p.z - vz * (1 - FRICTION);
      } else if (m === dx1 || m === dx2) {
        p.x += m === dx2 ? dx2 : -dx1;
        q.x = p.x; q.y = p.y - vy * (1 - FRICTION); q.z = p.z - vz * (1 - FRICTION);
      } else {
        p.z += m === dz2 ? dz2 : -dz1;
        q.z = p.z; q.x = p.x - vx * (1 - FRICTION); q.y = p.y - vy * (1 - FRICTION);
      }
    }
    if (p.y < WORLD_BOTTOM) { p.y = WORLD_BOTTOM; q.copy(p); }
  }
}

function stepRagdoll(r: Ragdoll): void {
  for (let i = 0; i < r.pos.length; i++) {
    const p = r.pos[i]!, q = r.prev[i]!;
    const vx = (p.x - q.x) * AIR_DRAG, vy = (p.y - q.y) * AIR_DRAG, vz = (p.z - q.z) * AIR_DRAG;
    q.copy(p);
    p.x += vx; p.y += vy - GRAVITY * SUBSTEP * SUBSTEP; p.z += vz;
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (const s of r.sticks) {
      const a = r.pos[s.a]!, b = r.pos[s.b]!;
      _v.subVectors(b, a);
      const d = _v.length() || 1e-6;
      _v.multiplyScalar((d - s.len) / d * 0.5);
      a.add(_v); b.sub(_v);
    }
    for (const l of r.limits) {
      const a = r.pos[l.a]!, b = r.pos[l.b]!;
      _v.subVectors(b, a);
      const d = _v.length() || 1e-6;
      if (d >= l.min) continue;
      _v.multiplyScalar((d - l.min) / d * 0.5);
      a.add(_v); b.sub(_v);
    }
    collide(r);
  }
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _p = new THREE.Vector3();

/** Ставит кости модели по частицам: таз — по каркасу корпуса, шея и конечности — вдоль своих связей. */
function poseFromRagdoll(r: Ragdoll, sink: number): void {
  const B = r.char.bones, P = r.pos;
  const hips = B.Hips, parent = hips.parent!;
  parent.updateWorldMatrix(true, false);
  // Поворот каркаса с момента смерти, приложенный к тогдашней ориентации таза
  torsoBasis(P, _qa).multiply(r.basisInv).multiply(_qb.copy(r.hipsQuat));
  parent.getWorldQuaternion(_qb).invert();
  hips.quaternion.copy(_qb.multiply(_qa));
  hips.position.copy(parent.worldToLocal(_p.copy(P[HIPS]!).setY(P[HIPS]!.y - sink)));
  hips.updateMatrixWorld(true);
  const aim = (bone: BoneName, child: BoneName, to: number): void => {
    const b = B[bone];
    aimBone(b, B[child], _p.copy(P[to]!).setY(P[to]!.y - sink).sub(b.getWorldPosition(_v)));
  };
  aim('Neck', 'Head', HEAD);
  aim('LeftArm', 'LeftForeArm', L_ELB); aim('LeftForeArm', 'LeftHand', L_HAND);
  aim('RightArm', 'RightForeArm', R_ELB); aim('RightForeArm', 'RightHand', R_HAND);
  aim('LeftUpLeg', 'LeftLeg', L_KNEE); aim('LeftLeg', 'LeftFoot', L_FOOT);
  aim('RightUpLeg', 'RightLeg', R_KNEE); aim('RightLeg', 'RightFoot', R_FOOT);
}

export function updateCorpses(now: number, dt = 1 / 60): void {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i]!;
    const age = now - c.born;
    const sink = Math.max(0, Math.min(1, (age - CORPSE.physicsMs) / CORPSE.sinkMs));
    if (sink >= 1) { removeCorpse(i); continue; }
    if (c.ragdoll) {
      const r = c.ragdoll;
      if (sink === 0 && r.still < 0.6) {
        const before = r.pos[HIPS]!.clone().add(r.pos[HEAD]!).add(r.pos[L_FOOT]!).add(r.pos[R_HAND]!);
        // Догоняем до 0,12 с за кадр: и на медленном устройстве тело падает за реальное время, а не застывает
        r.acc = Math.min(r.acc + dt, 0.12);
        while (r.acc >= SUBSTEP) {
          r.acc -= SUBSTEP;
          refreshNear(r);
          stepRagdoll(r);
        }
        // Улеглось: суставы сдвигаются меньше чем на 2 см/с
        const moved = before.sub(r.pos[HIPS]!).sub(r.pos[HEAD]!).sub(r.pos[L_FOOT]!).sub(r.pos[R_HAND]!).length();
        r.still = moved < 0.02 * dt * 4 ? r.still + dt : 0;
      }
      poseFromRagdoll(r, CORPSE.depth * sink * sink);
    } else if (c.fallback) {
      const fall = Math.min(1, age / 350);
      c.fallback.getObjectByName('pivot')!.rotation.x = (Math.PI / 2) * fall * fall;
      c.fallback.position.y = c.baseY - sink;
    }
  }
}

/** Для отладки и тестов: где сейчас суставы последнего тела и как быстро они движутся (м/с). */
export function corpseDebug(): { joints: number[][]; speed: number; modelled: boolean } | null {
  const c = corpses[corpses.length - 1];
  if (!c) return null;
  if (!c.ragdoll) return { joints: [], speed: 0, modelled: false };
  const r = c.ragdoll;
  let speed = 0;
  r.pos.forEach((p, i) => { speed = Math.max(speed, p.distanceTo(r.prev[i]!) / SUBSTEP); });
  return { joints: r.pos.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]), speed, modelled: true };
}
