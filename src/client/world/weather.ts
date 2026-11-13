// Погода: дождь и снег.
import * as THREE from 'three';
import type { WeatherKind } from '../../shared/map.js';
import type { WeatherMsg } from '../../shared/protocol.js';
import { camera, fog, hemi, scene, sky, skyUniforms, sun } from '../core/scene.js';
import { state } from '../core/state.js';
import { toast } from '../ui/hud.js';
import { currentMap } from './map.js';
import { blockLight } from './blocks.js';

export let weatherKind: WeatherKind | null = null;

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

const WHITE = new THREE.Color(0xffffff);
const hsl = { h: 0, s: 0, l: 0 };

/**
 * Видимость и свет: в дождь туман ближе и серее, в снег — ещё ближе и белее.
 * Ясно: солнце тёплое, рассеянный свет сверху с оттенком неба карты, снизу — отражённый от её земли.
 * Под крышей солнце слабое, а рассеянный свет ровный и тёплый, как от ламп.
 */
export function applyFog(): void {
  const m = currentMap;
  if (weatherKind === 'rain') { fog.near = 8; fog.far = 45; fog.color.set(0x7d8791); sky.set(0x7d8791); }
  else if (weatherKind === 'snow') { fog.near = 5; fog.far = 30; fog.color.set(0xd5dce3); sky.set(0xd5dce3); }
  else { fog.near = 30; fog.far = 140; fog.color.set(m.sky); sky.set(m.sky); }
  skyUniforms.horizon.value.copy(fog.color);
  // Зенит — тот же оттенок, что у горизонта, но насыщеннее и темнее: без серой полосы от смешения с чужим цветом
  fog.color.getHSL(hsl);
  skyUniforms.zenith.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.08), hsl.l * 0.72);
  skyUniforms.zenithK.value = weatherKind ? 0.3 : 1;
  // Диск солнца — только на открытых картах в ясную погоду
  skyUniforms.sunOn.value = weatherKind || m.indoor ? 0 : 1;
  hemi.groundColor.set(m.floor).multiplyScalar(0.75);
  if (m.indoor) {
    hemi.color.set(0xfff4e2); hemi.intensity = 1.9;
    sun.color.set(0xfff1dc); sun.intensity = 0.7;
  } else if (weatherKind === 'rain') {
    hemi.color.set(0xc9d2dc); hemi.intensity = 1.7;
    sun.color.set(0xb9c4d0); sun.intensity = 0.6;
  } else if (weatherKind === 'snow') {
    hemi.color.set(0xeef2f7); hemi.intensity = 1.8;
    sun.color.set(0xe4ebf3); sun.intensity = 0.8;
  } else {
    hemi.color.copy(WHITE).lerp(new THREE.Color(m.sky), 0.35); hemi.intensity = 1.2;
    sun.color.set(0xffe9cc); sun.intensity = 2.15;
  }
  // Отражённый свет для запечённого освещения: стены и пол вокруг освещены солнцем и небом
  blockLight.bounce.value.copy(sun.color).multiplyScalar(sun.intensity * 0.22).add(hemi.color.clone().multiplyScalar(hemi.intensity * 0.12));
}

export function onWeather(m: WeatherMsg): void {
  state.lastWeather = m;
  if (currentMap.indoor) m = { t: 'weather', kind: null, ms: 0 }; // под крышей дождя и снега нет
  if (m.kind === weatherKind) return;
  if (weatherFx) { scene.remove(weatherFx); weatherFx.geometry.dispose(); weatherFx = null; }
  const was = weatherKind;
  weatherKind = m.kind;
  if (m.kind) {
    weatherFx = buildWeather(m.kind);
    scene.add(weatherFx);
    if (state.joined) toast(m.kind === 'rain' ? '🌧 Пошёл дождь — видно хуже' : '❄ Пошёл снег — видно хуже');
  } else if (was && state.joined) toast('☀ Прояснилось');
  applyFog();
}

export function updateWeather(dt: number): void {
  if (!weatherFx || !weatherKind) return;
  // Под землёй не идёт; наверху «коробка» с осадками ездит за камерой, частицы падают и возвращаются наверх
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
