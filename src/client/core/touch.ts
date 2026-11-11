// Сенсорное управление: джойстик под левым пальцем, обзор — под правым, действия — кнопки на экране.
// Включается само при первом касании пальцем; мышь и клавиатура при этом продолжают работать.
import { useSlot, type SlotId } from '../ui/hotbar.js';
import { enableTouch, isTouch, look, pressKey, releaseKey, setAim, setFire, showScoreboard, unlock } from './input.js';
import { keys, state } from './state.js';
import { $ } from './util.js';

/** Радиус хода джойстика, пиксели; дальше 90% хода вперёд — бег */
const STICK_R = 56;
/** Во сколько раз движение пальца сильнее движения мыши: экран маленький, а повернуться нужно на тот же угол */
const LOOK_GAIN = 2.6;

let stickId = -1, lookId = -1;
const stickAt = { x: 0, y: 0 }, lookAt = { x: 0, y: 0 };

function setStick(nx: number, ny: number): void {
  keys.KeyW = ny < -0.35;
  keys.KeyS = ny > 0.35;
  keys.KeyA = nx < -0.35;
  keys.KeyD = nx > 0.35;
  keys.ShiftLeft = ny < -0.9 || Math.hypot(nx, ny) > 0.97 && ny < -0.5;
  const knob = $('t-stick').firstElementChild as HTMLElement;
  knob.style.transform = `translate(${nx * STICK_R}px, ${ny * STICK_R}px)`;
}

function releaseStick(): void {
  stickId = -1;
  setStick(0, 0);
  $('t-stick').classList.add('hidden');
}

/** Кнопка, которую держат: on при нажатии и при отпускании; палец на кнопке огня ещё и поворачивает взгляд. */
function hold(el: HTMLElement, on: (down: boolean) => void, drag = false): void {
  let id = -1, x = 0, y = 0;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (id !== -1) return;
    id = e.pointerId; x = e.clientX; y = e.clientY;
    try { el.setPointerCapture(id); } catch { /* палец уже ушёл */ }
    el.classList.add('down');
    on(true);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== id) return;
    look((e.clientX - x) * LOOK_GAIN, (e.clientY - y) * LOOK_GAIN);
    x = e.clientX; y = e.clientY;
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = -1;
    el.classList.remove('down');
    on(false);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initTouch(): void {
  // Первое касание пальцем включает сенсорный режим (в том числе на ноутбуках с сенсорным экраном)
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !isTouch()) enableTouch(); }, true);

  // Свободная часть экрана: слева — джойстик (появляется под пальцем), справа — обзор
  const area = $('t-look');
  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { area.setPointerCapture(e.pointerId); } catch { /* палец уже ушёл */ }
    if (e.clientX < window.innerWidth * 0.42 && stickId === -1) {
      stickId = e.pointerId;
      stickAt.x = e.clientX; stickAt.y = e.clientY;
      const stick = $('t-stick');
      stick.style.left = `${e.clientX}px`;
      stick.style.top = `${e.clientY}px`;
      stick.classList.remove('hidden');
      setStick(0, 0);
    } else if (lookId === -1) {
      lookId = e.pointerId;
      lookAt.x = e.clientX; lookAt.y = e.clientY;
    }
  });
  area.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      let dx = (e.clientX - stickAt.x) / STICK_R, dy = (e.clientY - stickAt.y) / STICK_R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      setStick(dx, dy);
    } else if (e.pointerId === lookId) {
      look((e.clientX - lookAt.x) * LOOK_GAIN, (e.clientY - lookAt.y) * LOOK_GAIN);
      lookAt.x = e.clientX; lookAt.y = e.clientY;
    }
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId === stickId) releaseStick();
    if (e.pointerId === lookId) lookId = -1;
  };
  area.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', up);

  hold($('t-fire'), setFire, true);
  // Прицел — переключатель: нажал — целишься, нажал ещё раз — опустил (в самолёте — ракета, с ножом — бросок)
  $('t-aim').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setAim(!state.aimHeld);
    $('t-aim').classList.toggle('down', state.aimHeld);
  });
  for (const b of document.querySelectorAll<HTMLElement>('#touch [data-hold]')) {
    const code = b.dataset.hold!;
    hold(b, (down) => down ? pressKey(code) : releaseKey(code));
  }
  for (const b of document.querySelectorAll<HTMLElement>('#touch [data-key]')) {
    const code = b.dataset.key!;
    hold(b, (down) => down ? pressKey(code) : releaseKey(code));
  }
  hold($('t-score'), showScoreboard);
  $('t-menu').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    releaseStick();
    lookId = -1;
    $('t-aim').classList.remove('down');
    unlock();
  });
  // Слоты оружия и наград внизу экрана нажимаются пальцем
  $('hotbar').addEventListener('pointerdown', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.slot');
    if (!cell || !isTouch() || !state.locked) return;
    e.preventDefault();
    useSlot(cell.dataset.id as SlotId);
  });
  // Жесты браузера (масштаб, прокрутка, меню по долгому нажатию) во время игры не нужны
  document.addEventListener('touchmove', (e) => { if (state.locked && isTouch()) e.preventDefault(); }, { passive: false });
}
