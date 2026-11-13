// Сцена Three.js: рендерер, камера, свет, туман и небо.
import * as THREE from 'three';
import { $, BASE_FOV } from './util.js';

export const canvas = $<HTMLCanvasElement>('game');

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Мягкая цветокоррекция: яркие места не выгорают в белое, а оттенки цветов карты сохраняются
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.3;
// Тени от солнца считаются один раз при загрузке карты (карта неподвижна) — в бою кадр их не пересчитывает
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

export const scene = new THREE.Scene();

export const sky = new THREE.Color(0x9fc9ea);

export const fog = new THREE.Fog(0x9fc9ea, 30, 140);

export const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);

/** Рассеянный свет: сверху — оттенок неба, снизу — отражённый от земли. Цвета и силу задаёт погода и карта. */
export const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.5);

/** Солнце: тёплое в ясную погоду, тусклое и серое в дождь. */
export const sun = new THREE.DirectionalLight(0xffffff, 1.6);

/**
 * Небо — купол вокруг камеры: у горизонта цвет тумана (дальние дома растворяются в нём без шва),
 * к зениту — тот же оттенок, но глубже и насыщеннее. zenithK — насколько (в дождь и снег почти не меняется).
 */
export const skyUniforms = {
  horizon: { value: new THREE.Color(0x9fc9ea) },
  zenith: { value: new THREE.Color(0x3d7fd6) },
  zenithK: { value: 0.55 },
  /** Куда смотреть на солнце и видно ли его диск (на открытых картах в ясную погоду) */
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunOn: { value: 0 },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(200, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform float zenithK;
      uniform vec3 sunDir;
      uniform float sunOn;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 top = mix(horizon, zenith, zenithK);
        // Плавно от горизонта вверх, без излома на самой линии горизонта
        vec3 col = mix(horizon, top, 1.0 - pow(1.0 - h, 2.2));
        // Солнце: яркий диск (ярче всего на экране — от него свечение) и мягкий ореол вокруг
        float c = max(dot(d, sunDir), 0.0);
        col += sunOn * (vec3(9.0, 8.2, 6.6) * smoothstep(0.99955, 0.9998, c) + vec3(1.0, 0.85, 0.6) * (0.35 * pow(c, 64.0) + 0.15 * pow(c, 24.0)));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
skyDome.frustumCulled = false;
skyDome.renderOrder = -1;
// Купол всегда с центром в камере (какой бы камерой ни смотрели — своей, ракетой или с самолёта)
const camPos = new THREE.Vector3();
skyDome.onBeforeRender = (_r, _s, cam) => {
  cam.getWorldPosition(camPos);
  skyDome.matrixWorld.setPosition(camPos);                     // modelViewMatrix пересчитается из него следом
};

/** Подписчики на изменение размера окна (пост-обработка) */
const onResize: Array<(w: number, h: number) => void> = [];
export const addResizeListener = (f: (w: number, h: number) => void): void => { onResize.push(f); };

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  for (const f of onResize) f(window.innerWidth, window.innerHeight);
}

/** Включить или выключить тени: шейдеры всех материалов пересобираются, карта теней считается заново. */
export function setShadows(on: boolean): void {
  if (renderer.shadowMap.enabled === on) return;
  renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of mat ? (Array.isArray(mat) ? mat : [mat]) : []) m.needsUpdate = true;
  });
  if (on) renderer.shadowMap.needsUpdate = true;
}

/** Направление на солнце на закрытых картах (неподвижное) */
const SUN_DIR = new THREE.Vector3(22, 30, 12).normalize();   // ~50° над горизонтом
/** На открытых картах солнце обходит небо по кругу на этой высоте за SUN_TURN_MS — одинаково у всех (по часам) */
const SUN_ELEV = Math.asin(SUN_DIR.y), SUN_TURN_MS = 10 * 60_000;
/** Как часто пересчитывать тени, пока солнце движется (за секунду оно сдвигается на 0,6°) */
const SUN_SHADOW_MS = 1000;

let mapHalf = { x: 30, z: 30 }, movingSun = false, lastSunAt = 0;

/** Направление на солнце сейчас */
export function sunDirection(now = Date.now(), out = new THREE.Vector3()): THREE.Vector3 {
  if (!movingSun) return out.copy(SUN_DIR);
  const a = (now % SUN_TURN_MS) / SUN_TURN_MS * Math.PI * 2;
  return out.set(Math.cos(SUN_ELEV) * Math.cos(a), Math.sin(SUN_ELEV), Math.cos(SUN_ELEV) * Math.sin(a));
}

/**
 * Карта загружена: открытая (moving) — солнце ходит по кругу и видно в небе, закрытая — стоит на месте.
 * Тень настраивается под размер карты.
 */
export function setSunFor(half: { x: number; z: number }, moving: boolean): void {
  mapHalf = { ...half };
  movingSun = moving;
  bakeShadows(half);
}

/** Кадр: солнце сдвигается; тень пересчитывается раз в SUN_SHADOW_MS. */
export function updateSun(): void {
  if (!movingSun) return;
  const now = Date.now();
  sunDirection(now, skyUniforms.sunDir.value);
  if (now - lastSunAt >= SUN_SHADOW_MS) bakeShadows(mapHalf);
}

/** Настроить тень солнца под размер карты и направление солнца и пересчитать её (при загрузке карты; раз в секунду, если солнце движется). */
export function bakeShadows(half: { x: number; z: number }): void {
  lastSunAt = Date.now();
  sun.position.copy(sunDirection(lastSunAt, skyUniforms.sunDir.value)).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  // Кадр тени — ровно по карте, как её видит солнце: углы арены (со стенами, от земли до 12 м) в его координатах
  const cam = sun.shadow.camera;
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (const x of [-half.x - 1, half.x + 1]) for (const y of [-1, 12]) for (const z of [-half.z - 1, half.z + 1]) {
    p.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    lo.min(p); hi.max(p);
  }
  cam.left = lo.x - 1; cam.right = hi.x + 1; cam.bottom = lo.y - 1; cam.top = hi.y + 1;
  cam.near = Math.max(1, -hi.z - 2); cam.far = -lo.z + 2;
  cam.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, lit = true): THREE.Mesh {
  const material = lit ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initScene(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene.background = sky;
  scene.fog = fog;
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  scene.add(hemi);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;                                     // мягкий край тени
  scene.add(sun);
  scene.add(skyDome);
  window.addEventListener('resize', resize);
  resize();
}
