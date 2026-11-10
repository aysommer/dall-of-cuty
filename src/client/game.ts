import * as THREE from 'three';
import {
  AMMO_PACK, CRATE, DEFAULT_KIT, GUNS, GUNSHIP, clipWalls, gunshipPos, HEAD, HIP_SPREAD, KIT_SIZE, MAPS, MAP_ORDER, MATCH, MEDKIT, ROCKET, SLIDE, STREAK,
  THROW, WEAPONS, WEAPON_ORDER, WORLD_BOTTOM, PLAYER, isKit, type LimitKind, type WeatherKind,
  playerBox, rayBox, rayWorld, type StreakKind,
  type Box, type GameMap, type Ladder, type MapId,
} from '../shared/map.js';
import { EMOJIS, SPRAY } from '../shared/emoji.js';
import { UNDERGROUND_Y } from '../shared/maps/sewer.js';
import { RANKS, rankOf } from '../shared/ranks.js';
import {
  KILLS_PER_POINT, STATS, UPGRADES, maxLevel, multiplier, newProfile, pointsLeft, type Profile,
} from '../shared/progress.js';
import type {
  AmmoPacksMsg, BoomMsg, CrateMsg, GunshipMsg, CrateState, KillWeapon, LoadoutMsg, MedkitsMsg, MissileMsg, NukeMsg, PingMsg, RocketMsg, SprayMsg,
  ThrowEndMsg, ThrowMsg, VoteMsg, WeatherMsg,
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
  /** Выбранные стволы — не больше двух, нож есть всегда */
  kit: WeaponId[];
}
const SETTINGS_KEY = 'doc-settings';
const TOKEN_KEY = 'doc-progress';

function loadSettings(): Settings {
  const s: Settings = { volume: 0.7, sens: 1, hand: 'right', kit: [...DEFAULT_KIT] };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    if (typeof raw.volume === 'number') s.volume = Math.max(0, Math.min(1, raw.volume));
    if (typeof raw.sens === 'number') s.sens = Math.max(0.2, Math.min(3, raw.sens));
    if (raw.hand === 'left') s.hand = 'left';
    if (isKit(raw.kit)) s.kit = raw.kit;
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

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.5);
scene.add(hemi);
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
/** Невидимые стены по краю текущей карты */
let clips: Box[] = clipWalls(MAPS.sands.half);
/** Свет фонарей канализации — включается, когда камера под землёй */
const lampLights: THREE.PointLight[] = [];
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
  clips = clipWalls(currentMap.half);
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
  // Пол — плита из блоков с люками (она в boxes), под ней канализация
  lampLights.length = 0;
  for (const [x, y, z] of currentMap.lamps) {
    // Фонарь: корпус, светящееся стекло и тёплый свет на весь коридор
    const body = box(0.3, 0.12, 0.3, 0x222222);
    body.position.set(x, y + 0.3, z);
    const glass = box(0.22, 0.3, 0.22, 0xffd27a, false);
    glass.position.set(x, y + 0.1, z);
    const light = new THREE.PointLight(0xffd9a0, 14, 30, 1);
    light.position.set(x, y, z);
    light.visible = false;
    lampLights.push(light);
    mapGroup.add(body, glass, light);
  }
  for (const b of currentMap.boxes) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const m = box(w, h, d, b.color);
    if (b.top) {
      // Грани куба: +x, -x, +y, -y, +z, -z — верх своим цветом
      const side = m.material as THREE.MeshLambertMaterial;
      m.material = [side, side, new THREE.MeshLambertMaterial({ color: b.top }), side, side, side];
    }
    m.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    mapGroup.add(m);
  }
  for (const l of currentMap.ladders) mapGroup.add(buildLadder(l));
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
  /** Оптика снайперки — снимается и надевается на V */
  scope?: THREE.Object3D;
  scopeY: number;
  scopeZ: number;
  /** Куда смотрит глаз без оптики — по мушке и целику */
  iron?: { y: number; z: number; relief: number };
}

/** Коллиматорный прицел: рамка со стеклом и красная точка в центре. */
function buildRedDot(group: THREE.Group, y: number, z: number): void {
  const FRAME = 0x1a1a1a, W = 0.055, H = 0.042;
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
  part(0.004, 0.004, 0.002, 0, y, 0xff2020, false).position.z = z - 0.004; // красная точка
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
  let scope: THREE.Object3D | undefined;
  let iron: Gun['iron'];
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
    aim = { ...sight, relief: 0.22 };
    muzzleZ = -0.72;
  } else if (type === 'sniper') {
    add(0.06, 0.08, 0.75, 0x2f3a2c, 0, 0, -0.25);
    add(0.03, 0.03, 0.42, 0x1c1c1c, 0, 0.01, -0.83);
    scope = part(0.065, 0.065, 0.32, 0x111111, 0, 0.085, -0.26); // оптика
    // Мушка у дула и целик над затвором: по ним целятся, когда оптика снята
    add(0.012, 0.03, 0.012, 0x0c0c0c, 0, 0.04, -0.98);
    for (const side of [-1, 1]) add(0.012, 0.03, 0.012, 0x0c0c0c, side * 0.014, 0.04, -0.02);
    iron = { y: 0.055, z: -0.02, relief: 0.2 };
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
  } else if (type === 'lmg') {
    add(0.08, 0.11, 0.62, 0x2c3027, 0, 0, -0.22);            // ствольная коробка
    add(0.045, 0.045, 0.42, 0x1c1c1c, 0, 0.01, -0.73);       // ствол
    add(0.07, 0.03, 0.26, 0x1c1c1c, 0, 0.07, -0.42);         // кожух сверху
    mag = part(0.12, 0.13, 0.15, 0x3d4a2e, 0.02, -0.12, -0.16); // короб с лентой
    add(0.06, 0.12, 0.26, 0x4a3a28, 0, -0.02, 0.2);          // приклад
    for (const side of [-1, 1]) {                            // сошки
      const leg = box(0.015, 0.16, 0.015, 0x1c1c1c);
      leg.position.set(side * 0.04, -0.09, -0.78);
      leg.rotation.z = side * 0.3;
      group.add(leg);
    }
    sight = { y: 0.13, z: -0.08 };
    aim = { ...sight, relief: 0.24 };
    muzzleZ = -0.96;
  } else {
    add(0.06, 0.09, 0.5, 0x30343a, 0, 0, -0.2);
    add(0.035, 0.035, 0.3, 0x1c1c1c, 0, 0.01, -0.58);
    mag = part(0.045, 0.18, 0.07, 0x1c1c1c, 0, -0.12, -0.22);
    add(0.055, 0.1, 0.24, 0x4a3a28, 0, -0.02, 0.16);
    sight = { y: 0.1, z: -0.12 };
    aim = { ...sight, relief: 0.22 };
    muzzleZ = -0.75;
  }
  if (sight) buildRedDot(group, sight.y, sight.z);
  const flash = box(0.12, 0.12, 0.12, 0xffd34d, false);
  flash.position.set(0, 0, muzzleZ - 0.05);
  flash.visible = false;
  group.add(flash);
  return {
    group, flash, muzzleZ, mag, magY: mag?.position.y ?? 0, bolt, boltZ: bolt?.position.z ?? 0, shell, sight, aim,
    scope, scopeY: scope?.position.y ?? 0, scopeZ: scope?.position.z ?? 0, iron,
  };
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
// ======================= пиксельные лица =======================
/** Сколько убийств в матче нужно для каждой ступени: от спокойного лица к свирепому. */
const FACE_STEPS = [0, 2, 5, 9, 14];
const faceLevel = (kills: number): number => FACE_STEPS.filter((k) => kills >= k).length - 1;
const faceCache: THREE.CanvasTexture[] = [];
const faceUrl: string[] = [];

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

function faceTexture(level: number): THREE.CanvasTexture {
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
function dropHelmet(r: Remote): void {
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
function buildPlayer(info: PlayerInfo): Remote {
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
  big: false,
  pos: new THREE.Vector3(0, 0, 26),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  weapon: 'pistol' as WeaponId,
  ammo: {
    pistol: WEAPONS.pistol.mag, shotgun: WEAPONS.shotgun.mag, rifle: WEAPONS.rifle.mag,
    sniper: WEAPONS.sniper.mag, lmg: WEAPONS.lmg.mag, knife: 0, rocket: 0,
  } as Record<WeaponId, number>,
  /** Запас патронов сверх магазина; кончится — перезаряжаться нечем */
  reserve: {
    pistol: WEAPONS.pistol.reserve, shotgun: WEAPONS.shotgun.reserve, rifle: WEAPONS.rifle.reserve,
    sniper: WEAPONS.sniper.reserve, lmg: WEAPONS.lmg.reserve, knife: 0, rocket: 0,
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
  if (w === 'knife' && !hasKnife) return; // нож брошен — до смерти его нет
  if (GUNS.includes(w) && !settings.kit.includes(w)) return; // ствол не из набора
  adsK = 0;
  me.weapon = w;
  me.reloadUntil = 0;
  me.nextShot = Math.max(me.nextShot, performance.now() + 250);
  viewModel.remove(viewGun.group);
  viewGun = buildGun(w);
  if (viewGun.scope) viewGun.scope.visible = scopeOn;
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
  lmg: { dur: 0.16, freq: 1700, gain: 0.4 },
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
  // Салют: разноцветные искры во все стороны (у ракеты с неба — крупнее)
  fireworks(m.p[0], m.p[1] + 0.3, m.p[2], m.id < 0 ? 1.4 : 1);
  // Ракета с неба (id < 0): после взрыва корпус сразу исчезает
  const missile = remoteMissiles.get(-m.id);
  if (m.id < 0 && missile) {
    remoteMissiles.delete(-m.id);
    scene.remove(missile);
    missile.geometry.dispose();
    (missile.material as THREE.Material).dispose();
  }
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
      applyFog();
      joined = true;
      setWeapon(settings.kit[0]!);
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
    case 'loadout': onLoadout(m); break;
    case 'ammopacks': onAmmoPacks(m); break;
    case 'weather': onWeather(m); break;
    case 'helmet': {
      // Попадание в шлем: стрелку — «звон» металла и маркер, всем — сообщение, когда шлем слетел
      if (m.by === me.id) { showHit(false); beep(2400, 0.08, 0.1); beep(3100, 0.06, 0.06); }
      if (m.id === me.id) beep(1800, 0.1, 0.12);
      if (m.left === 0) {
        const who = m.id === me.id ? 'С тебя' : `С ${roster.find((p) => p.id === m.id)?.name ?? 'Джаггернаута'}`;
        feedNote(`🪖 ${who} сбит шлем`);
      } else if (m.by === me.id) toast(`🪖 Шлем держит: ещё ${m.left} попад.`);
      break;
    }
    case 'promoted': {
      const r = RANKS[m.rank]!;
      toast(`🎖 Новое звание: ${r.name} (${r.abbr})`);
      beep(990, 0.4, 0.12);
      break;
    }
    case 'ammo': {
      // Патроны с погибшего: к своим стволам — половина полного запаса
      for (const w of settings.kit) {
        // Всего патронов не больше полного запаса (магазин + запас); у пулемёта это его лента на 100
        const full = WEAPONS[w].mag + WEAPONS[w].reserve;
        me.reserve[w] = Math.min(full - me.ammo[w], me.reserve[w] + Math.ceil(full * AMMO_PACK.share));
      }
      toast('🎒 Патроны +50%');
      beep(760, 0.15, 0.1);
      updateHud();
      break;
    }
    case 'throw': onThrow(m); break;
    case 'thrown': onThrown(m); break;
    case 'uav':
      uavUntil = performance.now() + m.ms;
      toast('📡 БПЛА в воздухе: противники видны на карте');
      break;
    case 'ping': onPing(m); break;
    case 'missile-go': startMissile(m.id, m.p); break;
    case 'missile': onMissile(m); break;
    case 'nuke': onNuke(m); break;
    case 'gunship': onGunship(m); break;
    case 'gunship-end': onGunshipEnd(m.id, m.by, m.p); break;
    case 'gunship-hit':
      if (gunshipFx?.id === m.id) {
        feedNote(`✈ Попадание в самолёт! Осталось ${m.left}`);
        if (gunner) beep(300, 0.3, 0.15);
      }
      break;
    case 'gsshot': {
      if (!gunshipFx || gunshipFx.id !== m.id) break;
      const from = gunshipFx.mesh.position.clone();
      for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
      shotSound('lmg', 0.5);
      break;
    }
    case 'vote': onVote(m); break;
    case 'newmap': onNewMap(m.map); break;
    case 'rockets': {
      const had = me.ammo.rocket;
      me.ammo.rocket = m.n;
      if (m.n > 0 && had === 0) { setWeapon('rocket'); beep(990, 0.3); }
      if (m.n === 0 && me.weapon === 'rocket') setWeapon(settings.kit[0]!);
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
  if (m.left > 0) matchEndsAt = performance.now() + m.left;
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
      me.big = p.big;
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
    // Шлем сбили — он слетает с головы
    if (r.helmet.visible && p.helmet === 0 && p.alive) dropHelmet(r);
    r.helmet.visible = p.helmet > 0;
    r.crown.position.y = PLAYER.h + (p.helmet > 0 ? 0.14 : 0); // корона — поверх шлема
    r.g.scale.setScalar(p.big ? STREAK.bigScale : 1); // суперброня — в полтора раза больше
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { scene.remove(r.g); remotes.delete(id); }
  }
  const leader = leaderId();
  for (const [id, r] of remotes) {
    r.crown.visible = id === leader;
    const lvl = faceLevel(r.info.kills);
    if (lvl !== r.faceLevel) {
      r.faceLevel = lvl;
      (r.face.material as THREE.MeshLambertMaterial).map = faceTexture(lvl);
    }
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
    for (const w of WEAPON_ORDER) { me.ammo[w] = WEAPONS[w].mag; me.reserve[w] = WEAPONS[w].reserve; }
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
  if (!k || m.killer === null) {
    // Без убийцы: ящик-ловушка или бомба (для себя и своих)
    const trap = document.createElement('div');
    const name = document.createElement('span');
    name.className = 't-' + v.team;
    name.textContent = v.name;
    trap.append(m.w === 'nuke' ? '☢ Бомба ▸ ' : '💥 Ящик ▸ ', name);
    $('feed').prepend(trap);
    setTimeout(() => trap.remove(), 5000);
    if (m.victim === me.id) {
      $('center-msg').textContent = `${m.w === 'nuke' ? 'Бомба!' : 'Ящик взорвался!'}\nВозрождение через 3 сек.`;
    }
    return;
  }
  const row = document.createElement('div');
  const span = (p: PlayerInfo): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 't-' + p.team;
    s.textContent = p.name;
    return s;
  };
  row.append(span(k), ` ▸ ${weaponName(m.w)}${m.head ? ' 🎯' : ''} ▸ `, span(v));
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
  const self = m.killer === m.victim;
  if (m.killer === me.id && !self) { showHit(true); beep(880, 0.15); }
  if (m.victim === me.id) {
    $('center-msg').textContent = self
      ? `Ты подорвался: ${weaponName(m.w)}\nВозрождение через 3 сек.`
      : `Тебя убил ${k.name}\nВозрождение через 3 сек.`;
  }
}

function weaponName(w: KillWeapon): string {
  const extra: Record<string, string> = {
    crate: 'Ящик', throw: 'Метательный нож', missile: 'Ракета с неба', nuke: 'Бомба', gunship: 'Самолёт',
  };
  return extra[w] ?? WEAPONS[w as WeaponId].name;
}

let overText = '';
function onOver(m: OverMsg): void {
  roundOver = true;
  if (m.winner.draw) overText = 'Ничья';
  else if (m.winner.team) overText = m.winner.team === 'green' ? 'Победили ЗЕЛЁНЫЕ' : 'Победили КРАСНЫЕ';
  else overText = `Победил ${m.winner.name ?? ''}`;
  $('center-msg').textContent = '';
  endMissile();
}

// ======================= меню =======================
let chosenMode: Mode = 'tdm';
let chosenMap: MapId = 'sands';
let chosenLimitKind: LimitKind = 'time';
let chosenLimitValue = 10;
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
  if (modeLocked) { chosenLimitKind = m.limitKind; chosenLimitValue = m.limitValue; }
  for (const b of buttonsOf('limit-kind')) {
    b.classList.toggle('active', b.dataset.kind === chosenLimitKind);
    b.disabled = modeLocked;
  }
  // Значения — минуты или убийства, смотря что выбрано
  const values: readonly number[] = chosenLimitKind === 'time' ? MATCH.minutes : MATCH.kills;
  const unit = chosenLimitKind === 'time' ? 'мин' : 'убийств';
  const valueBox = $('limit-value');
  if (valueBox.dataset.kind !== chosenLimitKind) {
    valueBox.dataset.kind = chosenLimitKind;
    valueBox.textContent = '';
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = String(v);
      b.textContent = `${v} ${unit}`;
      valueBox.append(b);
    }
  }
  if (!values.includes(chosenLimitValue)) chosenLimitValue = values[1]!;
  for (const b of buttonsOf('limit-value')) {
    b.classList.toggle('active', Number(b.dataset.v) === chosenLimitValue);
    b.disabled = modeLocked;
  }
  loadMap(chosenMap); // карта видна за меню
  $('mode-note').textContent = modeLocked
    ? `На сервере уже ${m.count} из ${m.max} — режим, карту и время выбрал первый игрок.`
    : 'Ты первый — режим, карту и время выбираешь ты.';
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
$('limit-kind').addEventListener('click', (e) => {
  const b = pickedButton(e);
  if (!b) return;
  chosenLimitKind = b.dataset.kind === 'kills' ? 'kills' : 'time';
  if (lastInfo) onInfo(lastInfo);
});
$('limit-value').addEventListener('click', (e) => {
  const b = pickedButton(e);
  if (!b) return;
  chosenLimitValue = Number(b.dataset.v);
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
  sendMsg({ t: 'join', name, team: chosenTeam, mode: chosenMode, map: chosenMap, limitKind: chosenLimitKind, limitValue: chosenLimitValue, kit: settings.kit, token: localStorage.getItem(TOKEN_KEY) ?? undefined });
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
  $('pause').classList.toggle('hidden', locked || !joined || voting);
  if (!locked) { mouseDown = false; aimHeld = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  // Браузеры иногда присылают ложный рывок сразу после захвата курсора
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  // В прицеле чувствительность падает вместе с углом обзора, чтобы прицел не «улетал»
  const sens = MOUSE_SENS * settings.sens * (camera.fov / BASE_FOV);
  if (gunner) {
    // В самолёте мышь поворачивает орудие (смотреть можно только вниз)
    gunner.yaw -= e.movementX * sens;
    gunner.pitch = Math.max(-1.5, Math.min(-0.15, gunner.pitch - e.movementY * sens));
    return;
  }
  if (missileCtl) {
    // Ракетой с неба управляет мышь: поворот и наклон (смотреть можно только вниз)
    missileCtl.yaw -= e.movementX * sens * 0.6;
    missileCtl.pitch = Math.max(-1.55, Math.min(-0.5, missileCtl.pitch - e.movementY * sens * 0.6));
    return;
  }
  me.yaw -= e.movementX * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * sens));
});
document.addEventListener('mousedown', (e) => {
  // После Esc первый клик только возвращает мышь в игру, а не стреляет
  if (!locked) { if (joined && menuClosed) lock(); return; }
  if (e.button === 0) { mouseDown = true; firedThisPress = false; }
  if (e.button === 2) {
    // В самолёте ПКМ — ракета; с ножом в руке — бросить его
    if (gunner) gunnerRocket();
    else if (me.weapon === 'knife') throwKnife();
    else aimHeld = true;
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) aimHeld = false;
});
document.addEventListener('contextmenu', (e) => { if (joined) e.preventDefault(); });
document.addEventListener('wheel', (e) => {
  if (!locked) return;
  const order = (['knife', ...settings.kit, 'rocket'] as WeaponId[])
    .filter((w) => (w !== 'knife' || hasKnife) && (w !== 'rocket' || me.ammo.rocket > 0));
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
  // Слоты: 1 нож, 2 дробовик, 3 автомат, 4 снайперка, 5–8 — награды за серию, 0 — пистолет
  const slot = hotbar().find((h) => `Digit${h.key}` === e.code);
  if (slot && !e.repeat) useSlot(slot.id);
  if (e.code === 'KeyG' && !e.repeat) throwKnife();
  if (e.code === 'KeyV' && !e.repeat) toggleScope(performance.now());
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
  // Невидимые стены по краю карты — только для движения игрока
  for (const b of clips) if (overlaps(p, h, b)) return b;
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
/** Шаг на невысокий уступ (трамплин, ступенька): до STEP_UP метров — без прыжка. */
const STEP_UP = 0.35;
function stepUp(p: THREE.Vector3): boolean {
  if (!me.grounded) return false;
  const b = hitBox(p);
  if (!b || b.max[1] - p.y > STEP_UP || b.max[1] <= p.y) return false;
  const y = p.y;
  p.y = b.max[1] + 0.001;
  if (hitBox(p)) { p.y = y; return false; } // сверху нет места
  return true;
}
/** Летим после трамплина — до приземления */
let padFlight = false;
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
  const frozen = openingUntil > 0 || sliding || missileCtl !== null || gunner !== null;
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
    // В полёте после трамплина скорость почти не гасится — иначе до острова не долететь
    const accel = me.grounded ? 14 : padFlight ? 0.6 : 4;
    const k = Math.min(1, accel * dt);
    me.vel.x += (wish.x - me.vel.x) * k;
    me.vel.z += (wish.z - me.vel.z) * k;
    if (keys.Space && me.grounded && !frozen) { me.vel.y = JUMP; me.grounded = false; }
    me.vel.y -= GRAVITY * dt;
  }
  jumpHeld = !!keys.Space;

  p.x += me.vel.x * dt;
  if (hitBox(p) && !stepUp(p)) { p.x -= me.vel.x * dt; me.vel.x = 0; }
  p.z += me.vel.z * dt;
  if (hitBox(p) && !stepUp(p)) { p.z -= me.vel.z * dt; me.vel.z = 0; }

  p.y += me.vel.y * dt;
  me.grounded = false;
  // Дно мира — страховка; обычно игрок стоит на плите земли или на полу канализации
  if (p.y <= WORLD_BOTTOM) {
    p.y = WORLD_BOTTOM; me.vel.y = 0; me.grounded = true;
  } else {
    const b = hitBox(p);
    if (b) {
      if (me.vel.y <= 0) { p.y = b.max[1]; me.grounded = true; }
      else p.y = b.min[1] - (low ? SLIDE.height : PLAYER.h) - 0.001;
      me.vel.y = 0;
    }
  }
  if (me.grounded) padFlight = false;

  // Трамплин: встал на него — подбрасывает в его сторону
  if (me.grounded && !frozen) {
    for (const pad of currentMap.pads ?? []) {
      if (p.x >= pad.min[0] && p.x <= pad.max[0] && p.z >= pad.min[2] && p.z <= pad.max[2] &&
          Math.abs(p.y - pad.max[1]) < 0.05) {
        me.vel.set(pad.vel[0], pad.vel[1], pad.vel[2]);
        me.grounded = false;
        padFlight = true;
        beep(320, 0.12, 0.12);
        setTimeout(() => beep(640, 0.15, 0.1), 60);
        break;
      }
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
  if (me.reserve[me.weapon] <= 0) { toast('Патроны кончились — подбери с погибших'); return; }
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
      const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide, scaleOfRemote(r));
      const tp = rayBox(eye, dv, min, max);
      if (tp < t) { t = tp; victim = id; victimR = r; }
    }
    if (victim !== null && victimR) {
      // Голова — верх стоящего прямоугольника; в подкате головы как зоны нет
      const head = !victimR.slide && eye[1] + dv[1] * t - victimR.pos.y >= HEAD.from * scaleOfRemote(victimR);
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
    // Пулемёт бьёт вдвое сильнее автомата
    shotgun: [0.12, 0.035], rifle: [0.05, 0.012], lmg: [0.1, 0.024], sniper: [0.14, 0.05],
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
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide, scaleOfRemote(r));
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
    // В магазин идёт столько, сколько есть в запасе
    const take = Math.min(WEAPONS[me.weapon].mag - me.ammo[me.weapon], me.reserve[me.weapon]);
    me.ammo[me.weapon] += take;
    me.reserve[me.weapon] -= take;
    me.reloadUntil = 0;
    updateHud();
  }
  if (!mouseDown || !me.alive || !locked || me.reloadUntil || now < me.nextShot || openingUntil || now < boltUntil) return;
  if (missileCtl || gunner) return; // ЛКМ сейчас — ускорение ракеты или пулемёт самолёта
  const w = WEAPONS[me.weapon];
  if (!w.auto && firedThisPress) return;
  if (me.weapon === 'rocket') { fireRocket(now); return; }
  if (w.melee) { stab(now); return; }
  if (me.ammo[me.weapon] <= 0) {
    if (me.reserve[me.weapon] <= 0 && !firedThisPress) { beep(180, 0.05, 0.06); firedThisPress = true; } // щелчок: пусто
    startReload();
    return;
  }
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
  const myKills = roster.find((p) => p.id === me.id)?.kills ?? 0;
  faceTexture(faceLevel(myKills));
  $<HTMLImageElement>('my-face').src = faceUrl[faceLevel(myKills)]!;
  $('armor').classList.toggle('hidden', !(me.alive && me.armor > 0));
  $('armor-val').textContent = String(me.armor);
  const myHelmet = roster.find((p) => p.id === me.id)?.helmet ?? 0;
  $('helmet').classList.toggle('hidden', !(me.alive && myHelmet > 0));
  $('helmet-val').textContent = String(myHelmet);
  $('health').classList.toggle('low', me.hp <= 30);
  $('weapon-name').textContent = WEAPONS[me.weapon].name;
  const melee = !!WEAPONS[me.weapon].melee;
  $('ammo-count').textContent = melee ? '—' : me.reloadUntil ? '…' : String(me.ammo[me.weapon]);
  $('ammo-total').textContent = melee ? '' : me.weapon === 'rocket' ? ' ракет' : ` / ${me.reserve[me.weapon]}`;
  renderHotbar();
  renderStreak();

  const score = $('score');
  score.textContent = '';
  if (mode === 'tdm') {
    score.append(
      textEl('span', `Зелёные ${scores.green}`, 'g'), ' : ',
      textEl('span', `${scores.red} Красные`, 'r'),
    );
    score.append(limit > 0 ? textEl('small', `до ${limit}`) : timerEl());
  } else {
    const mine = roster.find((p) => p.id === me.id);
    const top = [...roster].sort((a, b) => b.kills - a.kills)[0];
    score.append(`Ты: ${mine?.kills ?? 0}`);
    if (top) score.append(textEl('small', `лидер: ${top.name} — ${top.kills}${limit > 0 ? ` · до ${limit}` : ''}`));
    if (limit === 0) score.append(timerEl());
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
    const n = row.insertCell();
    n.className = 't-' + p.team;
    n.textContent = (p.id === leader ? '♛ ' : '') + p.name;
    const rank = RANKS[p.rank]!;
    const badge = textEl('small', ` ${rank.abbr} · ${rank.name}`, 'rank');
    badge.title = rank.name;
    n.append(badge);
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
  row.append(textEl('span', 'Положение оружия', 'name'), choice);
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
    `Звание: ${RANKS[rankOf(profile.kills)]!.name} · убийств: ${profile.kills} · свободных очков: ${points} · до следующего очка: ${toNext}`;
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
  if (!wall) { toast('Наведи прицел на стену поближе'); return; }
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

// ======================= слоты и серия убийств =======================
/** Нож есть, пока его не бросили; после смерти возвращается. */
let hasKnife = true;
let streak = 0;
const rewards: Record<StreakKind, number> = { uav: 0, missile: 0, nuke: 0, gunship: 0 };

type SlotId = WeaponId | StreakKind;
/** Слоты: 1 — нож, 2 и 3 — стволы из набора, 5–8 — награды за серию. */
function hotbar(): Array<{ key: string; id: SlotId; label: string }> {
  const kit = settings.kit.map((id, i) => ({ key: String(i + 2), id: id as SlotId, label: WEAPONS[id].name }));
  return [
    { key: '1', id: 'knife', label: 'Нож' },
    ...kit,
    { key: '5', id: 'uav', label: 'БПЛА' },
    { key: '6', id: 'missile', label: 'Ракета с неба' },
    { key: '7', id: 'rocket', label: 'Ракетница' },
    { key: '8', id: 'nuke', label: 'Бомба' },
    { key: '9', id: 'gunship', label: 'Самолёт' },
  ];
}
let hotbarKey = '';
const isStreakKind = (id: SlotId): id is StreakKind =>
  id === 'uav' || id === 'missile' || id === 'nuke' || id === 'gunship';

function slotReady(id: SlotId): boolean {
  if (isStreakKind(id)) return rewards[id] > 0;
  if (id === 'knife') return hasKnife;
  if (id === 'rocket') return me.ammo.rocket > 0;
  return true;
}

function useSlot(id: SlotId): void {
  if (!slotReady(id)) return;
  if (!isStreakKind(id)) { if (me.alive) setWeapon(id); return; }
  // БПЛА, ракету с неба и бомбу можно применить и после смерти
  if (id === 'missile' && missileCtl) return;
  sendMsg({ t: 'use', kind: id });
}

function renderHotbar(): void {
  const bar = $('hotbar');
  const list = hotbar();
  const key = list.map((h) => h.id).join();
  if (key !== hotbarKey) {
    // Набор поменялся — перестраиваем ячейки
    hotbarKey = key;
    bar.textContent = '';
    for (const h of list) {
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.dataset.id = h.id;
      cell.append(textEl('span', h.key, 'key'), textEl('span', h.label, 'name'), textEl('span', '', 'count'));
      bar.append(cell);
    }
  }
  for (const cell of bar.querySelectorAll<HTMLElement>('.slot')) {
    const id = cell.dataset.id as SlotId;
    cell.classList.toggle('active', id === me.weapon);
    cell.classList.toggle('off', !slotReady(id));
    cell.classList.toggle('reward', isStreakKind(id) && rewards[id] > 0);
    const count = isStreakKind(id) ? rewards[id] : id === 'rocket' ? me.ammo.rocket : 0;
    cell.querySelector('.count')!.textContent = count > 0 ? `×${count}` : '';
  }
}

const STREAK_STEPS: Array<[number, string]> = [
  [STREAK.uav, 'БПЛА'], [STREAK.missile, 'ракета с неба'], [STREAK.launcher, 'ракетница'],
  [STREAK.superArmor, 'суперброня'], [GUNSHIP.streak, 'самолёт'], [STREAK.nuke, 'бомба'],
];
function renderStreak(): void {
  const next = STREAK_STEPS.find(([n]) => n > streak);
  $('streak-count').textContent = String(streak);
  $('streak-next').textContent = next ? `${next[1]} через ${next[0] - streak}` : 'все награды получены';
}

function onLoadout(m: LoadoutMsg): void {
  const got = (k: StreakKind) => m[k] > rewards[k];
  if (got('uav')) toast('🎁 БПЛА готов — нажми 5');
  if (got('missile')) toast('🎁 Ракета с неба готова — нажми 6');
  if (got('nuke')) toast('🎁 Бомба готова — нажми 8');
  if (got('gunship')) toast('🎁 Самолёт готов — нажми 9');
  if (m.streak === STREAK.superArmor && streak < m.streak) toast('🛡 Ты Джаггернаут: +500 брони, шлем держит 3 выстрела в голову');
  if (got('uav') || got('missile') || got('nuke') || got('gunship')) beep(1200, 0.3, 0.12);
  hasKnife = m.knife;
  streak = m.streak;
  rewards.uav = m.uav;
  rewards.missile = m.missile;
  rewards.nuke = m.nuke;
  rewards.gunship = m.gunship;
  if (!hasKnife && me.weapon === 'knife') setWeapon(settings.kit[0]!);
  updateHud();
}

function scaleOfRemote(r: Remote): number {
  return r.info.big ? STREAK.bigScale : 1;
}

// ======================= набор оружия (в меню Esc) =======================
function setKit(kit: WeaponId[]): void {
  settings.kit = kit;
  applySettings();
  sendMsg({ t: 'kit', guns: kit });
  if (GUNS.includes(me.weapon) && !kit.includes(me.weapon)) setWeapon(kit[0]!);
  renderKit();
  updateHud();
}

/** Кнопки выбора: отмечено не больше двух; третий выбор вытесняет самый первый. */
function renderKit(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.kit')) {
    if (!root.childElementCount) {
      for (const w of GUNS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.w = w;
        b.textContent = WEAPONS[w].name;
        b.addEventListener('click', () => {
          const kit = settings.kit.filter((k) => k !== w);
          if (kit.length === settings.kit.length) kit.push(w);   // добавить
          if (kit.length > KIT_SIZE) kit.shift();                 // вытеснить самый старый
          if (kit.length) setKit(kit);
        });
        root.append(b);
      }
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', settings.kit.includes(b.dataset.w as WeaponId));
    }
  }
}
renderKit();

// ======================= патроны с погибших =======================
interface PackFx { g: THREE.Group; at: Vec3 }
const packFx = new Map<number, PackFx>();

/** Зелёный ящик с патронами и жёлтой полосой. */
function buildPack(): THREE.Group {
  const g = new THREE.Group();
  const base = box(0.5, 0.28, 0.32, 0x3d5a2a);
  base.position.y = 0.14;
  const stripe = box(0.52, 0.06, 0.34, 0xf1c232, false);
  stripe.position.y = 0.2;
  g.add(base, stripe);
  return g;
}

function onAmmoPacks(m: AmmoPacksMsg): void {
  const seen = new Set<number>();
  for (const a of m.list) {
    seen.add(a.id);
    if (packFx.has(a.id)) continue;
    const g = buildPack();
    g.position.set(a.at[0], a.at[1], a.at[2]);
    scene.add(g);
    packFx.set(a.id, { g, at: a.at });
  }
  for (const [id, fx] of packFx) {
    if (seen.has(id)) continue;
    scene.remove(fx.g);
    packFx.delete(id);
  }
}

function updateAmmoPacks(now: number): void {
  for (const fx of packFx.values()) fx.g.rotation.y = now / 600;
}

// ======================= салют после взрывов =======================
interface Burst { points: THREE.Points; vel: Float32Array; born: number; life: number }
const bursts: Burst[] = [];
/** Цвета огня настоящего взрыва: красный, оранжевый, жёлтый и белый — по нарастанию жара */
const FIRE_COLORS = [0xff2a12, 0xff6a14, 0xffa31a, 0xffd23a, 0xfff3c4, 0xffffff];

/**
 * Взрыв как салют: искры разлетаются шаром, падают под тяжестью, мерцают и гаснут.
 * scale — размер: 1 для ракеты, больше — для ракеты с неба и бомбы.
 */
function fireworks(x: number, y: number, z: number, scale = 1): void {
  const n = Math.round(140 * scale);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos.set([x, y, z], i * 3);
    // Направление — равномерно по сфере, скорость — с разбросом, чтобы получился «шар» искр
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const heat = Math.random();
    // Горячие (белые, жёлтые) искры летят быстрее, остывшие (оранжевые, красные) — медленнее
    const speed = (4 + heat * 9) * Math.sqrt(scale);
    vel.set([r * Math.cos(a) * speed, u * speed + 3, r * Math.sin(a) * speed], i * 3);
    c.set(FIRE_COLORS[Math.min(FIRE_COLORS.length - 1, Math.floor(heat * FIRE_COLORS.length))]!);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.22 * Math.sqrt(scale), vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  bursts.push({ points, vel, born: performance.now(), life: 1400 + 600 * (scale - 1) });
}

function updateFireworks(dt: number): void {
  const now = performance.now();
  for (let i = bursts.length - 1; i >= 0; i--) {
    const bu = bursts[i]!;
    const age = now - bu.born;
    const mat = bu.points.material as THREE.PointsMaterial;
    if (age > bu.life) {
      scene.remove(bu.points);
      bu.points.geometry.dispose();
      mat.dispose();
      bursts.splice(i, 1);
      continue;
    }
    const pos = bu.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array, v = bu.vel;
    const drag = Math.exp(-1.6 * dt);
    for (let k = 0; k < arr.length; k += 3) {
      v[k]! *= drag; v[k + 2]! *= drag;
      v[k + 1] = v[k + 1]! * drag - 9 * dt;           // искры тормозят и падают
      arr[k] += v[k]! * dt; arr[k + 1] += v[k + 1]! * dt; arr[k + 2] += v[k + 2]! * dt;
    }
    pos.needsUpdate = true;
    // Гаснут к концу и слегка мерцают
    const t = age / bu.life;
    mat.opacity = (1 - t * t) * (0.75 + 0.25 * Math.sin(age / 35));
  }
}

// ======================= то, что уходит под землю =======================
const sinking: Array<{ obj: THREE.Object3D; born: number; baseY: number }> = [];
/** Секунду лежит, потом за секунду проваливается и исчезает — как тело. */
function updateSinking(now: number): void {
  for (let i = sinking.length - 1; i >= 0; i--) {
    const s = sinking[i]!;
    const k = Math.max(0, Math.min(1, (now - s.born - 1000) / 1000));
    s.obj.position.y = s.baseY - 1.6 * k;
    if (k >= 1) {
      scene.remove(s.obj);
      sinking.splice(i, 1);
    }
  }
}

// ======================= канализация: темнота и фонарь =======================
let underground = false;
/** Под землёй выключаем «солнце» и небо, включаем фонари — светло только рядом с ними. */
function updateUnderground(): void {
  const now = camera.position.y < UNDERGROUND_Y - 0.2;
  if (now === underground) return;
  underground = now;
  // Внизу темно за счёт тёмного бетона; солнце и небо остаются — из люка видно улицу.
  // Фонарь включаем только себе и только под землёй, чтобы он не подсвечивал улицу.
  for (const l of lampLights) l.visible = now;
}

// ======================= погода: дождь и снег =======================
let weatherKind: WeatherKind | null = null;
let weatherFx: THREE.Points | THREE.LineSegments | null = null;
const WEATHER_BOX = { x: 40, y: 22, z: 40 };

/** Капли (короткие черты) или снежинки (точки) в коробке вокруг камеры. */
function buildWeather(kind: WeatherKind): THREE.Points | THREE.LineSegments {
  const n = kind === 'rain' ? 1800 : 1400;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * WEATHER_BOX.x;
    const y = Math.random() * WEATHER_BOX.y;
    const z = (Math.random() - 0.5) * WEATHER_BOX.z;
    if (kind === 'rain') pts.push(x, y, z, x, y - 0.6, z);
    else pts.push(x, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return kind === 'rain'
    ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaac4dd, transparent: true, opacity: 0.55 }))
    : new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06 }));
}

/** Видимость: в дождь туман ближе и серее, в снег — ещё ближе и белее. */
function applyFog(): void {
  if (weatherKind === 'rain') { fog.near = 8; fog.far = 45; fog.color.set(0x7d8791); sky.set(0x7d8791); }
  else if (weatherKind === 'snow') { fog.near = 5; fog.far = 30; fog.color.set(0xd5dce3); sky.set(0xd5dce3); }
  else { fog.near = 50; fog.far = 130; fog.color.set(currentMap.sky); sky.set(currentMap.sky); }
}

function onWeather(m: WeatherMsg): void {
  if (m.kind === weatherKind) return;
  if (weatherFx) { scene.remove(weatherFx); weatherFx.geometry.dispose(); weatherFx = null; }
  const was = weatherKind;
  weatherKind = m.kind;
  if (m.kind) {
    weatherFx = buildWeather(m.kind);
    scene.add(weatherFx);
    if (joined) toast(m.kind === 'rain' ? '🌧 Пошёл дождь — видно хуже' : '❄ Пошёл снег — видно хуже');
  } else if (was && joined) toast('☀ Прояснилось');
  applyFog();
}

function updateWeather(dt: number): void {
  if (!weatherFx || !weatherKind) return;
  // Под землёй не идёт; наверху «коробка» с осадками ездит за камерой, частицы падают и возвращаются наверх
  weatherFx.visible = !underground;
  weatherFx.position.set(camera.position.x, camera.position.y - 6, camera.position.z);
  const pos = weatherFx.geometry.getAttribute('position') as THREE.BufferAttribute;
  const speed = weatherKind === 'rain' ? 26 : 2.2;
  const step = weatherKind === 'rain' ? 2 : 1;
  const t = performance.now() / 1000;
  for (let i = 0; i < pos.count; i += step) {
    let y = pos.getY(i) - speed * dt;
    let x = pos.getX(i);
    if (weatherKind === 'snow') x += Math.sin(t + i) * 0.3 * dt; // снег кружится
    if (y < 0) y += WEATHER_BOX.y;
    pos.setXY(i, x, y);
    if (step === 2) pos.setXY(i + 1, x, y - 0.6);
  }
  pos.needsUpdate = true;
}

// ======================= метательный нож =======================
interface KnifeFx { mesh: THREE.Group; vel: THREE.Vector3 }
const knifeFx = new Map<number, KnifeFx>();

function knifeModel(): THREE.Group {
  const g = new THREE.Group();
  const blade = box(0.02, 0.06, 0.3, 0xd0d4da);
  blade.position.z = -0.1;
  const handle = box(0.04, 0.05, 0.14, 0x1c1c1c);
  handle.position.z = 0.1;
  g.add(blade, handle);
  return g;
}

/** G (или ПКМ с ножом в руке): бросить нож туда, куда смотришь. */
function throwKnife(): void {
  if (!me.alive || !hasKnife || openingUntil || missileCtl || roundOver) return;
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'throw', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
  hasKnife = false; // сервер подтвердит
  if (me.weapon === 'knife') setWeapon(settings.kit[0]!);
  shotSound('knife', 1);
  updateHud();
}

/** Свои брошенные ножи — чтобы показать попадание */
const myKnives = new Set<number>();
function onThrow(m: ThrowMsg): void {
  if (m.by === me.id) myKnives.add(m.id);
  const mesh = knifeModel();
  mesh.position.set(m.o[0], m.o[1], m.o[2]);
  scene.add(mesh);
  knifeFx.set(m.id, { mesh, vel: new THREE.Vector3(m.d[0], m.d[1], m.d[2]).multiplyScalar(THROW.speed) });
}

function onThrown(m: ThrowEndMsg): void {
  if (myKnives.delete(m.id) && m.hit) { showHit(false); beep(1400, 0.05, 0.08); }
  const fx = knifeFx.get(m.id);
  if (!fx) return;
  knifeFx.delete(m.id);
  if (m.hit) {
    scene.remove(fx.mesh);
    return;
  }
  // Промах — нож торчит из стены или пола ещё 5 секунд
  fx.mesh.position.set(m.p[0], m.p[1], m.p[2]);
  fx.mesh.lookAt(fx.mesh.position.clone().sub(fx.vel));
  setTimeout(() => scene.remove(fx.mesh), 5000);
}

function updateKnives(dt: number): void {
  for (const fx of knifeFx.values()) {
    fx.vel.y -= THROW.gravity * dt;
    fx.mesh.position.addScaledVector(fx.vel, dt);
    fx.mesh.rotation.x -= dt * 20; // летит, вращаясь
  }
}

// ======================= БПЛА: мини-карта с эхо-локацией =======================
let uavUntil = 0;
let lastPingAt = 0;
let pingDots: Array<[number, number]> = [];

function onPing(m: PingMsg): void {
  pingDots = m.list.map(([, x, z]) => [x, z]);
  lastPingAt = performance.now();
  if (uavUntil > lastPingAt) beep(1600, 0.06, 0.04);
}

/** Карта сверху: стены, ты (стрелка) и отметки противников, которые гаснут до следующего импульса. */
function updateMinimap(now: number): void {
  const c = $<HTMLCanvasElement>('minimap');
  const on = joined && now < uavUntil && !voting;
  c.classList.toggle('hidden', !on);
  if (!on) return;
  const ctx = c.getContext('2d')!;
  const size = c.width, mid = size / 2;
  const half = currentMap.half;
  const k = (mid - 8) / Math.max(half.x, half.z);
  const sx = (x: number) => mid + x * k, sz = (z: number) => mid + z * k;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(10, 20, 14, 0.82)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(150, 190, 160, 0.55)';
  for (const b of currentMap.boxes) {
    if (b.max[1] <= 0.05) continue; // земля и канализация
    if (b.max[1] - b.min[1] < 0.6 && b.min[1] > 0) continue; // тонкие крыши и полки не рисуем
    ctx.fillRect(sx(b.min[0]), sz(b.min[2]), (b.max[0] - b.min[0]) * k, (b.max[2] - b.min[2]) * k);
  }
  // Эхо: кольцо расходится от тебя после каждого импульса.
  // Время кадра бывает чуть раньше времени прихода отметки — не даём возрасту уйти в минус.
  const age = Math.max(0, now - lastPingAt);
  if (age < 900) {
    ctx.strokeStyle = `rgba(90, 255, 140, ${1 - age / 900})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(me.pos.x), sz(me.pos.z), (age / 900) * size * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fade = Math.max(0, 1 - age / STREAK.pingMs);
  ctx.fillStyle = `rgba(255, 70, 70, ${0.25 + 0.75 * fade})`;
  for (const [x, z] of pingDots) {
    ctx.beginPath();
    ctx.arc(sx(x), sz(z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ты: стрелка по направлению взгляда
  ctx.save();
  ctx.translate(sx(me.pos.x), sz(me.pos.z));
  ctx.rotate(-me.yaw);
  ctx.fillStyle = '#5cf07a';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#c8ffd6';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`БПЛА ${Math.ceil((uavUntil - now) / 1000)} с`, 6, 14);
}

// ======================= ракета с неба =======================
let missileCtl: { id: number; pos: THREE.Vector3; yaw: number; pitch: number; born: number; sendAcc: number } | null = null;
const remoteMissiles = new Map<number, THREE.Mesh>();

function missileMesh(): THREE.Mesh {
  const m = box(0.35, 0.35, 1.4, 0xdddddd);
  m.material = new THREE.MeshLambertMaterial({ color: 0xdddddd, emissive: 0x552200 });
  return m;
}

/** Камера переходит в ракету над картой; ведёшь её мышью, ЛКМ — ускорение. */
function startMissile(id: number, p: Vec3): void {
  missileCtl = { id, pos: new THREE.Vector3(p[0], p[1], p[2]), yaw: me.yaw, pitch: -1.3, born: performance.now(), sendAcc: 0 };
  aimHeld = false;
  $('missile-view').classList.remove('hidden');
  canvas.classList.add('thermal');
  beep(500, 0.4, 0.1);
}

function endMissile(): void {
  if (!missileCtl) return;
  missileCtl = null;
  $('missile-view').classList.add('hidden');
  canvas.classList.remove('thermal');
}

function updateMissile(now: number, dt: number): void {
  const m = missileCtl;
  if (!m) return;
  const speed = mouseDown ? STREAK.missileBoost : STREAK.missileSpeed;
  const dir = new THREE.Vector3(-Math.sin(m.yaw) * Math.cos(m.pitch), Math.sin(m.pitch), -Math.cos(m.yaw) * Math.cos(m.pitch));
  const step = speed * dt;
  const from: Vec3 = [m.pos.x, m.pos.y, m.pos.z];
  const d: Vec3 = [dir.x, dir.y, dir.z];
  let t = rayWorld(currentMap.boxes, from, d, step);
  for (const r of remotes.values()) {
    if (!r.info.alive) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide, scaleOfRemote(r));
    t = Math.min(t, rayBox(from, d, min, max));
  }
  const expired = now - m.born > STREAK.missileMaxMs - 500;
  if (t < step || expired) {
    const at = m.pos.clone().addScaledVector(dir, Math.min(t, step));
    sendMsg({ t: 'mhit', id: m.id, p: [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)] });
    endMissile();
    return;
  }
  m.pos.addScaledVector(dir, step);
  m.sendAcc += dt;
  if (m.sendAcc >= 0.1) {
    m.sendAcc = 0;
    sendMsg({ t: 'mpos', id: m.id, p: [+m.pos.x.toFixed(2), +m.pos.y.toFixed(2), +m.pos.z.toFixed(2)] });
  }
  camera.position.copy(m.pos);
  camera.rotation.set(m.pitch, m.yaw, 0);
  $('missile-alt').textContent = `${Math.max(0, Math.round(m.pos.y))} м · ${mouseDown ? 'ускорение' : 'ЛКМ — ускорение'}`;
}

function onMissile(m: MissileMsg): void {
  let mesh = remoteMissiles.get(m.id);
  if (!mesh) {
    mesh = missileMesh();
    scene.add(mesh);
    remoteMissiles.set(m.id, mesh);
    if (joined) feedNote('🚀 С неба летит ракета!');
  }
  const target = new THREE.Vector3(m.p[0], m.p[1], m.p[2]);
  mesh.lookAt(target);
  mesh.position.copy(target);
}

// ======================= самолёт =======================
interface GunshipFx { id: number; by: number; phase: number; start: number; mesh: THREE.Group }
let gunshipFx: GunshipFx | null = null;
/** Я стреляю из самолёта: направление орудия, нагрев пулемёта и перезарядка ракет */
let gunner: {
  yaw: number; pitch: number; heat: number; overheatUntil: number; nextShot: number; rocketReadyAt: number; lastT: number;
} | null = null;

/** Самолёт из блоков: фюзеляж, крылья, хвост и винты. */
function buildPlane(): THREE.Group {
  const g = new THREE.Group();
  const BODY = 0x5d6b4f, DARK = 0x2c3326;
  const body = box(1.4, 1.2, 7, BODY);
  const nose = box(1, 0.9, 1, DARK);
  nose.position.z = -3.9;
  const wing = box(9, 0.25, 1.8, BODY);
  wing.position.set(0, 0.1, -0.6);
  const tail = box(3.2, 0.2, 0.9, BODY);
  tail.position.set(0, 0.3, 3.1);
  const fin = box(0.2, 1.4, 1, BODY);
  fin.position.set(0, 1, 3.1);
  g.add(body, nose, wing, tail, fin);
  for (const side of [-1, 1]) {
    const engine = box(0.7, 0.7, 1.4, DARK);
    engine.position.set(side * 2.6, -0.1, -1);
    const prop = box(1.6, 0.12, 0.08, 0x111111);
    prop.position.set(side * 2.6, -0.1, -1.75);
    prop.name = 'prop';
    g.add(engine, prop);
  }
  return g;
}

function gunshipPoint(fx: GunshipFx, now: number): THREE.Vector3 {
  const [x, y, z] = gunshipPos(currentMap.half, fx.phase, (now - fx.start) / 1000);
  return new THREE.Vector3(x, y, z);
}

function onGunship(m: GunshipMsg): void {
  if (gunshipFx) scene.remove(gunshipFx.mesh);
  const mesh = buildPlane();
  scene.add(mesh);
  gunshipFx = { id: m.id, by: m.by, phase: m.phase, start: performance.now() - m.elapsed, mesh };
  const who = roster.find((p) => p.id === m.by)?.name ?? '';
  if (m.by === me.id) {
    gunner = { yaw: me.yaw, pitch: -0.9, heat: 0, overheatUntil: 0, nextShot: 0, rocketReadyAt: 0, lastT: performance.now() };
    aimHeld = false;
    $('gunship-view').classList.remove('hidden');
    toast('✈ Ты в самолёте: ЛКМ — пулемёт, ПКМ — ракета');
  } else feedNote(`✈ ${who} в небе на самолёте! Сбей его двумя ракетами`);
  beep(180, 0.8, 0.12);
}

function onGunshipEnd(id: number, by: number | null, p: Vec3): void {
  if (!gunshipFx || gunshipFx.id !== id) return;
  scene.remove(gunshipFx.mesh);
  if (by !== null) {
    // Сбит: большой огненный взрыв в небе
    fireworks(p[0], p[1], p[2], 2.2);
    const who = roster.find((q) => q.id === by)?.name ?? '';
    feedNote(`✈💥 ${who} сбил самолёт`);
  } else if (gunshipFx.by !== me.id) feedNote('✈ Самолёт улетел');
  if (gunshipFx.by === me.id) {
    gunner = null;
    $('gunship-view').classList.add('hidden');
    for (const el of markerEls.values()) el.remove();
    markerEls.clear();
  }
  gunshipFx = null;
}

/** ПКМ в самолёте: ракета, раз в 3 секунды. */
function gunnerRocket(): void {
  const now = performance.now();
  if (!gunner || now < gunner.rocketReadyAt) return;
  gunner.rocketReadyAt = now + GUNSHIP.rocketCdMs;
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'gsrocket', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
}

/** Очередь пулемёта: луч из самолёта по прицелу, перегрев за 5 секунд непрерывной стрельбы. */
function gunnerFire(now: number): void {
  if (!gunner) return;
  gunner.nextShot = now + GUNSHIP.gunRateMs;
  camera.updateMatrixWorld(true);
  camera.getWorldDirection(_dir);
  const sp = GUNSHIP.spread;
  const d = _dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp)).normalize();
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const dv: Vec3 = [d.x, d.y, d.z];
  let t = rayWorld(currentMap.boxes, eye, dv, 200);
  let victim: number | null = null;
  for (const [id, r] of remotes) {
    if (!r.info.alive || (mode === 'tdm' && r.info.team === me.team)) continue;
    const [min, max] = playerBox([r.pos.x, r.pos.y, r.pos.z], r.yaw, r.slide, scaleOfRemote(r));
    const tp = rayBox(eye, dv, min, max);
    if (tp < t) { t = tp; victim = id; }
  }
  const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
  addTracer(camera.position.clone().addScaledVector(d, 2).add(new THREE.Vector3(0, -0.4, 0)), end);
  const hits: Record<number, number> = {};
  if (victim !== null) { hits[victim] = 1; showHit(false); beep(1400, 0.04, 0.06); }
  sendMsg({ t: 'gsfire', ends: [[+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]], hits });
  shotSound('lmg', 0.8);
}

/** Маркеры врагов поверх экрана — только у стрелка самолёта. */
const markerEls = new Map<number, HTMLElement>();
function updateMarkers(): void {
  const layer = $('markers');
  const seen = new Set<number>();
  if (gunner) {
    for (const [id, r] of remotes) {
      if (!r.info.alive || (mode === 'tdm' && r.info.team === me.team)) continue;
      const v = r.pos.clone().add(new THREE.Vector3(0, PLAYER.h * scaleOfRemote(r) + 0.6, 0)).project(camera);
      if (v.z > 1) continue; // позади камеры
      seen.add(id);
      let el = markerEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'marker';
        layer.append(el);
        markerEls.set(id, el);
      }
      el.style.left = `${((v.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - v.y) / 2) * 100}%`;
    }
  }
  for (const [id, el] of markerEls) if (!seen.has(id)) { el.remove(); markerEls.delete(id); }
}

function updateGunship(now: number, dt: number): void {
  const fx = gunshipFx;
  if (fx) {
    // Самолёт летит по кругу, нос — по направлению полёта; винты крутятся
    const p = gunshipPoint(fx, now);
    const ahead = gunshipPoint(fx, now + 100);
    fx.mesh.position.copy(p);
    fx.mesh.lookAt(p.clone().multiplyScalar(2).sub(ahead));
    fx.mesh.rotation.z += 0.35; // крен в вираж
    fx.mesh.traverse((o) => { if (o.name === 'prop') o.rotation.z += dt * 40; });
  }
  updateMarkers();
  const g = gunner;
  if (!g || !fx) return;
  // Камера — под брюхом самолёта, смотрит туда, куда повёрнуто орудие
  camera.position.copy(fx.mesh.position).add(new THREE.Vector3(0, -1.6, 0));
  camera.rotation.set(g.pitch, g.yaw, 0);
  // Нагрев — по настоящему времени, а не по шагу кадра: при низком FPS шаг кадра урезан
  const realMs = Math.min(250, now - g.lastT);
  g.lastT = now;
  const overheated = now < g.overheatUntil;
  if (mouseDown && !overheated && locked) {
    if (now >= g.nextShot) gunnerFire(now);
    g.heat = Math.min(1, g.heat + realMs / GUNSHIP.heatMs);
    if (g.heat >= 1) { g.overheatUntil = now + GUNSHIP.coolMs; beep(220, 0.3, 0.12); }
  } else if (overheated) {
    g.heat = Math.max(0, (g.overheatUntil - now) / GUNSHIP.coolMs); // за секунду остывает до нуля
  } else {
    g.heat = Math.max(0, g.heat - (realMs / 1000) * 0.5);
  }
  const left = Math.max(0, Math.ceil((GUNSHIP.ms - (now - fx.start)) / 1000));
  const rocketIn = Math.max(0, (g.rocketReadyAt - now) / 1000);
  $<HTMLElement>('gs-heat').style.width = `${Math.round(g.heat * 100)}%`;
  $('gs-heat').classList.toggle('over', overheated);
  $('gs-info').textContent =
    `✈ ${left} с · пулемёт: ${overheated ? 'ПЕРЕГРЕВ' : 'ЛКМ'} · ракета: ${rocketIn > 0 ? rocketIn.toFixed(1) + ' с' : 'ПКМ — готова'}`;
}

// ======================= бомба =======================
let nukeAt = 0;
let nukeMesh: THREE.Group | null = null;

function onNuke(m: NukeMsg): void {
  nukeAt = performance.now() + m.ms;
  const who = roster.find((p) => p.id === m.by)?.name ?? '';
  feedNote(`☢ ${who} сбросил бомбу!`);
  nukeMesh = new THREE.Group();
  const body = box(1.6, 1.6, 3.6, 0x2d2f2a);
  const tail = box(2.6, 0.15, 0.8, 0x2d2f2a);
  tail.position.z = 1.8;
  const tail2 = box(0.15, 2.6, 0.8, 0x2d2f2a);
  tail2.position.z = 1.8;
  const stripe = box(1.65, 1.65, 0.3, 0xf1c232);
  stripe.position.z = -0.8;
  nukeMesh.add(body, tail, tail2, stripe);
  nukeMesh.rotation.x = Math.PI / 2; // носом вниз
  scene.add(nukeMesh);
  beep(220, 1.2, 0.2);
}

function updateNuke(now: number): void {
  if (!nukeAt) return;
  const left = nukeAt - now;
  if (left > 0) {
    if (nukeMesh) nukeMesh.position.set(0, 2 + 80 * (left / STREAK.nukeMs) ** 1.5, 0);
    $('center-msg').textContent = `☢ БОМБА через ${Math.ceil(left / 1000)}`;
    return;
  }
  // Удар: белая вспышка на весь экран и грохот
  nukeAt = 0;
  if (nukeMesh) { scene.remove(nukeMesh); nukeMesh = null; }
  $('center-msg').textContent = '';
  const flash = $('flash');
  flash.classList.remove('fade');
  flash.classList.add('on');
  void flash.offsetWidth; // перезапуск анимации
  flash.classList.add('fade');
  shotSound('boom', 1);
  setTimeout(() => shotSound('boom', 0.8), 120);
  // Бомба — огромный салют над центром карты
  fireworks(0, 6, 0, 3);
  setTimeout(() => fireworks(0, 14, 0, 2.5), 250);
}

// ======================= время матча и голосование =======================
let matchEndsAt = 0;
let voting = false;
let voteEndsAt = 0;

function timerText(): string {
  const left = Math.max(0, Math.ceil((matchEndsAt - performance.now()) / 1000));
  return `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
function timerEl(): HTMLElement {
  const el = textEl('small', timerText(), 'timer');
  el.id = 'match-timer';
  return el;
}

function onVote(m: VoteMsg): void {
  if (!voting) {
    voting = true;
    voteEndsAt = performance.now() + m.ms;
    document.exitPointerLock();
    $('pause').classList.add('hidden');
    $('vote').classList.remove('hidden');
  }
  $('vote-title').textContent = overText || 'Матч окончен';
  const list = $('vote-maps');
  list.textContent = '';
  for (const id of MAP_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = id === m.mine ? 'active' : '';
    b.append(textEl('span', MAPS[id].name), textEl('small', ` · голосов: ${m.counts[id]}`));
    b.addEventListener('click', () => sendMsg({ t: 'vote', map: id }));
    list.append(b);
  }
}

function updateVote(now: number): void {
  if (!voting) return;
  $('vote-timer').textContent = `Новый матч через ${Math.max(0, Math.ceil((voteEndsAt - now) / 1000))} сек. При равенстве голосов карта выбирается случайно.`;
}

function onNewMap(id: MapId): void {
  voting = false;
  roundOver = false;
  $('vote').classList.add('hidden');
  loadMap(id);
  applyFog(); // туман и небо — под текущую погоду
  feedNote(`🗺 Новый матч: ${MAPS[id].name}`);
  // Мышь отпущена на время голосования — вернуть её можно кликом по «ИГРАТЬ»
  if (!locked) $('pause').classList.remove('hidden');
}

// ======================= прицеливание =======================
/** ПКМ: камера приближается, оружие уходит в центр, разброс уменьшается. */
function updateAim(dt: number): void {
  const w = WEAPONS[me.weapon];
  const aiming = aimHeld && w.zoom !== null && me.alive && !me.reloadUntil && !openingUntil && !scopeAnim;
  adsK += ((aiming ? 1 : 0) - adsK) * Math.min(1, dt * 12);
  if (adsK < 0.001) adsK = 0;
  // Снайперка без оптики — по мушке, с небольшим приближением
  const zoom = me.weapon === 'sniper' && !scopeOn ? IRON_ZOOM : w.zoom ?? BASE_FOV;
  const fov = BASE_FOV + (zoom - BASE_FOV) * adsK;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const handX = settings.hand === 'left' ? -0.22 : 0.22;
  viewModel.position.x = handX * (1 - adsK);
  // В прицеле центр прицела встаёт ровно на линию взгляда (красная точка — в центр экрана)
  const aimPt = me.weapon === 'sniper' && !scopeOn ? viewGun.iron : viewGun.aim;
  const aimY = aimPt ? -aimPt.y * viewModel.scale.y : -0.13;
  viewModel.position.y = -0.2 + (aimY + 0.2) * adsK;
}

// ======================= снайперка: оптика на V и тряска в движении =======================
/** Оптика на снайперке: снимается и надевается на V */
let scopeOn = true;
/** Анимация руки, которая снимает или надевает оптику */
let scopeAnim: { until: number; to: boolean } | null = null;
const SCOPE_ANIM_MS = 700;
/** Приближение по мушке, без оптики */
const IRON_ZOOM = 50;
let scopeHand: THREE.Mesh | null = null;

function toggleScope(now: number): void {
  if (me.weapon !== 'sniper' || !me.alive || scopeAnim || me.reloadUntil) return;
  scopeAnim = { until: now + SCOPE_ANIM_MS, to: !scopeOn };
  aimHeld = false; // во время возни с оптикой не целимся
  beep(scopeOn ? 520 : 760, 0.08, 0.06);
}

/**
 * Квадратная рука тянется к оптике: при снятии — забирает её и уносит вниз,
 * при надевании — приносит снизу и ставит на место.
 */
function animateScope(now: number): void {
  const g = viewGun;
  if (!g.scope) { if (scopeHand) scopeHand.visible = false; return; }
  if (!scopeHand) {
    scopeHand = box(0.11, 0.07, 0.13, 0xd9a07a); // квадратная ладонь
    viewModel.add(scopeHand);
  }
  if (!scopeAnim) {
    scopeHand.visible = false;
    g.scope.visible = scopeOn;
    g.scope.position.set(0, g.scopeY, g.scopeZ);
    return;
  }
  const p = 1 - Math.max(0, scopeAnim.until - now) / SCOPE_ANIM_MS;
  const mount = new THREE.Vector3(0, g.scopeY + 0.07, g.scopeZ);
  const below = new THREE.Vector3(0.12, -0.35, g.scopeZ + 0.1);
  // Рука: снизу к оптике (0…0.45) и обратно вниз (0.55…1)
  const up = ramp(p, 0, 0.45), down = ramp(p, 0.55, 1);
  const hand = below.clone().lerp(mount, up).lerp(below, down);
  scopeHand.visible = true;
  scopeHand.position.copy(hand);
  if (scopeAnim.to) {
    // Надеваем: оптика в руке поднимается и встаёт на место
    g.scope.visible = true;
    if (p < 0.5) g.scope.position.copy(hand).add(new THREE.Vector3(0, -0.07, 0));
    else g.scope.position.set(0, g.scopeY, g.scopeZ);
  } else {
    // Снимаем: оптика стоит, пока рука не дотянулась, дальше уходит вместе с рукой
    g.scope.visible = p < 0.95;
    if (p < 0.5) g.scope.position.set(0, g.scopeY, g.scopeZ);
    else g.scope.position.copy(hand).add(new THREE.Vector3(0, -0.07, 0));
  }
  if (now >= scopeAnim.until) {
    scopeOn = scopeAnim.to;
    scopeAnim = null;
    toast(scopeOn ? '🔭 Оптика надета' : '🔭 Оптика снята — целься по мушке (V — надеть)');
  }
}

/**
 * Тряска снайперки в прицеле, пока игрок двигается: чем быстрее, тем сильнее.
 * Стоя на месте прицел спокойный. Выстрел летит туда, куда смотрит камера, — с учётом тряски.
 */
function sniperSway(now: number): { yaw: number; pitch: number } {
  if (me.weapon !== 'sniper' || adsK < 0.3 || !me.alive) return { yaw: 0, pitch: 0 };
  const speed = Math.hypot(me.vel.x, me.vel.z) + (me.grounded ? 0 : 4);
  const amp = Math.min(1, speed / SPEED) * 0.04 * adsK;
  if (amp < 0.0005) return { yaw: 0, pitch: 0 };
  const t = now / 1000;
  return { yaw: amp * Math.sin(t * 6.3), pitch: amp * 0.7 * Math.sin(t * 12.1 + 1) };
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
      const eyeTarget = (low ? SLIDE.eye : PLAYER.eye) * (me.big ? STREAK.bigScale : 1);
      eyeH += (eyeTarget - eyeH) * Math.min(1, dt * 14);
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
    const sway = sniperSway(now);
    camera.rotation.set(me.alive ? Math.min(1.5, me.pitch + recoil + sway.pitch) : -0.9, me.alive ? me.yaw + sway.yaw : 0, 0);
    // Камера ракеты с неба перекрывает обычный вид
    updateMissile(now, dt);
    updateGunship(now, dt);

    updateShooting(now);
    updateAim(dt);
    kick = Math.max(0, kick - dt * 0.6);
    recoil *= Math.exp(-dt / 0.12);
    // Взмах ножом — горизонтальный: справа налево, с выносом вперёд в середине
    const sw = now < swingUntil ? 1 - (swingUntil - now) / SWING_MS : -1;
    const swing = sw >= 0 ? Math.sin(Math.PI * sw) : 0;
    // В прицеле глаз подводится к прицелу: прицел оказывается в aim.relief метрах перед глазом,
    // а приклад уходит назад к щеке, за пределы обзора. Отдача в прицеле мягче.
    const aim = me.weapon === 'sniper' && !scopeOn ? viewGun.iron : viewGun.aim;
    const aimZ = aim ? -aim.relief - aim.z * viewModel.scale.z : -0.25;
    viewModel.position.z = -0.45 + (aimZ + 0.45) * adsK + kick * (1 - 0.7 * adsK) - swing * 0.12;
    viewModel.position.x += sw >= 0 ? 0.2 - 0.4 * sw : 0;
    viewModel.rotation.y = sw >= 0 ? -1.1 + 2.2 * sw : 0;
    viewModel.rotation.z = sw >= 0 ? -Math.PI / 2 * swing * 0.6 : 0;
    viewModel.rotation.x = kick * 1.5;
    animateGun(now);
    animateScope(now);

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
  const scoped = me.weapon === 'sniper' && scopeOn && adsK > 0.85;
  viewModel.visible = joined && me.alive && !scoped && !missileCtl && !gunner;
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
  updateKnives(dt);
  updateSinking(now);
  updateFireworks(dt);
  updateAmmoPacks(now);
  updateUnderground();
  updateWeather(dt);
  updateMinimap(now);
  updateNuke(now);
  updateVote(now);
  const timer = document.getElementById('match-timer');
  if (timer) timer.textContent = timerText();
  renderer.render(scene, camera);
}

updateHud();
requestAnimationFrame(frame);

// Для отладки из консоли
declare global {
  interface Window {
    game: {
      me: typeof me; remotes: typeof remotes; keys: typeof keys;
      steer: (yaw: number, pitch: number) => void; faces: () => string[]; dbg: () => Record<string, unknown>;
    };
  }
}
window.game = {
  me, remotes, keys,
  steer: (yaw: number, pitch: number) => {
    if (missileCtl) { missileCtl.yaw = yaw; missileCtl.pitch = pitch; }
    if (gunner) { gunner.yaw = yaw; gunner.pitch = pitch; }
  },
  faces: () => FACE_STEPS.map((_, l) => { faceTexture(l); return faceUrl[l]!; }),
  dbg: () => ({ scopeOn, scopeAnim: !!scopeAnim, sway: sniperSway(performance.now()), fovNow: camera.fov, gunship: gunshipFx ? gunshipFx.mesh.position.toArray() : null, gunner: gunner ? { heat: gunner.heat, over: performance.now() < gunner.overheatUntil } : null, markers: markerEls.size, bursts: bursts.length, weather: weatherKind, fogFar: fog.far, underground, sinking: sinking.length, remoteMissiles: remoteMissiles.size, packs: packFx.size,
    kit: settings.kit, reserve: { ...me.reserve }, hotbar: hotbar().map((h) => `${h.key}:${h.label}`).join(' '),
    missile: missileCtl ? missileCtl.pos.toArray() : null, low, adsK, fov: camera.fov, crateState, crateAt, eyeH, recoil, corpses: corpses.length, sprays: sprays.length,
    steps: stepCount, medkits: medkitFx.size, boltUntil, menuClosed, armor: me.armor }),
};
