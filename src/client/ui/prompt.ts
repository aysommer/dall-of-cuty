// Подсказки у ящика и двери и полоска открытия ящика.
import { CRATE } from '../../shared/map.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { crateBy, crateExpiresAt, nearCrate, openingUntil } from '../pickups/crate.js';
import { nearDoor, openDoors } from '../world/map.js';

export function updateCratePrompt(now: number): void {
  const prompt = $('crate-prompt');
  let text = '';
  let progress = -1;
  if (state.joined && me.alive && (state.crateState === 'idle' || state.crateState === 'opening')) {
    if (openingUntil) {
      progress = Math.max(0, Math.min(1, 1 - (openingUntil - now) / CRATE.openMs));
      text = 'Открываю ящик… F — отмена';
    } else if (nearCrate()) {
      const opener = state.crateState === 'opening' ? state.roster.find((p) => p.id === crateBy) : null;
      const left = Math.max(0, Math.ceil((crateExpiresAt - now) / 1000));
      text = opener
        ? `Ящик открывает ${opener.name}`
        : `F — открыть ящик (${CRATE.openMs / 1000} сек., двигаться нельзя) · исчезнет через ${left} сек.`;
    }
  }
  if (!text && state.joined && me.alive) {
    const door = nearDoor();
    if (door) text = openDoors.has(door.id) ? 'F — закрыть дверь' : 'F — открыть дверь';
  }
  prompt.classList.toggle('hidden', !text);
  if (!text) return;
  $('crate-text').textContent = text;
  $('crate-bar').classList.toggle('hidden', progress < 0);
  $('crate-fill').style.width = `${Math.round(Math.max(0, progress) * 100)}%`;
}
