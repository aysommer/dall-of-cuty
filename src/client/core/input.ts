// Управление: захват мыши, клавиатура, колесо, кнопки мыши. Общие действия (обзор, клавиши, огонь)
// вынесены в функции — ими же пользуется сенсорное управление (touch.ts).
import type { WeaponId } from '../../shared/protocol.js';
import { initAudio } from './audio.js';
import { sendMsg } from './net.js';
import { camera, canvas } from './scene.js';
import { settings } from './settings.js';
import { keys, me, state } from './state.js';
import { $, BASE_FOV, MOUSE_SENS } from './util.js';
import { trySpray } from '../fx/sprays.js';
import { nearCrate, openingUntil } from '../pickups/crate.js';
import { gunner, gunnerRocket } from '../streaks/gunship.js';
import { missileCtl } from '../streaks/missile.js';
import { hotbar, useSlot } from '../ui/hotbar.js';
import { renderScoreboard } from '../ui/hud.js';
import { voting } from '../ui/match.js';
import { pauseView, showPauseView } from '../ui/pause.js';
import { throwKnife } from '../weapons/knife.js';
import { startReload } from '../weapons/shooting.js';
import { setWeapon, toggleScope } from '../weapons/viewmodel.js';
import { nearDoor } from '../world/map.js';
import { trySlide } from '../world/physics.js';

/** Сенсорный режим: мышь не захватывается, игра управляется кнопками на экране */
let touchMode = false;
export const isTouch = (): boolean => touchMode;
export function enableTouch(): void {
  touchMode = true;
  document.body.classList.add('touch');
}

/** Игрок в игре (true) или в меню (false). С мышью это следует за захватом курсора, на сенсорном экране — ставится напрямую. */
function setLocked(locked: boolean): void {
  state.locked = locked;
  if (!locked) unlockedAt = performance.now();
  state.menuClosed = false;
  document.body.classList.toggle('playing', locked);
  $('pause').classList.toggle('hidden', locked || !state.joined || voting);
  if (!locked) showPauseView('home');
  if (!locked) { state.mouseDown = false; state.aimHeld = false; for (const k in keys) keys[k] = false; }
}

/** Войти в игру из меню: с мышью — захватить курсор, на сенсорном экране — просто убрать меню. */
export function lock(): void {
  initAudio();
  if (touchMode || typeof canvas.requestPointerLock !== 'function') {
    setLocked(true);
    // Во весь экран и горизонтально — где браузер это умеет
    try {
      void Promise.resolve(document.documentElement.requestFullscreen?.()).then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o.lock?.('landscape');
      }).catch(() => {});
    } catch { /* не умеет — играем как есть */ }
    return;
  }
  // Сразу после Esc браузер может отказать в захвате курсора — тогда нужен повторный клик
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}

/** Выйти из игры в меню (голосование, пауза, обрыв связи). */
export function unlock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
  else if (state.locked) setLocked(false);
}

const playing = (): boolean => state.locked || (state.joined && state.menuClosed);

let unlockedAt = 0;

/** Поворот взгляда на dx, dy «пикселей мыши». В самолёте и ракете с неба поворачивается их камера. */
export function look(dx: number, dy: number): void {
  // В прицеле чувствительность падает вместе с углом обзора, чтобы прицел не «улетал»
  const sens = MOUSE_SENS * settings.sens * (camera.fov / BASE_FOV);
  if (gunner) {
    // В самолёте поворачивается орудие (смотреть можно только вниз)
    gunner.yaw -= dx * sens;
    gunner.pitch = Math.max(-1.5, Math.min(-0.15, gunner.pitch - dy * sens));
    return;
  }
  if (missileCtl) {
    // Ракета с неба: поворот и наклон (смотреть можно только вниз)
    missileCtl.yaw -= dx * sens * 0.6;
    missileCtl.pitch = Math.max(-1.55, Math.min(-0.5, missileCtl.pitch - dy * sens * 0.6));
    return;
  }
  me.yaw -= dx * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - dy * sens));
}

/** Основной огонь: нажали или отпустили (ЛКМ или кнопка на экране). */
export function setFire(on: boolean): void {
  if (on) { state.mouseDown = true; state.firedThisPress = false; } else state.mouseDown = false;
}

/** Второе действие (ПКМ): в самолёте — ракета, с ножом в руке — бросок, иначе — прицел. */
export function setAim(on: boolean): void {
  if (!on) { state.aimHeld = false; return; }
  if (gunner) gunnerRocket();
  else if (me.weapon === 'knife') throwKnife();
  else state.aimHeld = true;
}

/** Следующее или предыдущее оружие по кругу (колесо мыши). */
export function cycleWeapon(dir: 1 | -1): void {
  const order = (['knife', ...settings.kit, 'rocket'] as WeaponId[])
    .filter((w) => (w !== 'knife' || state.hasKnife) && (w !== 'rocket' || me.ammo.rocket > 0));
  const i = order.indexOf(me.weapon);
  const n = order.length;
  setWeapon(order[(i + (dir > 0 ? 1 : n - 1)) % n]!);
}

/** Клавиша нажата (с клавиатуры или кнопкой на экране): движение — через keys, действия — сразу. */
export function pressKey(code: string, repeat = false): void {
  if (!playing()) return;
  keys[code] = true;
  // Слоты: 1 — нож или граната, 2 и 3 — стволы, 5–9 — награды за серию
  const slot = hotbar().find((h) => `Digit${h.key}` === code);
  if (slot && !repeat) useSlot(slot.id);
  if (code === 'KeyG' && !repeat) throwKnife();
  if (code === 'KeyV' && !repeat) toggleScope(performance.now());
  if (code === 'KeyC' && !repeat) trySlide(performance.now());
  if (code === 'KeyT' && !repeat) trySpray(performance.now());
  if (code === 'KeyF' && !repeat) {
    // F — начать открывать ящик; повторное нажатие отменяет и сбрасывает прогресс
    if (openingUntil) sendMsg({ t: 'open', on: false });
    else if (me.alive && state.crateState === 'idle' && nearCrate()) sendMsg({ t: 'open', on: true });
    else { const door = nearDoor(); if (door) sendMsg({ t: 'door', id: door.id }); }
  }
  if (code === 'KeyR') startReload();
}
export function releaseKey(code: string): void {
  keys[code] = false;
}

/** Таблица счёта: показать или скрыть (Tab или кнопка на экране). */
export function showScoreboard(on: boolean): void {
  $('scoreboard').classList.toggle('hidden', !on);
  if (on) renderScoreboard();
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initInput(): void {
  $('resume').addEventListener('click', lock);
  canvas.addEventListener('click', () => { if (state.joined && !state.locked && !touchMode) lock(); });
  document.addEventListener('pointerlockchange', () => setLocked(document.pointerLockElement === canvas));
  document.addEventListener('mousemove', (e) => {
    if (!state.locked || touchMode) return;
    // Браузеры иногда присылают ложный рывок сразу после захвата курсора
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    look(e.movementX, e.movementY);
  });
  document.addEventListener('mousedown', (e) => {
    if (touchMode) return; // на сенсорном экране стреляют кнопкой, а не касанием где попало
    // После Esc первый клик только возвращает мышь в игру, а не стреляет
    if (!state.locked) { if (state.joined && state.menuClosed) lock(); return; }
    if (e.button === 0) setFire(true);
    if (e.button === 2) setAim(true);
  });
  document.addEventListener('mouseup', (e) => {
    if (touchMode) return;
    if (e.button === 0) setFire(false);
    if (e.button === 2) setAim(false);
  });
  document.addEventListener('contextmenu', (e) => { if (state.joined) e.preventDefault(); });
  document.addEventListener('wheel', (e) => {
    if (state.locked) cycleWeapon(e.deltaY > 0 ? 1 : -1);
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details[open]')) d.open = false;
      // Esc в разделе меню — назад к плиткам
      if (state.joined && !state.locked && !state.menuClosed && pauseView !== 'home' && performance.now() - unlockedAt > 300) {
        showPauseView('home');
        return;
      }
      // Esc при открытом меню — сразу обратно в игру (то же нажатие, что открыло меню, не считается)
      if (state.joined && !state.locked && !state.menuClosed && performance.now() - unlockedAt > 300) {
        $('pause').classList.add('hidden');
        state.menuClosed = true;
        lock(); // где браузер разрешает — мышь захватится сразу
      }
      return;
    }
    if (!state.joined || e.target instanceof HTMLInputElement) return;
    if (e.code === 'Tab') { e.preventDefault(); showScoreboard(true); }
    pressKey(e.code, e.repeat);
    if (e.code === 'Space' && playing()) e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    releaseKey(e.code);
    if (e.code === 'Tab') showScoreboard(false);
  });
}
