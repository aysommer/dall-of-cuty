// Оружие в руках: прицеливание, поза у стены и в беге, оптика снайперки, анимации.
import * as THREE from 'three';
import type { Vec3, WeaponId } from '../../shared/protocol.js';
import { GUNS, rayWorld, WEAPONS } from '../../shared/map.js';
import { beep } from '../core/audio.js';
import { camera } from '../core/scene.js';
import { settings } from '../core/settings.js';
import { keys, me, state } from '../core/state.js';
import { BASE_FOV, SPEED } from '../core/util.js';
import { openingUntil } from '../pickups/crate.js';
import { buildGun } from '../render/models.js';
import { toast, updateHud } from '../ui/hud.js';
import { cookStart } from './grenade.js';
import { _dir } from './shooting.js';
import { solids } from '../world/map.js';
import { sprintKey } from '../world/physics.js';

export const SWING_MS = 300;

// Оружие в руках (вид от первого лица)
export const viewModel = new THREE.Group();

export let viewGun = buildGun('pistol');

export function setWeapon(w: WeaponId): void {
  if (w === 'rocket' && me.ammo.rocket <= 0) return;
  if (w === 'knife' && !state.hasKnife) return; // нож брошен — до смерти его нет
  if (w === 'grenade' && state.myGrenades <= 0 && !cookStart) return; // граната одна на жизнь
  if (GUNS.includes(w) && !settings.kit.includes(w)) return; // ствол не из набора
  state.adsK = 0;
  me.weapon = w;
  me.reloadUntil = 0;
  // Оружие достают: пистолет — быстро, основное — дольше; пока достаёшь — не стреляешь
  drawMs = DRAW_MS[w];
  drawUntil = performance.now() + drawMs;
  me.nextShot = Math.max(me.nextShot, drawUntil);
  viewModel.remove(viewGun.group);
  viewGun = buildGun(w);
  state.scopeOn = sightOn(w);
  if (viewGun.scope) viewGun.scope.visible = state.scopeOn;
  viewModel.add(viewGun.group);
  updateHud();
}

/** ПКМ: камера приближается, оружие уходит в центр, разброс уменьшается. */
export function updateAim(dt: number): void {
  const w = WEAPONS[me.weapon];
  const aiming = state.aimHeld && w.zoom !== null && me.alive && !me.reloadUntil && !openingUntil && !scopeAnim;
  // Без прицела оружие легче — вскидывается чуть быстрее
  const bare = !!viewGun.scope && !state.scopeOn;
  state.adsK += ((aiming ? 1 : 0) - state.adsK) * Math.min(1, dt * (bare ? ADS_SPEED_BARE : ADS_SPEED));
  if (state.adsK < 0.001) state.adsK = 0;
  // Снайперка без оптики — по мушке, с небольшим приближением
  // Приближение задано для обзора 75°; при другом обзоре из настроек оно меняется в той же пропорции
  const zoom = (me.weapon === 'sniper' && !state.scopeOn ? IRON_ZOOM : w.zoom ?? BASE_FOV) * (settings.fov / BASE_FOV);
  const fov = settings.fov + (zoom - settings.fov) * state.adsK;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const handX = settings.hand === 'left' ? -0.22 : 0.22;
  viewModel.position.x = handX * (1 - state.adsK);
  // В прицеле центр прицела встаёт ровно на линию взгляда (красная точка — в центр экрана)
  const aimPt = aimPoint();
  const aimY = aimPt ? -aimPt.y * viewModel.scale.y : -0.13;
  viewModel.position.y = -0.2 + (aimY + 0.2) * state.adsK;
}

export function isSprinting(): boolean {
  return sprintKey() && !!keys.KeyW && !state.aimHeld && !state.mouseDown && me.grounded && !state.low && !state.crouch;
}

/**
 * При беге оружие поднимается и разворачивается стволом вверх-вбок; у стены — задирается
 * и отходит назад, чтобы не проходить сквозь неё.
 */
export function poseGun(dt: number): void {
  const moving = Math.hypot(me.vel.x, me.vel.z) > SPEED * 0.9;
  state.sprintK += ((isSprinting() && moving ? 1 : 0) - state.sprintK) * Math.min(1, dt * 10);
  camera.getWorldDirection(_dir);
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const near = rayWorld(solids, eye, [_dir.x, _dir.y, _dir.z], 1.3);
  const wallTarget = Math.max(0, Math.min(1, (1.3 - near) / 0.8));
  state.wallK += (wallTarget - state.wallK) * Math.min(1, dt * 12);
  const side = settings.hand === 'left' ? -1 : 1;
  viewModel.rotation.x += 0.55 * state.sprintK + 1.0 * state.wallK;
  viewModel.rotation.y += 0.45 * state.sprintK * side;
  viewModel.rotation.z += 0.4 * state.sprintK * side;
  viewModel.position.y += 0.05 * state.sprintK - 0.04 * state.wallK;
  viewModel.position.x -= 0.06 * state.sprintK * side;
  viewModel.position.z += 0.18 * state.wallK;
}

/** Скорость вскидки в прицел: с прицелом и без него (без — на четверть быстрее) */
const ADS_SPEED = 12, ADS_SPEED_BARE = 15;

// Стоит ли прицел — помнится по каждому стволу отдельно и переживает перезапуск игры
const SIGHTS_KEY = 'doc-sights';
const sights: Record<string, boolean> = (() => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SIGHTS_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> : {};
  } catch { return {}; }
})();
/** Надет ли прицел на этом стволе (по умолчанию — да) */
export const sightOn = (w: WeaponId): boolean => sights[w] ?? true;
function rememberSight(w: WeaponId, on: boolean): void {
  sights[w] = on;
  try { localStorage.setItem(SIGHTS_KEY, JSON.stringify(sights)); } catch { /* хранилище недоступно */ }
}

/** Куда подводится глаз в прицеле: к прицелу, а если он снят — к мушке с целиком. */
export const aimPoint = (): typeof viewGun.aim => !state.scopeOn && viewGun.iron ? viewGun.iron : viewGun.aim;

/** Анимация руки, которая снимает или надевает оптику */
export let scopeAnim: { until: number; to: boolean } | null = null;

const SCOPE_ANIM_MS = 700;

/** Приближение по мушке, без оптики */
const IRON_ZOOM = 50;

/** Куда тянется рука, когда снимает или надевает прицел (в координатах viewModel); null — рука свободна */
export let scopeHandPos: THREE.Vector3 | null = null;

/** V: снять или надеть прицел на оружии в руках — оптику снайперки или коллиматор остальных стволов. */
export function toggleScope(now: number): void {
  if (!viewGun.scope || !me.alive || scopeAnim || me.reloadUntil) return;
  scopeAnim = { until: now + SCOPE_ANIM_MS, to: !state.scopeOn };
  state.aimHeld = false; // во время возни с оптикой не целимся
  beep(state.scopeOn ? 520 : 760, 0.08, 0.06);
}

/**
 * Рука тянется к прицелу: при снятии — забирает её и уносит вниз,
 * при надевании — приносит снизу и ставит на место.
 */
export function animateScope(now: number): void {
  const g = viewGun;
  scopeHandPos = null;
  if (!g.scope) return;
  if (!scopeAnim) {
    g.scope.visible = state.scopeOn;
    g.scope.position.set(0, g.scopeY, g.scopeZ);
    return;
  }
  const p = 1 - Math.max(0, scopeAnim.until - now) / SCOPE_ANIM_MS;
  const mount = new THREE.Vector3(0, g.scopeY + 0.07, g.scopeZ);
  const below = new THREE.Vector3(0.12, -0.35, g.scopeZ + 0.1);
  // Рука: снизу к оптике (0…0.45) и обратно вниз (0.55…1)
  const up = ramp(p, 0, 0.45), down = ramp(p, 0.55, 1);
  const hand = below.clone().lerp(mount, up).lerp(below, down);
  scopeHandPos = hand.clone();
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
    state.scopeOn = scopeAnim.to;
    scopeAnim = null;
    rememberSight(me.weapon, state.scopeOn);
    const what = me.weapon === 'sniper' ? 'Оптика' : 'Прицел';
    toast(state.scopeOn ? `🔭 ${what}: на месте` : `🔭 ${what}: снят — целься по мушке, вскидка быстрее (V — надеть)`);
  }
}

/**
 * Тряска снайперки в прицеле, пока игрок двигается: чем быстрее, тем сильнее.
 * Стоя на месте прицел спокойный. Выстрел летит туда, куда смотрит камера, — с учётом тряски.
 */
export function sniperSway(now: number): { yaw: number; pitch: number } {
  if (me.weapon !== 'sniper' || state.adsK < 0.3 || !me.alive) return { yaw: 0, pitch: 0 };
  const speed = Math.hypot(me.vel.x, me.vel.z) + (me.grounded ? 0 : 4);
  const amp = Math.min(1, speed / SPEED) * 0.04 * state.adsK;
  if (amp < 0.0005) return { yaw: 0, pitch: 0 };
  const t = now / 1000;
  return { yaw: amp * Math.sin(t * 6.3), pitch: amp * 0.7 * Math.sin(t * 12.1 + 1) };
}

export const BOLT_MS = 900;

const ease = (x: number): number => x * x * (3 - 2 * x);

/** 0 → 1 на отрезке [a, b] */
const ramp = (p: number, a: number, b: number): number => ease(Math.max(0, Math.min(1, (p - a) / (b - a))));

/** Сколько миллисекунд достаётся оружие: лёгкое — быстро, тяжёлое — долго */
const DRAW_MS: Record<WeaponId, number> = {
  knife: 240, grenade: 280, pistol: 280, smg: 380, shotgun: 540, rifle: 540, sniper: 680, lmg: 740, rocket: 680,
};
let drawUntil = 0, drawMs = 1;
/** Сколько длится текущее (последнее) доставание оружия — для отладки и тестов */
export const lastDrawMs = (): number => drawMs;

const PLACE_MS = 360;
let placeUntil = 0;
/** Мину или растяжку кладут под ноги: рука с ней опускается вниз-вперёд и возвращается. */
export function startPlace(now: number): void {
  placeUntil = now + PLACE_MS;
}

/** Бросок свободной рукой (нож на G, когда в руках ствол): 0…1 — как далеко зашёл взмах; −1 — броска нет */
let offThrowUntil = 0;
export function startOffhandThrow(now: number): void {
  offThrowUntil = now + THROW_MS;
}
export const offhandThrow = (now: number): number => now < offThrowUntil ? 1 - (offThrowUntil - now) / THROW_MS : -1;

const THROW_MS = 320;
let throwUntil = 0;
/** Бросок гранаты: рука с ней идёт назад, потом резко вперёд и вверх. */
export function startThrow(now: number): void {
  throwUntil = now + THROW_MS;
}

/** Перезарядка всех стволов и затвор снайперки. */
export function animateGun(now: number): void {
  const g = viewGun;
  if (now < drawUntil) {
    // Оружие поднимается снизу, стволом вниз, и встаёт на место
    const k = 1 - ease(1 - (drawUntil - now) / drawMs);
    viewModel.position.y -= 0.42 * k;
    viewModel.rotation.x -= 1.0 * k;
    viewModel.rotation.z += 0.35 * k * (settings.hand === 'left' ? -1 : 1);
  }
  if (now < placeUntil) {
    const k = Math.sin(Math.PI * (1 - (placeUntil - now) / PLACE_MS));
    viewModel.position.y -= 0.3 * k;
    viewModel.position.z -= 0.12 * k;
    viewModel.rotation.x -= 0.7 * k;
  }
  if (now < throwUntil) {
    const p = 1 - (throwUntil - now) / THROW_MS;
    const back = ramp(p, 0, 0.3) * (1 - ramp(p, 0.3, 0.55)), fwd = ramp(p, 0.3, 0.75);
    viewModel.position.z += 0.16 * back - 0.42 * fwd;
    viewModel.position.y += 0.1 * back + 0.2 * fwd;
    viewModel.rotation.x += 0.7 * back - 0.9 * fwd;
  }
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
  } else if (g.bolt && now < state.boltUntil) {
    // Снайперка: рычаг вверх, назад, вперёд и вниз; ствол слегка покачивается
    const p = 1 - (state.boltUntil - now) / BOLT_MS;
    const up = ramp(p, 0.05, 0.2) * (1 - ramp(p, 0.75, 0.9));
    const back = ramp(p, 0.2, 0.45) * (1 - ramp(p, 0.5, 0.75));
    g.bolt.rotation.z = 1.2 * up;
    g.bolt.position.z = g.boltZ + 0.1 * back;
    viewModel.rotation.z += 0.25 * up;
    viewModel.rotation.x -= 0.1 * up;
  }
}
