// Модели из кубиков: игроки и оружие (в том числе коллиматорный прицел).
import * as THREE from 'three';
import type { Team, WeaponId } from '../../shared/protocol.js';
import { box } from '../core/scene.js';

export interface Gun {
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
/**
 * Съёмный коллиматор: все его детали — в одной группе с началом в центре рамки (0, y, z),
 * чтобы его можно было снять и надеть целиком. Под ним на оружии — мушка и целик.
 */
function buildRedDot(group: THREE.Group, y: number, z: number, top: number): THREE.Group {
  // Компактный прицел: рамка ~3,8 × 2,9 см, точка ~2 мм — не загораживает цель
  const FRAME = 0x1a1a1a, W = 0.038, H = 0.029;
  const dot = new THREE.Group();
  dot.position.set(0, y, z);
  const part = (w: number, h: number, d: number, px: number, py: number, color: number, lit = true) => {
    const m = box(w, h, d, color, lit);
    m.position.set(px, py, 0);
    dot.add(m);
    return m;
  };
  // Основание — от верха корпуса оружия (top) до рамки и чуть вглубь корпуса: прицел не висит в воздухе
  const baseH = y - H / 2 - top + 0.006;
  part(W * 0.7, baseH, 0.05, 0, -H / 2 - baseH / 2, FRAME);  // основание
  part(0.007, H, 0.009, -W / 2, 0, FRAME);                   // стойки
  part(0.007, H, 0.009, W / 2, 0, FRAME);
  part(W + 0.007, 0.007, 0.009, 0, H / 2, FRAME);            // верх
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  );
  dot.add(glass);
  part(0.0022, 0.0022, 0.001, 0, 0, 0xff2020, false).position.z = -0.004; // красная точка
  group.add(dot);
  return dot;
}

/** Высота мушки и целика над корпусом — по ним целятся, когда коллиматор снят */
const IRON_H = 0.018;

/**
 * Мушка у дула и целик из двух зубцов ближе к глазу. Стоят на своих местах корпуса (rearTop и frontTop —
 * высота корпуса под ними), а верхушки — на одной линии; возвращает высоту этой линии прицеливания.
 */
function buildIrons(group: THREE.Group, rearTop: number, rearZ: number, frontTop: number, frontZ: number): number {
  const DARK = 0x0c0c0c, line = Math.max(rearTop, frontTop) + IRON_H;
  const post = (x: number, z: number, base: number): void => {
    const m = box(0.008, line - base, 0.008, DARK);
    m.position.set(x, (line + base) / 2, z);
    group.add(m);
  };
  post(0, frontZ, frontTop);
  post(-0.011, rearZ, rearTop);
  post(0.011, rearZ, rearTop);
  return line;
}

// Оружие смотрит стволом вдоль -Z.
export function buildGun(type: WeaponId): Gun {
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
  /** Высота верха корпуса под прицелом — на неё встаёт его подставка */
  let sightTop = 0;
  let aim: Gun['aim'];
  let scope: THREE.Object3D | undefined;
  let iron: Gun['iron'];
  if (type === 'pistol') {
    add(0.05, 0.07, 0.24, 0x2b2b2b, 0, 0, -0.12);
    add(0.045, 0.13, 0.06, 0x3a2a1a, 0, -0.09, -0.03);
    mag = part(0.032, 0.05, 0.045, 0x111111, 0, -0.165, -0.03); // низ магазина торчит из рукояти
    sight = { y: 0.085, z: -0.1 };
    sightTop = 0.035;
    aim = { ...sight, relief: 0.45 }; // пистолет держат на вытянутых руках: кисти дальше от глаз и не загораживают обзор
    muzzleZ = -0.26;
  } else if (type === 'shotgun') {
    add(0.06, 0.06, 0.7, 0x252525, 0, 0, -0.35);
    add(0.075, 0.06, 0.2, 0x7a4a22, 0, -0.055, -0.42);
    add(0.06, 0.1, 0.28, 0x7a4a22, 0, -0.03, 0.12);
    add(0.045, 0.12, 0.06, 0x1c1c1c, 0, -0.09, 0.0);       // пистолетная рукоять
    shell = part(0.03, 0.03, 0.07, 0xc0262b, 0, -0.12, -0.08);
    shell.visible = false;
    sight = { y: 0.08, z: -0.15 };
    sightTop = 0.03;
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
  } else if (type === 'grenade') {
    // Ярко-красная граната с запалом и кольцом чеки
    const body = part(0.09, 0.11, 0.09, 0xe0101a, 0, 0, -0.1);
    (body.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(0x550000);
    add(0.04, 0.04, 0.04, 0x333333, 0, 0.075, -0.1);
    add(0.05, 0.012, 0.012, 0xcccccc, 0.035, 0.09, -0.1);
    muzzleZ = -0.15;
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
    add(0.05, 0.12, 0.06, 0x1c1c1c, 0, -0.11, 0.02);         // пистолетная рукоять
    for (const side of [-1, 1]) {                            // сошки
      const leg = box(0.015, 0.16, 0.015, 0x1c1c1c);
      leg.position.set(side * 0.04, -0.09, -0.78);
      leg.rotation.z = side * 0.3;
      group.add(leg);
    }
    sight = { y: 0.13, z: -0.08 };
    sightTop = 0.055;
    aim = { ...sight, relief: 0.24 };
    muzzleZ = -0.96;
  } else if (type === 'smg') {
    add(0.06, 0.08, 0.36, 0x26292e, 0, 0, -0.14);          // короткая коробка
    add(0.035, 0.035, 0.16, 0x111111, 0, 0.01, -0.39);     // ствол
    mag = part(0.04, 0.2, 0.06, 0x111111, 0, -0.14, -0.16); // длинный прямой магазин
    add(0.045, 0.12, 0.06, 0x1c1c1c, 0, -0.09, 0.0);        // рукоять
    add(0.05, 0.06, 0.2, 0x3a3a3a, 0, 0, 0.13);             // складной приклад
    sight = { y: 0.085, z: -0.12 };
    sightTop = 0.04;
    aim = { ...sight, relief: 0.22 };
    muzzleZ = -0.48;
  } else {
    add(0.06, 0.09, 0.5, 0x30343a, 0, 0, -0.2);
    add(0.035, 0.035, 0.3, 0x1c1c1c, 0, 0.01, -0.58);
    mag = part(0.045, 0.18, 0.07, 0x1c1c1c, 0, -0.12, -0.22);
    add(0.055, 0.1, 0.24, 0x4a3a28, 0, -0.02, 0.16);
    add(0.045, 0.12, 0.06, 0x3a2a1a, 0, -0.1, -0.01);      // пистолетная рукоять
    sight = { y: 0.1, z: -0.12 };
    sightTop = 0.045;
    aim = { ...sight, relief: 0.22 };
    muzzleZ = -0.75;
  }
  if (sight && aim) {
    // Коллиматор съёмный (V); без него целятся по мушке и целику, глаз — на том же расстоянии
    scope = buildRedDot(group, sight.y, sight.z, sightTop);
    // У пулемёта мушка стоит на кожухе ствола — он выше ствольной коробки
    const line = type === 'lmg'
      ? buildIrons(group, sightTop, sight.z + 0.06, 0.085, -0.5)
      : buildIrons(group, sightTop, sight.z + 0.06, sightTop, muzzleZ + 0.04);
    iron = { y: line - 0.002, z: sight.z + 0.06, relief: aim.relief + 0.04 };
  }
  const flash = box(0.12, 0.12, 0.12, 0xffd34d, false);
  flash.position.set(0, 0, muzzleZ - 0.05);
  flash.visible = false;
  group.add(flash);
  return {
    group, flash, muzzleZ, mag, magY: mag?.position.y ?? 0, bolt, boltZ: bolt?.position.z ?? 0, shell, sight, aim,
    scope, scopeY: scope?.position.y ?? 0, scopeZ: scope?.position.z ?? 0, iron,
  };
}

export function muzzleWorld(gun: Gun): THREE.Vector3 {
  gun.group.updateWorldMatrix(true, false);
  return new THREE.Vector3(0, 0, gun.muzzleZ).applyMatrix4(gun.group.matrixWorld);
}

export function nameSprite(text: string, team: Team): THREE.Sprite {
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
