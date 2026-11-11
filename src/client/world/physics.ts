// Движение и столкновения: ходьба, бег, прыжок, подкат, лестницы, трамплины.
import * as THREE from 'three';
import { type Box, type Ladder, PLAYER, SLIDE, WORLD_BOTTOM } from '../../shared/map.js';
import { beep, shotSound } from '../core/audio.js';
import { keys, me, state } from '../core/state.js';
import { CLIMB, GRAVITY, JUMP, SPEED, SPRINT_K } from '../core/util.js';
import { crateSolid, openingUntil } from '../pickups/crate.js';
import { gunner } from '../streaks/gunship.js';
import { missileCtl } from '../streaks/missile.js';
import { isSprinting } from '../weapons/viewmodel.js';
import { clips, currentMap, solids } from './map.js';

const slideDir = new THREE.Vector3();

/** Упавший ящик мог накрыть игрока — тогда до выхода из него ящик для него не твёрдый. */
let insideCrate = false;

function overlaps(p: THREE.Vector3, h: number, b: Box): boolean {
  const r = PLAYER.w / 2;
  return p.x + r > b.min[0] && p.x - r < b.max[0] &&
    p.y + h > b.min[1] && p.y < b.max[1] &&
    p.z + r > b.min[2] && p.z - r < b.max[2];
}

function hitBox(p: THREE.Vector3, h: number = state.low ? SLIDE.height : PLAYER.h): Box | null {
  for (const b of solids) if (overlaps(p, h, b)) return b;
  // Невидимые стены по краю карты — только для движения игрока
  for (const b of clips) if (overlaps(p, h, b)) return b;
  // Лежащий ящик тоже твёрдый
  const c = insideCrate ? null : crateSolid();
  return c && overlaps(p, h, c) ? c : null;
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

let ladderBlockedUntil = 0;

 // после спрыгивания лестница ненадолго «не липнет»
/** Шаг на невысокий уступ (трамплин, ступенька): до STEP_UP метров — без прыжка. */
const STEP_UP = 0.35;

function stepUp(p: THREE.Vector3): boolean {
  if (!me.grounded) return false;
  const b = hitBox(p);
  if (!b || b.max[1] - p.y > STEP_UP || b.max[1] <= p.y) return false;
  const y = p.y;
  p.y = b.max[1] + 0.001;
  if (hitBox(p)) { p.y = y; return false; } // сверху нет места
  return true;
}

/** Летим после трамплина — до приземления */
let padFlight = false;

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

export const sprintKey = (): boolean => !!(keys.ShiftLeft || keys.ShiftRight);

const sprintSpeed = (): number => SPEED * SPRINT_K;

/** C в спринте: ложимся и скользим по инерции SLIDE.ms, управлять движением нельзя. */
export function trySlide(now: number): void {
  const sprinting = sprintKey() && keys.KeyW && !state.aimHeld;
  if (!me.alive || !me.grounded || !sprinting || state.low || openingUntil || now < state.slideCooldownUntil) return;
  if (touchingLadder(me.pos)) return;
  const hs = Math.hypot(me.vel.x, me.vel.z);
  if (hs > 1) slideDir.set(me.vel.x / hs, 0, me.vel.z / hs);
  else slideDir.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
  state.slideSpeed = Math.max(hs, sprintSpeed()) * SLIDE.boost;
  state.slideUntil = now + SLIDE.ms;
  state.low = true;
  shotSound('slide', 0.8);
}

export function move(dt: number): void {
  const now = performance.now();
  const sliding = now < state.slideUntil;
  // Пока открываем ящик — стоим на месте; в подкате управлять движением нельзя
  const frozen = openingUntil > 0 || sliding || missileCtl !== null || gunner !== null;
  const f = frozen ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = frozen ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const len = Math.hypot(f, s) || 1;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let speed = SPEED;
  // В прицеле не бегаем
  // Бег — пока не целишься и не стреляешь (как в Call of Duty: выстрел прерывает спринт)
  if (isSprinting()) speed *= SPRINT_K;
  const wish = { x: (-sin * f + cos * s) / len * speed, z: (-cos * f - sin * s) / len * speed };
  const p = me.pos;
  const crate = crateSolid();
  insideCrate = crate !== null && overlaps(p, PLAYER.h, crate);
  const ladder = !sliding && now >= ladderBlockedUntil ? touchingLadder(p) : null;

  if (sliding) {
    // Скорость подката плавно падает от начальной до SLIDE.endSpeed от неё
    const t = 1 - (state.slideUntil - now) / SLIDE.ms;
    const v = state.slideSpeed * (1 - (1 - SLIDE.endSpeed) * t);
    me.vel.x = slideDir.x * v;
    me.vel.z = slideDir.z * v;
    me.vel.y -= GRAVITY * dt;
  } else if (!ladder || !climb(ladder, f, wish, now)) {
    // В полёте после трамплина скорость почти не гасится — иначе до острова не долететь
    const accel = me.grounded ? 14 : padFlight ? 0.6 : 4;
    const k = Math.min(1, accel * dt);
    me.vel.x += (wish.x - me.vel.x) * k;
    me.vel.z += (wish.z - me.vel.z) * k;
    if (keys.Space && me.grounded && !frozen) { me.vel.y = JUMP; me.grounded = false; }
    me.vel.y -= GRAVITY * dt;
  }
  jumpHeld = !!keys.Space;

  p.x += me.vel.x * dt;
  if (hitBox(p) && !stepUp(p)) { p.x -= me.vel.x * dt; me.vel.x = 0; }
  p.z += me.vel.z * dt;
  if (hitBox(p) && !stepUp(p)) { p.z -= me.vel.z * dt; me.vel.z = 0; }

  p.y += me.vel.y * dt;
  me.grounded = false;
  // Дно мира — страховка; обычно игрок стоит на плите земли или на полу канализации
  if (p.y <= WORLD_BOTTOM) {
    p.y = WORLD_BOTTOM; me.vel.y = 0; me.grounded = true;
  } else {
    const b = hitBox(p);
    if (b) {
      if (me.vel.y <= 0) { p.y = b.max[1]; me.grounded = true; }
      else p.y = b.min[1] - (state.low ? SLIDE.height : PLAYER.h) - 0.001;
      me.vel.y = 0;
    }
  }
  if (me.grounded) padFlight = false;

  // Трамплин: встал на него — подбрасывает в его сторону
  if (me.grounded && !frozen) {
    for (const pad of currentMap.pads ?? []) {
      if (p.x >= pad.min[0] && p.x <= pad.max[0] && p.z >= pad.min[2] && p.z <= pad.max[2] &&
          Math.abs(p.y - pad.max[1]) < 0.05) {
        me.vel.set(pad.vel[0], pad.vel[1], pad.vel[2]);
        me.grounded = false;
        padFlight = true;
        beep(320, 0.12, 0.12);
        setTimeout(() => beep(640, 0.15, 0.1), 60);
        break;
      }
    }
  }

  // Подкат закончился — встаём, если над головой есть место
  if (state.low && !sliding && !hitBox(p, PLAYER.h)) {
    state.low = false;
    state.slideCooldownUntil = now + SLIDE.cooldownMs;
  }
}
