// Звание и уровень: прогресс с сервера, окно звания, всплывающее «Вас повысили».
import type { ProfileMsg, WeaponId } from '../../shared/protocol.js';
import { killsForRank, levelOf, rankProgress, RANKS, UNLOCK_LEVEL } from '../../shared/ranks.js';
import { GEAR, GEAR_ORDER, GUNS, isGear, WEAPONS } from '../../shared/map.js';
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
const FIRST_LEVEL = [
  ...GUNS.filter((w) => !(w in UNLOCK_LEVEL)).map((w) => WEAPONS[w].name),
  ...GEAR_ORDER.filter((g) => !(g in UNLOCK_LEVEL)).map((g) => `${GEAR[g].icon} ${GEAR[g].name}`),
];

/** Что открывается на каком уровне: оружие и устройства по порядку уровней. */
function unlocksByLevel(): Array<{ level: number; items: string[] }> {
  const levels = new Map<number, string[]>();
  for (const [id, lv] of Object.entries(UNLOCK_LEVEL)) {
    const title = isGear(id) ? `${GEAR[id].icon} ${GEAR[id].name}` : WEAPONS[id as WeaponId].name;
    levels.set(lv, [...(levels.get(lv) ?? []), title]);
  }
  return [...levels].sort((a, b) => a[0] - b[0]).map(([level, items]) => ({ level, items }));
}

/**
 * Прогресс: горизонтальная шкала уровней, под отметками — что на них открывается.
 * Шкала заполнена до текущего уровня и дальше — на долю пути к следующему. Названий будущих званий здесь нет.
 */
export function renderProgress(): void {
  const root = $('progress');
  root.textContent = '';
  const pr = rankProgress(knownKills);
  const steps = unlocksByLevel();
  const last = Math.max(...steps.map((s) => s.level), pr.level + (pr.need ? 1 : 0));
  // Отметки шкалы: все уровни от первого до последнего с открытиями (или до следующего после текущего)
  const fill = last > 1 ? Math.min(1, (pr.level - 1 + pr.part) / (last - 1)) : 1;
  const next = steps.find((s) => s.level > pr.level);
  root.append(textEl('span', `Уровень ${pr.level}`, 'prog-now'),
    textEl('small', next
      ? `На уровне ${next.level} откроется: ${next.items.join(', ')}. До следующего уровня — ${pr.need - pr.done} из ${pr.need} убийств.`
      : pr.need ? `Всё оружие и снаряжение открыто. До следующего уровня — ${pr.need - pr.done} из ${pr.need} убийств.`
        : 'Всё открыто, уровень высший.'));
  const line = document.createElement('div');
  line.className = 'timeline';
  const bar = document.createElement('div');
  bar.className = 'timeline-bar';
  const done = document.createElement('i');
  done.style.width = `${fill * 100}%`;
  bar.append(done);
  line.append(bar);
  for (let lv = 1; lv <= last; lv++) {
    const node = document.createElement('div');
    node.className = 'node' + (lv <= pr.level ? ' done' : '') + (lv === pr.level ? ' now' : '');
    node.style.left = `${last > 1 ? ((lv - 1) / (last - 1)) * 100 : 0}%`;
    node.append(textEl('span', String(lv), 'dot'));
    const items = steps.find((s) => s.level === lv)?.items ?? (lv === 1 ? FIRST_LEVEL : []);
    const list = document.createElement('div');
    list.className = 'items';
    for (const it of items) list.append(textEl('span', (lv <= pr.level ? '✓ ' : '🔒 ') + it, 'chip'));
    node.append(list);
    line.append(node);
  }
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
