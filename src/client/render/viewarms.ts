// Руки от первого лица: руки той же модели со скелетом держат оружие, перезаряжают, снимают прицел,
// передёргивают затвор и бросают гранаты. Остальное тело от первого лица не рисуется.
import * as THREE from 'three';
import { camera } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { BOLT_MS, scopeHandPos, viewGun, viewModel } from '../weapons/viewmodel.js';
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
  camera.add(c.root);
  const B = c.bones;
  rest = [B.LeftArm, B.LeftForeArm, B.LeftHand, B.RightArm, B.RightForeArm, B.RightHand].map((b) => [b, b.quaternion.clone()]);
  // Пальцы согнуты в хват: каждая фаланга поворачивается к ладони
  for (const b of c.allBones) {
    const m = /^mixamorig:?(Left|Right)Hand(Index|Middle|Ring|Pinky)([123])$/.exec(b.name);
    if (m) b.rotation.z += (m[1] === 'Left' ? -1 : 1) * (m[3] === '1' ? 1.1 : 0.9);
  }
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

  const main = side > 0 ? [B.RightArm, B.RightForeArm, B.RightHand] as const : [B.LeftArm, B.LeftForeArm, B.LeftHand] as const;
  const off = side > 0 ? [B.LeftArm, B.LeftForeArm, B.LeftHand] as const : [B.RightArm, B.RightForeArm, B.RightHand] as const;
  // Локти — вниз и наружу
  solveLimb(main[0], main[1], main[2], _r, camVec(0.7 * side, -1, 0.25, _pole));
  solveLimb(off[0], off[1], off[2], _l, camVec(-0.7 * side, -1, free ? 0.6 : 0.25, _pole));
}

/** Для отладки и тестов */
export const viewArmsReady = (): boolean => arms !== null;
