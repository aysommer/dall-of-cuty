// Руки от первого лица: руки той же модели со скелетом держат оружие, перезаряжают, снимают прицел,
// передёргивают затвор и бросают гранаты. Остальное тело от первого лица не рисуется.
import * as THREE from 'three';
import { camera } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { BOLT_MS, offhandThrow, scopeHandPos, viewGun, viewModel } from '../weapons/viewmodel.js';
import { type Character, characterReady, createCharacter, setCharacterLook, solveLimb } from './character.js';
import { grips } from './players.js';

let arms: Character | null = null;
/** Поза покоя рук (до обратной кинематики) — к ней кости возвращаются каждый кадр, чтобы не накапливалось скручивание */
let rest: Array<[THREE.Bone, THREE.Quaternion]> = [];

/**
 * Руки от первого лица чуть крупнее настоящих и вынесены вперёд — как принято в шутерах: оружие в кадре
 * держится дальше, чем достаёт настоящая рука. Плечи оказываются чуть ниже и впереди глаз.
 */
const ARM_SCALE = 1.3;
const ROOT = new THREE.Vector3(0, -1.44 * ARM_SCALE - 0.13, -0.08);

function build(): void {
  const c = createCharacter(me.team, { armsOnly: true });
  if (!c) return;
  c.mixer.stopAllAction(); // руками управляет только код
  c.root.position.copy(ROOT);
  c.root.scale.setScalar(ARM_SCALE);
  const B = c.bones;
  // Пальцы согнуты в хват: каждая фаланга доворачивается в сторону ладони вокруг оси, перпендикулярной пальцу.
  // Где у кисти ладонь, определяется по ней самой: нормаль к плоскости оснований пальцев, с той стороны, где большой палец.
  c.root.updateMatrixWorld(true);
  const bone = (name: string): THREE.Bone | undefined => c.allBones.find((x) => x.name.replace(/^mixamorig:?/, '') === name);
  const curl = (b: THREE.Bone, child: THREE.Object3D, toward: THREE.Vector3, angle: number): void => {
    const dir = child.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, toward);
    if (axis.lengthSq() < 1e-6) return;
    const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle));
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    b.updateMatrixWorld(true);
  };
  for (const side of ['Left', 'Right']) {
    const hand = bone(`${side}Hand`), index = bone(`${side}HandIndex1`), pinky = bone(`${side}HandPinky1`), thumb = bone(`${side}HandThumb1`);
    if (!hand || !index || !pinky || !thumb) continue;
    const at = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3()));
    const palm = new THREE.Vector3().crossVectors(at(index), at(pinky)).normalize();
    if (at(thumb).dot(palm) < 0) palm.negate();
    for (const [finger, angles] of [['Index', [0.9, 1.2, 0.8]], ['Middle', [1.0, 1.25, 0.8]], ['Ring', [1.05, 1.25, 0.8]], ['Pinky', [1.1, 1.2, 0.8]], ['Thumb', [0.3, 0.4, 0.3]]] as const) {
      for (let i = 1; i <= 3; i++) {
        const b = bone(`${side}Hand${finger}${i}`), child = bone(`${side}Hand${finger}${i + 1}`);
        if (b && child) curl(b, child, palm, angles[i - 1]!);
      }
    }
  }
  // Поза покоя рук запоминается уже с согнутыми пальцами
  rest = [B.LeftArm, B.LeftForeArm, B.LeftHand, B.RightArm, B.RightForeArm, B.RightHand].map((b) => [b, b.quaternion.clone()]);
  camera.add(c.root);
  arms = c;
}

const _r = new THREE.Vector3(), _l = new THREE.Vector3(), _pole = new THREE.Vector3(), _q = new THREE.Quaternion();
const camVec = (x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(x, y, z).applyQuaternion(camera.getWorldQuaternion(_q));

/** Кадр: руки тянутся к оружию в его текущем положении (прицел, бег, отдача — всё уже учтено в viewModel). */
export function updateViewArms(now: number): void {
  if (!arms) { if (characterReady()) build(); if (!arms) return; }
  const c = arms;
  c.root.visible = viewModel.visible;
  if (!c.root.visible) return;
  if (c.team !== me.team) { c.team = me.team; }
  setCharacterLook(c, { vest: false, grey: me.big });
  for (const [b, q] of rest) b.quaternion.copy(q);
  camera.updateMatrixWorld(true);
  const B = c.bones;
  const g = viewGun, grip = grips(me.weapon);
  const side = settings.hand === 'left' ? -1 : 1;

  // Основная рука — на рукояти (с какой стороны оружие, та и основная); при работе затвором уходит к нему
  g.group.localToWorld(_r.copy(grip.right));
  if (g.bolt && now < state.boltUntil) {
    const p = 1 - (state.boltUntil - now) / BOLT_MS;
    const k = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
    _r.lerp(g.bolt.getWorldPosition(_l), Math.min(1, k * 1.6));
  }
  // Вторая рука: на цевье; при перезарядке — на магазине (или патроне дробовика); у прицела — когда его снимают
  let free = false;
  if (scopeHandPos) viewModel.localToWorld(_l.copy(scopeHandPos));
  else if (me.reloadUntil && (g.shell?.visible || g.mag)) (g.shell?.visible ? g.shell : g.mag!).getWorldPosition(_l);
  else if (grip.left) g.group.localToWorld(_l.copy(grip.left));
  else { free = true; camVec(-0.3 * side, -0.62, -0.18, _l).add(camera.getWorldPosition(new THREE.Vector3())); }
  // Бросок свободной рукой (нож на G со стволом в руках): рука идёт из-за плеча вперёд и вверх
  const toss = offhandThrow(now);
  if (toss >= 0) {
    const fwd = Math.sin(Math.PI * Math.min(1, toss * 1.15));
    camVec(-0.28 * side, -0.25 + 0.2 * fwd, 0.05 - 0.75 * fwd, _l).add(camera.getWorldPosition(new THREE.Vector3()));
    free = true;
  }

  const main = side > 0 ? [B.RightArm, B.RightForeArm, B.RightHand] as const : [B.LeftArm, B.LeftForeArm, B.LeftHand] as const;
  const off = side > 0 ? [B.LeftArm, B.LeftForeArm, B.LeftHand] as const : [B.RightArm, B.RightForeArm, B.RightHand] as const;
  // Локти — вниз и наружу
  solveLimb(main[0], main[1], main[2], _r, camVec(0.7 * side, -1, 0.25, _pole));
  solveLimb(off[0], off[1], off[2], _l, camVec(-0.7 * side, -1, free ? 0.6 : 0.25, _pole));
  // Кисти довёрнуты вокруг предплечья так, чтобы ладонь смотрела на предмет: основная обхватывает рукоять
  // (или гранату, нож), вторая ложится под цевьё или на магазин
  twist(main[2], main[1], TWIST_MAIN * side);
  // У пистолета вторая кисть тоже обхватывает рукоять — поверх основной, а не ложится ладонью под цевьё
  twist(off[2], off[1], (free || me.weapon === 'pistol' ? TWIST_MAIN : TWIST_OFF) * -side);
}

const TWIST_MAIN = -Math.PI / 2, TWIST_OFF = -0.6;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qt = new THREE.Quaternion();
/** Повернуть кисть вокруг оси предплечья на angle радиан. */
function twist(hand: THREE.Bone, forearm: THREE.Bone, angle: number): void {
  hand.getWorldPosition(_a).sub(forearm.getWorldPosition(_b));
  if (_a.lengthSq() < 1e-8) return;
  hand.getWorldQuaternion(_qw).premultiply(_qt.setFromAxisAngle(_a.normalize(), angle));
  hand.quaternion.copy(hand.parent!.getWorldQuaternion(_qp).invert().multiply(_qw));
  hand.updateMatrixWorld(true);
}

/** Для отладки и тестов */
export const viewArmsReady = (): boolean => arms !== null;
