// Звание и уровень: прогресс с сервера, окно звания, всплывающее «Вас повысили».
import type { ProfileMsg, WeaponId } from '../../shared/protocol.js';
import { killsForRank, levelOf, rankProgress, RANKS, UNLOCK_LEVEL } from '../../shared/ranks.js';
import { GEAR, isGear, WEAPONS } from '../../shared/map.js';
import { TOKEN_KEY } from '../core/settings.js';
import { $, textEl } from '../core/util.js';
import { enforceUnlocks } from './classes.js';
import { renderHome } from './shell.js';

export function onProfile(m: ProfileMsg): void {
  knownKills = m.kills;
  knownDeaths = m.deaths;
  try {
    localStorage.setItem(TOKEN_KEY, m.token);
    localStorage.setItem(KILLS_KEY, String(m.kills));
    localStorage.setItem(DEATHS_KEY, String(m.deaths));
  } catch { /* хранилище недоступно */ }
  renderHome();
  renderProgress();
  enforceUnlocks();
}

// Сервер присылает убийства только после входа (прогресс зашифрован), поэтому для меню
// до входа помним последнее известное число — только чтобы показать, решает всё равно сервер.
const KILLS_KEY = 'doc-kills';

const DEATHS_KEY = 'doc-deaths';

const storedCount = (key: string): number => {
  try { return Math.max(0, Number(localStorage.getItem(key)) || 0); } catch { return 0; }
};

export let knownKills = storedCount(KILLS_KEY);

export let knownDeaths = storedCount(DEATHS_KEY);

const SVG_NS = 'http://www.w3.org/2000/svg';

/** «1 убийство», «3 убийства», «5 убийств» */
function killsWord(n: number): string {
  const d = n % 10, h = n % 100;
  const w = d === 1 && h !== 11 ? 'убийство' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'убийства' : 'убийств';
  return `${n} ${w}`;
}

/** Большой круговой прогресс: кольцо заполнено на part, внутри — уровень и звание. */
export function rankRing(level: number, abbr: string, part: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ring';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  const R = 52, LEN = 2 * Math.PI * R;
  for (const cls of ['bg', 'fg']) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', String(R));
    c.setAttribute('class', cls);
    if (cls === 'fg') {
      c.setAttribute('stroke-dasharray', String(LEN));
      c.setAttribute('stroke-dashoffset', String(LEN * (1 - Math.max(0, Math.min(1, part)))));
      c.style.setProperty('--len', String(LEN));
    }
    svg.append(c);
  }
  const inner = document.createElement('div');
  inner.className = 'ring-in';
  inner.append(textEl('small', 'УРОВЕНЬ'), textEl('span', String(level), 'lv'), textEl('small', abbr, 'abbr'));
  wrap.append(svg, inner);
  return wrap;
}

/** Доступно сразу, с первого уровня: всё, чего нет в списке открытий */
/** Что открывается на уровне level: оружие и устройства (на первом — ничего: с него доступно базовое) */
function unlocksAt(level: number): string[] {
  return Object.entries(UNLOCK_LEVEL).filter(([, lv]) => lv === level)
    .map(([id]) => isGear(id) ? `${GEAR[id].icon} ${GEAR[id].name}` : WEAPONS[id as WeaponId].name);
}

/**
 * Прогресс: только текущий и следующий уровень. Шкала между ними заполнена на долю пути
 * к следующему; под каждым — что на нём открывается. Дальние уровни и названия будущих званий не показываются.
 */
export function renderProgress(): void {
  const root = $('progress');
  root.textContent = '';
  const pr = rankProgress(knownKills);
  const hasNext = pr.need > 0;
  const nextItems = hasNext ? unlocksAt(pr.level + 1) : [];
  root.append(textEl('span', `Уровень ${pr.level}`, 'prog-now'),
    textEl('small', hasNext
      ? `До уровня ${pr.level + 1} — ещё ${pr.need - pr.done} из ${pr.need} убийств.${nextItems.length ? ` Откроется: ${nextItems.join(', ')}.` : ''}`
      : 'Высший уровень.'));
  const line = document.createElement('div');
  line.className = 'timeline two';
  const bar = document.createElement('div');
  bar.className = 'timeline-bar';
  const done = document.createElement('i');
  done.style.width = `${(hasNext ? pr.part : 1) * 100}%`;
  bar.append(done);
  line.append(bar);
  const node = (lv: number, left: number, reached: boolean, items: string[]): void => {
    const n = document.createElement('div');
    n.className = 'node' + (reached ? ' done now' : '');
    n.style.left = `${left}%`;
    n.append(textEl('span', String(lv), 'dot'));
    const list = document.createElement('div');
    list.className = 'items';
    for (const it of items) list.append(textEl('span', (reached ? '✓ ' : '🔒 ') + it, 'chip'));
    n.append(list);
    line.append(n);
  };
  // Текущий уровень: что на нём открылось (на первом ничего не пишем — базовое оружие игрок и так видит)
  node(pr.level, 0, true, pr.level > 1 ? unlocksAt(pr.level) : []);
  if (hasNext) node(pr.level + 1, 100, false, nextItems);
  root.append(line);
}

let promoTimer = 0;

/** Всплывающее окно «Вас повысили»: кольцо нового звания заполняется на глазах. */
export function showPromotion(rank: number): void {
  const r = RANKS[rank]!;
  const el = $('promo');
  el.textContent = '';
  const ring = rankRing(levelOf(rank), r.abbr, 1);
  ring.classList.add('fill');
  el.append(
    textEl('small', '🎖 ВАС ПОВЫСИЛИ!', 'promo-title'),
    ring,
    textEl('span', r.name, 'promo-name'),
    textEl('small', `Уровень ${levelOf(rank)}${RANKS[rank + 1] ? ` · следующее звание через ${killsWord(killsForRank(rank + 1) - killsForRank(rank))}` : ' · высшее звание'}`),
  );
  // Что открылось на этом уровне — оружие и снаряжение для классов
  const opened = Object.entries(UNLOCK_LEVEL).filter(([, lv]) => lv === levelOf(rank))
    .map(([id]) => isGear(id) ? GEAR[id].name : WEAPONS[id as WeaponId].name);
  if (opened.length) el.append(textEl('span', `🔓 Открыто: ${opened.join(', ')}`, 'promo-unlock'));
  // Перезапуск анимации, если повысили два раза подряд
  el.classList.add('hidden');
  void el.offsetWidth;
  el.classList.remove('hidden');
  clearTimeout(promoTimer);
  promoTimer = window.setTimeout(() => el.classList.add('hidden'), 4500);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initRanks(): void {
  renderProgress();
}
