// Карта «Пески»: две базы и три линии — открытая «длина», центр с дверями, крытый туннель.
// Координаты ниже записаны в исходном масштабе и при построении уменьшаются вдвое (K);
// высоты блоков не меняются.
import { builder, type GameMap, type SpawnPoint } from './types.js';

const K = 0.5;
const WORLD = { half: 30 * K, wallH: 6 };

const SAND = '#d8b878';
const SAND_DARK = '#b9965a';
const STONE = '#9c8f7a';
const CRATE = '#8a5a2b';
const CRATE_LIGHT = '#a8743a';
const TUNNEL = '#6f6455';

const { boxes, b: put } = builder();
const b = (x1: number, z1: number, x2: number, z2: number, h: number, color: string, y = 0): void =>
  put(x1 * K, z1 * K, x2 * K, z2 * K, h, color, y);

// Внешние стены
b(-31, -31, 31, -30, WORLD.wallH, SAND_DARK);
b(-31, 30, 31, 31, WORLD.wallH, SAND_DARK);
b(-31, -30, -30, 30, WORLD.wallH, SAND_DARK);
b(30, -30, 31, 30, WORLD.wallH, SAND_DARK);

// Четыре больших здания, делящих карту на три линии: запад, центр, восток
b(-14, -18, -4, -3, 5, SAND);
b(-14, 3, -4, 18, 5, SAND);
b(4, -18, 14, -3, 5, SAND);
b(4, 3, 14, 18, 5, SAND);

// Центр: «двойные двери» с узким проходом
b(-4, -0.4, -2, 0.4, 3.5, STONE);
b(2, -0.4, 4, 0.4, 3.5, STONE);
b(-3.6, 8, -1.6, 10, 1.2, CRATE);
b(1.6, -10, 3.6, -8, 1.2, CRATE);

// Западная линия («длина»): открытая, с ящиками и полустенкой
b(-30, -0.5, -24, 0.5, 3, STONE);
b(-21, -1.5, -18, 1.5, 1.2, CRATE);
b(-21, -1.5, -19.5, 0, 1.2, CRATE_LIGHT, 1.2);
b(-27, 7, -25, 9, 2.4, CRATE);
b(-17.5, -12, -15.5, -10, 1.2, CRATE_LIGHT);
b(-28, -13, -26, -11, 1.2, CRATE);
b(-17.5, 11, -15.5, 13, 1.2, CRATE);

// Восточная линия («туннель»): крыша и два дверных проёма
b(14, -10, 30, 10, 0.5, TUNNEL, 3.6);
b(14, -10, 21, -9, 3.6, TUNNEL);
b(23, 9, 30, 10, 3.6, TUNNEL);
b(20, -1, 22, 1, 1.2, CRATE);
b(26, 2, 28, 4, 1.2, CRATE_LIGHT);
b(16, -5, 18, -3, 1.2, CRATE_LIGHT);

// Базы: укрытия у точек появления
b(-9, 21.5, -5, 22.5, 1.5, STONE);
b(5, 21.5, 9, 22.5, 1.5, STONE);
b(-9, -22.5, -5, -21.5, 1.5, STONE);
b(5, -22.5, 9, -21.5, 1.5, STONE);
b(18, 20, 20, 22, 1.2, CRATE);
b(-20, -22, -18, -20, 1.2, CRATE);
b(-22, 23, -20, 25, 1.2, CRATE_LIGHT);
b(20, -25, 22, -23, 1.2, CRATE_LIGHT);

// Точки появления: [x, z, yaw]. yaw = 0 — взгляд на север (-z).
const S = Math.PI; // взгляд на юг (+z)
const sp = (x: number, z: number, yaw: number): SpawnPoint => [x * K, z * K, yaw];
const green: SpawnPoint[] = [sp(-12, 26, 0), sp(-6, 26, 0), sp(6, 26, 0), sp(12, 26, 0), sp(-24, 27, 0), sp(24, 27, 0)];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, S]);
const spawns: GameMap['spawns'] = {
  green,
  red,
  ffa: [
    ...green, ...red,
    sp(-26, 16, 0), sp(-26, -18, S), sp(26, 16, 0), sp(26, -16, S),
    sp(-22, 4, 0), sp(16, 6, S), sp(-16, -6, 0), sp(27, -7, S),
  ],
};

export const SANDS: GameMap = {
  id: 'sands',
  name: 'Пески',
  half: { x: WORLD.half, z: WORLD.half },
  floor: '#c9a86a',
  sky: '#9fc9ea',
  boxes,
  ladders: [],
  // Ящик падает с неба — точки под открытым небом, симметричные для обеих сторон
  crateDrops: [[-11, 0, -7], [11, 0, 7]],
  spawns,
};
