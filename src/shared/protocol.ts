// Типы сетевого протокола — общие для клиента и сервера.

import type { Levels, Stat } from './progress.js';
import type { MapId } from './maps/types.js';

export type Team = 'green' | 'red';
export type Mode = 'tdm' | 'ffa';
export type WeaponId = 'pistol' | 'shotgun' | 'rifle';
export type Vec3 = [number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
}

/** [id, x, y, z, yaw, pitch, оружие] */
export type SnapRow = [number, number, number, number, number, number, WeaponId];

export interface Winner {
  team?: Team;
  id?: number;
  name?: string;
}

export type InfoMsg = { t: 'info'; mode: Mode; map: MapId; count: number; green: number; red: number; max: number };
export type PlayersMsg = { t: 'players'; mode: Mode; limit: number; scores: Record<Team, number>; list: PlayerInfo[] };
export type SpawnMsg = { t: 'spawn'; id: number; p: Vec3; yaw: number };
export type SnapMsg = { t: 'snap'; ps: SnapRow[] };
export type ShotMsg = { t: 'shot'; id: number; w: WeaponId; ends: Vec3[] };
export type KillMsg = { t: 'kill'; killer: number; victim: number; w: WeaponId };
export type ProfileMsg = { t: 'profile'; token: string; kills: number; levels: Levels };
export type OverMsg = { t: 'over'; winner: Winner; pause: number };

export type ServerMsg =
  | InfoMsg
  | PlayersMsg
  | SpawnMsg
  | SnapMsg
  | ShotMsg
  | KillMsg
  | OverMsg
  | ProfileMsg
  | { t: 'error'; text: string }
  | { t: 'welcome'; id: number; mode: Mode; map: MapId }
  | { t: 'reset' };

export type ClientMsg =
  | { t: 'join'; name: string; team: Team; mode: Mode; map: MapId; token?: string }
  | { t: 'upgrade'; stat: Stat }
  | { t: 'state'; p: Vec3; yaw: number; pitch: number; w: WeaponId }
  | { t: 'shoot'; w: WeaponId; ends: Vec3[]; hits: Record<number, number> };
