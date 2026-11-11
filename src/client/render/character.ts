// Человекоподобная модель игрока: безликий манекен X Bot (Mixamo) со скелетом.
// Ходьба и бег — готовые анимации модели; руки на оружии, прыжок и перезарядка — обратная кинематика поверх них.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Team } from '../../shared/protocol.js';
import { TEAM_COLOR } from '../core/util.js';

const MODEL_URL = 'models/xbot.glb';

/** Кости, которыми управляет код (имена Mixamo без префикса mixamorig) */
const BONE_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
] as const;
export type BoneName = typeof BONE_NAMES[number];

export interface Character {
  /** Корень модели: в его системе игрок смотрит на −Z, ноги на y = 0, рост 1.8 м */
  root: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  /** Все кости — чтобы копировать позу целиком (для тела погибшего) */
  allBones: THREE.Bone[];
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  run: THREE.AnimationAction;
  materials: THREE.Material[];
  /** Сглаженные веса: 0 — стоит, 1 — в воздухе; фаза перезарядки */
  airK: number;
  reloadT: number;
  /** Сглаженная скорость по земле, м/с (со знаком: назад — отрицательная) */
  speed: number;
}

let template: { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip> } | null = null;
let failed = false;

/** Модель загружена и можно создавать персонажей */
export const characterReady = (): boolean => template !== null;
/** Модель не загрузилась — игроки останутся прямоугольниками */
export const characterFailed = (): boolean => failed;

/** Загружает модель один раз при старте. Пока она грузится (или если не загрузилась), игроки — прямоугольники. */
export function loadCharacterModel(): void {
  new GLTFLoader().load(MODEL_URL, (gltf) => {
    const clips = new Map<string, THREE.AnimationClip>();
    for (const clip of gltf.animations) clips.set(clip.name, clip);
    template = { scene: gltf.scene, clips };
  }, undefined, (err) => {
    failed = true;
    console.warn('Модель игрока не загрузилась — остаются прямоугольники', err);
  });
}

export function createCharacter(team: Team): Character | null {
  if (!template) return null;
  const model = cloneSkinned(template.scene);
  // Модель смотрит на +Z, а игрок в игре — на −Z
  model.rotation.y = Math.PI;
  const root = new THREE.Group();
  root.add(model);

  const materials: THREE.Material[] = [];
  const allBones: THREE.Bone[] = [];
  const byName = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if (o instanceof THREE.Bone) { allBones.push(o); byName.set(o.name.replace(/^mixamorig:?/, ''), o); }
    if (o instanceof THREE.SkinnedMesh) {
      // Свой материал на каждого игрока: поверхность — цвета команды, суставы — тёмные
      const src = o.material as THREE.MeshStandardMaterial;
      const joints = /Joints/i.test(src.name);
      const mat = new THREE.MeshLambertMaterial({ color: joints ? 0x23262c : TEAM_COLOR[team] });
      o.material = mat;
      materials.push(mat);
      // Границы скелетной сетки считаются по позе покоя — при анимации она иначе пропадает у края экрана
      o.frustumCulled = false;
    }
  });
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONE_NAMES) {
    const b = byName.get(n);
    if (!b) throw new Error(`В модели нет кости ${n}`);
    bones[n] = b;
  }

  const mixer = new THREE.AnimationMixer(model);
  const action = (name: string): THREE.AnimationAction => {
    const a = mixer.clipAction(template!.clips.get(name)!);
    a.play();
    return a;
  };
  const idle = action('idle'), walk = action('walk'), run = action('run');
  walk.setEffectiveWeight(0);
  run.setEffectiveWeight(0);
  mixer.update(0);
  return { root, bones, allBones, mixer, idle, walk, run, materials, airK: 0, reloadT: 0, speed: 0 };
}

export function disposeCharacter(c: Character): void {
  c.mixer.stopAllAction();
  c.root.removeFromParent();
  for (const m of c.materials) m.dispose(); // геометрия общая с шаблоном — её не трогаем
}

// ---------- обратная кинематика ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

/**
 * Поворачивает кость так, чтобы направление на дочернюю кость совпало с dir (в мировых координатах).
 * Поворот минимальный — от текущего положения, поэтому скручивания вокруг оси почти нет.
 */
export function aimBone(bone: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3): void {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _b.sub(_a);
  if (_b.lengthSq() < 1e-10 || dir.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(_b.normalize(), _c.copy(dir).normalize());
  bone.getWorldQuaternion(_qw).premultiply(_q);
  bone.parent!.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Двухзвенная цепочка (плечо–предплечье или бедро–голень): конец ставится в точку target,
 * локоть или колено отводится в сторону pole. k — вес 0…1 (смешивается с текущей позой).
 */
export function solveLimb(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, k = 1): void {
  if (k <= 0) return;
  const qU = upper.quaternion.clone(), qL = lower.quaternion.clone();
  const s = upper.getWorldPosition(new THREE.Vector3());
  const lenA = s.distanceTo(lower.getWorldPosition(_d));
  const lenB = _d.distanceTo(end.getWorldPosition(new THREE.Vector3()));
  const to = new THREE.Vector3().subVectors(target, s);
  const dist = Math.min(Math.max(to.length(), Math.abs(lenA - lenB) + 1e-3), lenA + lenB - 1e-3);
  const dir = to.normalize();
  // Сустав: в плоскости (dir, pole) на расстоянии lenA от начала
  const cos = (lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const perp = new THREE.Vector3().copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(dir, dir.y);
  perp.normalize();
  const joint = new THREE.Vector3().copy(s).addScaledVector(dir, lenA * cos).addScaledVector(perp, lenA * sin);
  aimBone(upper, lower, joint.sub(s));
  const end2 = new THREE.Vector3().copy(s).addScaledVector(dir, dist);
  aimBone(lower, end, end2.sub(lower.getWorldPosition(_d)));
  if (k < 1) {
    upper.quaternion.copy(qU.slerp(upper.quaternion, k));
    lower.quaternion.copy(qL.slerp(lower.quaternion, k));
    upper.updateMatrixWorld(true);
  }
}

export interface CharacterInput {
  /** Скорость по земле, м/с, и куда она направлена относительно взгляда (1 — вперёд, −1 — назад) */
  speed: number;
  forward: number;
  /** В воздухе (прыжок или падение) */
  air: boolean;
  reloading: boolean;
  /** Точки хвата оружия в мировых координатах: правая рука и левая (null — рука свободна) */
  rightHand: THREE.Vector3 | null;
  leftHand: THREE.Vector3 | null;
  /** Куда смотрит игрок по вертикали, радианы (вверх — плюс) */
  pitch: number;
}

/** Естественные скорости анимаций модели, м/с: при них ноги не «скользят» */
const WALK_SPEED = 1.7, RUN_SPEED = 4.6;
const RELOAD_CYCLE = 1.4;
const _right = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3();

/** Шаг анимации: готовые клипы по скорости, затем позы поверх них. Перед вызовом корень должен стоять на месте игрока. */
export function updateCharacter(c: Character, dt: number, input: CharacterInput): void {
  // --- ходьба и бег: веса по скорости, темп — чтобы шаг совпадал с движением ---
  c.speed += (input.speed * (input.forward < -0.3 ? -1 : 1) - c.speed) * Math.min(1, dt * 10);
  const v = Math.abs(c.speed);
  const moving = Math.min(1, v / 0.6);
  const runK = Math.min(1, Math.max(0, (v - 2) / 2)); // до 2 м/с — шаг, с 4 м/с — бег
  const ground = 1 - c.airK * 0.85;
  c.idle.setEffectiveWeight((1 - moving) * ground + (1 - ground));
  c.walk.setEffectiveWeight(moving * (1 - runK) * ground);
  c.run.setEffectiveWeight(moving * runK * ground);
  const sign = c.speed < 0 ? -1 : 1; // пятится — шаги в обратную сторону
  c.walk.timeScale = sign * Math.min(1.8, Math.max(0.6, v / WALK_SPEED));
  c.run.timeScale = sign * Math.min(1.9, Math.max(0.7, v / RUN_SPEED));
  c.mixer.update(dt);

  c.airK += ((input.air ? 1 : 0) - c.airK) * Math.min(1, dt * 12);
  c.reloadT = input.reloading ? (c.reloadT + dt / RELOAD_CYCLE) % 1 : 0;

  c.root.updateMatrixWorld(true);
  // Оси игрока в мире: вправо, вперёд (−Z корня) и вверх
  const e = c.root.matrixWorld.elements;
  _right.set(e[0]!, e[1]!, e[2]!).normalize();
  _up.set(e[4]!, e[5]!, e[6]!).normalize();
  _fwd.set(-e[8]!, -e[9]!, -e[10]!).normalize();
  const scale = c.root.getWorldScale(_t).y;
  const B = c.bones;

  // --- наклон корпуса и головы за взглядом ---
  const lean = THREE.MathUtils.clamp(input.pitch, -1.2, 1.2);
  for (const [bone, part] of [[B.Spine1, 0.25], [B.Spine2, 0.25], [B.Head, 0.3]] as const) {
    bone.getWorldQuaternion(_qw).premultiply(_q.setFromAxisAngle(_right, lean * part));
    bone.parent!.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_qw));
    bone.updateMatrixWorld(true);
  }

  // --- прыжок: ноги поджаты, одна чуть впереди ---
  if (c.airK > 0.01) {
    const hips = B.Hips.getWorldPosition(new THREE.Vector3());
    for (const side of [-1, 1] as const) {
      const up = side < 0 ? B.LeftUpLeg : B.RightUpLeg, low = side < 0 ? B.LeftLeg : B.RightLeg, foot = side < 0 ? B.LeftFoot : B.RightFoot;
      const target = new THREE.Vector3().copy(hips)
        .addScaledVector(_right, side * 0.11 * scale)
        .addScaledVector(_up, (side < 0 ? -0.56 : -0.7) * scale)
        .addScaledVector(_fwd, (side < 0 ? 0.22 : -0.12) * scale);
      solveLimb(up, low, foot, target, _fwd, c.airK);
    }
  }

  // --- руки на оружии ---
  if (input.rightHand) {
    _pole.copy(_up).multiplyScalar(-1).addScaledVector(_right, 0.6);
    solveLimb(B.RightArm, B.RightForeArm, B.RightHand, input.rightHand, _pole);
  }
  if (input.leftHand) {
    const target = new THREE.Vector3().copy(input.leftHand);
    if (input.reloading) {
      // Перезарядка: левая рука уходит вниз за магазином к поясу и возвращается к оружию
      const t = c.reloadT;
      const down = t < 0.3 ? t / 0.3 : t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.3);
      const k = down * down * (3 - 2 * down);
      const belt = B.Hips.getWorldPosition(new THREE.Vector3())
        .addScaledVector(_right, -0.2 * scale).addScaledVector(_fwd, 0.12 * scale).addScaledVector(_up, 0.02 * scale);
      target.lerp(belt, k);
    }
    _pole.copy(_up).multiplyScalar(-1).addScaledVector(_right, -0.6);
    solveLimb(B.LeftArm, B.LeftForeArm, B.LeftHand, target, _pole);
  }
}
