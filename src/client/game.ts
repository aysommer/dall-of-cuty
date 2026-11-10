import * as THREE from 'three';
import {
  CRATE, MAPS, MAP_ORDER, ROCKET, WEAPONS, WEAPON_ORDER, PLAYER, rayBox, rayWorld,
  type Box, type GameMap, type Ladder, type MapId,
} from '../shared/map.js';
import {
  KILLS_PER_POINT, STATS, UPGRADES, maxLevel, multiplier, newProfile, pointsLeft, type Profile,
} from '../shared/progress.js';
import type {
  BoomMsg, CrateMsg, CrateState, RocketMsg,
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

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
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
let crateState: CrateState = 'idle';
let crateBy: number | null = null;
let crateMesh: THREE.Mesh | null = null;
let crateBox: Box | null = null;
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

function nearCrate(): boolean {
  const [cx, cy, cz] = currentMap.crate;
  return Math.hypot(me.pos.x - cx, me.pos.z - cz) <= CRATE.reach && Math.abs(me.pos.y - cy) <= 1.5;
}

function onCrate(m: CrateMsg): void {
  crateState = m.state;
  crateBy = m.by;
  if (crateMesh) crateMesh.visible = m.state !== 'gone';
  openingUntil = m.state === 'opening' && m.by === me.id ? performance.now() + m.ms : 0;
  if (m.state === 'gone' && m.by === null) beep(520, 0.3, 0.1);
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

  const [cx, cy, cz] = currentMap.crate;
  crateMesh = buildCrate();
  crateMesh.position.set(cx, cy + CRATE.height / 2, cz);
  crateMesh.visible = crateState !== 'gone';
  mapGroup.add(crateMesh);
  const half = CRATE.size / 2;
  crateBox = { min: [cx - half, cy, cz - half], max: [cx + half, cy + CRATE.height, cz + half], color: '' };
}
loadMap('sands');

// ======================= модели из кубиков =======================
interface Gun {
  group: THREE.Group;
  flash: THREE.Mesh;
  muzzleZ: number;
}

// Оружие смотрит стволом вдоль -Z.
function buildGun(type: WeaponId): Gun {
  const group = new THREE.Group();
  const add = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): void => {
    const m = box(w, h, d, color);
    m.position.set(x, y, z);
    group.add(m);
  };
  let muzzleZ: number;
  if (type === 'pistol') {
    add(0.05, 0.07, 0.24, 0x2b2b2b, 0, 0, -0.12);
    add(0.045, 0.13, 0.06, 0x3a2a1a, 0, -0.09, -0.03);
    muzzleZ = -0.26;
  } else if (type === 'shotgun') {
    add(0.06, 0.06, 0.7, 0x252525, 0, 0, -0.35);
    add(0.075, 0.06, 0.2, 0x7a4a22, 0, -0.055, -0.42);
    add(0.06, 0.1, 0.28, 0x7a4a22, 0, -0.03, 0.12);
    muzzleZ = -0.72;
  } else if (type === 'rocket') {
    add(0.15, 0.15, 0.9, 0x4c5a3a, 0, 0.02, -0.25);
    add(0.19, 0.19, 0.12, 0x2b2b2b, 0, 0.02, -0.7);
    add(0.19, 0.19, 0.12, 0x2b2b2b, 0, 0.02, 0.2);
    add(0.05, 0.14, 0.07, 0x2b2b2b, 0, -0.12, -0.2);
    muzzleZ = -0.78;
  } else {
    add(0.06, 0.09, 0.5, 0x30343a, 0, 0, -0.2);
    add(0.035, 0.035, 0.3, 0x1c1c1c, 0, 0.01, -0.58);
    add(0.045, 0.18, 0.07, 0x1c1c1c, 0, -0.12, -0.22);
    add(0.055, 0.1, 0.24, 0x4a3a28, 0, -0.02, 0.16);
    add(0.02, 0.04, 0.12, 0x1c1c1c, 0, 0.065, -0.2);
    muzzleZ = -0.75;
  }
  const flash = box(0.12, 0.12, 0.12, 0xffd34d, false);
  flash.position.set(0, 0, muzzleZ - 0.05);
  flash.visible = false;
  group.add(flash);
  return { group, flash, muzzleZ };
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
  crown: THREE.Group;
  label: THREE.Sprite;
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
  const body = box(PLAYER.w, PLAYER.h, PLAYER.w, TEAM_COLOR[info.team]);
  body.position.y = PLAYER.h / 2;
  g.add(body);
  const visor = box(PLAYER.w * 0.8, 0.16, 0.06, 0x111111); // показывает, куда смотрит игрок
  visor.position.set(0, PLAYER.eye, -PLAYER.w / 2);
  g.add(visor);
  const hand = new THREE.Group();
  hand.position.set(PLAYER.w / 2 + 0.06, 1.25, -0.25);
  g.add(hand);
  const label = nameSprite(info.name, info.team);
  label.position.y = PLAYER.h + 0.35;
  g.add(label);
  const crown = buildCrown();
  g.add(crown);
  scene.add(g);
  const gun = remoteGun('pistol');
  hand.add(gun.group);
  return {
    info, g, crown, label, hand, gun, w: 'pistol',
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
  pos: new THREE.Vector3(0, 0, 26),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  weapon: 'pistol' as WeaponId,
  ammo: { pistol: WEAPONS.pistol.mag, shotgun: WEAPONS.shotgun.mag, rifle: WEAPONS.rifle.mag, rocket: 0 } as Record<WeaponId, number>,
  reloadUntil: 0,
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
function shotSound(w: WeaponId | 'boom', volume = 1): void {
  if (!audio || !master || volume <= 0.01) return;
  const dur = w === 'boom' ? 0.8 : w === 'shotgun' || w === 'rocket' ? 0.35 : w === 'rifle' ? 0.14 : 0.18;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = w === 'boom' ? 350 : w === 'rocket' ? 600 : w === 'shotgun' ? 900 : w === 'rifle' ? 2600 : 1800;
  const gain = audio.createGain();
  gain.gain.value = (w === 'boom' ? 0.9 : 0.35) * volume;
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
      if (p.hp < me.hp && p.alive) flashDamage();
      me.hp = p.hp;
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
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { scene.remove(r.g); remotes.delete(id); }
  }
  const leader = leaderId();
  for (const [id, r] of remotes) {
    r.crown.visible = id === leader;
    r.label.position.y = PLAYER.h + (id === leader ? 0.7 : 0.35); // имя — над короной
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
  for (const [id, x, y, z, yaw, pitch, w] of m.ps) {
    const r = remotes.get(id);
    if (!r) continue;
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
  r.flashUntil = performance.now() + 50;
  const from = muzzleWorld(r.gun);
  for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
  const dist = r.pos.distanceTo(me.pos);
  shotSound(m.w, Math.max(0, 1 - dist / 70) * 0.8);
}

function onKill(m: KillMsg): void {
  const k = roster.find((p) => p.id === m.killer);
  const v = roster.find((p) => p.id === m.victim);
  if (!v) return;
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
  row.append(span(k), ` ▸ ${WEAPONS[m.w].name} ▸ `, span(v));
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
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('pause').classList.toggle('hidden', locked || !joined);
  if (!locked) { mouseDown = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  // Браузеры иногда присылают ложный рывок сразу после захвата курсора
  if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
  const sens = MOUSE_SENS * settings.sens;
  me.yaw -= e.movementX * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * sens));
});
document.addEventListener('mousedown', (e) => {
  if (locked && e.button === 0) { mouseDown = true; firedThisPress = false; }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('wheel', (e) => {
  if (!locked) return;
  const order: WeaponId[] = me.ammo.rocket > 0 ? [...WEAPON_ORDER, 'rocket'] : WEAPON_ORDER;
  const i = order.indexOf(me.weapon);
  const n = order.length;
  setWeapon(order[(i + (e.deltaY > 0 ? 1 : n - 1)) % n]!);
});
document.addEventListener('keydown', (e) => {
  if (!joined || e.target instanceof HTMLInputElement) return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); renderScoreboard(); }
  if (!locked) return;
  keys[e.code] = true;
  if (e.code === 'Digit1') setWeapon('pistol');
  if (e.code === 'Digit2') setWeapon('shotgun');
  if (e.code === 'Digit3') setWeapon('rifle');
  if (e.code === 'Digit4') setWeapon('rocket');
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
function hitBox(p: THREE.Vector3): Box | null {
  const r = PLAYER.w / 2;
  for (const b of currentMap.boxes) {
    if (p.x + r > b.min[0] && p.x - r < b.max[0] &&
        p.y + PLAYER.h > b.min[1] && p.y < b.max[1] &&
        p.z + r > b.min[2] && p.z - r < b.max[2]) return b;
  }
  // Ящик тоже твёрдый, пока его не открыли
  const c = crateState !== 'gone' ? crateBox : null;
  if (c && p.x + r > c.min[0] && p.x - r < c.max[0] &&
      p.y + PLAYER.h > c.min[1] && p.y < c.max[1] &&
      p.z + r > c.min[2] && p.z - r < c.max[2]) return c;
  return null;
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

function move(dt: number): void {
  // Пока открываем ящик — стоим на месте
  const frozen = openingUntil > 0;
  const f = frozen ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = frozen ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const len = Math.hypot(f, s) || 1;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let speed = SPEED * multiplier(profile.levels, 'walk');
  if (keys.ShiftLeft || keys.ShiftRight) speed *= multiplier(profile.levels, 'sprint');
  const wish = { x: (-sin * f + cos * s) / len * speed, z: (-cos * f - sin * s) / len * speed };
  const p = me.pos;
  const now = performance.now();
  const ladder = now >= ladderBlockedUntil ? touchingLadder(p) : null;

  if (!ladder || !climb(ladder, f, wish, now)) {
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
      else p.y = b.min[1] - PLAYER.h - 0.001;
      me.vel.y = 0;
    }
  }
}

// ======================= стрельба =======================
function startReload(): void {
  const w = WEAPONS[me.weapon];
  if (me.weapon === 'rocket') return; // ракетница не перезаряжается
  if (me.reloadUntil || me.ammo[me.weapon] >= w.mag || !me.alive) return;
  me.reloadUntil = performance.now() + w.reload / multiplier(profile.levels, 'reload');
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
  const muzzle = muzzleWorld(viewGun);

  const hits: Record<number, number> = {};
  const ends: Vec3[] = [];
  let anyHit = false;
  const hw = PLAYER.w / 2;
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * w.spread;
    const d = _dir.clone().addScaledVector(_right, Math.cos(a) * rad).addScaledVector(_up, Math.sin(a) * rad).normalize();
    const dv: Vec3 = [d.x, d.y, d.z];
    let t = rayWorld(currentMap.boxes, eye, dv);
    let victim: number | null = null;
    for (const [id, r] of remotes) {
      if (!r.info.alive) continue;
      if (mode === 'tdm' && r.info.team === me.team) continue;
      const tp = rayBox(eye, dv,
        [r.pos.x - hw, r.pos.y, r.pos.z - hw],
        [r.pos.x + hw, r.pos.y + PLAYER.h, r.pos.z + hw]);
      if (tp < t) { t = tp; victim = id; }
    }
    if (victim !== null) { hits[victim] = (hits[victim] ?? 0) + 1; anyHit = true; }
    const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
    addTracer(muzzle, end);
  }
  sendMsg({ t: 'shoot', w: me.weapon, ends, hits });
  if (anyHit) { showHit(false); beep(1400, 0.05, 0.08); }

  shotSound(me.weapon);
  kick = me.weapon === 'shotgun' ? 0.12 : 0.05;
  me.pitch = Math.min(1.5, me.pitch + (me.weapon === 'shotgun' ? 0.035 : me.weapon === 'rifle' ? 0.012 : 0.015));
  const flash = viewGun.flash;
  flash.visible = true;
  setTimeout(() => { flash.visible = false; }, 45);
  if (me.ammo[me.weapon] <= 0) startReload();
  updateHud();
}

function fireRocket(now: number): void {
  if (me.ammo.rocket <= 0) return;
  me.nextShot = now + WEAPONS.rocket.rate;
  firedThisPress = true;
  me.ammo.rocket--; // сервер пришлёт точное число
  camera.getWorldDirection(_dir);
  sendMsg({ t: 'rocket', d: [+_dir.x.toFixed(4), +_dir.y.toFixed(4), +_dir.z.toFixed(4)] });
  kick = 0.16;
  me.pitch = Math.min(1.5, me.pitch + 0.04);
  updateHud();
}

function updateShooting(now: number): void {
  if (me.reloadUntil && now >= me.reloadUntil) {
    me.ammo[me.weapon] = WEAPONS[me.weapon].mag;
    me.reloadUntil = 0;
    updateHud();
  }
  if (!mouseDown || !me.alive || !locked || me.reloadUntil || now < me.nextShot || openingUntil) return;
  const w = WEAPONS[me.weapon];
  if (!w.auto && firedThisPress) return;
  if (me.weapon === 'rocket') { fireRocket(now); return; }
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
  $('health').classList.toggle('low', me.hp <= 30);
  $('weapon-name').textContent = WEAPONS[me.weapon].name;
  $('ammo-count').textContent = me.reloadUntil ? '…' : String(me.ammo[me.weapon]);
  $('ammo-total').textContent = me.weapon === 'rocket' ? ' ракет' : ' / ∞';
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
  if (joined && me.alive && crateState !== 'gone') {
    if (openingUntil) {
      progress = Math.max(0, Math.min(1, 1 - (openingUntil - now) / CRATE.openMs));
      text = 'Открываю ящик… F — отмена';
    } else if (nearCrate()) {
      const opener = crateState === 'opening' ? roster.find((p) => p.id === crateBy) : null;
      text = opener ? `Ящик открывает ${opener.name}` : 'F — открыть ящик (5 сек., двигаться нельзя)';
    }
  }
  prompt.classList.toggle('hidden', !text);
  if (!text) return;
  $('crate-text').textContent = text;
  $('crate-bar').classList.toggle('hidden', progress < 0);
  $('crate-fill').style.width = `${Math.round(Math.max(0, progress) * 100)}%`;
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
      camera.position.set(me.pos.x, me.pos.y + PLAYER.eye, me.pos.z);
    } else {
      // После смерти камера смотрит на место гибели сверху
      camera.position.set(me.pos.x, me.pos.y + 6, me.pos.z + 4);
      const left = Math.max(0, Math.ceil((respawnAt - now) / 1000));
      if (!roundOver && left > 0) {
        const first = ($('center-msg').textContent ?? '').split('\n')[0];
        $('center-msg').textContent = `${first}\nВозрождение через ${left} сек.`;
      }
    }
    camera.rotation.set(me.alive ? me.pitch : -0.9, me.alive ? me.yaw : 0, 0);

    updateShooting(now);
    kick = Math.max(0, kick - dt * 0.6);
    viewModel.position.z = -0.45 + kick;
    viewModel.rotation.x = kick * 1.5 + (me.reloadUntil ? -0.5 : 0);

    sendAcc += dt;
    if (sendAcc >= 0.05) {
      sendAcc = 0;
      sendMsg({
        t: 'state',
        p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)],
        yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), w: me.weapon,
      });
    }
  } else {
    // Облёт карты под меню
    const a = now / 9000;
    const r = Math.max(currentMap.half.x, currentMap.half.z) * 1.4;
    camera.position.set(Math.sin(a) * r, r * 0.62, Math.cos(a) * r);
    camera.lookAt(0, 0, 0);
  }
  viewModel.visible = joined && me.alive;

  const k = 1 - Math.exp(-16 * dt);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    const dy = r.targetYaw - r.yaw;
    r.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
    r.g.position.copy(r.pos);
    r.g.rotation.y = r.yaw;
    r.hand.rotation.x = r.pitch;
    r.gun.flash.visible = now < r.flashUntil;
  }

  updateRockets(now, dt);
  updateEffects(now);
  updateCratePrompt(now);
  renderer.render(scene, camera);
}

updateHud();
requestAnimationFrame(frame);

// Для отладки из консоли
declare global {
  interface Window {
    game: { me: typeof me; remotes: typeof remotes; keys: typeof keys };
  }
}
window.game = { me, remotes, keys };
