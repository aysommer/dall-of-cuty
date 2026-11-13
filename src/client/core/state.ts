// Состояние клиента: свой игрок, чужие игроки, клавиши; общий объект state для того, что меняют разные модули.
import * as THREE from 'three';
import type { CrateState, Mode, PlayerInfo, Team, Vec3, WeaponId, WeatherMsg } from '../../shared/protocol.js';
import { PLAYER, WEAPONS } from '../../shared/map.js';
import { camera } from './scene.js';
import { settings } from './settings.js';
import type { Remote } from '../render/players.js';
import { viewGun, viewModel } from '../weapons/viewmodel.js';

/** То, что меняют разные модули: читать и писать как state.имя. */
export const state = {
  crateState: 'gone' as CrateState,
  /** Куда падает или где лежит ящик */
  crateAt: null as Vec3 | null,
  crateMesh: null as THREE.Group | null,
  /** Парашют падающего ящика — по нему ящик видно издалека */
  crateChute: null as THREE.Group | null,
  mode: 'tdm' as Mode,
  limit: 20,
  scores: { green: 0, red: 0 } as Record<Team, number>,
  roster: [] as PlayerInfo[],
  /** Пинг игроков (id → мс), приходит с сервера раз в 2 с */
  pings: new Map<number, number>(),
  mouseDown: false,
  firedThisPress: false,
  locked: false,
  joined: false,
  roundOver: false,
  respawnAt: 0,
  // Подкат: до какого момента скользим, в какую сторону и с какой начальной скоростью
  slideUntil: 0,
  slideCooldownUntil: 0,
  slideSpeed: 0,
  /** Игрок лежит: идёт подкат, лёг сам (Ctrl) или над головой нет места, чтобы встать */
  low: false,
  /** Игрок присел (C) */
  crouch: false,
  /** Чего хочет игрок: 0 — стоять, 1 — присесть, 2 — лечь; получится ли встать — зависит от места над головой */
  stance: 0 as 0 | 1 | 2,
  eyeH: PLAYER.eye as number,
  // Прицеливание на ПКМ: aimHeld — кнопка зажата, adsK — 0 (от бедра) … 1 (в прицел)
  aimHeld: false,
  adsK: 0,
  /** Удар ножом: когда закончится горизонтальный взмах (для анимации) */
  swingUntil: 0,
  /**
   * Отдача: временный подъём камеры, который сам возвращается обратно.
   * Поэтому место попадания после выстрела снова оказывается под прицелом.
   */
  recoil: 0,
  kick: 0,
  /**
   * Меню закрыли по Esc: клавиатура сразу работает (бег, оружие, прыжки),
   * а мышь вернётся с первым кликом — браузеры не дают захватить её по Esc.
   */
  menuClosed: false,
  /** Нож есть, пока его не бросили; после смерти возвращается. */
  hasKnife: true,
  myGrenades: 0,
  lastWeather: null as WeatherMsg | null,
  uavUntil: 0,
  matchEndsAt: 0,
  sprintK: 0,
  wallK: 0,
  /** Оптика на снайперке: снимается и надевается на V */
  scopeOn: true,
  /** Когда закончится передёргивание затвора снайперки */
  boltUntil: 0,
};

export const me = {
  id: -1,
  team: 'green' as Team,
  alive: false,
  hp: 100,
  armor: 0,
  big: false,
  pos: new THREE.Vector3(0, 0, 26),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  grounded: false,
  weapon: 'pistol' as WeaponId,
  ammo: {
    pistol: WEAPONS.pistol.mag, shotgun: WEAPONS.shotgun.mag, rifle: WEAPONS.rifle.mag, m6: WEAPONS.m6.mag,
    sniper: WEAPONS.sniper.mag, lmg: WEAPONS.lmg.mag, smg: WEAPONS.smg.mag, knife: 0, grenade: 0, rocket: 0,
  } as Record<WeaponId, number>,
  /** Запас патронов сверх магазина; кончится — перезаряжаться нечем */
  reserve: {
    pistol: WEAPONS.pistol.reserve, shotgun: WEAPONS.shotgun.reserve, rifle: WEAPONS.rifle.reserve, m6: WEAPONS.m6.reserve,
    sniper: WEAPONS.sniper.reserve, lmg: WEAPONS.lmg.reserve, smg: WEAPONS.smg.reserve, knife: 0, grenade: 0, rocket: 0,
  } as Record<WeaponId, number>,
  reloadUntil: 0,
  /** Длительность текущей перезарядки — для анимации */
  reloadMs: 1,
  nextShot: 0,
};

export const remotes = new Map<number, Remote>();

export const keys: Record<string, boolean> = {};

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initState(): void {
  viewModel.position.set(settings.hand === 'left' ? -0.22 : 0.22, -0.2, -0.45);
  viewModel.scale.setScalar(0.7);
  camera.add(viewModel);
  viewModel.add(viewGun.group);
}
