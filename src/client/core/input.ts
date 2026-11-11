// Управление: захват мыши, клавиатура, колесо, кнопки мыши.
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

function lock(): void {
  initAudio();
  // Сразу после Esc браузер может отказать в захвате курсора — тогда нужен повторный клик
  Promise.resolve(canvas.requestPointerLock()).catch(() => {});
}

const playing = (): boolean => state.locked || (state.joined && state.menuClosed);

let unlockedAt = 0;

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initInput(): void {
  $('resume').addEventListener('click', lock);
  canvas.addEventListener('click', () => { if (state.joined && !state.locked) lock(); });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) unlockedAt = performance.now();
    state.menuClosed = false;
    $('pause').classList.toggle('hidden', state.locked || !state.joined || voting);
    if (!state.locked) showPauseView('home');
    if (!state.locked) { state.mouseDown = false; state.aimHeld = false; for (const k in keys) keys[k] = false; }
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    // Браузеры иногда присылают ложный рывок сразу после захвата курсора
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    // В прицеле чувствительность падает вместе с углом обзора, чтобы прицел не «улетал»
    const sens = MOUSE_SENS * settings.sens * (camera.fov / BASE_FOV);
    if (gunner) {
      // В самолёте мышь поворачивает орудие (смотреть можно только вниз)
      gunner.yaw -= e.movementX * sens;
      gunner.pitch = Math.max(-1.5, Math.min(-0.15, gunner.pitch - e.movementY * sens));
      return;
    }
    if (missileCtl) {
      // Ракетой с неба управляет мышь: поворот и наклон (смотреть можно только вниз)
      missileCtl.yaw -= e.movementX * sens * 0.6;
      missileCtl.pitch = Math.max(-1.55, Math.min(-0.5, missileCtl.pitch - e.movementY * sens * 0.6));
      return;
    }
    me.yaw -= e.movementX * sens;
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * sens));
  });
  document.addEventListener('mousedown', (e) => {
    // После Esc первый клик только возвращает мышь в игру, а не стреляет
    if (!state.locked) { if (state.joined && state.menuClosed) lock(); return; }
    if (e.button === 0) { state.mouseDown = true; state.firedThisPress = false; }
    if (e.button === 2) {
      // В самолёте ПКМ — ракета; с ножом в руке — бросить его
      if (gunner) gunnerRocket();
      else if (me.weapon === 'knife') throwKnife();
      else state.aimHeld = true;
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseDown = false;
    if (e.button === 2) state.aimHeld = false;
  });
  document.addEventListener('contextmenu', (e) => { if (state.joined) e.preventDefault(); });
  document.addEventListener('wheel', (e) => {
    if (!state.locked) return;
    const order = (['knife', ...settings.kit, 'rocket'] as WeaponId[])
      .filter((w) => (w !== 'knife' || state.hasKnife) && (w !== 'rocket' || me.ammo.rocket > 0));
    const i = order.indexOf(me.weapon);
    const n = order.length;
    setWeapon(order[(i + (e.deltaY > 0 ? 1 : n - 1)) % n]!);
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
    if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); renderScoreboard(); }
    if (!playing()) return;
    keys[e.code] = true;
    // Слоты: 1 нож, 2 дробовик, 3 автомат, 4 снайперка, 5–8 — награды за серию, 0 — пистолет
    const slot = hotbar().find((h) => `Digit${h.key}` === e.code);
    if (slot && !e.repeat) useSlot(slot.id);
    if (e.code === 'KeyG' && !e.repeat) throwKnife();
    if (e.code === 'KeyV' && !e.repeat) toggleScope(performance.now());
    if (e.code === 'KeyC' && !e.repeat) trySlide(performance.now());
    if (e.code === 'KeyT' && !e.repeat) trySpray(performance.now());
    if (e.code === 'KeyF' && !e.repeat) {
      // F — начать открывать ящик; повторное нажатие отменяет и сбрасывает прогресс
      if (openingUntil) sendMsg({ t: 'open', on: false });
      else if (me.alive && state.crateState === 'idle' && nearCrate()) sendMsg({ t: 'open', on: true });
      else { const door = nearDoor(); if (door) sendMsg({ t: 'door', id: door.id }); }
    }
    if (e.code === 'KeyR') startReload();
    if (e.code === 'Space') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
  });
}
