// Чужие игроки: модели, пиксельные лица (злее с каждым убийством), шлем Джаггернаута, корона лидера.
import * as THREE from 'three';
import { PLAYER, STREAK } from '../../shared/map.js';
import type { PlayerInfo, WeaponId } from '../../shared/protocol.js';
import { box, scene } from '../core/scene.js';
import { state } from '../core/state.js';
import { TEAM_COLOR } from '../core/util.js';
import { buildGun, type Gun, nameSprite } from './models.js';

/** Корона лидера — тоже из кубиков: обод и зубцы. */

/** Сколько убийств в матче нужно для каждой ступени: от спокойного лица к свирепому. */
export const FACE_STEPS = [0, 2, 5, 9, 14];

export const faceLevel = (kills: number): number => FACE_STEPS.filter((k) => kills >= k).length - 1;

const faceCache: THREE.CanvasTexture[] = [];

export const faceUrl: string[] = [];

/**
 * Лицо 16×10 «пикселей»: глаза, брови и рот. Чем выше ступень — тем ниже и круче брови,
 * уже глаза, а рот из ровной черты превращается в оскал; на последней ступени глаза красные.
 */
function drawFace(level: number): HTMLCanvasElement {
  const P = 8, W = 16, H = 10;
  const c = document.createElement('canvas');
  c.width = W * P; c.height = H * P;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, color: string, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(x * P, y * P, w * P, h * P); };
  const INK = '#141414', WHITE = '#f4f4f4', TEETH = '#f0ead6';
  const pupil = level >= 4 ? '#e01b1b' : INK;
  // Глаза: у спокойного — открытые 3×3, дальше всё уже
  const eyeH = level >= 3 ? 1 : level >= 1 ? 2 : 3;
  const eyeY = 4 - Math.floor(eyeH / 2);
  for (const ex of [3, 10]) {
    px(ex, eyeY, WHITE, 3, eyeH);
    px(ex + 1, eyeY + Math.floor(eyeH / 2), pupil);
  }
  // Брови: ровные → наклонённые к переносице, всё ниже и толще
  for (let i = 0; i < 4; i++) {
    const tilt = Math.min(level, 3) * 0.4 * i;
    const yl = Math.round(1 + (level >= 2 ? 1 : 0) + tilt * 0.5);
    px(2 + i, Math.min(yl, eyeY - 1), INK, 1, level >= 3 ? 2 : 1);   // левая: внутренний край (правее) ниже
    px(13 - i, Math.min(yl, eyeY - 1), INK, 1, level >= 3 ? 2 : 1);  // правая — зеркально
  }
  // Рот
  if (level === 0) px(5, 8, INK, 6, 1);                                       // ровная черта
  else if (level === 1) { px(5, 8, INK, 6, 1); px(4, 9, INK); px(11, 9, INK); } // уголки вниз
  else if (level === 2) { px(5, 7, INK, 6, 1); px(5, 8, TEETH, 6, 1); px(5, 9, INK, 6, 1); } // сжатые зубы
  else {
    // Оскал: широкий рот с зубами, на последней ступени — раскрытый крик
    const w = level >= 4 ? 10 : 8, x0 = 8 - w / 2;
    px(x0, 7, INK, w, 1);
    px(x0, 8, TEETH, w, level >= 4 ? 1 : 1);
    for (let x = x0 + 1; x < x0 + w; x += 2) px(x, 8, INK);
    px(x0, 9, INK, w, 1);
  }
  return c;
}

export function faceTexture(level: number): THREE.CanvasTexture {
  if (!faceCache[level]) {
    const canvasEl = drawFace(level);
    const t = new THREE.CanvasTexture(canvasEl);
    t.magFilter = THREE.NearestFilter; // чёткие пиксели
    t.minFilter = THREE.NearestFilter;
    faceCache[level] = t;
    faceUrl[level] = canvasEl.toDataURL();
  }
  return faceCache[level];
}

/**
 * Шлем Джаггернаута: тёмный металлический колпак на голову с наушниками по бокам
 * и козырьком; лицо под ним остаётся видно.
 */
function buildHelmet(): THREE.Group {
  const g = new THREE.Group();
  const METAL = 0x3a3f45, EDGE = 0x22262b;
  const top = box(PLAYER.w + 0.1, 0.16, PLAYER.w + 0.1, METAL);
  top.position.y = PLAYER.h + 0.03;
  const back = box(PLAYER.w + 0.1, 0.34, 0.08, METAL);
  back.position.set(0, PLAYER.h - 0.13, PLAYER.w / 2 + 0.01);
  const brim = box(PLAYER.w + 0.14, 0.05, 0.14, EDGE);
  brim.position.set(0, PLAYER.h - 0.06, -PLAYER.w / 2 - 0.05);
  g.add(top, back, brim);
  for (const side of [-1, 1]) {
    const ear = box(0.08, 0.34, PLAYER.w + 0.06, METAL);
    ear.position.set(side * (PLAYER.w / 2 + 0.01), PLAYER.h - 0.13, 0);
    g.add(ear);
  }
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
      if (flying.position.y < floorY - PLAYER.h) { flying.position.y = floorY - PLAYER.h; vel.set(0, 0, 0); }
    } else {
      flying.position.y -= 0.02; // лежит и уходит под землю
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function buildCrown(): THREE.Group {
  const GOLD = 0xffc928;
  const g = new THREE.Group();
  const band = box(0.52, 0.1, 0.52, GOLD);
  band.position.y = 0.05;
  g.add(band);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, -0.2], [0, 0.2], [-0.2, 0], [0.2, 0]] as const) {
    const prong = box(0.1, 0.16, 0.1, GOLD);
    prong.position.set(x, 0.18, z);
    g.add(prong);
  }
  g.position.y = PLAYER.h;
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
  /** Тело, визор, рука и корона — всё, что ложится при подкате */
  pose: THREE.Group;
  slide: boolean;
  /** 0 — стоит, 1 — лежит */
  poseK: number;
  labelY: number;
  crown: THREE.Group;
  face: THREE.Mesh;
  faceLevel: number;
  /** Бронежилет: закрывает корпус, голова и ноги видны */
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
  yaw: number;
  targetYaw: number;
  pitch: number;
  flashUntil: number;
}

function remoteGun(w: WeaponId): Gun {
  const gun = buildGun(w);
  gun.group.scale.setScalar(1.4);
  return gun;
}

// Игрок — одинаковый прямоугольник цвета команды
export function buildPlayer(info: PlayerInfo): Remote {
  const g = new THREE.Group();
  const pose = new THREE.Group();
  g.add(pose);
  const body = box(PLAYER.w, PLAYER.h, PLAYER.w, TEAM_COLOR[info.team]);
  body.position.y = PLAYER.h / 2;
  pose.add(body);
  // Пиксельное лицо спереди: показывает, куда смотрит игрок, и злеет с каждым убийством
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PLAYER.w * 0.9, 0.42),
    new THREE.MeshLambertMaterial({ map: faceTexture(0), transparent: true }),
  );
  face.position.set(0, PLAYER.eye - 0.05, -PLAYER.w / 2 - 0.005);
  face.rotation.y = Math.PI;
  pose.add(face);
  const hand = new THREE.Group();
  hand.position.set(PLAYER.w / 2 + 0.06, 1.25, -0.25);
  pose.add(hand);
  const label = nameSprite(info.name, info.team);
  label.position.y = PLAYER.h + 0.35;
  g.add(label);
  const crown = buildCrown();
  pose.add(crown);
  const armor = box(PLAYER.w + 0.14, 0.8, PLAYER.w + 0.14, 0x4b5320);
  armor.position.y = 0.55 + 0.4; // от бёдер (0.55) до плеч (1.35)
  armor.visible = false;
  pose.add(armor);
  const helmet = buildHelmet();
  pose.add(helmet);
  scene.add(g);
  const gun = remoteGun('pistol');
  hand.add(gun.group);
  return {
    info, g, pose, slide: false, poseK: 0, labelY: PLAYER.h + 0.35, crown, face, faceLevel: 0, armor, helmet, label, hand, gun, w: 'pistol',
    stepAcc: 0, lastPos: new THREE.Vector3(),
    pos: new THREE.Vector3(), target: new THREE.Vector3(),
    yaw: 0, targetYaw: 0, pitch: 0, flashUntil: 0,
  };
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
