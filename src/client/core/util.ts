// Общие мелочи клиента: поиск элемента по id и постоянные движения.
import type { Team } from '../../shared/protocol.js';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Нет элемента #${id}`);
  return el as T;
};

export const TEAM_COLOR: Record<Team, number> = { green: 0x2fc44e, red: 0xe23b3b };

export const SPEED = 6.5, JUMP = 7, GRAVITY = 19, CLIMB = 4;

/** Во сколько раз бег быстрее ходьбы */
export const SPRINT_K = 1.25;

export const MOUSE_SENS = 0.0022;

export const BASE_FOV = 75;

export function textEl(tag: 'span' | 'small', text: string, cls = ''): HTMLElement {
  const s = document.createElement(tag);
  s.className = cls;
  s.textContent = text;
  return s;
}
