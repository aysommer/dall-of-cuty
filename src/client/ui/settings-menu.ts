// Ползунки и переключатели настроек в меню.
import { master } from '../core/audio.js';
import { settings, SETTINGS_KEY } from '../core/settings.js';
import { textEl } from '../core/util.js';
import { viewModel } from '../weapons/viewmodel.js';

const settingsRefreshers: Array<() => void> = [];

export function applySettings(): void {
  if (master) master.gain.value = settings.volume;
  viewModel.position.x = settings.hand === 'left' ? -0.22 : 0.22;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* хранилище недоступно */ }
  for (const refresh of settingsRefreshers) refresh();
}

function slider(
  label: string, min: number, max: number, step: number,
  get: () => number, set: (v: number) => void, show: (v: number) => string,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'setting';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  const value = textEl('span', '', 'value');
  row.append(textEl('span', label, 'name'), input, value);
  input.addEventListener('input', () => { set(Number(input.value)); applySettings(); });
  settingsRefreshers.push(() => { input.value = String(get()); value.textContent = show(get()); });
  return row;
}

function buildSettings(root: HTMLElement): void {
  root.append(
    slider('Громкость', 0, 1, 0.05, () => settings.volume, (v) => { settings.volume = v; },
      (v) => `${Math.round(v * 100)}%`),
    slider('Чувствительность мыши', 0.2, 3, 0.05, () => settings.sens, (v) => { settings.sens = v; },
      (v) => `×${v.toFixed(2)}`),
    slider('Угол обзора (FOV)', 70, 100, 1, () => settings.fov, (v) => { settings.fov = v; },
      (v) => `${v}°`),
  );
  const row = document.createElement('div');
  row.className = 'setting';
  const choice = document.createElement('div');
  choice.className = 'choice';
  const hands = [['right', 'Справа'], ['left', 'Слева']] as const;
  const buttons = hands.map(([hand, title]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = title;
    b.addEventListener('click', () => { settings.hand = hand; applySettings(); });
    settingsRefreshers.push(() => b.classList.toggle('active', settings.hand === hand));
    return b;
  });
  choice.append(...buttons);
  row.append(textEl('span', 'Положение оружия', 'name'), choice);
  root.append(row);
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initSettingsMenu(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.settings')) buildSettings(root);
  applySettings();
}
