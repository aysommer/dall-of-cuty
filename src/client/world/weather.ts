// Погода: дождь и снег.
import * as THREE from 'three';
import type { WeatherKind } from '../../shared/map.js';
import type { WeatherMsg } from '../../shared/protocol.js';
import { camera, fog, scene, sky } from '../core/scene.js';
import { state } from '../core/state.js';
import { toast } from '../ui/hud.js';
import { currentMap } from './map.js';

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

/** Видимость: в дождь туман ближе и серее, в снег — ещё ближе и белее. */
export function applyFog(): void {
  if (weatherKind === 'rain') { fog.near = 8; fog.far = 45; fog.color.set(0x7d8791); sky.set(0x7d8791); }
  else if (weatherKind === 'snow') { fog.near = 5; fog.far = 30; fog.color.set(0xd5dce3); sky.set(0xd5dce3); }
  else { fog.near = 50; fog.far = 130; fog.color.set(currentMap.sky); sky.set(currentMap.sky); }
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
  weatherFx.visible = !state.underground;
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
