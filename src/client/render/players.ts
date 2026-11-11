// Чужие игроки: человекоподобная модель (или прямоугольник, пока она грузится), оружие в руках,
// шлем Джаггернаута, бронежилет и корона лидера.
import * as THREE from 'three';
import { PLAYER, STREAK } from '../../shared/map.js';
import type { PlayerInfo, WeaponId } from '../../shared/protocol.js';
import { box, scene } from '../core/scene.js';
import { state } from '../core/state.js';
import { TEAM_COLOR } from '../core/util.js';
import { type Character, characterReady, createCharacter, setCharacterLook, updateCharacter } from './character.js';
import { buildGun, type Gun, nameSprite } from './models.js';

/** Высота центра головы модели над землёй, м */
const HEAD_Y = 1.66;

/**
 * Шлем Джаггернаута: округлый стальной купол с назатыльником и козырьком.
 * Собран вокруг центра головы: (0, 0, 0) — середина головы, козырёк смотрит на −Z.
 */
function buildHelmet(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x4a4f56 }), dark = new THREE.MeshLambertMaterial({ color: 0x24282d });
  // Купол — верхняя половина сферы, чуть вытянутая назад
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), steel);
  dome.scale.set(1, 1.05, 1.12);
  dome.position.set(0, 0.03, 0.01);
  // Назатыльник и уши — пояс сферы ниже купола, открытый спереди (лицо свободно)
  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.157, 20, 6, Math.PI * 0.25, Math.PI * 1.5, Math.PI * 0.5, Math.PI * 0.28), steel);
  neck.scale.set(1, 1.05, 1.12);
  neck.position.copy(dome.position);
  neck.rotation.y = Math.PI / 2 + Math.PI; // разрез — к лицу (−Z)
  steel.side = THREE.DoubleSide;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.022, 20, 1, false, Math.PI * 0.72, Math.PI * 0.56), dark);
  brim.scale.set(1, 1, 1.25);
  brim.position.set(0, 0.035, -0.02);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.156, 0.012, 6, 24), dark);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1.12, 1);
  band.position.set(0, 0.035, 0.01);
  g.add(dome, neck, brim, band);
  g.visible = false;
  return g;
}

/** Сбитый шлем: копия слетает с головы, кувыркаясь, и уходит под землю. */
export function dropHelmet(r: Remote): void {
  r.helmet.updateWorldMatrix(true, true);
  const flying = buildHelmet();
  flying.visible = true;
  r.helmet.getWorldPosition(flying.position);
  flying.scale.copy(r.g.scale);
  flying.rotation.y = r.yaw;
  scene.add(flying);
  const vel = new THREE.Vector3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3);
  const born = performance.now();
  const floorY = r.pos.y;
  const tick = (): void => {
    const age = (performance.now() - born) / 1000;
    if (age > 3) { scene.remove(flying); return; }
    if (age < 1.2) {
      vel.y -= 14 * (1 / 60);
      flying.position.addScaledVector(vel, 1 / 60);
      flying.rotation.x += 0.2;
      if (flying.position.y < floorY + 0.1) { flying.position.y = floorY + 0.1; vel.set(0, 0, 0); }
    } else {
      flying.position.y -= 0.02; // лежит и уходит под землю
    }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Корона лидера — тоже из кубиков: обод и зубцы. Основание — в (0, 0, 0). */
function buildCrown(): THREE.Group {
  const GOLD = 0xffc928;
  const g = new THREE.Group();
  const band = box(0.28, 0.06, 0.28, GOLD);
  band.position.y = 0.03;
  g.add(band);
  for (const [x, z] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11], [0, -0.11], [0, 0.11], [-0.11, 0], [0.11, 0]] as const) {
    const prong = box(0.06, 0.09, 0.06, GOLD);
    prong.position.set(x, 0.1, z);
    g.add(prong);
  }
  g.visible = false;
  return g;
}

/** Лидер — единственный игрок с наибольшим числом убийств. При ничьей лидера нет. */
export function leaderId(): number | null {
  let best: PlayerInfo | null = null, tie = false;
  for (const p of state.roster) {
    if (!best || p.kills > best.kills) { best = p; tie = false; }
    else if (p.kills === best.kills) tie = true;
  }
  return best && !tie && best.kills > 0 ? best.id : null;
}

export interface Remote {
  info: PlayerInfo;
  g: THREE.Group;
  /** Тело, рука с оружием и всё надетое — то, что ложится при подкате */
  pose: THREE.Group;
  /** Модель со скелетом; null — пока модель не загрузилась (тогда виден прямоугольник body) */
  char: Character | null;
  body: THREE.Mesh;
  slide: boolean;
  /** 0 — стоит, 1 — лежит */
  poseK: number;
  labelY: number;
  crown: THREE.Group;
  /** Бронежилет на прямоугольнике (пока нет модели); у модели жилет свой — чёрное утолщённое туловище */
  armor: THREE.Mesh;
  /** Шлем Джаггернаута */
  helmet: THREE.Group;
  label: THREE.Sprite;
  /** Для звука шагов: пройденный путь с прошлого шага */
  stepAcc: number;
  lastPos: THREE.Vector3;
  hand: THREE.Group;
  gun: Gun;
  w: WeaponId;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Скорость по сглаженному положению — для анимации шага и для тела после смерти */
  vel: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  pitch: number;
  /** С сервера: в воздухе, перезаряжается */
  air: boolean;
  reloading: boolean;
  flashUntil: number;
}

function remoteGun(w: WeaponId): Gun {
  const gun = buildGun(w);
  gun.group.scale.setScalar(1.15);
  return gun;
}

/** Где на оружии руки (в координатах оружия): правая на рукояти, левая на цевье; null — рука свободна. */
function grips(w: WeaponId): { right: THREE.Vector3; left: THREE.Vector3 | null } {
  if (w === 'knife' || w === 'grenade') return { right: new THREE.Vector3(0, -0.04, 0), left: null };
  if (w === 'pistol') return { right: new THREE.Vector3(0, -0.1, -0.02), left: new THREE.Vector3(-0.03, -0.12, -0.03) };
  if (w === 'rocket') return { right: new THREE.Vector3(0, -0.1, -0.05), left: new THREE.Vector3(0, -0.08, -0.4) };
  return { right: new THREE.Vector3(0, -0.1, 0), left: new THREE.Vector3(0, -0.07, -0.38) };
}

export function buildPlayer(info: PlayerInfo): Remote {
  const g = new THREE.Group();
  const pose = new THREE.Group();
  g.add(pose);
  // Прямоугольник цвета команды — пока модель грузится (или если она не загрузилась)
  const body = box(0.45, PLAYER.h, 0.3, TEAM_COLOR[info.team]);
  body.position.y = PLAYER.h / 2;
  pose.add(body);
  // Оружие — у правого плеча, стволом вперёд; руки модели тянутся к нему сами
  const hand = new THREE.Group();
  hand.position.set(0.15, 1.38, -0.24);
  pose.add(hand);
  const label = nameSprite(info.name, info.team);
  label.position.y = PLAYER.h + 0.35;
  g.add(label);
  const crown = buildCrown();
  crown.position.y = HEAD_Y + 0.14;
  pose.add(crown);
  const armor = box(0.47, 0.5, 0.32, 0x16181b);
  armor.position.y = 1.2; // от пояса до плеч
  armor.visible = false;
  pose.add(armor);
  const helmet = buildHelmet();
  helmet.position.y = HEAD_Y;
  pose.add(helmet);
  scene.add(g);
  const gun = remoteGun('pistol');
  hand.add(gun.group);
  const r: Remote = {
    info, g, pose, char: null, body, slide: false, poseK: 0, labelY: PLAYER.h + 0.35, crown, armor, helmet, label, hand, gun, w: 'pistol',
    stepAcc: 0, lastPos: new THREE.Vector3(),
    pos: new THREE.Vector3(), target: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, targetYaw: 0, pitch: 0, air: false, reloading: false, flashUntil: 0,
  };
  attachCharacter(r);
  return r;
}

/** Ставит модель вместо прямоугольника (как только она загрузилась); шлем и корона садятся на голову, жилет — на корпус. */
function attachCharacter(r: Remote): void {
  if (r.char || !characterReady()) return;
  const c = createCharacter(r.info.team);
  if (!c) return;
  r.char = c;
  r.pose.add(c.root);
  r.body.visible = false;
  // Кости модели в сантиметрах и развёрнуты на пол-оборота — возвращаем надетому метры и взгляд на −Z
  const wear = (o: THREE.Object3D, bone: THREE.Bone, y: number): void => {
    bone.add(o);
    o.scale.setScalar(100);
    o.rotation.y = Math.PI;
    o.position.set(0, y * 100, 0);
  };
  wear(r.helmet, c.bones.Head, 0.08);
  r.armor.visible = false;
  applyLook(r);
  placeCrown(r);
}

/** Броня, шлем и цвет по сведениям с сервера: жилет — чёрное туловище, Джаггернаут — весь серый и в шлеме. */
export function applyLook(r: Remote): void {
  const p = r.info;
  r.helmet.visible = p.helmet > 0;
  if (r.char) setCharacterLook(r.char, { vest: p.armor > 0 && !p.big, grey: p.big });
  else r.armor.visible = p.armor > 0;
}

/** Корона — на макушке, а если надет шлем — поверх него. */
export function placeCrown(r: Remote): void {
  const lift = r.info.helmet > 0 ? 0.09 : 0;
  if (r.char) {
    if (r.crown.parent !== r.char.bones.Head) {
      r.char.bones.Head.add(r.crown);
      r.crown.scale.setScalar(100);
      r.crown.rotation.y = Math.PI;
    }
    r.crown.position.set(0, (0.2 + lift) * 100, 0);
  } else r.crown.position.y = HEAD_Y + 0.14 + lift;
}

export function setRemoteWeapon(r: Remote, w: WeaponId): void {
  if (r.w === w) return;
  r.hand.remove(r.gun.group);
  r.gun = remoteGun(w);
  r.hand.add(r.gun.group);
  r.w = w;
}

export function scaleOfRemote(r: Remote): number {
  return r.info.big ? STREAK.bigScale : 1;
}

const _prev = new THREE.Vector3(), _rh = new THREE.Vector3(), _lh = new THREE.Vector3();

/** Кадр чужого игрока: сглаженное движение, подкат и анимация модели. k — доля сглаживания за кадр. */
export function updateRemote(r: Remote, dt: number, now: number, k: number): void {
  _prev.copy(r.pos);
  r.pos.lerp(r.target, k);
  if (dt > 0) {
    _prev.subVectors(r.pos, _prev).divideScalar(dt);
    // Быстрее 12 м/с игроки не двигаются: больше — это рывок из-за задержки сети или редких кадров
    r.vel.lerp(_prev.clampLength(0, 12), Math.min(1, dt * 12));
  }
  const dy = r.targetYaw - r.yaw;
  r.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
  r.g.position.copy(r.pos);
  r.g.rotation.y = r.yaw;
  r.hand.rotation.x = r.pitch;
  r.gun.flash.visible = now < r.flashUntil;
  // Подкат: тело ложится вдоль взгляда и встаёт обратно
  r.poseK += ((r.slide ? 1 : 0) - r.poseK) * Math.min(1, dt * 12);
  r.pose.rotation.x = (-Math.PI / 2) * r.poseK;
  r.pose.position.set(0, 0.2 * r.poseK, (PLAYER.h / 2) * r.poseK);
  r.label.position.y = r.labelY + (1.4 - r.labelY) * r.poseK;

  attachCharacter(r);
  if (!r.char || !r.g.visible) return;
  r.g.updateMatrixWorld(true);
  const grip = grips(r.w);
  const speed = Math.hypot(r.vel.x, r.vel.z);
  // Вперёд или назад идёт игрок относительно взгляда (взгляд — на (−sin yaw, −cos yaw))
  const forward = speed > 0.2 ? (-Math.sin(r.yaw) * r.vel.x - Math.cos(r.yaw) * r.vel.z) / speed : 1;
  updateCharacter(r.char, dt, {
    speed: r.slide ? 0 : speed, forward, air: r.air && !r.slide, reloading: r.reloading,
    rightHand: r.gun.group.localToWorld(_rh.copy(grip.right)),
    leftHand: grip.left ? r.gun.group.localToWorld(_lh.copy(grip.left)) : null,
    pitch: r.pitch,
  });
}
