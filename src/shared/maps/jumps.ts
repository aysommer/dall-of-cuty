// Карта «Трамплины»: открытая арена с островом посередине, на который можно попасть
// только трамплинами, и двумя угловыми вышками с лестницами. Базы — на севере и юге.
// Планировка своя; всё симметрично относительно центра, чтобы стороны были в равных условиях.
import { builder, type GameMap, type JumpPad, type Ladder, type SpawnPoint } from './types.js';
import { addGroundAndSewer } from './sewer.js';

const HALF = { x: 26, z: 26 };
const WALL_H = 7;

const WALL = '#e9edf2';
const TEAL = '#25a18e';
const TEAL_DARK = '#1b7a6b';
const ORANGE = '#f28c28';
const PURPLE = '#7e57c2';
const BLUE = '#3b82f6';
const PAD = '#ff3d9a';

const { boxes, b, sym } = builder();

// Внешние стены
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, WALL);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, WALL);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, WALL);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, WALL);

// --- Остров в центре: 10×10, высота 4; бортики по углам оставляют проёмы для прилёта с трамплинов ---
const ISLAND = 4;
b(-5, -5, 5, 5, ISLAND, TEAL);
for (const [x1, z1, x2, z2] of [[-5, -5, -2, -4.5], [2, -5, 5, -4.5], [-5, 4.5, -2, 5], [2, 4.5, 5, 5],
  [-5, -4.5, -4.5, -2], [-5, 2, -4.5, 4.5], [4.5, -4.5, 5, -2], [4.5, 2, 5, 4.5]] as const) {
  b(x1, z1, x2, z2, 0.9, TEAL_DARK, ISLAND);
}
sym(-1, -1.6, 1, -0.6, 1.1, ORANGE, ISLAND);                 // укрытие на острове

// --- Трамплины: четыре вокруг острова, каждый бросает к его центру ---
const PAD_H = 0.25;
const pads: JumpPad[] = [];
const pad = (x: number, z: number, vx: number, vz: number): void => {
  b(x - 1, z - 1, x + 1, z + 1, PAD_H, PAD);
  pads.push({ min: [x - 1, 0, z - 1], max: [x + 1, PAD_H, z + 1], vel: [vx, 13, vz] });
};
pad(0, 10.5, 0, -10.3);
pad(0, -10.5, 0, 10.3);
pad(10.5, 0, -10.3, 0);
pad(-10.5, 0, 10.3, 0);

// --- Вышки у боковых стен (восток и запад), подальше от баз; лестница со стороны центра ---
const TOWER = 6;
sym(20, -13, 25, -8, TOWER, BLUE);
sym(24.5, -13, 25, -8, 1, BLUE, TOWER);                      // бортик со стороны стены
sym(20, -13, 24.5, -12.5, 1, BLUE, TOWER);                   // и со стороны базы красных
const ladders: Ladder[] = [
  { min: [19.55, 0, -11.1], max: [20, TOWER + 0.4, -9.9], normal: [-1, 0] },
  { min: [-20, 0, 9.9], max: [-19.55, TOWER + 0.4, 11.1], normal: [1, 0] },
];

// --- Базы: высокие стенки перед точками появления и низкие укрытия перед ними ---
sym(-17, 20.5, -3, 21.2, 2.8, PURPLE);
sym(3, 20.5, 17, 21.2, 2.8, PURPLE);
sym(-17, 21.2, -16.3, 25, 2.8, PURPLE);                     // боковые крылья
sym(16.3, 21.2, 17, 25, 2.8, PURPLE);
sym(-2, 18, 2, 18.8, 1.4, ORANGE);

// --- Середина: укрытия на подходах ---
sym(-16, 7, -13, 9, 1.6, ORANGE);
sym(8, 12, 10.5, 14, 1.2, PURPLE);
sym(-24, 13, -22, 18, 2.6, BLUE);                          // заслон для угловых точек появления
sym(-25.5, -22, -22.5, -21.3, 2.6, BLUE);
sym(16, 4, 18, 6.5, 1.2, ORANGE);
sym(-8, -14, -6, -12, 2.6, TEAL_DARK);

// Канализация: под островом, с запада на восток
const { lamps } = addGroundAndSewer(boxes, ladders, HALF, { axis: 'x', from: -22, to: 22, at: -3 }, '#b9b3c9');

const S = Math.PI; // взгляд на юг (+z)
const green: SpawnPoint[] = [[-12, 23.5, 0], [-7, 24.5, 0], [-4.5, 23, 0], [4.5, 23, 0], [7, 24.5, 0], [12, 23.5, 0]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, S]);

export const JUMPS: GameMap = {
  id: 'jumps',
  name: 'Трамплины',
  half: HALF,
  floor: '#b9b3c9',
  sky: '#a9d6ff',
  boxes,
  ladders,
  lamps,
  pads,
  // Ящик падает на остров или в один из двух открытых углов середины
  crateDrops: [[0, ISLAND, 2.5], [-17, 0, 0], [17, 0, 0]],
  medkitDrops: [[0, 0, 16], [0, 0, -16], [-20, 0, -8], [20, 0, 8]],
  spawns: {
    green,
    red,
    ffa: [...green, ...red, [-24.8, 19.5, 0], [24.8, -19.5, S], [-24, -20, S], [24, 20, 0]],
  },
};
