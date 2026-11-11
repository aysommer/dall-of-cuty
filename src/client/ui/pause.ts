// Меню паузы (Esc): плитки профиля, классов, настроек и выхода.
import { rankProgress, RANKS } from '../../shared/ranks.js';
import { me, state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { renderClasses } from './classes.js';
import { knownDeaths, knownKills, rankRing } from './ranks.js';

type PauseView = 'home' | 'classes' | 'settings';

export let pauseView: PauseView = 'home';

const PAUSE_TITLES: Record<PauseView, string> = { home: 'Пауза', classes: 'Классы', settings: 'Настройки' };

export function showPauseView(view: PauseView): void {
  pauseView = view;
  for (const v of ['home', 'classes', 'settings'] as const) $('pv-' + v).classList.toggle('hidden', v !== view);
  $('pause-title').textContent = PAUSE_TITLES[view];
  $('pause-back').classList.toggle('hidden', view === 'home');
  if (view === 'home') renderProfileTile();
  if (view === 'classes') renderClasses();
}

/** Имя игрока: из списка на сервере, а до него — из поля в меню входа. */
function myName(): string {
  return state.roster.find((p) => p.id === me.id)?.name ?? ($<HTMLInputElement>('name').value.trim() || 'Игрок');
}

/** Плитка профиля: ник, звание, уровень, кольцо прогресса, убийства и смерти (не кликается). */
export function renderProfileTile(): void {
  const tile = $('tile-profile');
  const pr = rankProgress(knownKills);
  const r = RANKS[pr.rank]!;
  const next = RANKS[pr.rank + 1];
  const kd = knownDeaths ? knownKills / knownDeaths : knownKills;
  const mine = state.roster.find((p) => p.id === me.id);
  tile.textContent = '';
  const info = document.createElement('div');
  info.className = 'profile-info';
  info.append(
    textEl('span', myName(), 'nick'),
    textEl('span', `${r.abbr} · ${r.name}`, 'rank-line'),
    textEl('small', next ? `${pr.done} / ${pr.need} до «${next.name}»` : 'Высшее звание'),
  );
  const stats = document.createElement('div');
  stats.className = 'kd';
  const stat = (value: string, label: string): HTMLElement => {
    const el = document.createElement('div');
    el.append(textEl('span', value, 'v'), textEl('small', label));
    return el;
  };
  stats.append(
    stat(String(knownKills), 'убийств'),
    stat(String(knownDeaths), 'смертей'),
    stat(kd.toFixed(2), 'У/С'),
  );
  info.append(stats);
  if (mine) info.append(textEl('small', `В этом матче: ${mine.kills} / ${mine.deaths}`, 'match'));
  tile.append(rankRing(pr.level, r.abbr, pr.part), info);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initPause(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#pv-home [data-view]')) {
    b.addEventListener('click', () => showPauseView(b.dataset.view === 'classes' ? 'classes' : 'settings'));
  }
  $('pause-back').addEventListener('click', () => showPauseView('home'));
  // Выйти — на главный экран: соединение рвётся, сервер убирает игрока, меню входа — с чистого листа
  $('tile-exit').addEventListener('click', () => location.reload());
}
