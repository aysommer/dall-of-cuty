// Пост-обработка: мягкое затенение углов и стыков (GTAO) и свечение ярких мест (bloom).
// Обе — по переключателям в настройках; если обе выключены, кадр рисуется напрямую, без лишних проходов.
//
// Руки и оружие от первого лица (всё, что прикреплено к камере) рисуются отдельным проходом поверх мира:
// затенение считается только по миру — иначе вокруг рук у самой камеры на полу и стенах ложились бы тёмные пятна.
// Порядок: мир → затенение → руки и оружие → свечение → цветокоррекция и цвета экрана (OutputPass).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { addResizeListener, camera, hemi, renderer, scene, sun } from './scene.js';
import { settings } from './settings.js';

/** Слой рук и оружия от первого лица */
export const VIEW_LAYER = 1;

/**
 * Порог свечения — выше самых ярких освещённых стен (солнце и рассеянный свет вместе дают до ~3):
 * светятся только вспышки выстрелов, искры взрывов и диск солнца — они заданы ярче белого.
 */
const BLOOM = { strength: 0.55, radius: 0.45, threshold: 3.2 };

/** Руки и оружие: поверх уже нарисованного мира, без фона и с чистой глубиной (всегда впереди). */
class ViewModelPass extends Pass {
  cam = new THREE.PerspectiveCamera();
  constructor() { super(); this.needsSwap = false; }
  render(r: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const bg = scene.background, auto = r.autoClear;
    scene.background = null;
    r.autoClear = false;                     // мир уже нарисован — не стирать его
    r.setRenderTarget(this.renderToScreen ? null : read);
    r.clearDepth();
    r.render(scene, this.cam);
    r.autoClear = auto;
    scene.background = bg;
  }
}

let composer: EffectComposer | null = null;
let worldPass: RenderPass, ao: GTAOPass, viewPass: ViewModelPass, bloom: UnrealBloomPass;
const worldCam = new THREE.PerspectiveCamera();

function build(): void {
  const size = renderer.getSize(new THREE.Vector2());
  composer = new EffectComposer(renderer);
  worldPass = new RenderPass(scene, worldCam);
  ao = new GTAOPass(scene, worldCam, size.x, size.y);
  // Затенение — в пределах ~80 см: углы, стыки стен с полом, щели между ящиками
  ao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.5, scale: 1.4, samples: 12 });
  ao.blendIntensity = 1;
  viewPass = new ViewModelPass();
  bloom = new UnrealBloomPass(size, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(worldPass);
  composer.addPass(ao);
  composer.addPass(viewPass);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

/** Всё, что прикреплено к камере (руки, оружие, вспышка), — на слой рук; свет — на обоих слоях. */
function tagViewModel(): void {
  for (const child of camera.children) child.traverse((o) => { o.layers.set(VIEW_LAYER); });
  hemi.layers.enable(VIEW_LAYER);
  sun.layers.enable(VIEW_LAYER);
}

/** Нарисовать кадр с камеры cam — с затенением и свечением, если они включены. */
export function renderFrame(cam: THREE.PerspectiveCamera): void {
  tagViewModel();
  if (!settings.bloom && !settings.ssao) {
    cam.layers.enable(VIEW_LAYER);
    renderer.render(scene, cam);
    return;
  }
  if (!composer) build();
  cam.updateMatrixWorld();
  // Мир — с камеры cam без слоя рук; руки — тем же взглядом, только слой рук
  for (const [c, layer] of [[worldCam, 0], [viewPass.cam, VIEW_LAYER]] as const) {
    c.copy(cam, false);
    c.matrixWorld.copy(cam.matrixWorld);
    c.matrixWorldInverse.copy(cam.matrixWorldInverse);
    c.matrixAutoUpdate = false;
    c.matrixWorldAutoUpdate = false;
    c.layers.set(layer);
  }
  ao.enabled = settings.ssao;
  bloom.enabled = settings.bloom;
  composer!.render();
}

/** Размер окна поменялся */
export function resizePost(w: number, h: number): void {
  if (!composer) return;
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
}

addResizeListener(resizePost);

/** Для отладки и тестов */
export const postState = (): { bloom: boolean; ssao: boolean; composer: boolean } => ({ bloom: settings.bloom, ssao: settings.ssao, composer: !!composer });
