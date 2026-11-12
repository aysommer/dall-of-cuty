// Каркас меню: слева разделы, в центре — выбранный. В лобби это главное меню, в бою — меню по Esc
// (пункты слева другие, главный экран тот же: уровень, звание, ник).
import { rankProgress, RANKS } from '../../shared/ranks.js';
import { lock } from '../core/input.js';
import { me, state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { renderClasses } from './classes.js';
import { voting } from './match.js';
import { joinRandom } from './menu.js';
import { knownDeaths, knownKills, rankRing, renderProgress } from './ranks.js';

export type View = 'home' | 'rooms' | 'classes' | 'progress' | 'settings';
const VIEWS: View[] = ['home', 'rooms', 'classes', 'progress', 'settings'];

export let view: View = 'home';

export function showView(v: View): void {
  // Комнаты выбирают только в лобби
  view = v === 'rooms' && state.joined ? 'home' : v;
  for (const id of VIEWS) $('view-' + id).classList.toggle('hidden', id !== view);
  for (const b of document.querySelectorAll<HTMLElement>('.nav-item[data-view]')) b.classList.toggle('active', b.dataset.view === view);
  if (view === 'home') renderHome();
  if (view === 'classes') renderClasses();
  if (view === 'progress') renderProgress();
}

/** Меню видно всегда, пока игрок не в комнате; в бою — только когда он сам его открыл (и не идёт голосование). */
export function syncMenu(): void {
  const show = !state.joined || (!state.locked && !state.menuClosed && !voting);
  $('menu').classList.toggle('hidden', !show);
  document.body.classList.toggle('in-game', state.joined);
}

/** Ник: в бою — с сервера, в лобби — из поля (хранится в браузере). */
export function myName(): string {
  return state.roster.find((p) => p.id === me.id)?.name ?? ($<HTMLInputElement>('name').value.trim() || 'Игрок');
}

/** Главный экран: огромное кольцо до следующего уровня, звание, ник и счёт. */
export function renderHome(): void {
  const pr = rankProgress(knownKills);
  const r = RANKS[pr.rank]!;
  const ring = $('home-ring');
  ring.textContent = '';
  ring.append(rankRing(pr.level, r.abbr, pr.part));
  $('home-rank').textContent = r.name;
  $('home-next').textContent = pr.need
    ? `${pr.done} / ${pr.need} — до следующего уровня ещё ${pr.need - pr.done}`
    : 'Высший уровень';
  $('home-nick').textContent = myName();
  const kd = knownDeaths ? knownKills / knownDeaths : knownKills;
  const stats = $('home-stats');
  stats.textContent = '';
  const stat = (value: string, label: string): HTMLElement => {
    const el = document.createElement('div');
    el.append(textEl('span', value, 'v'), textEl('small', label));
    return el;
  };
  stats.append(stat(String(knownKills), 'убийств'), stat(String(knownDeaths), 'смертей'), stat(kd.toFixed(2), 'У/С'));
  const mine = state.roster.find((p) => p.id === me.id);
  if (mine) stats.append(stat(`${mine.kills} / ${mine.deaths}`, 'в этом матче'));
}

/** Вошли в комнату: меню прячется, игра начинается сразу — класс при желании меняют потом по Esc. */
export function enterGame(): void {
  state.joined = true;
  $('hud').classList.remove('hidden');
  showView('home');
  // Если браузер не даст захватить мышь без нового клика, клавиатура всё равно работает, а первый клик вернёт мышь
  state.menuClosed = true;
  syncMenu();
  lock();
}

/** Связь с сервером оборвалась: назад в главное меню. */
export function leaveGame(): void {
  state.joined = false;
  $('hud').classList.add('hidden');
  syncMenu();
}

/** Клавиши: группа → строки «клавиша — что делает» */
const KEYS: Array<[string, Array<[string, string]>]> = [
  ['Движение', [
    ['W A S D', 'ходьба'], ['Shift', 'бег'], ['Пробел', 'прыжок'],
    ['C', 'присесть; на бегу — подкат'], ['Ctrl', 'лечь'],
  ]],
  ['Бой', [
    ['ЛКМ', 'огонь; граната — зажать и отпустить; мина и растяжка — поставить'], ['ПКМ', 'прицел'],
    ['R', 'перезарядка'], ['V', 'снять или надеть прицел'], ['G', 'бросить нож'],
    ['1', 'нож или устройство'], ['2 и 3', 'стволы'], ['Колесо', 'оружие по кругу'],
  ]],
  ['Награды за серию', [
    ['5', 'БПЛА'], ['6', 'ракета с неба'], ['7', 'ракетница'], ['8', 'бомба'], ['9', 'самолёт'],
  ]],
  ['Прочее', [
    ['F', 'ящик и двери'], ['T', 'эмодзи на стене'], ['Tab', 'счёт'], ['Esc', 'меню'],
  ]],
];

let leaving = false;

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initShell(): void {
  for (const b of document.querySelectorAll<HTMLElement>('.nav-item[data-view]')) {
    b.addEventListener('click', () => showView(b.dataset.view as View));
  }
  $('nav-home').addEventListener('click', () => showView('home'));
  $('nav-random').addEventListener('click', joinRandom);
  $('nav-exit').addEventListener('click', () => {
    leaving = true;
    if (state.joined) { location.reload(); return; } // из боя — в главное меню
    // Из главного меню — закрыть вкладку; браузер разрешает это не всегда
    window.close();
    setTimeout(() => {
      leaving = false;
      $('status').textContent = 'Браузер не дал закрыть вкладку — закрой её сам.';
    }, 300);
  });
  // Ctrl+W и другие сочетания браузера не должны молча выбрасывать из боя (Ctrl — «лечь»)
  window.addEventListener('beforeunload', (e) => {
    if (state.joined && !leaving) { e.preventDefault(); e.returnValue = ''; }
  });

  // Ник: «Изменить» показывает поле; Enter или уход из поля — сохранить
  const input = $<HTMLInputElement>('name');
  input.value = localStorage.getItem('doc-name') ?? '';
  const edit = (on: boolean): void => {
    input.classList.toggle('hidden', !on);
    $('home-nick').classList.toggle('hidden', on);
    $('nick-edit').textContent = on ? 'Готово' : 'Изменить';
    if (on) { input.focus(); input.select(); } else {
      input.value = input.value.trim();
      try { localStorage.setItem('doc-name', input.value); } catch { /* хранилище недоступно */ }
      renderHome();
    }
  };
  $('nick-edit').addEventListener('click', () => edit(input.classList.contains('hidden')));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(false); } });
  input.addEventListener('blur', () => { if (!input.classList.contains('hidden')) edit(false); });

  const keys = $('keys');
  for (const [group, rows] of KEYS) {
    const box = document.createElement('div');
    box.className = 'key-group';
    box.append(textEl('span', group, 'key-title'));
    for (const [key, what] of rows) {
      const row = document.createElement('div');
      row.className = 'key-row';
      row.append(textEl('span', key, 'kbd'), textEl('span', what));
      box.append(row);
    }
    keys.append(box);
  }
  showView('home');
  syncMenu();
}
