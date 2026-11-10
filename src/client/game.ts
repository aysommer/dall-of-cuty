import * as THREE from 'three';
import {
  CRATE, HEAD, HIP_SPREAD, MAPS, MAP_ORDER, MEDKIT, ROCKET, SLIDE, WEAPONS, WEAPON_ORDER, PLAYER, playerBox, rayBox, rayWorld,
  type Box, type GameMap, type Ladder, type MapId,
} from '../shared/map.js';
import { EMOJIS, SPRAY } from '../shared/emoji.js';
import {
  KILLS_PER_POINT, STATS, UPGRADES, maxLevel, multiplier, newProfile, pointsLeft, type Profile,
} from '../shared/progress.js';
import type {
  BoomMsg, CrateMsg, CrateState, MedkitsMsg, RocketMsg, SprayMsg,
  ClientMsg, InfoMsg, KillMsg, Mode, OverMsg, PlayerInfo, PlayersMsg, ProfileMsg, ServerMsg,
  ShotMsg, SnapMsg, SpawnMsg, Team, Vec3, WeaponId,
} from '../shared/protocol.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el as T;
};
const TEAM_COLOR: Record<Team, number> = { green: 0x2fc44e, red: 0xe23b3b };
const SPEED = 6.5, JUMP = 7, GRAVITY = 19, CLIMB = 4;
const MOUSE_SENS = 0.0022;
const BASE_FOV = 75;

// ======================= настройки =======================
interface Settings {
  /** Громкость, 0…1 */
  volume: number;
  /** Множитель чувствительности мыши */
  sens: number;
  hand: 'right' | 'left';
}
const SETTINGS_KEY = 'doc-settings';
const TOKEN_KEY = 'doc-progress';

function loadSettings(): Settings {
  const s: Settings = { volume: 0.7, sens: 1, hand: 'right' };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    if (typeof raw.volume === 'number') s.volume = Math.max(0, Math.min(1, raw.volume));
    if (typeof raw.sens === 'number') s.sens = Math.max(0.2, Math.min(3, raw.sens));
    if (raw.hand === 'left') s.hand = 'left';
  } catch { /* испорченные настройки — берём стандартные */ }
  return s;
}
const settings = loadSettings();

// Прокачка: данные приходят с сервера, в браузере лежит только зашифрованный токен
let profile: Profile = newProfile();

// ======================= сцена =======================
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const sky = new THREE.Color(0x9fc9ea);
const fog = new THREE.Fog(0x9fc9ea, 50, 130);
scene.background = sky;
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 40, 10);
scene.add(sun);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, lit = true): THREE.Mesh {
  const material = lit ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

// ======================= карта =======================
let currentMap: GameMap = MAPS.sands;
let loadedMap: MapId | null = null;
const mapGroup = new THREE.Group();
scene.add(mapGroup);

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

// ---------- ящик с ракетницей ----------
let crateState: CrateState = 'gone'; // до ответа сервера считаем, что ящика нет
let crateBy: number | null = null;
/** Куда падает или где лежит ящик */
let crateAt: Vec3 | null = null;
/** Когда ящик коснётся земли и когда исчезнет (по часам браузера) */
let crateLandAt = 0;
let crateExpiresAt = 0;
let crateMesh: THREE.Mesh | null = null;
/** Световой столб над лежащим ящиком, чтобы его было видно издалека */
let crateBeam: THREE.Mesh | null = null;
/** Когда закончится открытие, которое веду я (0 — не открываю). */
let openingUntil = 0;

/** Сторона ящика: доски, нарисованный смайлик с рожками и надпись. */
function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b07a3a';
  ctx.fillRect(0, 0, 256, 192);
  ctx.strokeStyle = '#6b4520';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 182);
  ctx.lineWidth = 3;
  for (const y of [66, 128]) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(248, y); ctx.stroke(); }

  // Смайлик: круг, рожки, хитрые брови, глаза и ухмылка
  const x = 128, y = 74, r = 46;
  ctx.fillStyle = '#7b3fc4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * 20, y - 38); ctx.lineTo(x + side * 44, y - 62); ctx.lineTo(x + side * 42, y - 22);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(x + side * 30, y - 24); ctx.lineTo(x + side * 8, y - 12); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + side * 17, y - 4, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y + 4, 28, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 34px system-ui, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Open me 😈', 128, 158);
  return new THREE.CanvasTexture(c);
}

function buildCrate(): THREE.Mesh {
  const side = new THREE.MeshLambertMaterial({ map: crateTexture() });
  const wood = new THREE.MeshLambertMaterial({ color: 0x9a6a30 });
  // Порядок граней куба: +x, -x, +y, -y, +z, -z — картинка на четырёх боковых
  return new THREE.Mesh(
    new THREE.BoxGeometry(CRATE.size, CRATE.height, CRATE.size),
    [side, side, wood, wood, side, side],
  );
}

/** Лежащий ящик твёрдый; падающий — ещё нет. */
function crateSolid(): Box | null {
  if (!crateAt || (crateState !== 'idle' && crateState !== 'opening')) return null;
  const [cx, cy, cz] = crateAt;
  const h = CRATE.size / 2;
  return { min: [cx - h, cy, cz - h], max: [cx + h, cy + CRATE.height, cz + h], color: '' };
}

function nearCrate(): boolean {
  if (!crateAt) return false;
  const [cx, cy, cz] = crateAt;
  return Math.hypot(me.pos.x - cx, me.pos.z - cz) <= CRATE.reach && Math.abs(me.pos.y - cy) <= 1.5;
}

function feedNote(text: string): void {
  const row = document.createElement('div');
  row.textContent = text;
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
}

function onCrate(m: CrateMsg): void {
  const prev = crateState;
  const now = performance.now();
  crateState = m.state;
  crateBy = m.by;
  crateAt = m.at;
  crateLandAt = m.state === 'falling' ? now + m.ms : 0;
  crateExpiresAt = m.left > 0 ? now + m.left : 0;
  openingUntil = m.state === 'opening' && m.by === me.id ? now + m.ms : 0;
  if (!joined) return;
  if (m.state === 'falling' && prev === 'gone') { feedNote('📦 С неба падает ящик'); beep(700, 0.25, 0.1); }
  if (m.state === 'gone' && prev === 'idle') feedNote('📦 Ящик исчез');
  if (m.state === 'gone' && prev === 'opening') beep(520, 0.3, 0.1);
}

/** Падение (с ускорением), столб света и мигание в последние 10 секунд. */
function updateCrate(now: number): void {
  if (!crateMesh || !crateBeam) return;
  const show = crateAt !== null && crateState !== 'gone';
  crateMesh.visible = show;
  crateBeam.visible = show && crateState !== 'falling';
  if (!show || !crateAt) return;
  const [x, y, z] = crateAt;
  let lift = 0;
  if (crateState === 'falling') {
    const left = Math.max(0, Math.min(1, (crateLandAt - now) / CRATE.fallMs));
    lift = CRATE.fallHeight * (1 - (1 - left) ** 2);
  }
  crateMesh.position.set(x, y + CRATE.height / 2 + lift, z);
  crateBeam.position.set(x, y + CRATE.height + 15, z);
  if (crateState === 'idle' && crateExpiresAt && crateExpiresAt - now < 10_000) {
    crateMesh.visible = Math.floor(now / 250) % 2 === 0;
  }
}

function loadMap(id: MapId): void {
  if (loadedMap === id) return;
  loadedMap = id;
  currentMap = MAPS[id];
  mapGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const materials = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
      for (const mat of materials) {
        (mat as THREE.MeshLambertMaterial).map?.dispose();
        mat.dispose();
      }
    }
  });
  mapGroup.clear();

  sky.set(currentMap.sky);
  fog.color.set(currentMap.sky);
  const floor = box(currentMap.half.x * 2 + 2, 1, currentMap.half.z * 2 + 2, currentMap.floor);
  floor.position.y = -0.5;
  mapGroup.add(floor);
  for (const b of currentMap.boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const m = box(w, h, d, b.color);
    m.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    mapGroup.add(m);
  }
  for (const l of currentMap.ladders) mapGroup.add(buildLadder(l));

  crateMesh = buildCrate();
  crateMesh.visible = false;
  mapGroup.add(crateMesh);
  crateBeam = box(0.3, 30, 0.3, 0xffd34d, false);
  const beamMat = crateBeam.material as THREE.MeshBasicMaterial;
  beamMat.transparent = true;
  beamMat.opacity = 0.35;
  beamMat.depthWrite = false;
  crateBeam.visible = false;
  mapGroup.add(crateBeam);
}
loadMap('sands');

// ======================= модели из кубиков =======================
interface Gun {
  group: THREE.Group;
  flash: THREE.Mesh;
  muzzleZ: number;
  /** Магазин — вынимается при перезарядке */
  mag?: THREE.Object3D;
  magY: number;
  /** Рукоять затвора снайперки */
  bolt?: THREE.Object3D;
  boltZ: number;
  /** Патрон дробовика, который вставляют при перезарядке */
  shell?: THREE.Object3D;
  /** Центр коллиматорного прицела (красная точка) в координатах оружия */
  sight?: { y: number; z: number };
  /**
   * Куда смотрит глаз при прицеливании: центр прицела (y, z в координатах оружия)
   * и на каком расстоянии от него глаз (relief, метры). Приклад при этом уходит к щеке, за пределы обзора.
   */
  aim?: { y: number; z: number; relief: number };
}

/** Коллиматорный прицел: рамка со стеклом и красная точка в центре. */
function buildRedDot(group: THREE.Group, y: number, z: number): void {
  const FRAME = 0x1a1a1a, W = 0.09, H = 0.07;
  const part = (w: number, h: number, d: number, px: number, py: number, color: number, lit = true) => {
    const m = box(w, h, d, color, lit);
    m.position.set(px, py, z);
    group.add(m);
    return m;
  };
  part(W * 0.7, 0.02, 0.07, 0, y - H / 2 - 0.012, FRAME);       // основание
  part(0.01, H, 0.012, -W / 2, y, FRAME);                       // стойки
  part(0.01, H, 0.012, W / 2, y, FRAME);
  part(W + 0.01, 0.01, 0.012, 0, y + H / 2, FRAME);             // верх
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  );
  glass.position.set(0, y, z);
  group.add(glass);
  part(0.006, 0.006, 0.002, 0, y, 0xff2020, false).position.z = z - 0.004; // красная точка
}

// Оружие смотрит стволом вдоль -Z.
function buildGun(type: WeaponId): Gun {
  const group = new THREE.Group();
  const add = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): void => {
    const m = box(w, h, d, color);
    m.position.set(x, y, z);
    group.add(m);
  };
  const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = box(w, h, d, color);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  let muzzleZ: number;
  let mag: THREE.Object3D | undefined, bolt: THREE.Object3D | undefined, shell: THREE.Object3D | undefined;
  let sight: Gun['sight'];
  let aim: Gun['aim'];
  if (type === 'pistol') {
    add(0.05, 0.07, 0.24, 0x2b2b2b, 0, 0, -0.12);
    add(0.045, 0.13, 0.06, 0x3a2a1a, 0, -0.09, -0.03);
    mag = part(0.032, 0.05, 0.045, 0x111111, 0, -0.165, -0.03); // низ магазина торчит из рукояти
    sight = { y: 0.085, z: -0.1 };
    aim = { ...sight, relief: 0.35 }; // пистолет держат на вытянутых руках
    muzzleZ = -0.26;
  } else if (type === 'shotgun') {
    add(0.06, 0.06, 0.7, 0x252525, 0, 0, -0.35);
    add(0.075, 0.06, 0.2, 0x7a4a22, 0, -0.055, -0.42);
    add(0.06, 0.1, 0.28, 0x7a4a22, 0, -0.03, 0.12);
    shell = part(0.03, 0.03, 0.07, 0xc0262b, 0, -0.12, -0.08);
    shell.visible = false;
    sight = { y: 0.08, z: -0.15 };
    aim = { ...sight, relief: 0.16 };
    muzzleZ = -0.72;
  } else if (type === 'sniper') {
    add(0.06, 0.08, 0.75, 0x2f3a2c, 0, 0, -0.25);
    add(0.03, 0.03, 0.42, 0x1c1c1c, 0, 0.01, -0.83);
    add(0.065, 0.065, 0.32, 0x111111, 0, 0.085, -0.26); // оптика
    add(0.06, 0.11, 0.26, 0x4a3a28, 0, -0.02, 0.24);
    add(0.045, 0.15, 0.06, 0x1c1c1c, 0, -0.1, -0.05);
    mag = part(0.04, 0.07, 0.09, 0x111111, 0, -0.07, -0.2);
    // Затвор: рычаг справа, его двигают после каждого выстрела
    const b = new THREE.Group();
    const lever = box(0.07, 0.018, 0.018, 0x777777);
    lever.position.x = 0.05;
    const knob = box(0.03, 0.03, 0.03, 0x555555);
    knob.position.x = 0.09;
    b.add(lever, knob);
    b.position.set(0, 0.035, 0.02);
    group.add(b);
    bolt = b;
    aim = { y: 0.085, z: -0.1, relief: 0.08 }; // глаз у окуляра оптики
    muzzleZ = -1.05;
  } else if (type === 'knife') {
    add(0.035, 0.05, 0.12, 0x1c1c1c, 0, 0, 0);
    add(0.07, 0.025, 0.02, 0x555555, 0, 0, -0.07);
    add(0.012, 0.045, 0.26, 0xd0d4da, 0, 0.005, -0.21);
    muzzleZ = -0.34;
  } else if (type === 'rocket') {
    add(0.15, 0.15, 0.9, 0x4c5a3a, 0, 0.02, -0.25);
    add(0.19, 0.19, 0.12, 0x2b2b2b, 0, 0.02, -0.7);
    add(0.19, 0.19, 0.12, 0x2b2b2b, 0, 0.02, 0.2);
    add(0.05, 0.14, 0.07, 0x2b2b2b, 0, -0.12, -0.2);
    muzzleZ = -0.78;
  } else {
    add(0.06, 0.09, 0.5, 0x30343a, 0, 0, -0.2);
    add(0.035, 0.035, 0.3, 0x1c1c1c, 0, 0.01, -0.58);
    mag = part(0.045, 0.18, 0.07, 0x1c1c1c, 0, -0.12, -0.22);
    add(0.055, 0.1, 0.24, 0x4a3a28, 0, -0.02, 0.16);
    sight = { y: 0.1, z: -0.12 };
    aim = { ...sight, relief: 0.14 };
    muzzleZ = -0.75;
  }
  if (sight) buildRedDot(group, sight.y, sight.z);
  const flash = box(0.12, 0.12, 0.12, 0xffd34d, false);
  flash.position.set(0, 0, muzzleZ - 0.05);
  flash.visible = false;
  group.add(flash);
  return { group, flash, muzzleZ, mag, magY: mag?.position.y ?? 0, bolt, boltZ: bolt?.position.z ?? 0, shell, sight, aim };
}

function muzzleWorld(gun: Gun): THREE.Vector3 {
  gun.group.updateWorldMatrix(true, false);
  return new THREE.Vector3(0, 0, gun.muzzleZ).applyMatrix4(gun.group.matrixWorld);
}

function nameSprite(text: string, team: Team): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = team === 'green' ? '#7dff96' : '#ff8a8a';
  ctx.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

/** Корона лидера — тоже из кубиков: обод и зубцы. */
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
function leaderId(): number | null {
  let best: PlayerInfo | null = null, tie = false;
  for (const p of roster) {
    if (!best || p.kills > best.kills) { best = p; tie = false; }
    else if (p.kills === best.kills) tie = true;
  }
  return best && !tie && best.kills > 0 ? best.id : null;
}

interface Remote {
  info: PlayerInfo;
  g: THREE.Group;
  /** Тело, визор, рука и корона — всё, что ложится при подкате */
  pose: THREE.Group;
  slide: boolean;
  /** 0 — стоит, 1 — лежит */
  poseK: number;
  labelY: number;
  crown: THREE.Group;
  /** Бронежилет: закрывает корпус, голова и ноги видны */
  armor: THREE.Mesh;
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
function buildPlayer(info: PlayerInfo): Remote {
  const g = new THREE.Group();
  const pose = new THREE.Group();
  g.add(pose);
  const body = box(PLAYER.w, PLAYER.h, PLAYER.w, TEAM_COLOR[info.team]);
  body.position.y = PLAYER.h / 2;
  pose.add(body);
  const visor = box(PLAYER.w * 0.8, 0.16, 0.06, 0x111111); // показывает, куда смотрит игрок
  visor.position.set(0, PLAYER.eye, -PLAYER.w / 2);
  pose.add(visor);
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
  scene.add(g);
  const gun = remoteGun('pistol');
  hand.add(gun.group);
  return {
    info, g, pose, slide: false, poseK: 0, labelY: PLAYER.h + 0.35, crown, armor, label, hand, gun, w: 'pistol',
    stepAcc: 0, lastPos: new THREE.Vector3(),
    pos: new THREE.Vector3(), target: new THREE.Vector3(),
    yaw: 0, targetYaw: 0, pitch: 0, flashUntil: 0,
  };
}
function setRemoteWeapon(r: Remote, w: WeaponId): void {
  if (r.w === w) return;
  r.hand.remove(r.gun.group);
  r.gun = remoteGun(w);
  r.hand.add(r.gun.group);
  r.w = w;
}

// ======================= состояние =======================
const me = {
  id: -1,
  team: 'green' as Team,
  alive: false,
  hp: 100,
  armor: 0,
  pos: new THREE.Vector3(0, 0, 26),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  weapon: 'pistol' as WeaponId,
  ammo: {
    pistol: WEAPONS.pistol.mag, shotgun: WEAPONS.shotgun.mag, rifle: WEAPONS.rifle.mag,
    sniper: WEAPONS.sniper.mag, knife: 0, rocket: 0,
  } as Record<WeaponId, number>,
  reloadUntil: 0,
  /** Длительность текущей перезарядки — для анимации */
  reloadMs: 1,
  nextShot: 0,
};

let mode: Mode = 'tdm';
let limit = 20;
let scores: Record<Team, number> = { green: 0, red: 0 };
let roster: PlayerInfo[] = [];
const remotes = new Map<number, Remote>();
const keys: Record<string, boolean> = {};
let mouseDown = false, firedThisPress = false, locked = false, joined = false, roundOver = false;
let respawnAt = 0;

// Подкат: до какого момента скользим, в какую сторону и с какой начальной скоростью
let slideUntil = 0, slideCooldownUntil = 0, slideSpeed = 0;
const slideDir = new THREE.Vector3();
/** Игрок лежит: идёт подкат или над головой нет места, чтобы встать */
let low = false;
let eyeH: number = PLAYER.eye;

// Прицеливание на ПКМ: aimHeld — кнопка зажата, adsK — 0 (от бедра) … 1 (в прицел)
let aimHeld = false, adsK = 0;
/** Удар ножом: когда закончится горизонтальный взмах (для анимации) */
let swingUntil = 0;
const SWING_MS = 300;
/**
 * Отдача: временный подъём камеры, который сам возвращается обратно.
 * Поэтому место попадания после выстрела снова оказывается под прицелом.
 */
let recoil = 0;

// Оружие в руках (вид от первого лица)
const viewModel = new THREE.Group();
viewModel.position.set(settings.hand === 'left' ? -0.22 : 0.22, -0.2, -0.45);
viewModel.scale.setScalar(0.7);
camera.add(viewModel);
let viewGun = buildGun('pistol');
viewModel.add(viewGun.group);
let kick = 0;

function setWeapon(w: WeaponId): void {
  if (w === 'rocket' && me.ammo.rocket <= 0) return;
  adsK = 0;
  me.weapon = w;
  me.reloadUntil = 0;
  me.nextShot = Math.max(me.nextShot, performance.now() + 250);
  viewModel.remove(viewGun.group);
  viewGun = buildGun(w);
  viewModel.add(viewGun.group);
  updateHud();
}

// ======================= звук =======================
let audio: AudioContext | null = null;
let master: GainNode | null = null;
function initAudio(): void {
  if (audio) return;
  try {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = settings.volume;
    master.connect(audio.destination);
  } catch { /* без звука */ }
}
const SOUND: Record<WeaponId | 'boom' | 'slide', { dur: number; freq: number; gain: number; high?: boolean }> = {
  pistol: { dur: 0.18, freq: 1800, gain: 0.35 },
  shotgun: { dur: 0.35, freq: 900, gain: 0.35 },
  rifle: { dur: 0.14, freq: 2600, gain: 0.35 },
  sniper: { dur: 0.5, freq: 1300, gain: 0.55 },
  knife: { dur: 0.12, freq: 2500, gain: 0.25, high: true },
  rocket: { dur: 0.35, freq: 600, gain: 0.35 },
  boom: { dur: 0.8, freq: 350, gain: 0.9 },
  slide: { dur: 0.5, freq: 1200, gain: 0.15, high: true },
};
function shotSound(w: WeaponId | 'boom' | 'slide', volume = 1): void {
  if (!audio || !master || volume <= 0.01) return;
  const snd = SOUND[w];
  const dur = snd.dur;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = snd.high ? 'highpass' : 'lowpass';
  filter.frequency.value = snd.freq;
  const gain = audio.createGain();
  gain.gain.value = snd.gain * volume;
  src.connect(filter).connect(gain).connect(master);
  src.start();
}
function beep(freq: number, dur: number, volume = 0.15): void {
  if (!audio || !master) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(audio.currentTime + dur);
}

// ======================= трассеры =======================
interface Effect {
  obj: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | THREE.Mesh;
  born: number;
  life: number;
  fade: boolean;
  /** Во сколько раз объект вырастает за время жизни (взрыв) */
  grow?: number;
}
const effects: Effect[] = [];

function addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
  const now = performance.now();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from, to]),
    new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 }),
  );
  scene.add(line);
  effects.push({ obj: line, born: now, life: 70, fade: true });
  // Искра в точке попадания
  const spark = box(0.08, 0.08, 0.08, 0xffe08a, false);
  spark.position.copy(to);
  scene.add(spark);
  effects.push({ obj: spark, born: now, life: 160, fade: false });
}
function updateEffects(now: number): void {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]!;
    const age = now - e.born;
    const material = e.obj.material as THREE.Material;
    if (age > e.life) {
      scene.remove(e.obj);
      e.obj.geometry.dispose();
      material.dispose();
      effects.splice(i, 1);
    } else {
      if (e.fade) material.opacity = 0.9 * (1 - age / e.life);
      if (e.grow) e.obj.scale.setScalar(1 + (e.grow - 1) * (age / e.life));
    }
  }
}

// ======================= ракеты =======================
interface RocketFx { mesh: THREE.Mesh; dir: THREE.Vector3; born: number }
const rocketFx = new Map<number, RocketFx>();

function onRocket(m: RocketMsg): void {
  const mesh = box(0.14, 0.14, 0.5, 0xfff0c0, false);
  const dir = new THREE.Vector3(m.d[0], m.d[1], m.d[2]);
  mesh.position.set(m.o[0], m.o[1], m.o[2]).addScaledVector(dir, 0.8);
  mesh.lookAt(mesh.position.clone().add(dir));
  scene.add(mesh);
  rocketFx.set(m.id, { mesh, dir, born: performance.now() });
  const dist = mesh.position.distanceTo(camera.position);
  shotSound('rocket', m.by === me.id ? 1 : Math.max(0, 1 - dist / 70));
}

function removeRocket(id: number): void {
  const r = rocketFx.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  r.mesh.geometry.dispose();
  (r.mesh.material as THREE.Material).dispose();
  rocketFx.delete(id);
}

function onBoom(m: BoomMsg): void {
  removeRocket(m.id);
  const now = performance.now();
  // Взрыв — растущий и гаснущий куб размером с зону поражения
  for (const [color, size, life] of [[0xff8a1f, ROCKET.radius * 2, 380], [0xfff0a0, ROCKET.radius, 260]] as const) {
    const blast = box(1, 1, 1, color, false);
    (blast.material as THREE.Material).transparent = true;
    blast.position.set(m.p[0], m.p[1], m.p[2]);
    scene.add(blast);
    effects.push({ obj: blast, born: now, life, fade: true, grow: size });
  }
  const dist = Math.hypot(m.p[0] - camera.position.x, m.p[1] - camera.position.y, m.p[2] - camera.position.z);
  shotSound('boom', Math.max(0, 1 - dist / 90));
}

function updateRockets(now: number, dt: number): void {
  for (const [id, r] of rocketFx) {
    // Сервер пришлёт точку взрыва; до тех пор ракета просто летит, а у стены замирает
    const p = r.mesh.position;
    const step = ROCKET.speed * dt;
    const d: Vec3 = [r.dir.x, r.dir.y, r.dir.z];
    if (rayWorld(currentMap.boxes, [p.x, p.y, p.z], d, step) >= step) p.addScaledVector(r.dir, step);
    if (now - r.born > ROCKET.lifeMs + 1000) removeRocket(id);
  }
}

// ======================= сеть =======================
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
function sendMsg(m: ClientMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

const playBtn = $<HTMLButtonElement>('play');

ws.addEventListener('close', () => {
  $('status').textContent = 'Соединение с сервером потеряно. Обнови страницу.';
  playBtn.disabled = true;
  if (joined) {
    document.exitPointerLock();
    $('hud').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }
});

ws.addEventListener('message', (e: MessageEvent<string>) => {
  const m = JSON.parse(e.data) as ServerMsg;
  switch (m.t) {
    case 'info': onInfo(m); break;
    case 'error': $('status').textContent = m.text; playBtn.disabled = false; break;
    case 'welcome':
      me.id = m.id;
      mode = m.mode;
      loadMap(m.map);
      joined = true;
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('pause').classList.remove('hidden');
      break;
    case 'players': onPlayers(m); break;
    case 'spawn': onSpawn(m); break;
    case 'snap': onSnap(m); break;
    case 'shot': onShot(m); break;
    case 'kill': onKill(m); break;
    case 'over': onOver(m); break;
    case 'profile': onProfile(m); break;
    case 'crate': onCrate(m); break;
    case 'rocket': onRocket(m); break;
    case 'boom': onBoom(m); break;
    case 'spray': onSpray(m); break;
    case 'medkits': onMedkits(m); break;
    case 'rockets': {
      const had = me.ammo.rocket;
      me.ammo.rocket = m.n;
      if (m.n > 0 && had === 0) { setWeapon('rocket'); beep(990, 0.3); }
      if (m.n === 0 && me.weapon === 'rocket') setWeapon('pistol');
      updateHud();
      break;
    }
    case 'reset':
      roundOver = false;
      $('center-msg').textContent = '';
      break;
  }
});

function onPlayers(m: PlayersMsg): void {
  mode = m.mode; limit = m.limit; scores = m.scores; roster = m.list;
  const seen = new Set<number>();
  for (const p of roster) {
    if (p.id === me.id) {
      if ((p.hp < me.hp || p.armor < me.armor) && p.alive) flashDamage();
      if (p.alive && me.alive) {
        if (p.armor > me.armor) { toast('🛡 Броня +100'); beep(880, 0.2, 0.1); }
        if (p.hp > me.hp) { toast(`❤ Аптечка +${p.hp - me.hp} HP`); beep(660, 0.2, 0.1); }
      }
      me.hp = p.hp;
      me.armor = p.armor;
      me.team = p.team;
      if (me.alive && !p.alive) respawnAt = performance.now() + 3000;
      me.alive = p.alive;
      continue;
    }
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) { r = buildPlayer(p); remotes.set(p.id, r); }
    r.info = p;
    r.g.visible = p.alive;
    r.armor.visible = p.armor > 0;
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { scene.remove(r.g); remotes.delete(id); }
  }
  const leader = leaderId();
  for (const [id, r] of remotes) {
    r.crown.visible = id === leader;
    r.labelY = PLAYER.h + (id === leader ? 0.7 : 0.35); // имя — над короной
  }
  $('crown-note').classList.toggle('hidden', leader !== me.id);
  updateHud();
}

function onSpawn(m: SpawnMsg): void {
  if (m.id === me.id) {
    me.pos.set(m.p[0], m.p[1], m.p[2]);
    me.vel.set(0, 0, 0);
    me.yaw = m.yaw;
    me.pitch = 0;
    me.alive = true;
    me.hp = 100;
    for (const w of WEAPON_ORDER) me.ammo[w] = WEAPONS[w].mag;
    if (me.ammo.rocket === 0 && me.weapon === 'rocket') setWeapon('pistol');
    me.reloadUntil = 0;
    low = false;
    slideUntil = 0;
    if (!roundOver) $('center-msg').textContent = '';
    updateHud();
    return;
  }
  const r = remotes.get(m.id);
  if (r) {
    r.pos.set(m.p[0], m.p[1], m.p[2]);
    r.target.copy(r.pos);
    r.yaw = r.targetYaw = m.yaw;
  }
}

function onSnap(m: SnapMsg): void {
  for (const [id, x, y, z, yaw, pitch, w, sl] of m.ps) {
    const r = remotes.get(id);
    if (!r) continue;
    r.slide = sl === 1;
    r.target.set(x, y, z);
    r.targetYaw = yaw;
    r.pitch = pitch;
    setRemoteWeapon(r, w);
  }
}

function onShot(m: ShotMsg): void {
  const r = remotes.get(m.id);
  if (!r) return;
  setRemoteWeapon(r, m.w);
  if (!WEAPONS[m.w].melee) r.flashUntil = performance.now() + 50;
  const from = muzzleWorld(r.gun);
  for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
  const dist = r.pos.distanceTo(me.pos);
  shotSound(m.w, Math.max(0, 1 - dist / 70) * 0.8);
}

function onKill(m: KillMsg): void {
  const k = roster.find((p) => p.id === m.killer);
  const v = roster.find((p) => p.id === m.victim);
  if (!v) return;
  // Тело падает и уходит под землю
  if (m.victim === me.id) spawnCorpse(me.pos, me.yaw, v.team, low);
  else {
    const r = remotes.get(m.victim);
    if (r) spawnCorpse(r.pos, r.yaw, v.team, r.slide);
  }
  if (m.w === 'crate') {
    // Ящик оказался ловушкой
    const trap = document.createElement('div');
    const name = document.createElement('span');
    name.className = 't-' + v.team;
    name.textContent = v.name;
    trap.append('💥 Ящик ▸ ', name);
    $('feed').prepend(trap);
    setTimeout(() => trap.remove(), 5000);
    if (m.victim === me.id) $('center-msg').textContent = 'Ящик взорвался!\nВозрождение через 3 сек.';
    return;
  }
  if (!k) return;
  const row = document.createElement('div');
  const span = (p: PlayerInfo): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 't-' + p.team;
    s.textContent = p.name;
    return s;
  };
  row.append(span(k), ` ▸ ${WEAPONS[m.w].name}${m.head ? ' 🎯' : ''} ▸ `, span(v));
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
  const self = m.killer === m.victim;
  if (m.killer === me.id && !self) { showHit(true); beep(880, 0.15); }
  if (m.victim === me.id) {
    $('center-msg').textContent = self
      ? 'Ты подорвался на своей ракете\nВозрождение через 3 сек.'
      : `Тебя убил ${k.name}\nВозрождение через 3 сек.`;
  }
}

function onOver(m: OverMsg): void {
  roundOver = true;
  let text: string;
  if (m.winner.team) text = m.winner.team === 'green' ? 'Победили ЗЕЛЁНЫЕ' : 'Победили КРАСНЫЕ';
  else text = `Победил ${m.winner.name ?? ''}`;
  $('center-msg').textContent = `${text}\nНовый раунд через ${Math.round(m.pause / 1000)} сек.`;
}

// ======================= меню =======================
let chosenMode: Mode = 'tdm';
let chosenMap: MapId = 'sands';
let chosenTeam: Team = 'green';
let lastInfo: InfoMsg | null = null;
const nameInput = $<HTMLInputElement>('name');
nameInput.value = localStorage.getItem('doc-name') ?? '';

const buttonsOf = (id: string): HTMLButtonElement[] =>
  [...$(id).querySelectorAll<HTMLButtonElement>('button')];

function onInfo(m: InfoMsg): void {
  lastInfo = m;
  if (joined) return;
  playBtn.disabled = m.count >= m.max;
  playBtn.textContent = m.count >= m.max ? 'Сервер заполнен' : 'ИГРАТЬ';
  const modeLocked = m.count > 0;
  if (modeLocked) chosenMode = m.mode;
  for (const b of buttonsOf('mode-choice')) {
    b.classList.toggle('active', b.dataset.mode === chosenMode);
    b.disabled = modeLocked;
  }
  if (modeLocked) chosenMap = m.map;
  for (const b of buttonsOf('map-choice')) {
    b.classList.toggle('active', b.dataset.map === chosenMap);
    b.disabled = modeLocked;
  }
  loadMap(chosenMap); // карта видна за меню
  $('mode-note').textContent = modeLocked
    ? `На сервере уже ${m.count} из ${m.max} — режим и карту выбрал первый игрок.`
    : 'Ты первый — режим и карту выбираешь ты.';
  const tdm = chosenMode === 'tdm';
  $('green-count').textContent = tdm ? `${m.green}/2` : '';
  $('red-count').textContent = tdm ? `${m.red}/2` : '';
  const full: Record<Team, boolean> = { green: tdm && m.green >= 2, red: tdm && m.red >= 2 };
  if (full[chosenTeam]) chosenTeam = chosenTeam === 'green' ? 'red' : 'green';
  for (const b of buttonsOf('team-choice')) {
    b.disabled = full[b.dataset.team as Team];
    b.classList.toggle('active', b.dataset.team === chosenTeam);
  }
}

function pickedButton(e: MouseEvent): HTMLButtonElement | null {
  const b = (e.target as HTMLElement).closest('button');
  return b && !b.disabled ? b : null;
}
$('mode-choice').addEventListener('click', (e) => {
  const b = pickedButton(e);
  if (!b) return;
  chosenMode = b.dataset.mode === 'ffa' ? 'ffa' : 'tdm';
  if (lastInfo) onInfo(lastInfo);
});
for (const id of MAP_ORDER) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.map = id;
  b.textContent = MAPS[id].name;
  $('map-choice').append(b);
}
$('map-choice').addEventListener('click', (e) => {
  const b = pickedButton(e);
  if (!b) return;
  chosenMap = MAP_ORDER.find((id) => id === b.dataset.map) ?? 'sands';
  if (lastInfo) onInfo(lastInfo);
});
$('team-choice').addEventListener('click', (e) => {
  const b = pickedButton(e);
  if (!b) return;
  chosenTeam = b.dataset.team === 'red' ? 'red' : 'green';
  if (lastInfo) onInfo(lastInfo);
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  initAudio();
  const name = nameInput.value.trim();
  localStorage.setItem('doc-name', name);
  playBtn.disabled = true;
  sendMsg({ t: 'join', name, team: chosenTeam, mode: chosenMode, map: chosenMap, token: localStorage.getItem(TOKEN_KEY) ?? undefined });
});

// ======================= управление =======================
function lock(): void {
  initAudio();
  // Сразу после Esc браузер может отказать в захвате курсора — тогда нужен повторный клик
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}
$('resume').addEventListener('click', lock);
canvas.addEventListener('click', () => { if (joined && !locked) lock(); });
/**
 * Меню закрыли по Esc: клавиатура сразу работает (бег, оружие, прыжки),
 * а мышь вернётся с первым кликом — браузеры не дают захватить её по Esc.
 */
let menuClosed = false;
const playing = (): boolean => locked || (joined && menuClosed);
let unlockedAt = 0;
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) unlockedAt = performance.now();
  menuClosed = false;
  $('pause').classList.toggle('hidden', locked || !joined);
  if (!locked) { mouseDown = false; aimHeld = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  // Браузеры иногда присылают ложный рывок сразу после захвата курсора
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  // В прицеле чувствительность падает вместе с углом обзора, чтобы прицел не «улетал»
  const sens = MOUSE_SENS * settings.sens * (camera.fov / BASE_FOV);
  me.yaw -= e.movementX * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * sens));
});
document.addEventListener('mousedown', (e) => {
  // После Esc первый клик только возвращает мышь в игру, а не стреляет
  if (!locked) { if (joined && menuClosed) lock(); return; }
  if (e.button === 0) { mouseDown = true; firedThisPress = false; }
  if (e.button === 2) aimHeld = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) aimHeld = false;
});
document.addEventListener('contextmenu', (e) => { if (joined) e.preventDefault(); });
document.addEventListener('wheel', (e) => {
  if (!locked) return;
  const order: WeaponId[] = me.ammo.rocket > 0 ? [...WEAPON_ORDER, 'rocket'] : WEAPON_ORDER;
  const i = order.indexOf(me.weapon);
  const n = order.length;
  setWeapon(order[(i + (e.deltaY > 0 ? 1 : n - 1)) % n]!);
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    for (const d of document.querySelectorAll<HTMLDetailsElement>('details[open]')) d.open = false;
    // Esc при открытом меню — сразу обратно в игру (то же нажатие, что открыло меню, не считается)
    if (joined && !locked && !menuClosed && performance.now() - unlockedAt > 300) {
      $('pause').classList.add('hidden');
      menuClosed = true;
      lock(); // где браузер разрешает — мышь захватится сразу
    }
    return;
  }
  if (!joined || e.target instanceof HTMLInputElement) return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); renderScoreboard(); }
  if (!playing()) return;
  keys[e.code] = true;
  if (e.code === 'Digit1') setWeapon('pistol');
  if (e.code === 'Digit2') setWeapon('shotgun');
  if (e.code === 'Digit3') setWeapon('rifle');
  if (e.code === 'Digit4') setWeapon('sniper');
  if (e.code === 'Digit5') setWeapon('knife');
  if (e.code === 'Digit6') setWeapon('rocket');
  if (e.code === 'KeyC' && !e.repeat) trySlide(performance.now());
  if (e.code === 'KeyT' && !e.repeat) trySpray(performance.now());
  if (e.code === 'KeyF' && !e.repeat) {
    // F — начать открывать ящик; повторное нажатие отменяет и сбрасывает прогресс
    if (openingUntil) sendMsg({ t: 'open', on: false });
    else if (me.alive && crateState === 'idle' && nearCrate()) sendMsg({ t: 'open', on: true });
  }
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
});

// ======================= движение и столкновения =======================
/** Упавший ящик мог накрыть игрока — тогда до выхода из него ящик для него не твёрдый. */
let insideCrate = false;

function overlaps(p: THREE.Vector3, h: number, b: Box): boolean {
  const r = PLAYER.w / 2;
  return p.x + r > b.min[0] && p.x - r < b.max[0] &&
    p.y + h > b.min[1] && p.y < b.max[1] &&
    p.z + r > b.min[2] && p.z - r < b.max[2];
}

function hitBox(p: THREE.Vector3, h: number = low ? SLIDE.height : PLAYER.h): Box | null {
  for (const b of currentMap.boxes) if (overlaps(p, h, b)) return b;
  // Лежащий ящик тоже твёрдый
  const c = insideCrate ? null : crateSolid();
  return c && overlaps(p, h, c) ? c : null;
}

function touchingLadder(p: THREE.Vector3): Ladder | null {
  const r = PLAYER.w / 2;
  for (const l of currentMap.ladders) {
    if (p.x + r > l.min[0] && p.x - r < l.max[0] &&
        p.y + PLAYER.h > l.min[1] && p.y < l.max[1] &&
        p.z + r > l.min[2] && p.z - r < l.max[2]) return l;
  }
  return null;
}

let ladderBlockedUntil = 0; // после спрыгивания лестница ненадолго «не липнет»
let jumpHeld = false;

/**
 * Лестница: подошёл — «прилип», сила тяжести не действует.
 * W — вверх, если смотришь на лестницу прямо или вверх, и вниз, если смотришь вниз или от неё; S — наоборот.
 * Прыжок — оттолкнуться от лестницы. Возвращает true, если игрок сейчас на лестнице.
 */
function climb(ladder: Ladder, f: number, wish: { x: number; z: number }, now: number): boolean {
  const [nx, nz] = ladder.normal;
  const facingAway = -Math.sin(me.yaw) * nx - Math.cos(me.yaw) * nz > 0.3;
  const vy = f * (me.pitch > -0.4 && !facingAway ? 1 : -1) * CLIMB;
  if (me.grounded && vy <= 0) return false; // стоим на земле и не лезем вверх — обычная ходьба

  if (keys.Space && !jumpHeld && !openingUntil) {
    me.vel.set(nx * 4.5, 3, nz * 4.5);
    ladderBlockedUntil = now + 350;
    return false;
  }
  // От лестницы отойти нельзя (только спрыгнуть или сойти вбок), прижиматься и смещаться вбок — можно
  const away = wish.x * nx + wish.z * nz;
  if (away > 0) { wish.x -= nx * away; wish.z -= nz * away; }
  me.vel.x = wish.x * 0.45;
  me.vel.z = wish.z * 0.45;
  me.vel.y = vy;
  // Долезли до верха — выталкиваем на площадку
  if (vy > 0 && me.pos.y + vy * 0.05 >= ladder.max[1]) {
    me.pos.y = ladder.max[1] + 0.02;
    me.vel.set(-nx * 3.5, 2.5, -nz * 3.5);
    ladderBlockedUntil = now + 300;
  }
  return true;
}

const sprintKey = (): boolean => !!(keys.ShiftLeft || keys.ShiftRight);
const sprintSpeed = (): number =>
  SPEED * multiplier(profile.levels, 'walk') * multiplier(profile.levels, 'sprint');

/** C в спринте: ложимся и скользим по инерции SLIDE.ms, управлять движением нельзя. */
function trySlide(now: number): void {
  const sprinting = sprintKey() && keys.KeyW && !aimHeld;
  if (!me.alive || !me.grounded || !sprinting || low || openingUntil || now < slideCooldownUntil) return;
  if (touchingLadder(me.pos)) return;
  const hs = Math.hypot(me.vel.x, me.vel.z);
  if (hs > 1) slideDir.set(me.vel.x / hs, 0, me.vel.z / hs);
  else slideDir.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
  slideSpeed = Math.max(hs, sprintSpeed()) * SLIDE.boost;
  slideUntil = now + SLIDE.ms;
  low = true;
  shotSound('slide', 0.8);
}

function move(dt: number): void {
  const now = performance.now();
  const sliding = now < slideUntil;
  // Пока открываем ящик — стоим на месте; в подкате управлять движением нельзя
  const frozen = openingUntil > 0 || sliding;
  const f = frozen ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = frozen ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const len = Math.hypot(f, s) || 1;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let speed = SPEED * multiplier(profile.levels, 'walk');
  // В прицеле не бегаем
  if (sprintKey() && !aimHeld) speed *= multiplier(profile.levels, 'sprint');
  const wish = { x: (-sin * f + cos * s) / len * speed, z: (-cos * f - sin * s) / len * speed };
  const p = me.pos;
  const crate = crateSolid();
  insideCrate = crate !== null && overlaps(p, PLAYER.h, crate);
  const ladder = !sliding && now >= ladderBlockedUntil ? touchingLadder(p) : null;

  if (sliding) {
    // Скорость подката плавно падает от начальной до SLIDE.endSpeed от неё
    const t = 1 - (slideUntil - now) / SLIDE.ms;
    const v = slideSpeed * (1 - (1 - SLIDE.endSpeed) * t);
    me.vel.x = slideDir.x * v;
    me.vel.z = slideDir.z * v;
    me.vel.y -= GRAVITY * dt;
  } else if (!ladder || !climb(ladder, f, wish, now)) {
    const accel = me.grounded ? 14 : 4;
    const k = Math.min(1, accel * dt);
    me.vel.x += (wish.x - me.vel.x) * k;
    me.vel.z += (wish.z - me.vel.z) * k;
    if (keys.Space && me.grounded && !frozen) { me.vel.y = JUMP; me.grounded = false; }
    me.vel.y -= GRAVITY * dt;
  }
  jumpHeld = !!keys.Space;

  p.x += me.vel.x * dt;
  if (hitBox(p)) { p.x -= me.vel.x * dt; me.vel.x = 0; }
  p.z += me.vel.z * dt;
  if (hitBox(p)) { p.z -= me.vel.z * dt; me.vel.z = 0; }

  p.y += me.vel.y * dt;
  me.grounded = false;
  if (p.y <= 0) {
    p.y = 0; me.vel.y = 0; me.grounded = true;
  } else {
    const b = hitBox(p);
    if (b) {
      if (me.vel.y <= 0) { p.y = b.max[1]; me.grounded = true; }
      else p.y = b.min[1] - (low ? SLIDE.height : PLAYER.h) - 0.001;
      me.vel.y = 0;
    }
  }

  // Подкат закончился — встаём, если над головой есть место
  if (low && !sliding && !hitBox(p, PLAYER.h)) {
    low = false;
    slideCooldownUntil = now + SLIDE.cooldownMs;
  }
}

// ======================= стрельба =======================
function startReload(): void {
  const w = WEAPONS[me.weapon];
  if (me.weapon === 'rocket' || w.melee) return; // ракетница и нож не перезаряжаются
  if (me.reloadUntil || me.ammo[me.weapon] >= w.mag || !me.alive) return;
  me.reloadMs = w.reload / multiplier(profile.levels, 'reload');
  me.reloadUntil = performance.now() + me.reloadMs;
  beep(300, 0.08, 0.08);
  updateHud();
}

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
function fire(now: number): void {
  const w = WEAPONS[me.weapon];
  me.nextShot = now + w.rate;
  me.ammo[me.weapon]--;
  firedThisPress = true;

  camera.updateMatrixWorld(true);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  camera.getWorldDirection(_dir);
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);

  const hits: Record<number, [number, number]> = {};
  const ends: Vec3[] = [];
  let anyHead = false;
  let anyHit = false;
  // В прицеле — малый разброс (вес пули), от бедра — в HIP_SPREAD раз больше
  const spread = w.spread * (HIP_SPREAD - (HIP_SPREAD - 1) * adsK);
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
    const d = _dir.clone().addScaledVector(_right, Math.cos(a) * rad).addScaledVector(_up, Math.sin(a) * rad).normalize();
    const dv: Vec3 = [d.x, d.y, d.z];
    let t = rayWorld(currentMap.boxes, eye, dv);
    let victim: number | null = null;
    let victimR: Remote | null = null;
    for (const [id, r] of remotes) {
      if (!r.info.alive) continue;
      if (mode === 'tdm' && r.info.team === me.team) continue;
      const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide);
      const tp = rayBox(eye, dv, min, max);
      if (tp < t) { t = tp; victim = id; victimR = r; }
    }
    if (victim !== null && victimR) {
      // Голова — верх стоящего прямоугольника; в подкате головы как зоны нет
      const head = !victimR.slide && eye[1] + dv[1] * t - victimR.pos.y >= HEAD.from;
      const h = (hits[victim] ??= [0, 0]);
      h[head ? 1 : 0]++;
      anyHit = true;
      anyHead ||= head;
    }
    const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
    // Свой трассер идёт по линии прицела, а не из ствола сбоку — так видно, куда летит пуля
    addTracer(new THREE.Vector3(eye[0] + dv[0] * 1.2, eye[1] + dv[1] * 1.2 - 0.04, eye[2] + dv[2] * 1.2), end);
  }
  sendMsg({ t: 'shoot', w: me.weapon, ends, hits });
  if (anyHit) { showHit(false); beep(anyHead ? 1900 : 1400, 0.05, 0.08); }

  shotSound(me.weapon);
  if (me.weapon === 'sniper' && me.ammo.sniper > 0) boltUntil = now + BOLT_MS;
  const RECOIL: Partial<Record<WeaponId, [number, number]>> = {
    shotgun: [0.12, 0.035], rifle: [0.05, 0.012], sniper: [0.14, 0.05],
  };
  const [k, lift] = RECOIL[me.weapon] ?? [0.05, 0.015];
  kick = k;
  recoil += lift;
  const flash = viewGun.flash;
  flash.visible = true;
  setTimeout(() => { flash.visible = false; }, 45);
  if (me.ammo[me.weapon] <= 0) startReload();
  updateHud();
}

/** Нож: удар по ближайшему противнику перед собой (узкий конус, дальность WEAPONS.knife.melee). */
function stab(now: number): void {
  const w = WEAPONS[me.weapon];
  const reach = w.melee ?? 0;
  me.nextShot = now + w.rate;
  firedThisPress = true;
  swingUntil = now + SWING_MS;
  camera.updateMatrixWorld(true);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  camera.getWorldDirection(_dir);
  let victim: number | null = null, best = Infinity;
  for (const [id, r] of remotes) {
    if (!r.info.alive || (mode === 'tdm' && r.info.team === me.team)) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide);
    const near = ([0, 1, 2] as const).map((i) => Math.max(min[i]!, Math.min(eye[i], max[i]!)));
    const dist = Math.hypot(near[0]! - eye[0], near[1]! - eye[1], near[2]! - eye[2]);
    if (dist > reach || dist >= best) continue;
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const to = c.sub(camera.position);
    const flat = Math.hypot(to.x, to.z);
    // Попадание, если противник примерно перед нами (по горизонтали) и между нами нет стены
    const ang = Math.acos(Math.max(-1, Math.min(1, (to.x * _dir.x + to.z * _dir.z) / ((flat || 1) * (Math.hypot(_dir.x, _dir.z) || 1)))));
    if (ang > 0.6) continue;
    const toV: Vec3 = [to.x / to.length(), to.y / to.length(), to.z / to.length()];
    if (rayWorld(currentMap.boxes, eye, toV, to.length()) < to.length() - 0.5) continue;
    victim = id;
    best = dist;
  }
  const hits: Record<number, [number, number]> = {};
  if (victim !== null) { hits[victim] = [1, 0]; showHit(false); beep(1400, 0.05, 0.08); }
  sendMsg({ t: 'shoot', w: me.weapon, ends: [], hits });
  shotSound('knife');
}

function fireRocket(now: number): void {
  if (me.ammo.rocket <= 0) return;
  me.nextShot = now + WEAPONS.rocket.rate;
  firedThisPress = true;
  me.ammo.rocket--; // сервер пришлёт точное число
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'rocket', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
  kick = 0.16;
  recoil += 0.04;
  updateHud();
}

function updateShooting(now: number): void {
  if (me.reloadUntil && now >= me.reloadUntil) {
    me.ammo[me.weapon] = WEAPONS[me.weapon].mag;
    me.reloadUntil = 0;
    updateHud();
  }
  if (!mouseDown || !me.alive || !locked || me.reloadUntil || now < me.nextShot || openingUntil || now < boltUntil) return;
  const w = WEAPONS[me.weapon];
  if (!w.auto && firedThisPress) return;
  if (me.weapon === 'rocket') { fireRocket(now); return; }
  if (w.melee) { stab(now); return; }
  if (me.ammo[me.weapon] <= 0) { startReload(); return; }
  fire(now);
}

// ======================= HUD =======================
let hitTimer = 0, dmgTimer = 0;
function showHit(kill: boolean): void {
  const el = $('hitmarker');
  el.classList.toggle('kill', kill);
  el.classList.add('show');
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => el.classList.remove('show'), kill ? 250 : 60);
}
function flashDamage(): void {
  $('damage').classList.add('show');
  clearTimeout(dmgTimer);
  dmgTimer = window.setTimeout(() => $('damage').classList.remove('show'), 80);
}

function textEl(tag: 'span' | 'small', text: string, cls = ''): HTMLElement {
  const s = document.createElement(tag);
  s.className = cls;
  s.textContent = text;
  return s;
}

function updateHud(): void {
  $('hp').textContent = String(me.alive ? me.hp : 0);
  $('armor').classList.toggle('hidden', !(me.alive && me.armor > 0));
  $('armor-val').textContent = String(me.armor);
  $('health').classList.toggle('low', me.hp <= 30);
  $('weapon-name').textContent = WEAPONS[me.weapon].name;
  const melee = !!WEAPONS[me.weapon].melee;
  $('ammo-count').textContent = melee ? '—' : me.reloadUntil ? '…' : String(me.ammo[me.weapon]);
  $('ammo-total').textContent = melee ? '' : me.weapon === 'rocket' ? ' ракет' : ' / ∞';
  for (const s of $('slots').querySelectorAll<HTMLElement>('span')) {
    s.classList.toggle('active', s.dataset.w === me.weapon);
    if (s.dataset.w === 'rocket') s.classList.toggle('hidden', me.ammo.rocket <= 0);
  }

  const score = $('score');
  score.textContent = '';
  if (mode === 'tdm') {
    score.append(
      textEl('span', `Зелёные ${scores.green}`, 'g'), ' : ',
      textEl('span', `${scores.red} Красные`, 'r'),
      textEl('small', `до ${limit}`),
    );
  } else {
    const mine = roster.find((p) => p.id === me.id);
    const top = [...roster].sort((a, b) => b.kills - a.kills)[0];
    score.append(`Ты: ${mine?.kills ?? 0}`);
    if (top) score.append(textEl('small', `лидер: ${top.name} — ${top.kills} · до ${limit}`));
  }
  if (!$('scoreboard').classList.contains('hidden')) renderScoreboard();
}

function renderScoreboard(): void {
  const sb = $('scoreboard');
  sb.textContent = '';
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const [t, cls] of [['Игрок', ''], ['Убийства', 'n'], ['Смерти', 'n']] as const) {
    const th = document.createElement('th');
    th.textContent = t;
    th.className = cls;
    head.append(th);
  }
  const leader = leaderId();
  const order: Record<Team, number> = { green: 0, red: 1 };
  const list = [...roster].sort((a, b) =>
    (mode === 'tdm' ? order[a.team] - order[b.team] : 0) || b.kills - a.kills);
  for (const p of list) {
    const row = table.insertRow();
    if (p.id === me.id) row.className = 'me';
    const n = row.insertCell(); n.textContent = (p.id === leader ? '♛ ' : '') + p.name; n.className = 't-' + p.team;
    const k = row.insertCell(); k.textContent = String(p.kills); k.className = 'n';
    const d = row.insertCell(); d.textContent = String(p.deaths); d.className = 'n';
  }
  sb.append(table);
}

// ======================= меню настроек =======================
const settingsRefreshers: Array<() => void> = [];

function applySettings(): void {
  if (master) master.gain.value = settings.volume;
  viewModel.position.x = settings.hand === 'left' ? -0.22 : 0.22;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* хранилище недоступно */ }
  for (const refresh of settingsRefreshers) refresh();
}

function slider(
  label: string, min: number, max: number, step: number,
  get: () => number, set: (v: number) => void, show: (v: number) => string,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'setting';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  const value = textEl('span', '', 'value');
  row.append(textEl('span', label, 'name'), input, value);
  input.addEventListener('input', () => { set(Number(input.value)); applySettings(); });
  settingsRefreshers.push(() => { input.value = String(get()); value.textContent = show(get()); });
  return row;
}

function buildSettings(root: HTMLElement): void {
  root.append(
    slider('Громкость', 0, 1, 0.05, () => settings.volume, (v) => { settings.volume = v; },
      (v) => `${Math.round(v * 100)}%`),
    slider('Чувствительность мыши', 0.2, 3, 0.05, () => settings.sens, (v) => { settings.sens = v; },
      (v) => `×${v.toFixed(2)}`),
  );
  const row = document.createElement('div');
  row.className = 'setting';
  const choice = document.createElement('div');
  choice.className = 'choice';
  const hands = [['right', 'Справа'], ['left', 'Слева']] as const;
  const buttons = hands.map(([hand, title]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = title;
    b.addEventListener('click', () => { settings.hand = hand; applySettings(); });
    settingsRefreshers.push(() => b.classList.toggle('active', settings.hand === hand));
    return b;
  });
  choice.append(...buttons);
  row.append(textEl('span', 'Оружие', 'name'), choice);
  root.append(row);
}

for (const root of document.querySelectorAll<HTMLElement>('.settings')) buildSettings(root);
applySettings();

// ======================= прокачка =======================
function onProfile(m: ProfileMsg): void {
  const before = pointsLeft(profile);
  profile = { kills: m.kills, levels: m.levels };
  try { localStorage.setItem(TOKEN_KEY, m.token); } catch { /* хранилище недоступно */ }
  if (pointsLeft(profile) > before && joined && profile.kills > 0) beep(660, 0.25);
  renderUpgrades();
}

function renderUpgrades(): void {
  const points = pointsLeft(profile);
  const toNext = KILLS_PER_POINT - (profile.kills % KILLS_PER_POINT);
  $('upgrade-points').textContent =
    `Убийств: ${profile.kills} · свободных очков: ${points} · до следующего очка: ${toNext}`;
  $('upgrade-note').classList.toggle('hidden', points <= 0);

  const root = $('upgrades');
  root.textContent = '';
  for (const stat of STATS) {
    const up = UPGRADES[stat];
    const level = profile.levels[stat];
    const row = document.createElement('div');
    row.className = 'upgrade';
    const steps = document.createElement('span');
    steps.className = 'steps';
    up.values.forEach((v, i) => {
      steps.append(textEl('span', `×${v.toFixed(2)}`, i === level ? 'now' : i < level ? 'done' : ''));
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = level >= maxLevel(stat) ? 'МАКС' : '+';
    btn.disabled = points <= 0 || level >= maxLevel(stat);
    btn.addEventListener('click', () => sendMsg({ t: 'upgrade', stat }));
    const title = textEl('span', up.name, 'name');
    title.append(textEl('small', up.hint));
    row.append(title, steps, btn);
    root.append(row);
  }
}
renderUpgrades();

// ======================= подсказка и полоска открытия ящика =======================
function updateCratePrompt(now: number): void {
  const prompt = $('crate-prompt');
  let text = '';
  let progress = -1;
  if (joined && me.alive && (crateState === 'idle' || crateState === 'opening')) {
    if (openingUntil) {
      progress = Math.max(0, Math.min(1, 1 - (openingUntil - now) / CRATE.openMs));
      text = 'Открываю ящик… F — отмена';
    } else if (nearCrate()) {
      const opener = crateState === 'opening' ? roster.find((p) => p.id === crateBy) : null;
      const left = Math.max(0, Math.ceil((crateExpiresAt - now) / 1000));
      text = opener
        ? `Ящик открывает ${opener.name}`
        : `F — открыть ящик (${CRATE.openMs / 1000} сек., двигаться нельзя) · исчезнет через ${left} сек.`;
    }
  }
  prompt.classList.toggle('hidden', !text);
  if (!text) return;
  $('crate-text').textContent = text;
  $('crate-bar').classList.toggle('hidden', progress < 0);
  $('crate-fill').style.width = `${Math.round(Math.max(0, progress) * 100)}%`;
}

// ======================= тела погибших =======================
interface Corpse { g: THREE.Group; pivot: THREE.Group; born: number; lying: boolean }
const corpses: Corpse[] = [];
const CORPSE = { fallMs: 350, lieMs: 1000, sinkMs: 1000, depth: 1 };

/** Прямоугольник падает на спину, через секунду уходит под землю и исчезает. */
function spawnCorpse(pos: THREE.Vector3, yaw: number, team: Team, lying: boolean): void {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = yaw;
  // Ось вращения — задний нижний край, чтобы тело заваливалось назад, а не проваливалось в пол
  const pivot = new THREE.Group();
  pivot.position.z = PLAYER.w / 2;
  g.add(pivot);
  const body = box(PLAYER.w, PLAYER.h, PLAYER.w, TEAM_COLOR[team]);
  body.position.set(0, PLAYER.h / 2, -PLAYER.w / 2);
  pivot.add(body);
  scene.add(g);
  corpses.push({ g, pivot, born: performance.now(), lying });
}

function updateCorpses(now: number): void {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i]!;
    const age = now - c.born;
    const fall = c.lying ? 1 : Math.min(1, age / CORPSE.fallMs);
    c.pivot.rotation.x = (Math.PI / 2) * fall * fall; // падает с ускорением
    const sinkStart = (c.lying ? 0 : CORPSE.fallMs) + CORPSE.lieMs;
    const sink = Math.max(0, Math.min(1, (age - sinkStart) / CORPSE.sinkMs));
    c.g.position.y = c.g.userData.baseY ?? (c.g.userData.baseY = c.g.position.y);
    c.g.position.y -= CORPSE.depth * sink;
    if (sink >= 1) {
      scene.remove(c.g);
      c.g.traverse((o) => {
        if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      corpses.splice(i, 1);
    }
  }
}

// ======================= эмодзи на стенах =======================
interface Spray { mesh: THREE.Mesh; born: number }
const sprays: Spray[] = [];
let sprayReadyAt = 0;
let toastTimer = 0;

function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 2000);
}

/** T: найти стену под прицелом и попросить сервер нарисовать на ней случайный эмодзи. */
function trySpray(now: number): void {
  if (!me.alive) return;
  if (now < sprayReadyAt) {
    toast(`Рисовать можно раз в минуту — ещё ${Math.ceil((sprayReadyAt - now) / 1000)} сек.`);
    return;
  }
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const d: Vec3 = [_dir.x, _dir.y, _dir.z];
  let best = SPRAY.reach;
  let wall: Box | null = null;
  for (const b of currentMap.boxes) {
    const t = rayBox(eye, d, b.min, b.max);
    if (t < best) { best = t; wall = b; }
  }
  const floorT = d[1] < 0 ? -eye[1] / d[1] : Infinity;
  if (!wall || floorT < best) { toast('Наведи прицел на стену поближе'); return; }
  const p: Vec3 = [eye[0] + d[0] * best, eye[1] + d[1] * best, eye[2] + d[2] * best];
  // Какой грани блока принадлежит точка: ближайшая по расстоянию
  const faces: Array<[number, number, number, number]> = [
    [-1, 0, 0, Math.abs(p[0] - wall.min[0])], [1, 0, 0, Math.abs(p[0] - wall.max[0])],
    [0, -1, 0, Math.abs(p[1] - wall.min[1])], [0, 1, 0, Math.abs(p[1] - wall.max[1])],
    [0, 0, -1, Math.abs(p[2] - wall.min[2])], [0, 0, 1, Math.abs(p[2] - wall.max[2])],
  ];
  const [nx, ny, nz] = faces.reduce((a, b) => (b[3] < a[3] ? b : a));
  if (ny !== 0) { toast('Рисовать можно только на стене'); return; }
  const e = Math.floor(Math.random() * EMOJIS.length);
  sendMsg({ t: 'spray', p: [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)], n: [nx, nz], e });
  sprayReadyAt = now + SPRAY.cooldownMs;
}

function emojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '100px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  return new THREE.CanvasTexture(c);
}

function onSpray(m: SprayMsg): void {
  const emoji = EMOJIS[m.e];
  if (!emoji) return;
  const mat = new THREE.MeshBasicMaterial({
    map: emojiTexture(emoji), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRAY.size, SPRAY.size), mat);
  const [nx, nz] = m.n;
  mesh.position.set(m.p[0] + nx * 0.02, m.p[1], m.p[2] + nz * 0.02);
  mesh.lookAt(mesh.position.x + nx, mesh.position.y, mesh.position.z + nz);
  scene.add(mesh);
  sprays.push({ mesh, born: performance.now() });
}

function updateSprays(now: number): void {
  for (let i = sprays.length - 1; i >= 0; i--) {
    const s = sprays[i]!;
    const age = now - s.born;
    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    // Последнюю секунду рисунок тает
    mat.opacity = Math.min(1, (SPRAY.lifeMs - age) / 1000);
    if (age >= SPRAY.lifeMs) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      mat.map?.dispose();
      mat.dispose();
      sprays.splice(i, 1);
    }
  }
}

// ======================= аптечки =======================
interface MedkitFx { g: THREE.Group; at: Vec3; landAt: number }
const medkitFx = new Map<number, MedkitFx>();

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

function onMedkits(m: MedkitsMsg): void {
  const now = performance.now();
  const seen = new Set<number>();
  for (const k of m.list) {
    seen.add(k.id);
    if (medkitFx.has(k.id)) continue;
    const g = buildMedkit();
    scene.add(g);
    medkitFx.set(k.id, { g, at: k.at, landAt: now + k.ms });
    if (joined && k.ms > 0) feedNote('❤ С неба падает аптечка');
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

function updateMedkits(now: number): void {
  for (const fx of medkitFx.values()) {
    const left = Math.max(0, Math.min(1, (fx.landAt - now) / MEDKIT.fallMs));
    const lift = MEDKIT.fallHeight * (1 - (1 - left) ** 2);
    fx.g.position.set(fx.at[0], fx.at[1] + lift, fx.at[2]);
    fx.g.rotation.y = now / 700; // медленно вращается, чтобы бросалась в глаза
    // Последние 3 секунды перед исчезновением мигает
    const left2 = fx.landAt + MEDKIT.lifeMs - now;
    fx.g.visible = left2 > 3000 || Math.floor(now / 200) % 2 === 0;
  }
}

// ======================= шаги =======================
const STRIDE = 1.8;
/** Сколько шагов было слышно (для проверки в тестах) */
let stepCount = 0;
let myStepAcc = 0;
const myLastPos = new THREE.Vector3();

/** Глухой шаг; громкость падает с расстоянием, звук слышен с той стороны, где идёт игрок. */
function stepSound(volume: number, pan: number): void {
  if (volume <= 0.02) return;
  stepCount++;
  if (!audio || !master) return;
  const dur = 0.09;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 650;
  const gain = audio.createGain();
  gain.gain.value = 0.5 * volume;
  const panner = audio.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(filter).connect(gain).connect(panner).connect(master);
  src.start();
}

/** Шаги считаются по пройденному по земле пути: каждые STRIDE метров — один шаг. */
function updateSteps(dt: number): void {
  if (!joined || dt <= 0) return;
  const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
  for (const r of remotes.values()) {
    const dx = r.pos.x - r.lastPos.x, dy = r.pos.y - r.lastPos.y, dz = r.pos.z - r.lastPos.z;
    r.lastPos.copy(r.pos);
    const moved = Math.hypot(dx, dz);
    // В прыжке, на лестнице, в подкате и при телепорте (возрождение) шагов нет
    if (!r.info.alive || r.slide || Math.abs(dy) > 0.02 || moved > 2) { r.stepAcc = 0; continue; }
    r.stepAcc += moved;
    if (r.stepAcc < STRIDE) continue;
    r.stepAcc -= STRIDE;
    const to = r.pos.clone().sub(me.pos);
    const dist = to.length();
    // Чем ближе игрок, тем громче: тишина дальше 30 м, у самого уха — в полную силу
    const vol = Math.max(0, 1 - dist / 30) ** 2;
    stepSound(vol, dist > 0.1 ? to.dot(right) / dist : 0);
  }
  if (!me.alive) { myLastPos.copy(me.pos); return; }
  const moved = Math.hypot(me.pos.x - myLastPos.x, me.pos.z - myLastPos.z);
  myLastPos.copy(me.pos);
  if (!me.grounded || low || moved > 2) { myStepAcc = 0; return; }
  myStepAcc += moved;
  if (myStepAcc >= STRIDE) { myStepAcc -= STRIDE; stepSound(0.25, 0); }
}

// ======================= прицеливание =======================
/** ПКМ: камера приближается, оружие уходит в центр, разброс уменьшается. */
function updateAim(dt: number): void {
  const w = WEAPONS[me.weapon];
  const aiming = aimHeld && w.zoom !== null && me.alive && !me.reloadUntil && !openingUntil;
  adsK += ((aiming ? 1 : 0) - adsK) * Math.min(1, dt * 12);
  if (adsK < 0.001) adsK = 0;
  const fov = BASE_FOV + ((w.zoom ?? BASE_FOV) - BASE_FOV) * adsK;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const handX = settings.hand === 'left' ? -0.22 : 0.22;
  viewModel.position.x = handX * (1 - adsK);
  // В прицеле центр прицела встаёт ровно на линию взгляда (красная точка — в центр экрана)
  const aimY = viewGun.aim ? -viewGun.aim.y * viewModel.scale.y : -0.13;
  viewModel.position.y = -0.2 + (aimY + 0.2) * adsK;
}

// ======================= анимации оружия =======================
const BOLT_MS = 900;
/** Когда закончится передёргивание затвора снайперки */
let boltUntil = 0;
const ease = (x: number): number => x * x * (3 - 2 * x);
/** 0 → 1 на отрезке [a, b] */
const ramp = (p: number, a: number, b: number): number => ease(Math.max(0, Math.min(1, (p - a) / (b - a))));

/** Перезарядка всех стволов и затвор снайперки. */
function animateGun(now: number): void {
  const g = viewGun;
  if (g.mag) g.mag.position.y = g.magY;
  if (g.shell) g.shell.visible = false;
  if (g.bolt) { g.bolt.position.z = g.boltZ; g.bolt.rotation.z = 0; }

  if (me.reloadUntil) {
    const p = 1 - Math.max(0, me.reloadUntil - now) / me.reloadMs;
    // Оружие наклоняется и опускается, в конце возвращается
    const tilt = ramp(p, 0, 0.15) * (1 - ramp(p, 0.85, 1));
    viewModel.rotation.x += -0.45 * tilt;
    viewModel.rotation.z += 0.5 * tilt;
    viewModel.position.y -= 0.06 * tilt;
    if (g.shell) {
      // Дробовик: три патрона по очереди вставляются снизу
      const q = (p - 0.2) / 0.65;
      if (q >= 0 && q < 1) {
        const k = (q * 3) % 1;
        g.shell.visible = true;
        g.shell.position.y = -0.14 + 0.1 * ease(Math.min(1, k * 1.4));
      }
    } else if (g.mag) {
      // Старый магазин вниз, новый — снизу обратно
      const out = ramp(p, 0.15, 0.4) * (1 - ramp(p, 0.55, 0.85));
      g.mag.position.y = g.magY - 0.3 * out;
    }
  } else if (g.bolt && now < boltUntil) {
    // Снайперка: рычаг вверх, назад, вперёд и вниз; ствол слегка покачивается
    const p = 1 - (boltUntil - now) / BOLT_MS;
    const up = ramp(p, 0.05, 0.2) * (1 - ramp(p, 0.75, 0.9));
    const back = ramp(p, 0.2, 0.45) * (1 - ramp(p, 0.5, 0.75));
    g.bolt.rotation.z = 1.2 * up;
    g.bolt.position.z = g.boltZ + 0.1 * back;
    viewModel.rotation.z += 0.25 * up;
    viewModel.rotation.x -= 0.1 * up;
  }
}

// ======================= главный цикл =======================
let last = performance.now(), sendAcc = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (joined) {
    if (me.alive) {
      move(dt);
      eyeH += ((low ? SLIDE.eye : PLAYER.eye) - eyeH) * Math.min(1, dt * 14);
      camera.position.set(me.pos.x, me.pos.y + eyeH, me.pos.z);
    } else {
      // После смерти камера смотрит на место гибели сверху
      camera.position.set(me.pos.x, me.pos.y + 6, me.pos.z + 4);
      const left = Math.max(0, Math.ceil((respawnAt - now) / 1000));
      if (!roundOver && left > 0) {
        const first = ($('center-msg').textContent ?? '').split('\n')[0];
        $('center-msg').textContent = `${first}\nВозрождение через ${left} сек.`;
      }
    }
    camera.rotation.set(me.alive ? Math.min(1.5, me.pitch + recoil) : -0.9, me.alive ? me.yaw : 0, 0);

    updateShooting(now);
    updateAim(dt);
    kick = Math.max(0, kick - dt * 0.6);
    recoil *= Math.exp(-dt / 0.12);
    // Взмах ножом — горизонтальный: справа налево, с выносом вперёд в середине
    const sw = now < swingUntil ? 1 - (swingUntil - now) / SWING_MS : -1;
    const swing = sw >= 0 ? Math.sin(Math.PI * sw) : 0;
    // В прицеле глаз подводится к прицелу: прицел оказывается в aim.relief метрах перед глазом,
    // а приклад уходит назад к щеке, за пределы обзора. Отдача в прицеле мягче.
    const aim = viewGun.aim;
    const aimZ = aim ? -aim.relief - aim.z * viewModel.scale.z : -0.25;
    viewModel.position.z = -0.45 + (aimZ + 0.45) * adsK + kick * (1 - 0.7 * adsK) - swing * 0.12;
    viewModel.position.x += sw >= 0 ? 0.2 - 0.4 * sw : 0;
    viewModel.rotation.y = sw >= 0 ? -1.1 + 2.2 * sw : 0;
    viewModel.rotation.z = sw >= 0 ? -Math.PI / 2 * swing * 0.6 : 0;
    viewModel.rotation.x = kick * 1.5;
    animateGun(now);

    sendAcc += dt;
    if (sendAcc >= 0.05) {
      sendAcc = 0;
      sendMsg({
        t: 'state',
        p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)],
        yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), w: me.weapon, sl: low,
      });
    }
  } else {
    // Облёт карты под меню
    const a = now / 9000;
    const r = Math.max(currentMap.half.x, currentMap.half.z) * 1.4;
    camera.position.set(Math.sin(a) * r, r * 0.62, Math.cos(a) * r);
    camera.lookAt(0, 0, 0);
  }
  const scoped = me.weapon === 'sniper' && adsK > 0.85;
  viewModel.visible = joined && me.alive && !scoped;
  $('scope').classList.toggle('hidden', !(joined && me.alive && scoped));
  $('crosshair').classList.toggle('ads', adsK > 0.5);
  // С коллиматором своя красная точка, крест в прицеле не нужен
  $('crosshair').classList.toggle('sight', adsK > 0.5 && !!viewGun.sight);
  // У снайперки креста нет: от бедра — без прицела, в прицеле — оптика
  $('crosshair').classList.toggle('hidden', me.weapon === 'sniper');

  const k = 1 - Math.exp(-16 * dt);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    const dy = r.targetYaw - r.yaw;
    r.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
    r.g.position.copy(r.pos);
    r.g.rotation.y = r.yaw;
    r.hand.rotation.x = r.pitch;
    r.gun.flash.visible = now < r.flashUntil;
    // Подкат: прямоугольник ложится вдоль взгляда и встаёт обратно
    r.poseK += ((r.slide ? 1 : 0) - r.poseK) * Math.min(1, dt * 12);
    r.pose.rotation.x = (-Math.PI / 2) * r.poseK;
    r.pose.position.set(0, (PLAYER.w / 2) * r.poseK, (PLAYER.h / 2) * r.poseK);
    r.label.position.y = r.labelY + (1.4 - r.labelY) * r.poseK;
  }

  updateRockets(now, dt);
  updateEffects(now);
  updateCrate(now);
  updateCratePrompt(now);
  updateCorpses(now);
  updateSprays(now);
  updateMedkits(now);
  updateSteps(dt);
  renderer.render(scene, camera);
}

updateHud();
requestAnimationFrame(frame);

// Для отладки из консоли
declare global {
  interface Window {
    game: { me: typeof me; remotes: typeof remotes; keys: typeof keys; dbg: () => Record<string, unknown> };
  }
}
window.game = {
  me, remotes, keys,
  dbg: () => ({ low, adsK, fov: camera.fov, crateState, crateAt, eyeH, recoil, corpses: corpses.length, sprays: sprays.length,
    steps: stepCount, medkits: medkitFx.size, boltUntil, menuClosed, armor: me.armor }),
};
