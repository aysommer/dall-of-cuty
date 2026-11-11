// Звание и уровень: прогресс с сервера, окно звания, всплывающее «Вас повысили».
import type { ProfileMsg } from '../../shared/protocol.js';
import { killsForRank, levelOf, rankProgress, RANKS } from '../../shared/ranks.js';
import { TOKEN_KEY } from '../core/settings.js';
import { $, textEl } from '../core/util.js';
import { renderProfileTile } from './pause.js';

export function onProfile(m: ProfileMsg): void {
  knownKills = m.kills;
  knownDeaths = m.deaths;
  try {
    localStorage.setItem(TOKEN_KEY, m.token);
    localStorage.setItem(KILLS_KEY, String(m.kills));
    localStorage.setItem(DEATHS_KEY, String(m.deaths));
  } catch { /* хранилище недоступно */ }
  renderRankCards();
  renderProfileTile();
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

/** Окно звания в настройках: кольцо прогресса, сколько убийств до повышения и таблица всех званий. */
function renderRankCards(): void {
  const pr = rankProgress(knownKills);
  const r = RANKS[pr.rank]!;
  const next = RANKS[pr.rank + 1];
  for (const card of document.querySelectorAll<HTMLElement>('.rank-card')) {
    const open = card.querySelector('details')?.open ?? false;
    card.textContent = '';
    const info = document.createElement('div');
    info.className = 'rank-info';
    info.append(
      textEl('span', r.name, 'rank-name'),
      textEl('small', `Уровень ${pr.level} из ${RANKS.length} · убийств за всё время: ${knownKills}`),
    );
    if (next) {
      const bar = document.createElement('div');
      bar.className = 'rank-next';
      bar.append(
        textEl('span', `${pr.done} / ${pr.need}`, 'cnt'),
        textEl('small', ` до «${next.name}» — ещё ${killsWord(pr.need - pr.done)}`),
      );
      info.append(bar);
    } else info.append(textEl('small', 'Высшее звание — дальше некуда 🎖'));
    // Таблица: уровень, звание, сколько убийств всего нужно и сколько — с предыдущего уровня
    const all = document.createElement('details');
    all.open = open;
    const sum = document.createElement('summary');
    sum.textContent = 'Все звания';
    const table = document.createElement('table');
    const head = table.insertRow();
    for (const t of ['Ур.', 'Звание', 'Убийств', '+']) {
      const th = document.createElement('th');
      th.textContent = t;
      head.append(th);
    }
    RANKS.forEach((rk, i) => {
      const row = table.insertRow();
      if (i === pr.rank) row.className = 'now';
      else if (i < pr.rank) row.className = 'done';
      row.insertCell().textContent = String(levelOf(i));
      row.insertCell().textContent = `${rk.abbr} · ${rk.name}`;
      row.insertCell().textContent = String(killsForRank(i));
      row.insertCell().textContent = i ? `+${killsForRank(i) - killsForRank(i - 1)}` : '—';
    });
    all.append(sum, table);
    info.append(all);
    card.append(rankRing(pr.level, r.abbr, pr.part), info);
  }
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
  // Перезапуск анимации, если повысили два раза подряд
  el.classList.add('hidden');
  void el.offsetWidth;
  el.classList.remove('hidden');
  clearTimeout(promoTimer);
  promoTimer = window.setTimeout(() => el.classList.add('hidden'), 4500);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initRanks(): void {
  renderRankCards();
}
