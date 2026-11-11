// Сцена Three.js: рендерер, камера, свет, туман.
import * as THREE from 'three';
import { $, BASE_FOV } from './util.js';

export const canvas = $<HTMLCanvasElement>('game');

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

export const scene = new THREE.Scene();

export const sky = new THREE.Color(0x9fc9ea);

export const fog = new THREE.Fog(0x9fc9ea, 50, 130);

export const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.5);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
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
  sun.position.set(20, 40, 10);
  scene.add(sun);
  window.addEventListener('resize', resize);
  resize();
}
