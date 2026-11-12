// Время матча и голосование за следующую карту.
import type { VoteMsg } from '../../shared/protocol.js';
import { MAP_ORDER, type MapId, MAPS } from '../../shared/map.js';
import { overText, sendMsg } from '../core/net.js';
import { unlock } from '../core/input.js';
import { syncMenu } from './shell.js';
import { state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { feedNote } from './hud.js';
import { loadMap } from '../world/map.js';
import { applyFog, onWeather } from '../world/weather.js';

export let voting = false;

let voteEndsAt = 0;

export function timerText(): string {
  const left = Math.max(0, Math.ceil((state.matchEndsAt - performance.now()) / 1000));
  return `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function timerEl(): HTMLElement {
  const el = textEl('small', timerText(), 'timer');
  el.id = 'match-timer';
  return el;
}

export function onVote(m: VoteMsg): void {
  if (!voting) {
    voting = true;
    voteEndsAt = performance.now() + m.ms;
    unlock();
    syncMenu();
    $('vote').classList.remove('hidden');
  }
  $('vote-title').textContent = overText || 'Матч окончен';
  const list = $('vote-maps');
  list.textContent = '';
  for (const id of MAP_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = id === m.mine ? 'active' : '';
    b.append(textEl('span', MAPS[id].name), textEl('small', ` · голосов: ${m.counts[id]}`));
    b.addEventListener('click', () => sendMsg({ t: 'vote', map: id }));
    list.append(b);
  }
}

export function updateVote(now: number): void {
  if (!voting) return;
  $('vote-timer').textContent = `Новый матч через ${Math.max(0, Math.ceil((voteEndsAt - now) / 1000))} сек. При равенстве голосов карта выбирается случайно.`;
}

export function onNewMap(id: MapId): void {
  voting = false;
  state.roundOver = false;
  $('vote').classList.add('hidden');
  loadMap(id);
  if (state.lastWeather) onWeather(state.lastWeather);
  applyFog(); // туман и небо — под текущую погоду
  feedNote(`🗺 Новый матч: ${MAPS[id].name}`);
  // Мышь отпущена на время голосования — вернуть её можно кликом по «ИГРАТЬ»
  syncMenu();
}
