// Блоки карты одной склеенной геометрией: вместо сотен отдельных кубов — пара больших мешей с одним материалом.
// Цвет блока и затемнение у основания — в цветах вершин; кромка по краям каждой грани и лёгкий шум
// «штукатурки» — в шейдере (кромка считается в метрах от края грани, шум — по мировым координатам).
import * as THREE from 'three';
import type { Box, GameMap } from '../../shared/map.js';
import { bakeSky, type Occluder, skyAttribute } from './skybake.js';

/**
 * Отражённый свет для запечённого освещения: насколько светят стены и пол вокруг (зависит от солнца и неба —
 * задаётся вместе со светом в weather.ts). Умножается на цвет, который «увидели» лучи запекания.
 */
export const blockLight = { bounce: { value: new THREE.Color(0.6, 0.55, 0.5) } };

/** Размер клетки сетки на гранях — с таким шагом запекается освещение (большие грани — не больше 48 клеток) */
const CELL = 1, MAX_CELLS = 48;

/** Сколько вершин запекается и когда закончили (для отладки и тестов) */
export const bakeInfo = { vertices: 0, pending: 0, ms: 0, startedAt: 0, ceilings: 0 };

/** Нижние 1,4 м стоящего блока темнее (до 72 % яркости): стены «стоят» на земле, а не висят над ней. */
const BASE_DARK = 0.72, BASE_H = 1.4;

/** Стоит ли блок на земле или на другом блоке (низ совпадает с чьим-то верхом и они перекрываются). */
function resting(b: Box, all: Box[]): boolean {
  if (Math.abs(b.min[1]) < 0.05) return true;
  return all.some((o) => o !== b && Math.abs(o.max[1] - b.min[1]) < 0.05
    && o.min[0] < b.max[0] && o.max[0] > b.min[0] && o.min[2] < b.max[2] && o.max[2] > b.min[2]);
}

/** Шум для поверхностей: крупные мягкие пятна плюс мелкое зерно; повторяется без шва. */
function grainTexture(): THREE.CanvasTexture {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  // Крупные пятна: маленькая случайная картинка, растянутая со сглаживанием (края повторяются — шва нет)
  const s = document.createElement('canvas');
  s.width = s.height = 16;
  const sg = s.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 110 + Math.floor(Math.random() * 36);
    sg.fillStyle = `rgb(${v},${v},${v})`;
    sg.fillRect(x, y, 1, 1);
  }
  g.imageSmoothingEnabled = true;
  for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) g.drawImage(s, dx, dy, N, N);
  // Мелкое зерно поверх
  const img = g.getImageData(0, 0, N, N);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i]! + Math.floor((Math.random() - 0.5) * 22);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

let material: THREE.MeshLambertMaterial | null = null;

/** Общий материал блоков (один на все карты; при смене карты не удаляется). */
function blockMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  const grain = grainTexture();
  material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.userData.shared = true;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.grain = { value: grain };
    sh.uniforms.bounceLight = blockLight.bounce;
    sh.vertexShader = 'attribute vec4 aFace;\nattribute vec4 aSky;\nvarying vec4 vFace;\nvarying vec4 vSky;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vFace = aFace;
        vSky = aSky;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNorm = normal;`);
    sh.fragmentShader = 'uniform sampler2D grain;\nuniform vec3 bounceLight;\nvarying vec4 vFace;\nvarying vec4 vSky;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\n'
      + sh.fragmentShader.replace('#include <lights_fragment_end>', `
        #if defined( RE_IndirectDiffuse )
          // Запечённое: рассеянный свет неба — только та доля, что видна из этой точки, плюс отражённый от соседних блоков
          irradiance = irradiance * vSky.x + bounceLight * vSky.yzw;
        #endif
        #include <lights_fragment_end>`).replace('#include <color_fragment>', `#include <color_fragment>
        // Кромка: темнее в последних ~7 см до края грани
        vec2 fe = min(vFace.xy, vFace.zw - vFace.xy);
        float edge = mix(0.8, 1.0, smoothstep(0.0, 0.07, min(fe.x, fe.y)));
        // Шум по мировым координатам в плоскости грани
        vec3 an = abs(vWNorm);
        vec2 wp = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
        float g = texture2D(grain, wp * 0.3).r * 0.6 + texture2D(grain, wp * 1.7 + 0.37).r * 0.4;
        diffuseColor.rgb *= edge * (0.82 + 0.36 * g);`);
  };
  return material;
}

class Builder {
  pos: number[] = []; norm: number[] = []; col: number[] = []; face: number[] = []; idx: number[] = [];

  /**
   * Прямоугольная грань o + s·U + t·V (U×V смотрит наружу) — сеткой с шагом ~CELL (по ней запекается освещение);
   * по высоте не меньше minRows полос (затемнение у основания).
   */
  quad(o: number[], U: number[], V: number[], n: number[], c: THREE.Color, shade: (y: number) => number, minRows = 1): void {
    const lu = Math.hypot(U[0]!, U[1]!, U[2]!), lv = Math.hypot(V[0]!, V[1]!, V[2]!);
    const cols = Math.min(MAX_CELLS, Math.max(1, Math.ceil(lu / CELL)));
    const rows = Math.max(minRows, Math.min(MAX_CELLS, Math.max(1, Math.ceil(lv / CELL))));
    const base = this.pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (let q = 0; q <= cols; q++) {
        const s = q / cols;
        const p = [0, 1, 2].map((k) => o[k]! + s * U[k]! + t * V[k]!);
        this.pos.push(p[0]!, p[1]!, p[2]!);
        this.norm.push(n[0]!, n[1]!, n[2]!);
        const k = shade(p[1]!);
        this.col.push(c.r * k, c.g * k, c.b * k);
        this.face.push(s * lu, t * lv, lu, lv);
      }
    }
    const w = cols + 1;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const a = base + r * w + q;
      this.idx.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
    }
  }

  mesh(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('aFace', new THREE.Float32BufferAttribute(this.face, 4));
    geo.setAttribute('aSky', skyAttribute(this.pos.length / 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, blockMaterial());
  }
}

/**
 * Все блоки карты двумя мешами: отбрасывающие тень и нет (потолок закрытой карты — иначе он
 * затенил бы весь зал). Оба принимают тени.
 */
export function buildBlocks(map: GameMap): THREE.Mesh[] {
  const casters = new Builder(), others = new Builder();
  const area = 4 * map.half.x * map.half.z;
  const side = new THREE.Color(), top = new THREE.Color();
  // Преграды для запекания: все блоки, кроме потолка закрытой карты (он — как лампы, свет идёт сверху)
  const occluders: Occluder[] = [];
  let ceilings = 0;
  for (const b of map.boxes) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const ceiling = !!map.indoor && y0 > 2 && dx * dz > area * 0.3;
    const out = ceiling ? others : casters;
    side.set(b.color);
    top.set(b.top ?? b.color);
    if (!ceiling) occluders.push({ box: b, side: side.clone(), top: top.clone() });
    const grounded = dy >= 0.4 && resting(b, map.boxes);
    const shade = grounded ? (y: number): number => BASE_DARK + (1 - BASE_DARK) * Math.min(1, (y - y0) / BASE_H) : (): number => 1;
    const rows = grounded ? Math.ceil(dy / BASE_H) : 1;
    out.quad([x1, y0, z1], [0, 0, -dz], [0, dy, 0], [1, 0, 0], side, shade, rows);
    out.quad([x0, y0, z0], [0, 0, dz], [0, dy, 0], [-1, 0, 0], side, shade, rows);
    out.quad([x0, y0, z1], [dx, 0, 0], [0, dy, 0], [0, 0, 1], side, shade, rows);
    out.quad([x1, y0, z0], [-dx, 0, 0], [0, dy, 0], [0, 0, -1], side, shade, rows);
    out.quad([x0, y1, z1], [dx, 0, 0], [0, 0, -dz], [0, 1, 0], top, shade);
    // Низ не виден только у блока, стоящего на земле. У лежащего на других блоках (крыша на стенах, перекрытие
    // этажа) низ — это потолок, его видно снизу; цвет без затемнения у основания
    if (y0 > 0.05) ceilings++;
    if (y0 > 0.05) out.quad([x0, y0, z0], [dx, 0, 0], [0, 0, dz], [0, -1, 0], side, () => 1);
  }
  const meshes: THREE.Mesh[] = [];
  for (const [bld, cast] of [[casters, true], [others, false]] as const) {
    if (!bld.idx.length) continue;
    const m = bld.mesh();
    m.castShadow = cast;
    m.receiveShadow = true;
    meshes.push(m);
  }
  // Освещение запекается в фоне: до конца расчёта карта выглядит как без него
  bakeInfo.vertices = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
  bakeInfo.pending = meshes.length;
  bakeInfo.ceilings = ceilings;
  bakeInfo.startedAt = performance.now();
  bakeInfo.ms = 0;
  for (const m of meshes) bakeSky(m, occluders, () => { if (--bakeInfo.pending === 0) bakeInfo.ms = Math.round(performance.now() - bakeInfo.startedAt); });
  return meshes;
}
