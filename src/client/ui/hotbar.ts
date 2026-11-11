// Слоты оружия внизу экрана и серия убийств с наградами.
import { GEAR, GUNSHIP, STREAK, type StreakKind, WEAPONS } from '../../shared/map.js';
import type { MeleeKind, LoadoutMsg, WeaponId } from '../../shared/protocol.js';
import { beep } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { missileCtl } from '../streaks/missile.js';
import { toast, updateHud } from './hud.js';
import { cookStart } from '../weapons/grenade.js';
import { setWeapon } from '../weapons/viewmodel.js';

let streak = 0;

/** Что в слоте 1 в этой жизни: приходит с сервера (выбор в классе действует со следующей жизни) */
export let gear: MeleeKind = settings.melee;

const rewards: Record<StreakKind, number> = { uav: 0, missile: 0, nuke: 0, gunship: 0 };

export type SlotId = WeaponId | StreakKind;

/** Слоты: 1 — нож, 2 и 3 — стволы из набора, 5–8 — награды за серию. */
export function hotbar(): Array<{ key: string; id: SlotId; label: string }> {
  const kit = settings.kit.map((id, i) => ({ key: String(i + 2), id: id as SlotId, label: WEAPONS[id].name }));
  return [
    // Слот 1: нож или устройство этой жизни (в руке оно — «граната», а что именно — говорит gear)
    gear === 'knife' ? { key: '1', id: 'knife', label: 'Нож' } : { key: '1', id: 'grenade', label: GEAR[gear].name },
    ...kit,
    { key: '5', id: 'uav', label: 'БПЛА' },
    { key: '6', id: 'missile', label: 'Ракета с неба' },
    { key: '7', id: 'rocket', label: 'Ракетница' },
    { key: '8', id: 'nuke', label: 'Бомба' },
    { key: '9', id: 'gunship', label: 'Самолёт' },
  ];
}

let hotbarKey = '';

const isStreakKind = (id: SlotId): id is StreakKind =>
  id === 'uav' || id === 'missile' || id === 'nuke' || id === 'gunship';

function slotReady(id: SlotId): boolean {
  if (isStreakKind(id)) return rewards[id] > 0;
  if (id === 'knife') return state.hasKnife;
  if (id === 'grenade') return state.myGrenades > 0 || cookStart > 0;
  if (id === 'rocket') return me.ammo.rocket > 0;
  return true;
}

export function useSlot(id: SlotId): void {
  if (!slotReady(id)) return;
  if (!isStreakKind(id)) { if (me.alive) setWeapon(id); return; }
  // БПЛА, ракету с неба и бомбу можно применить и после смерти
  if (id === 'missile' && missileCtl) return;
  sendMsg({ t: 'use', kind: id });
}

export function renderHotbar(): void {
  const bar = $('hotbar');
  const list = hotbar();
  const key = list.map((h) => h.id + h.label).join();
  if (key !== hotbarKey) {
    // Набор поменялся — перестраиваем ячейки
    hotbarKey = key;
    bar.textContent = '';
    for (const h of list) {
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.dataset.id = h.id;
      cell.append(textEl('span', h.key, 'key'), textEl('span', h.label, 'name'), textEl('span', '', 'count'));
      bar.append(cell);
    }
  }
  for (const cell of bar.querySelectorAll<HTMLElement>('.slot')) {
    const id = cell.dataset.id as SlotId;
    cell.classList.toggle('active', id === me.weapon);
    cell.classList.toggle('off', !slotReady(id));
    cell.classList.toggle('reward', isStreakKind(id) && rewards[id] > 0);
    const count = isStreakKind(id) ? rewards[id] : id === 'rocket' ? me.ammo.rocket : 0;
    cell.querySelector('.count')!.textContent = count > 0 ? `×${count}` : '';
  }
}

const STREAK_STEPS: Array<[number, string]> = [
  [STREAK.uav, 'БПЛА'], [STREAK.missile, 'ракета с неба'], [STREAK.launcher, 'ракетница'],
  [STREAK.superArmor, 'суперброня'], [GUNSHIP.streak, 'самолёт'], [STREAK.nuke, 'бомба'],
];

export function renderStreak(): void {
  const next = STREAK_STEPS.find(([n]) => n > streak);
  $('streak-count').textContent = String(streak);
  $('streak-next').textContent = next ? `${next[1]} через ${next[0] - streak}` : 'все награды получены';
}

export function onLoadout(m: LoadoutMsg): void {
  const got = (k: StreakKind) => m[k] > rewards[k];
  if (got('uav')) toast('🎁 БПЛА готов — нажми 5');
  if (got('missile')) toast('🎁 Ракета с неба готова — нажми 6');
  if (got('nuke')) toast('🎁 Бомба готова — нажми 8');
  if (got('gunship')) toast('🎁 Самолёт готов — нажми 9');
  if (m.streak === STREAK.superArmor && streak < m.streak) toast('🛡 Ты Джаггернаут: +500 брони, шлем держит 3 выстрела в голову');
  if (got('uav') || got('missile') || got('nuke') || got('gunship')) beep(1200, 0.3, 0.12);
  state.hasKnife = m.knife;
  if (gear !== m.gear) { gear = m.gear; hotbarKey = ''; }
  state.myGrenades = m.grenades;
  streak = m.streak;
  rewards.uav = m.uav;
  rewards.missile = m.missile;
  rewards.nuke = m.nuke;
  rewards.gunship = m.gunship;
  if (!state.hasKnife && me.weapon === 'knife') setWeapon(settings.kit[0]!);
  updateHud();
}
