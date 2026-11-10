// Типы сетевого протокола — общие для клиента и сервера.

import type { Levels, Stat } from './progress.js';
import type { MapId } from './maps/types.js';
import type { StreakKind } from './map.js';

export type Team = 'green' | 'red';
export type Mode = 'tdm' | 'ffa';
export type WeaponId = 'pistol' | 'shotgun' | 'rifle' | 'sniper' | 'knife' | 'rocket';
/** falling — летит с неба, idle — лежит, opening — его открывают, gone — ящика нет */
export type CrateState = 'falling' | 'idle' | 'opening' | 'gone';
export type Vec3 = [number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  hp: number;
  /** Броня из ящика: тратится раньше здоровья */
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  /** Суперброня из серии: игрок в 1,5 раза больше */
  big: boolean;
}

/** [id, x, y, z, yaw, pitch, оружие, подкат 0/1] */
export type SnapRow = [number, number, number, number, number, number, WeaponId, 0 | 1];

export interface Winner {
  team?: Team;
  id?: number;
  name?: string;
  /** Ничья */
  draw?: boolean;
}

/** Чем убили: оружие, ящик-ловушка, метательный нож, ракета с неба или бомба. */
export type KillWeapon = WeaponId | 'crate' | 'throw' | 'missile' | 'nuke';

export type InfoMsg = { t: 'info'; mode: Mode; map: MapId; minutes: number; count: number; green: number; red: number; max: number };
/** left — сколько миллисекунд осталось до конца матча */
export type PlayersMsg = { t: 'players'; mode: Mode; limit: number; left: number; scores: Record<Team, number>; list: PlayerInfo[] };
export type SpawnMsg = { t: 'spawn'; id: number; p: Vec3; yaw: number };
export type SnapMsg = { t: 'snap'; ps: SnapRow[] };
export type ShotMsg = { t: 'shot'; id: number; w: WeaponId; ends: Vec3[] };
/** killer = null и w = 'crate' — игрока убил взорвавшийся ящик. */
export type KillMsg = { t: 'kill'; killer: number | null; victim: number; w: KillWeapon; head?: boolean };
/** Аптечки на карте: ms — сколько ещё падать. */
export type MedkitsMsg = { t: 'medkits'; list: Array<{ id: number; at: Vec3; ms: number }> };
export type ProfileMsg = { t: 'profile'; token: string; kills: number; levels: Levels };
/**
 * Состояние ящика. at — куда он падает или где лежит; by — кто открывает;
 * ms — сколько осталось падать или открывать; left — через сколько исчезнет, если не открыть.
 */
export type CrateMsg = { t: 'crate'; state: CrateState; at: Vec3 | null; by: number | null; ms: number; left: number };
export type RocketMsg = { t: 'rocket'; id: number; by: number; o: Vec3; d: Vec3 };
export type BoomMsg = { t: 'boom'; id: number; p: Vec3 };
/** Рисунок на стене: точка, нормаль стены по X/Z и номер эмодзи из EMOJIS. */
export type SprayMsg = { t: 'spray'; by: number; p: Vec3; n: [number, number]; e: number };
export type OverMsg = { t: 'over'; winner: Winner; pause: number };
/** Голосование за карту после матча: голоса по картам и сколько осталось. */
export type VoteMsg = { t: 'vote'; counts: Record<MapId, number>; ms: number; mine: MapId | null };
/** Своё снаряжение: есть ли нож, текущая серия и запас наград. */
export type LoadoutMsg = { t: 'loadout'; knife: boolean; streak: number; uav: number; missile: number; nuke: number };
/** Брошенный нож летит (o — откуда, d — направление) и где он остановился. */
export type ThrowMsg = { t: 'throw'; id: number; by: number; o: Vec3; d: Vec3 };
export type ThrowEndMsg = { t: 'thrown'; id: number; p: Vec3; hit: boolean };
/** Отметки противников от БПЛА (x, z) */
export type PingMsg = { t: 'ping'; list: Array<[number, number, number]> };
/** Ракета с неба: положение для остальных игроков */
export type MissileMsg = { t: 'missile'; id: number; by: number; p: Vec3 };
/** Бомба: через ms упадёт и убьёт всех */
export type NukeMsg = { t: 'nuke'; by: number; ms: number };

export type ServerMsg =
  | InfoMsg
  | PlayersMsg
  | SpawnMsg
  | SnapMsg
  | ShotMsg
  | KillMsg
  | MedkitsMsg
  | OverMsg
  | ProfileMsg
  | CrateMsg
  | RocketMsg
  | BoomMsg
  | SprayMsg
  | VoteMsg
  | LoadoutMsg
  | ThrowMsg
  | ThrowEndMsg
  | PingMsg
  | MissileMsg
  | NukeMsg
  | { t: 'uav'; ms: number }
  | { t: 'missile-go'; id: number; p: Vec3 }
  | { t: 'newmap'; map: MapId }
  | { t: 'rockets'; n: number }
  | { t: 'error'; text: string }
  | { t: 'welcome'; id: number; mode: Mode; map: MapId }
  | { t: 'reset' };

export type ClientMsg =
  | { t: 'join'; name: string; team: Team; mode: Mode; map: MapId; minutes: number; token?: string }
  | { t: 'vote'; map: MapId }
  | { t: 'throw'; d: Vec3 }
  | { t: 'use'; kind: StreakKind }
  | { t: 'mpos'; id: number; p: Vec3 }
  | { t: 'mhit'; id: number; p: Vec3 }
  | { t: 'upgrade'; stat: Stat }
  | { t: 'open'; on: boolean }
  | { t: 'rocket'; d: Vec3 }
  | { t: 'spray'; p: Vec3; n: [number, number]; e: number }
  | { t: 'state'; p: Vec3; yaw: number; pitch: number; w: WeaponId; sl: boolean }
  /** hits: id игрока → [попаданий в тело, попаданий в голову] */
  | { t: 'shoot'; w: WeaponId; ends: Vec3[]; hits: Record<number, [number, number]> };
