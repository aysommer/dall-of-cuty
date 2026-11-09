import * as THREE from 'three';
import { BOXES, WEAPONS, WEAPON_ORDER, PLAYER, WORLD, rayBox, rayWorld } from './shared/map.js';

const $ = (id) => document.getElementById(id);
const TEAM_COLOR = { green: 0x2fc44e, red: 0xe23b3b };
const SPEED = 6.5, JUMP = 7, GRAVITY = 19;

// ======================= сцена =======================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9ea);
scene.fog = new THREE.Fog(0x9fc9ea, 50, 130);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 40, 10);
scene.add(sun);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function box(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

// Карта: пол + блоки
{
  const size = WORLD.half * 2 + 2;
  const floor = box(size, 1, size, 0xc9a86a);
  floor.position.y = -0.5;
  scene.add(floor);
  for (const b of BOXES) {
    const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
    const m = box(w, h, d, b.color);
    m.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
    scene.add(m);
  }
}

// ======================= модели из кубиков =======================
// Оружие смотрит стволом вдоль -Z. Возвращает группу и положение дула.
function buildGun(type) {
  const g = new THREE.Group();
  const add = (w, h, d, color, x, y, z) => {
    const m = box(w, h, d, color);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  let muzzleZ;
  if (type === 'pistol') {
    add(0.05, 0.07, 0.24, 0x2b2b2b, 0, 0, -0.12);
    add(0.045, 0.13, 0.06, 0x3a2a1a, 0, -0.09, -0.03);
    muzzleZ = -0.26;
  } else if (type === 'shotgun') {
    add(0.06, 0.06, 0.7, 0x252525, 0, 0, -0.35);
    add(0.075, 0.06, 0.2, 0x7a4a22, 0, -0.055, -0.42);
    add(0.06, 0.1, 0.28, 0x7a4a22, 0, -0.03, 0.12);
    muzzleZ = -0.72;
  } else {
    add(0.06, 0.09, 0.5, 0x30343a, 0, 0, -0.2);
    add(0.035, 0.035, 0.3, 0x1c1c1c, 0, 0.01, -0.58);
    add(0.045, 0.18, 0.07, 0x1c1c1c, 0, -0.12, -0.22);
    add(0.055, 0.1, 0.24, 0x4a3a28, 0, -0.02, 0.16);
    add(0.02, 0.04, 0.12, 0x1c1c1c, 0, 0.065, -0.2);
    muzzleZ = -0.75;
  }
  const flash = box(0.12, 0.12, 0.12, 0xffd34d);
  flash.material = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  flash.position.set(0, 0, muzzleZ - 0.05);
  flash.visible = false;
  g.add(flash);
  g.userData = { flash, muzzleZ };
  return g;
}

function nameSprite(text, team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = team === 'green' ? '#7dff96' : '#ff8a8a';
  ctx.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// Игрок — одинаковый прямоугольник цвета команды
function buildPlayer(info) {
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
  scene.add(g);
  const r = { g, hand, gun: null, w: null, pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, targetYaw: 0, pitch: 0, flashUntil: 0 };
  setRemoteWeapon(r, 'pistol');
  return r;
}
function setRemoteWeapon(r, w) {
  if (r.w === w || !WEAPONS[w]) return;
  if (r.gun) r.hand.remove(r.gun);
  r.gun = buildGun(w);
  r.gun.scale.setScalar(1.4);
  r.hand.add(r.gun);
  r.w = w;
}

// ======================= состояние =======================
const me = {
  id: null, team: 'green', alive: false, hp: 100,
  pos: new THREE.Vector3(0, 0, 26), vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: false,
  weapon: 'pistol', ammo: {}, reloadUntil: 0, nextShot: 0,
};
for (const w of WEAPON_ORDER) me.ammo[w] = WEAPONS[w].mag;

let mode = 'tdm', limit = 20, scores = { green: 0, red: 0 };
let roster = [];               // список игроков с сервера
const remotes = new Map();     // id -> модель другого игрока
const keys = {};
let mouseDown = false, firedThisPress = false, locked = false, joined = false, roundOver = false;
let respawnAt = 0;

// Оружие в руках (вид от первого лица)
const viewModel = new THREE.Group();
viewModel.position.set(0.22, -0.2, -0.45);
viewModel.scale.setScalar(0.7);
camera.add(viewModel);
let viewGun = null, kick = 0;
function setWeapon(w) {
  if (!WEAPONS[w]) return;
  me.weapon = w;
  me.reloadUntil = 0;
  me.nextShot = Math.max(me.nextShot, performance.now() + 250);
  if (viewGun) viewModel.remove(viewGun);
  viewGun = buildGun(w);
  viewModel.add(viewGun);
  updateHud();
}

// ======================= звук =======================
let audio = null;
function initAudio() {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* без звука */ }
}
function shotSound(w, volume = 1) {
  if (!audio || volume <= 0.01) return;
  const dur = w === 'shotgun' ? 0.35 : w === 'rifle' ? 0.14 : 0.18;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = w === 'shotgun' ? 900 : w === 'rifle' ? 2600 : 1800;
  const gain = audio.createGain();
  gain.gain.value = 0.35 * volume;
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start();
}
function beep(freq, dur, volume = 0.15) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + dur);
}

// ======================= трассеры =======================
const tracers = [];
function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, born: performance.now() });
  // Искра в точке попадания
  const spark = box(0.08, 0.08, 0.08, 0xffe08a);
  spark.material = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  spark.position.copy(to);
  scene.add(spark);
  tracers.push({ line: spark, born: performance.now(), spark: true });
}
function updateTracers(now) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    const life = t.spark ? 160 : 70;
    const age = now - t.born;
    if (age > life) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      tracers.splice(i, 1);
    } else if (!t.spark) {
      t.line.material.opacity = 0.9 * (1 - age / life);
    }
  }
}

// ======================= сеть =======================
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
const sendMsg = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

ws.addEventListener('close', () => {
  $('status').textContent = 'Соединение с сервером потеряно. Обнови страницу.';
  $('play').disabled = true;
  if (joined) {
    document.exitPointerLock?.();
    $('hud').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }
});

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  switch (m.t) {
    case 'info': onInfo(m); break;
    case 'error': $('status').textContent = m.text; $('play').disabled = false; break;
    case 'welcome':
      me.id = m.id;
      mode = m.mode;
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
    case 'reset':
      roundOver = false;
      $('center-msg').textContent = '';
      break;
  }
});

function onPlayers(m) {
  mode = m.mode; limit = m.limit; scores = m.scores; roster = m.list;
  const seen = new Set();
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
  viewModel.visible = me.alive;
  updateHud();
}

function onSpawn(m) {
  if (m.id === me.id) {
    me.pos.set(m.p[0], m.p[1], m.p[2]);
    me.vel.set(0, 0, 0);
    me.yaw = m.yaw;
    me.pitch = 0;
    me.alive = true;
    me.hp = 100;
    for (const w of WEAPON_ORDER) me.ammo[w] = WEAPONS[w].mag;
    me.reloadUntil = 0;
    viewModel.visible = true;
    if (!roundOver) $('center-msg').textContent = '';
    updateHud();
  } else {
    const r = remotes.get(m.id);
    if (r) {
      r.pos.set(m.p[0], m.p[1], m.p[2]);
      r.target.copy(r.pos);
      r.yaw = r.targetYaw = m.yaw;
    }
  }
}

function onSnap(m) {
  for (const s of m.ps) {
    const r = remotes.get(s[0]);
    if (!r) continue;
    r.target.set(s[1], s[2], s[3]);
    r.targetYaw = s[4];
    r.pitch = s[5];
    setRemoteWeapon(r, s[6]);
  }
}

function onShot(m) {
  const r = remotes.get(m.id);
  if (!r) return;
  setRemoteWeapon(r, m.w);
  r.flashUntil = performance.now() + 50;
  r.gun.updateWorldMatrix(true, false);
  const from = new THREE.Vector3(0, 0, r.gun.userData.muzzleZ).applyMatrix4(r.gun.matrixWorld);
  for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
  const dist = r.pos.distanceTo(me.pos);
  shotSound(m.w, Math.max(0, 1 - dist / 70) * 0.8);
}

const playerName = (id) => roster.find((p) => p.id === id);
function onKill(m) {
  const k = playerName(m.killer), v = playerName(m.victim);
  if (!k || !v) return;
  const row = document.createElement('div');
  const span = (p) => {
    const s = document.createElement('span');
    s.className = 't-' + p.team;
    s.textContent = p.name;
    return s;
  };
  row.append(span(k), ` ▸ ${WEAPONS[m.w]?.name ?? ''} ▸ `, span(v));
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
  if (m.killer === me.id) { showHit(true); beep(880, 0.15); }
  if (m.victim === me.id) {
    $('center-msg').textContent = `Тебя убил ${k.name}\nВозрождение через 3 сек.`;
  }
}

function onOver(m) {
  roundOver = true;
  let text;
  if (m.winner.team) text = m.winner.team === 'green' ? 'Победили ЗЕЛЁНЫЕ' : 'Победили КРАСНЫЕ';
  else text = `Победил ${m.winner.name}`;
  $('center-msg').textContent = `${text}\nНовый раунд через ${Math.round(m.pause / 1000)} сек.`;
}

// ======================= меню =======================
let chosenMode = 'tdm', chosenTeam = 'green';
$('name').value = localStorage.getItem('doc-name') || '';

function onInfo(m) {
  if (joined) return;
  $('play').disabled = m.count >= m.max;
  $('play').textContent = m.count >= m.max ? 'Сервер заполнен' : 'ИГРАТЬ';
  const modeLocked = m.count > 0;
  if (modeLocked) chosenMode = m.mode;
  for (const b of $('mode-choice').children) {
    b.classList.toggle('active', b.dataset.mode === chosenMode);
    b.disabled = modeLocked;
  }
  $('mode-note').textContent = modeLocked
    ? `На сервере уже ${m.count} из ${m.max} — режим выбрал первый игрок.`
    : 'Ты первый — режим выбираешь ты.';
  const tdm = chosenMode === 'tdm';
  $('green-count').textContent = tdm ? `${m.green}/2` : '';
  $('red-count').textContent = tdm ? `${m.red}/2` : '';
  const full = { green: tdm && m.green >= 2, red: tdm && m.red >= 2 };
  if (full[chosenTeam]) chosenTeam = chosenTeam === 'green' ? 'red' : 'green';
  for (const b of $('team-choice').children) {
    b.disabled = full[b.dataset.team];
    b.classList.toggle('active', b.dataset.team === chosenTeam);
  }
  lastInfo = m;
}
let lastInfo = null;
$('mode-choice').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  chosenMode = b.dataset.mode;
  if (lastInfo) onInfo(lastInfo);
});
$('team-choice').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  chosenTeam = b.dataset.team;
  if (lastInfo) onInfo(lastInfo);
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  initAudio();
  const name = $('name').value.trim();
  localStorage.setItem('doc-name', name);
  $('play').disabled = true;
  sendMsg({ t: 'join', name, team: chosenTeam, mode: chosenMode });
});

// ======================= управление =======================
function lock() {
  initAudio();
  canvas.requestPointerLock?.();
}
$('pause').addEventListener('click', lock);
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
  me.yaw -= e.movementX * 0.0022;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * 0.0022));
});
document.addEventListener('mousedown', (e) => {
  if (locked && e.button === 0) { mouseDown = true; firedThisPress = false; }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('wheel', (e) => {
  if (!locked) return;
  const i = WEAPON_ORDER.indexOf(me.weapon);
  const n = WEAPON_ORDER.length;
  setWeapon(WEAPON_ORDER[(i + (e.deltaY > 0 ? 1 : n - 1)) % n]);
});
document.addEventListener('keydown', (e) => {
  if (!joined || e.target.tagName === 'INPUT') return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); renderScoreboard(); }
  if (!locked) return;
  keys[e.code] = true;
  if (e.code === 'Digit1') setWeapon('pistol');
  if (e.code === 'Digit2') setWeapon('shotgun');
  if (e.code === 'Digit3') setWeapon('rifle');
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
});

// ======================= движение и столкновения =======================
function hitBox(p) {
  const r = PLAYER.w / 2;
  for (const b of BOXES) {
    if (p.x + r > b.min[0] && p.x - r < b.max[0] &&
        p.y + PLAYER.h > b.min[1] && p.y < b.max[1] &&
        p.z + r > b.min[2] && p.z - r < b.max[2]) return b;
  }
  return null;
}

function move(dt) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const len = Math.hypot(f, s) || 1;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const wishX = (-sin * f + cos * s) / len * SPEED;
  const wishZ = (-cos * f - sin * s) / len * SPEED;
  const accel = me.grounded ? 14 : 4;
  const k = Math.min(1, accel * dt);
  me.vel.x += (wishX - me.vel.x) * k;
  me.vel.z += (wishZ - me.vel.z) * k;
  if (keys.Space && me.grounded) { me.vel.y = JUMP; me.grounded = false; }
  me.vel.y -= GRAVITY * dt;

  const p = me.pos;
  p.x += me.vel.x * dt;
  if (hitBox(p)) { p.x -= me.vel.x * dt; me.vel.x = 0; }
  p.z += me.vel.z * dt;
  if (hitBox(p)) { p.z -= me.vel.z * dt; me.vel.z = 0; }

  p.y += me.vel.y * dt;
  me.grounded = false;
  if (p.y <= 0) { p.y = 0; me.vel.y = 0; me.grounded = true; }
  else {
    const b = hitBox(p);
    if (b) {
      if (me.vel.y <= 0) { p.y = b.max[1]; me.grounded = true; }
      else p.y = b.min[1] - PLAYER.h - 0.001;
      me.vel.y = 0;
    }
  }
}

// ======================= стрельба =======================
function startReload() {
  const w = WEAPONS[me.weapon];
  if (me.reloadUntil || me.ammo[me.weapon] >= w.mag || !me.alive) return;
  me.reloadUntil = performance.now() + w.reload;
  beep(300, 0.08, 0.08);
  updateHud();
}

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
function fire(now) {
  const w = WEAPONS[me.weapon];
  me.nextShot = now + w.rate;
  me.ammo[me.weapon]--;
  firedThisPress = true;

  camera.updateMatrixWorld(true);
  const eye = [camera.position.x, camera.position.y, camera.position.z];
  camera.getWorldDirection(_dir);
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);
  const muzzle = new THREE.Vector3(0, 0, viewGun.userData.muzzleZ).applyMatrix4(viewGun.matrixWorld);

  const hits = {};
  const ends = [];
  let anyHit = false;
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * w.spread;
    const d = _dir.clone().addScaledVector(_right, Math.cos(a) * rad).addScaledVector(_up, Math.sin(a) * rad).normalize();
    const dv = [d.x, d.y, d.z];
    let t = rayWorld(eye, dv);
    let victim = null;
    for (const [id, r] of remotes) {
      if (!r.info?.alive) continue;
      if (mode === 'tdm' && r.info.team === me.team) continue;
      const hw = PLAYER.w / 2;
      const tp = rayBox(eye, dv,
        [r.pos.x - hw, r.pos.y, r.pos.z - hw],
        [r.pos.x + hw, r.pos.y + PLAYER.h, r.pos.z + hw]);
      if (tp < t) { t = tp; victim = id; }
    }
    if (victim !== null) { hits[victim] = (hits[victim] || 0) + 1; anyHit = true; }
    const end = new THREE.Vector3(eye[0] + dv[0] * t, eye[1] + dv[1] * t, eye[2] + dv[2] * t);
    ends.push([+end.x.toFixed(2), +end.y.toFixed(2), +end.z.toFixed(2)]);
    addTracer(muzzle, end);
  }
  sendMsg({ t: 'shoot', w: me.weapon, ends, hits });
  if (anyHit) { showHit(false); beep(1400, 0.05, 0.08); }

  shotSound(me.weapon);
  kick = me.weapon === 'shotgun' ? 0.12 : 0.05;
  me.pitch = Math.min(1.5, me.pitch + (me.weapon === 'shotgun' ? 0.035 : me.weapon === 'rifle' ? 0.012 : 0.015));
  viewGun.userData.flash.visible = true;
  setTimeout(() => { if (viewGun) viewGun.userData.flash.visible = false; }, 45);
  if (me.ammo[me.weapon] <= 0) startReload();
  updateHud();
}

function updateShooting(now) {
  if (me.reloadUntil && now >= me.reloadUntil) {
    me.ammo[me.weapon] = WEAPONS[me.weapon].mag;
    me.reloadUntil = 0;
    updateHud();
  }
  if (!mouseDown || !me.alive || !locked || me.reloadUntil || now < me.nextShot) return;
  const w = WEAPONS[me.weapon];
  if (!w.auto && firedThisPress) return;
  if (me.ammo[me.weapon] <= 0) { startReload(); return; }
  fire(now);
}

// ======================= HUD =======================
let hitTimer = 0, dmgTimer = 0;
function showHit(kill) {
  const el = $('hitmarker');
  el.classList.toggle('kill', kill);
  el.classList.add('show');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => el.classList.remove('show'), kill ? 250 : 60);
}
function flashDamage() {
  $('damage').classList.add('show');
  clearTimeout(dmgTimer);
  dmgTimer = setTimeout(() => $('damage').classList.remove('show'), 80);
}

function updateHud() {
  $('hp').textContent = me.alive ? me.hp : 0;
  $('health').classList.toggle('low', me.hp <= 30);
  $('weapon-name').textContent = WEAPONS[me.weapon].name;
  $('ammo-count').textContent = me.reloadUntil ? '…' : me.ammo[me.weapon];
  for (const s of $('slots').children) s.classList.toggle('active', s.dataset.w === me.weapon);

  const score = $('score');
  score.textContent = '';
  const part = (cls, text) => {
    const s = document.createElement(cls === 'small' ? 'small' : 'span');
    if (cls !== 'small') s.className = cls;
    s.textContent = text;
    return s;
  };
  if (mode === 'tdm') {
    score.append(part('g', `Зелёные ${scores.green}`), ' : ', part('r', `${scores.red} Красные`), part('small', `до ${limit}`));
  } else {
    const mine = roster.find((p) => p.id === me.id);
    const top = [...roster].sort((a, b) => b.kills - a.kills)[0];
    score.append(`Ты: ${mine?.kills ?? 0}`);
    if (top) score.append(part('small', `лидер: ${top.name} — ${top.kills} · до ${limit}`));
  }
  if (!$('scoreboard').classList.contains('hidden')) renderScoreboard();
}

function renderScoreboard() {
  const sb = $('scoreboard');
  sb.textContent = '';
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const [t, cls] of [['Игрок', ''], ['Убийства', 'n'], ['Смерти', 'n']]) {
    const th = document.createElement('th');
    th.textContent = t; th.className = cls;
    head.append(th);
  }
  const order = { green: 0, red: 1 };
  const list = [...roster].sort((a, b) =>
    (mode === 'tdm' ? order[a.team] - order[b.team] : 0) || b.kills - a.kills);
  for (const p of list) {
    const row = table.insertRow();
    if (p.id === me.id) row.className = 'me';
    const n = row.insertCell(); n.textContent = p.name; n.className = 't-' + p.team;
    const k = row.insertCell(); k.textContent = p.kills; k.className = 'n';
    const d = row.insertCell(); d.textContent = p.deaths; d.className = 'n';
  }
  sb.append(table);
}

// ======================= главный цикл =======================
let last = performance.now(), sendAcc = 0;
function frame(now) {
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
        const first = $('center-msg').textContent.split('\n')[0];
        $('center-msg').textContent = `${first}\nВозрождение через ${left} сек.`;
      }
    }
    camera.rotation.set(me.alive ? me.pitch : -0.9, me.yaw, 0);

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
    camera.position.set(Math.sin(a) * 42, 26, Math.cos(a) * 42);
    camera.lookAt(0, 0, 0);
  }
  viewModel.visible = joined && me.alive;

  const k = 1 - Math.exp(-16 * dt);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    let dy = r.targetYaw - r.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.yaw += dy * k;
    r.g.position.copy(r.pos);
    r.g.rotation.y = r.yaw;
    r.hand.rotation.x = r.pitch;
    r.gun.userData.flash.visible = now < r.flashUntil;
  }

  updateTracers(now);
  renderer.render(scene, camera);
}

setWeapon('pistol');
requestAnimationFrame(frame);

// Для отладки из консоли
window.game = { me, remotes, keys };
