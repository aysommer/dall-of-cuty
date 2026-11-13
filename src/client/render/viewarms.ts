// Руки от первого лица: руки той же модели со скелетом держат оружие, перезаряжают, снимают прицел,
// передёргивают затвор и бросают гранаты. Остальное тело от первого лица не рисуется.
//
// Хват задан так, как в шутерах: для каждого оружия — где предмет в ладони (в координатах ствола),
// куда смотрит ладонь и куда направлены пальцы. Кисть ставится ровно в эту ориентацию, а рука
// подтягивается так, чтобы в нужной точке оказалась ладонь, а не запястье. Основная рука обхватывает
// пистолетную рукоять (ладонь к рукояти, большой палец сверху), вторая снизу держит цевьё (ладонь вверх,
// пальцы обнимают его справа); у пистолета вторая ладонь накрывает пальцы основной слева.
import * as THREE from 'three';
import type { WeaponId } from '../../shared/protocol.js';
import { camera } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { BOLT_MS, offhandThrow, scopeHandPos, viewGun, viewModel } from '../weapons/viewmodel.js';
import { type Character, characterReady, createCharacter, setCharacterLook, solveLimb } from './character.js';

let arms: Character | null = null;
/** Поза покоя плеча, предплечья и кисти — к ней кости возвращаются каждый кадр */
let rest: Array<[THREE.Bone, THREE.Quaternion]> = [];

/** Кисть в собственных координатах: от запястья к основанию среднего пальца, направление пальцев и ладони */
interface HandFrame { mid: THREE.Vector3; finger: THREE.Vector3; palm: THREE.Vector3; basis: THREE.Matrix4 }
const frames: Record<'Left' | 'Right', HandFrame | null> = { Left: null, Right: null };
/** Пальцы: сжаты в кулак (на рукояти) или чуть свободнее — обнимают цевьё снизу */
const fingers: Record<'Left' | 'Right', Array<{ bone: THREE.Bone; fist: THREE.Quaternion; cup: THREE.Quaternion }>> = { Left: [], Right: [] };

/**
 * Руки от первого лица чуть крупнее настоящих и вынесены вперёд — как принято в шутерах: оружие в кадре
 * держится дальше, чем достаёт настоящая рука. Плечи оказываются чуть ниже и впереди глаз.
 */
const ARM_SCALE = 1.15;
const ROOT = new THREE.Vector3(0, -1.44 * ARM_SCALE - 0.13, -0.16);
/** Половина толщины ладони: от кости кисти до поверхности ладони */
const PALM = 0.018 * ARM_SCALE;

const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'] as const;
/** Сгиб фаланг в кулаке; на цевье — 80 % от него (пальцы обхватывают тонкое цевьё, а не торчат вверх) */
const FIST: Record<typeof FINGER_NAMES[number], [number, number, number]> = {
  Index: [0.9, 1.2, 0.8], Middle: [1.0, 1.25, 0.8], Ring: [1.05, 1.25, 0.8], Pinky: [1.1, 1.2, 0.8], Thumb: [0.3, 0.4, 0.3],
};
const CUP = 0.8;

function build(): void {
  const c = createCharacter(me.team, { armsOnly: true });
  if (!c) return;
  c.mixer.stopAllAction(); // руками управляет только код
  c.root.position.copy(ROOT);
  c.root.scale.setScalar(ARM_SCALE);
  const B = c.bones;
  c.root.updateMatrixWorld(true);
  const bone = (name: string): THREE.Bone | undefined => c.allBones.find((x) => x.name.replace(/^mixamorig:?/, '') === name);
  // Фаланга поворачивается вокруг оси сгиба пальца (одна на весь палец, считается по прямому пальцу:
  // если брать ось от текущего направления фаланги, то после сгиба за 90° она переворачивается и палец разгибается)
  const curl = (b: THREE.Bone, axis: THREE.Vector3, angle: number): void => {
    const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    b.updateMatrixWorld(true);
  };
  for (const side of ['Left', 'Right'] as const) {
    const hand = bone(`${side}Hand`), index = bone(`${side}HandIndex1`), pinky = bone(`${side}HandPinky1`), thumb = bone(`${side}HandThumb1`), middle = bone(`${side}HandMiddle1`);
    if (!hand || !index || !pinky || !thumb || !middle) continue;
    const hp = hand.getWorldPosition(new THREE.Vector3());
    const at = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3()).sub(hp);
    // Нормаль ладони — перпендикуляр к плоскости оснований пальцев, с той стороны, куда сгибается большой палец
    const palm = new THREE.Vector3().crossVectors(at(index), at(pinky)).normalize();
    if (at(thumb).dot(palm) < 0) palm.negate();
    // Всё — в собственных координатах кисти: так ориентацию можно задать в любой позе
    const inv = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const mid = at(middle).applyQuaternion(inv);
    const finger = mid.clone().normalize();
    const palmL = palm.clone().applyQuaternion(inv);
    frames[side] = { mid, finger, palm: palmL, basis: basisOf(finger, palmL) };
    // Пальцы: запоминаем полусогнутую позу, затем догибаем до кулака
    const list: typeof fingers.Left = [];
    const origin = new Map<THREE.Bone, THREE.Quaternion>();
    for (const f of FINGER_NAMES) for (let i = 1; i <= 3; i++) { const b = bone(`${side}Hand${f}${i}`); if (b) origin.set(b, b.quaternion.clone()); }
    // Оси сгиба: перпендикуляр к пальцу (по его первой фаланге в прямой позе) и к нормали ладони
    const axes = new Map<string, THREE.Vector3>();
    for (const f of FINGER_NAMES) {
      const a = bone(`${side}Hand${f}1`), b2 = bone(`${side}Hand${f}2`);
      if (!a || !b2) continue;
      const dir = b2.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
      const axis = new THREE.Vector3().crossVectors(dir, palm);
      if (axis.lengthSq() > 1e-6) axes.set(f, axis.normalize());
    }
    const bend = (k: number): void => {
      for (const [b, q] of origin) { b.quaternion.copy(q); b.updateMatrixWorld(true); }
      for (const f of FINGER_NAMES) for (let i = 1; i <= 3; i++) {
        const b = bone(`${side}Hand${f}${i}`), axis = axes.get(f);
        if (b && axis) curl(b, axis, FIST[f][i - 1]! * k);
      }
    };
    bend(CUP);
    const cup = new Map([...origin.keys()].map((b) => [b, b.quaternion.clone()]));
    bend(1);
    for (const b of origin.keys()) list.push({ bone: b, fist: b.quaternion.clone(), cup: cup.get(b)! });
    fingers[side] = list;
  }
  rest = [B.LeftArm, B.LeftForeArm, B.LeftHand, B.RightArm, B.RightForeArm, B.RightHand].map((b) => [b, b.quaternion.clone()]);
  camera.add(c.root);
  arms = c;
}

/** Ортонормированный базис (пальцы, ладонь, их произведение) столбцами */
function basisOf(finger: THREE.Vector3, palm: THREE.Vector3): THREE.Matrix4 {
  const n = palm.clone().normalize();
  const f = finger.clone().addScaledVector(n, -finger.dot(n)).normalize();
  return new THREE.Matrix4().makeBasis(f, n, new THREE.Vector3().crossVectors(f, n));
}

/**
 * Хват: где предмет (центр рукояти, цевья, гранаты) в координатах ствола, куда направлены пальцы
 * (от запястья к костяшкам), куда смотрит ладонь, толщина предмета и сжаты ли пальцы в кулак.
 * Ствол смотрит в −Z, верх — +Y, правая сторона — +X. Для левши всё отражается по X.
 */
interface Hold { at: THREE.Vector3; finger: THREE.Vector3; palm: THREE.Vector3; r: number; fist: boolean }
const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** Основная рука на пистолетной рукояти: пальцы вперёд и чуть вверх, ладонь к рукояти слева, большой палец сверху */
const onGrip = (y: number, z: number): Hold => ({ at: v(0, y, z), finger: v(0, 0.3, -1), palm: v(-1, 0, 0), r: 0.026, fist: true });
/**
 * Вторая рука снизу под цевьём, «люлькой»: ладонь вверх и чуть влево, пальцы вперёд-вправо плотно обхватывают
 * цевьё справа, большой палец — слева; над стволом в прицеле видны только кончики.
 */
const underGuard = (y: number, z: number, r: number): Hold => ({ at: v(0, y - 0.015, z), finger: v(0.3, 0, -1), palm: v(-0.4, 1, 0), r, fist: true });

const HOLDS: Record<WeaponId, { main: Hold; off: Hold | null }> = {
  pistol: {
    main: onGrip(-0.075, -0.03),
    // Вторая ладонь слева накрывает пальцы основной, большой палец смотрит вперёд вдоль затвора
    off: { at: v(0, -0.085, -0.03), finger: v(0, -0.35, -1), palm: v(1, 0, 0), r: 0.05, fist: true },
  },
  rifle: { main: onGrip(-0.085, -0.01), off: underGuard(-0.005, -0.33, 0.045) },
  smg: { main: onGrip(-0.075, 0.0), off: underGuard(0, -0.27, 0.04) },
  shotgun: { main: onGrip(-0.075, 0.0), off: underGuard(-0.055, -0.36, 0.03) },          // на цевье-помпе
  sniper: { main: onGrip(-0.085, -0.05), off: underGuard(0, -0.37, 0.04) },
  lmg: { main: onGrip(-0.095, 0.02), off: underGuard(0, -0.36, 0.055) },
  rocket: { main: onGrip(-0.1, -0.2), off: underGuard(0.02, -0.46, 0.075) },
  // Граната в кулаке: ладонь влево-вверх, пальцы обхватывают её сбоку, запал торчит сверху
  grenade: { main: { at: v(0, -0.01, -0.1), finger: v(0, 0.3, -1), palm: v(-0.7, 0.7, 0), r: 0.045, fist: true }, off: null },
  // Нож: рукоять в кулаке, клинок вперёд
  knife: { main: { at: v(0, 0, 0.0), finger: v(0, 0.7, -0.7), palm: v(-1, 0, 0), r: 0.02, fist: true }, off: null },
};
/** Вторая рука держит магазин (или патрон) снизу, снимает прицел сверху */
const ON_MAG: Hold = { at: v(0, 0, 0), finger: v(0.4, 0, -1), palm: v(0, 1, 0), r: 0.045, fist: false };
const ON_SCOPE: Hold = { at: v(0, 0, 0), finger: v(0, 0, -1), palm: v(0, -1, 0), r: 0.04, fist: false };
/** Основная рука на рукоятке затвора справа */
const ON_BOLT: Hold = { at: v(0, 0, 0), finger: v(0, 0.2, -1), palm: v(-1, 0, 0), r: 0.02, fist: true };

const _qg = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qh = new THREE.Quaternion();
const _f = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3(), _cam = new THREE.Vector3(), _pole = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Поставить кисть: ориентация — из хвата (направления в системе frame), предмет — в точке at (мир).
 * Рука тянется так, чтобы в at оказалась ладонь; затем кисть поворачивается ровно в нужную сторону.
 */
function place(c: Character, side: 'Left' | 'Right', at: THREE.Vector3, h: Hold, frame: THREE.Quaternion, mirror: number, pole: THREE.Vector3): void {
  const hf = frames[side];
  if (!hf) return;
  const B = c.bones;
  const [arm, fore, hand] = side === 'Left' ? [B.LeftArm, B.LeftForeArm, B.LeftHand] : [B.RightArm, B.RightForeArm, B.RightHand];
  _f.set(h.finger.x * mirror, h.finger.y, h.finger.z).applyQuaternion(frame);
  _n.set(h.palm.x * mirror, h.palm.y, h.palm.z).applyQuaternion(frame);
  // Мировая ориентация кисти: базис хвата × обратный базис кисти
  _m.multiplyMatrices(basisOf(_f, _n), hf.basis.clone().transpose());
  _qh.setFromRotationMatrix(_m);
  // Запястье: от предмета назад на толщину предмета и ладони и на полкисти к запястью
  _w.copy(at).addScaledVector(_n.normalize(), -(h.r + PALM)).sub(hf.mid.clone().multiplyScalar(0.55).applyQuaternion(_qh));
  solveLimb(arm, fore, hand, _w, pole);
  hand.quaternion.copy(hand.parent!.getWorldQuaternion(_qp).invert().multiply(_qh));
  hand.updateMatrixWorld(true);
  for (const f of fingers[side]) f.bone.quaternion.copy(h.fist ? f.fist : f.cup);
}

const camVec = (x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 => out.set(x, y, z).applyQuaternion(_qc);

/** Кадр: руки держат оружие в его текущем положении (прицел, бег, отдача — всё уже учтено в viewModel). */
export function updateViewArms(now: number): void {
  if (!arms) { if (characterReady()) build(); if (!arms) return; }
  const c = arms;
  c.root.visible = viewModel.visible;
  if (!c.root.visible) return;
  if (c.team !== me.team) { c.team = me.team; }
  setCharacterLook(c, { vest: false, grey: me.big });
  for (const [b, q] of rest) b.quaternion.copy(q);
  camera.updateMatrixWorld(true);
  camera.getWorldQuaternion(_qc);
  camera.getWorldPosition(_cam);
  const g = viewGun;
  g.group.getWorldQuaternion(_qg);
  const side = settings.hand === 'left' ? -1 : 1;
  const mainSide = side > 0 ? 'Right' : 'Left', offSide = side > 0 ? 'Left' : 'Right';
  const hold = HOLDS[me.weapon];

  // Основная рука — на рукояти; при работе затвором уходит к нему
  let main = hold.main;
  const mainAt = g.group.localToWorld(new THREE.Vector3(main.at.x * side, main.at.y, main.at.z));
  if (g.bolt && now < state.boltUntil) {
    const p = 1 - (state.boltUntil - now) / BOLT_MS;
    const k = Math.min(1, 1.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, p))));
    if (k > 0.5) main = ON_BOLT;
    mainAt.lerp(g.bolt.children[1]!.getWorldPosition(new THREE.Vector3()), k);
  }

  // Вторая рука: на цевье; при перезарядке — на магазине (или патроне дробовика); у прицела — когда его снимают
  let off: Hold | null = hold.off;
  const offAt = new THREE.Vector3();
  let offFrame = _qg, offMirror = side;
  if (scopeHandPos) { viewModel.localToWorld(offAt.copy(scopeHandPos)); off = ON_SCOPE; }
  else if (me.reloadUntil && (g.shell?.visible || g.mag)) { (g.shell?.visible ? g.shell : g.mag!).getWorldPosition(offAt); off = ON_MAG; }
  else if (off) g.group.localToWorld(offAt.set(off.at.x * side, off.at.y, off.at.z));
  // Бросок свободной рукой (нож на G со стволом в руках): рука идёт из-за плеча вперёд и вверх, ладонью вперёд
  const toss = offhandThrow(now);
  if (toss >= 0) {
    const fwd = Math.sin(Math.PI * Math.min(1, toss * 1.15));
    camVec(-0.28 * side, -0.25 + 0.2 * fwd, 0.05 - 0.75 * fwd, offAt).add(_cam);
    off = { at: v(0, 0, 0), finger: v(0, 1, -0.3), palm: v(0, 0, -1), r: 0.03, fist: true };
    offFrame = _qc;
  } else if (!off) {
    // Свободная рука опущена у пояса, вне кадра
    camVec(-0.3 * side, -0.62, -0.18, offAt).add(_cam);
    off = { at: v(0, 0, 0), finger: v(0, -0.3, -1), palm: v(1, 0, 0), r: 0.03, fist: false };
    offFrame = _qc; offMirror = side;
  }

  // Локти — вниз и наружу
  place(c, mainSide, mainAt, main, _qg, side, camVec(0.7 * side, -1, 0.25, _pole));
  place(c, offSide, offAt, off, offFrame, offMirror, camVec(-0.7 * side, -1, offFrame === _qc ? 0.6 : 0.25, new THREE.Vector3()));
}

/** Для отладки и тестов */
export const viewArmsReady = (): boolean => arms !== null;

/** Для тестов: где ладони относительно точек хвата (м) — 0, если рука держит предмет там, где надо. */
export function viewArmsDebug(): { main: number; off: number } | null {
  if (!arms) return null;
  const side = settings.hand === 'left' ? -1 : 1;
  const hold = HOLDS[me.weapon];
  const B = arms.bones;
  const palmAt = (s: 'Left' | 'Right', h: Hold): THREE.Vector3 => {
    const hand = s === 'Left' ? B.LeftHand : B.RightHand, hf = frames[s]!;
    const q = hand.getWorldQuaternion(new THREE.Quaternion());
    return hand.getWorldPosition(new THREE.Vector3()).add(hf.mid.clone().multiplyScalar(0.55).applyQuaternion(q))
      .addScaledVector(hf.palm.clone().applyQuaternion(q), h.r + PALM);
  };
  const want = (h: Hold): THREE.Vector3 => viewGun.group.localToWorld(new THREE.Vector3(h.at.x * side, h.at.y, h.at.z));
  const ms = side > 0 ? 'Right' : 'Left', os = side > 0 ? 'Left' : 'Right';
  return {
    main: +palmAt(ms, hold.main).distanceTo(want(hold.main)).toFixed(3),
    off: hold.off ? +palmAt(os, hold.off).distanceTo(want(hold.off)).toFixed(3) : 0,
  };
}
