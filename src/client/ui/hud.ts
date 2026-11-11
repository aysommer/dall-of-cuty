// HUD: здоровье, броня, патроны, счёт, таблица по Tab, чат комнаты.
import type { Team } from '../../shared/protocol.js';
import { GEAR, WEAPONS } from '../../shared/map.js';
import { levelOf, RANKS } from '../../shared/ranks.js';
import { me, state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { leaderId } from '../render/players.js';
import { gear, renderHotbar, renderStreak } from './hotbar.js';
import { timerEl } from './match.js';
import { cookStart } from '../weapons/grenade.js';

/** Чат комнаты: кто зашёл и кто вышел. Строки гаснут через 10 секунд, видно последние шесть. */
export function onChat(kind: 'join' | 'leave', name: string, team: Team): void {
  const row = document.createElement('div');
  row.className = 'chat-row ' + kind;
  const who = textEl('span', name, state.mode === 'tdm' ? 't-' + team : '');
  row.append(textEl('span', kind === 'join' ? '→ ' : '← ', 'arrow'), who,
    textEl('span', kind === 'join' ? ' заходит в комнату' : ' выходит из комнаты'));
  const chat = $('chat');
  chat.append(row);
  while (chat.childElementCount > 6) chat.firstElementChild?.remove();
  setTimeout(() => row.classList.add('fade'), 9000);
  setTimeout(() => row.remove(), 10_000);
}

export function feedNote(text: string): void {
  const row = document.createElement('div');
  row.textContent = text;
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
}

let hitTimer = 0, dmgTimer = 0;

export function showHit(kill: boolean): void {
  const el = $('hitmarker');
  el.classList.toggle('kill', kill);
  el.classList.add('show');
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => el.classList.remove('show'), kill ? 250 : 60);
}

export function flashDamage(): void {
  $('damage').classList.add('show');
  clearTimeout(dmgTimer);
  dmgTimer = window.setTimeout(() => $('damage').classList.remove('show'), 80);
}

export function updateHud(): void {
  $('hp').textContent = String(me.alive ? me.hp : 0);
  $('armor').classList.toggle('hidden', !(me.alive && me.armor > 0));
  $('armor-val').textContent = String(me.armor);
  const myHelmet = state.roster.find((p) => p.id === me.id)?.helmet ?? 0;
  $('helmet').classList.toggle('hidden', !(me.alive && myHelmet > 0));
  $('helmet-val').textContent = String(myHelmet);
  $('health').classList.toggle('low', me.hp <= 30);
  $('weapon-name').textContent = me.weapon === 'grenade' ? GEAR[gear].name : WEAPONS[me.weapon].name;
  const melee = !!WEAPONS[me.weapon].melee;
  $('ammo-count').textContent = me.weapon === 'grenade' ? String(state.myGrenades + (cookStart ? 1 : 0))
    : melee ? '—' : me.reloadUntil ? '…' : String(me.ammo[me.weapon]);
  $('ammo-total').textContent = melee ? '' : me.weapon === 'grenade' ? ' шт.' : me.weapon === 'rocket' ? ' ракет' : ` / ${me.reserve[me.weapon]}`;
  renderHotbar();
  renderStreak();

  const score = $('score');
  score.textContent = '';
  if (state.mode === 'tdm') {
    score.append(
      textEl('span', `Зелёные ${state.scores.green}`, 'g'), ' : ',
      textEl('span', `${state.scores.red} Красные`, 'r'),
    );
    score.append(state.limit > 0 ? textEl('small', `до ${state.limit}`) : timerEl());
  } else {
    const mine = state.roster.find((p) => p.id === me.id);
    const top = [...state.roster].sort((a, b) => b.kills - a.kills)[0];
    score.append(`Ты: ${mine?.kills ?? 0}`);
    if (top) score.append(textEl('small', `лидер: ${top.name} — ${top.kills}${state.limit > 0 ? ` · до ${state.limit}` : ''}`));
    if (state.limit === 0) score.append(timerEl());
  }
  if (!$('scoreboard').classList.contains('hidden')) renderScoreboard();
}

export function renderScoreboard(): void {
  const sb = $('scoreboard');
  sb.textContent = '';
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const [t, cls] of [['Игрок', ''], ['Уровень', 'n'], ['Убийства', 'n'], ['Смерти', 'n']] as const) {
    const th = document.createElement('th');
    th.textContent = t;
    th.className = cls;
    head.append(th);
  }
  const leader = leaderId();
  const order: Record<Team, number> = { green: 0, red: 1 };
  const list = [...state.roster].sort((a, b) =>
    (state.mode === 'tdm' ? order[a.team] - order[b.team] : 0) || b.kills - a.kills);
  for (const p of list) {
    const row = table.insertRow();
    if (p.id === me.id) row.className = 'me';
    const n = row.insertCell();
    n.className = 't-' + p.team;
    n.textContent = (p.id === leader ? '♛ ' : '') + p.name;
    const rank = RANKS[p.rank]!;
    const badge = textEl('small', ` ${rank.abbr} · ${rank.name}`, 'rank');
    badge.title = rank.name;
    n.append(badge);
    const lv = row.insertCell(); lv.className = 'n level'; lv.textContent = String(levelOf(p.rank));
    lv.title = `Уровень ${levelOf(p.rank)} — ${rank.name}`;
    const k = row.insertCell(); k.textContent = String(p.kills); k.className = 'n';
    const d = row.insertCell(); d.textContent = String(p.deaths); d.className = 'n';
  }
  sb.append(table);
}

let toastTimer = 0;

export function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 2000);
}
