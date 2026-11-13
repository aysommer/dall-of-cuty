// Оружие в руках и награды за серию.
// 1 — пистолет (вторичный ствол), 2 — основной ствол. Нож и устройства (граната, мина, растяжка…) в руки
// не берутся: ими пользуются на G. Награда за серию или из ящика — одна, ждёт в ячейке; применяется на 5,
// новая заменяет неиспользованную. Подсказка «… готов (нажми 5)» — рядом с серией.
import { GUNSHIP, type RewardSlot, STREAK, WEAPONS } from '../../shared/map.js';
import type { MeleeKind, LoadoutMsg, WeaponId } from '../../shared/protocol.js';
import { beep } from '../core/audio.js';
import { sendMsg } from '../core/net.js';
import { settings } from '../core/settings.js';
import { me, state } from '../core/state.js';
import { $ } from '../core/util.js';
import { missileCtl } from '../streaks/missile.js';
import { toast, updateHud } from './hud.js';
import { setWeapon } from '../weapons/viewmodel.js';

let streak = 0;

/** Снаряжение этой жизни (G): приходит с сервера (выбор в классе действует со следующей жизни) */
export let gear: MeleeKind = settings.melee;

/** Награда, ждущая применения */
export let reward: RewardSlot | null = null;

const REWARD_TITLE: Record<RewardSlot, string> = {
  uav: '🛰 БПЛА готов', missile: '🚀 Ракета с неба готова', launcher: '🎯 Ракетница готова', gunship: '✈ Самолёт готов', nuke: '☢ Бомба готова',
};

/** Стволы на 1 и 2: на 1 — пистолет (если он в наборе, иначе второй ствол), на 2 — основной. */
export function weaponSlots(): [WeaponId | null, WeaponId | null] {
  const kit = settings.kit;
  const first = kit.includes('pistol') ? 'pistol' : kit[1] ?? null;
  const second = kit.find((w) => w !== first) ?? null;
  return [first, second];
}

/** 1 или 2: взять ствол из слота. */
export function useWeaponSlot(i: 0 | 1): void {
  const w = weaponSlots()[i];
  if (w && me.alive) setWeapon(w);
}

/** 5: применить награду. Ракетница берётся в руки; если ракеты ещё остались — 5 снова даёт её в руки. */
export function useReward(): void {
  if (!reward) {
    if (me.ammo.rocket > 0 && me.alive) setWeapon('rocket');
    return;
  }
  if (reward === 'missile' && missileCtl) return;
  sendMsg({ t: 'use' });
}

/** Индикатор награды: «БПЛА готов (нажми 5)». */
export function renderReward(): void {
  const el = $('reward');
  el.classList.toggle('hidden', !reward);
  if (reward) el.textContent = `${REWARD_TITLE[reward]} (нажми 5)`;
}

const STREAK_STEPS: Array<[number, string]> = [
  [STREAK.uav, 'БПЛА'], [STREAK.missile, 'ракета с неба'], [STREAK.launcher, 'ракетница'],
  [STREAK.superArmor, 'суперброня'], [GUNSHIP.streak, 'самолёт'], [STREAK.nuke, 'бомба'],
];

export function renderStreak(): void {
  const next = STREAK_STEPS.find(([n]) => n > streak);
  $('streak-count').textContent = String(streak);
  $('streak-next').textContent = next ? `${next[1]} через ${next[0] - streak}` : 'все награды получены';
  renderReward();
}

export function onLoadout(m: LoadoutMsg): void {
  if (m.reward && m.reward !== reward) {
    toast(`🎁 ${REWARD_TITLE[m.reward]} — нажми 5${reward ? ' (заменила неиспользованную награду)' : ''}`);
    beep(1200, 0.3, 0.12);
  }
  if (m.streak === STREAK.superArmor && streak < m.streak) toast('🛡 Ты Джаггернаут: +500 брони, шлем держит 3 выстрела в голову');
  state.hasKnife = m.knife;
  gear = m.gear;
  state.myGrenades = m.grenades;
  streak = m.streak;
  reward = m.reward;
  updateHud();
}

/** Для тестов: что на 1 и 2 */
export const slotsText = (): string => weaponSlots().map((w, i) => `${i + 1}:${w ? WEAPONS[w].name : '—'}`).join(' ');
