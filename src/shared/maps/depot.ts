// Карта «Склад»: маленькая арена для ближнего боя.
// Базы за бетонными перегородками на севере и юге, между ними — контейнеры и ящики,
// а поперёк всей карты идёт мост, на который с обоих концов ведут лестницы.
// Под мостом можно пройти, с моста — спрыгнуть через разрыв в перилах.
import { builder, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround } from './ground.js';

const HALF = { x: 14, z: 18 };
const WALL_H = 6;

const CONCRETE = '#9aa0a6';
const CONCRETE_DARK = '#6d737a';
const STEEL = '#4f5a66';
const BLUE = '#2f6fde';
const ORANGE = '#e07b1f';
const YELLOW = '#f1c232';
const CRATE = '#a8743a';

const { boxes, b, sym } = builder();

// Внешние стены
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, CONCRETE_DARK);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, CONCRETE_DARK);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, CONCRETE_DARK);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, CONCRETE_DARK);

// Перегородки баз с двумя проходами (описана южная, северная — отражение)
sym(-14, 11.5, -5, 12.5, 3, CONCRETE);
sym(-1.5, 11.5, 5, 12.5, 3, CONCRETE);
sym(8, 11.5, 14, 12.5, 3, CONCRETE);

// Контейнеры и ящики
sym(-11, 4, -5, 6.4, 2.6, BLUE);
sym(3, 5, 5.4, 11, 2.6, ORANGE);
sym(-3.5, 6.5, -1, 9, 1.2, CRATE);
sym(10.5, 6, 13, 8.5, 1.2, CRATE);
sym(10.5, 6, 11.8, 7.3, 1.2, YELLOW, 1.2);
sym(-4, -0.8, -2.4, 0.8, 1.2, YELLOW);                      // ящики под мостом

// Мост: две опоры и настил между ними
const DECK = 3;
sym(-10, -1.5, -8, 1.5, DECK, CONCRETE_DARK);
b(-8, -1.5, 8, 1.5, 0.4, STEEL, DECK - 0.4);
sym(-8, 1.3, -3, 1.5, 0.7, YELLOW, DECK);                   // перила с разрывом посередине
sym(3, 1.3, 8, 1.5, 0.7, YELLOW, DECK);

// Лестницы на торцах опор
const ladders: Ladder[] = [
  { min: [-10.45, 0, -0.6], max: [-10, DECK, 0.6], normal: [-1, 0] },
  { min: [10, 0, -0.6], max: [10.45, DECK, 0.6], normal: [1, 0] },
];

const S = Math.PI; // взгляд на юг (+z)
const green: SpawnPoint[] = [[-11, 15.5, 0], [-8, 15.5, 0], [0, 15.5, 0], [3, 15.5, 0], [10, 15.5, 0], [12.5, 15.5, 0]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, S]);

// Земля под всей ареной
addGround(boxes, HALF, '#7d8187');

export const DEPOT: GameMap = {
  id: 'depot',
  name: 'Склад',
  half: HALF,
  floor: '#7d8187',
  sky: '#cfd8e3',
  boxes,
  ladders,
  // Ящик падает с неба: на мост или в одну из двух симметричных точек у контейнеров
  crateDrops: [[0, DECK, 0], [-8, 0, 8.5], [8, 0, -8.5]],
  medkitDrops: [[0, 0, 6], [0, 0, -6], [-11, 0, 3], [11, 0, -3]],
  spawns: {
    green,
    red,
    ffa: [...green, ...red, [-12.5, 9, 0], [12.5, -9, S], [7, 9.5, 0], [-7, -9.5, S]],
  },
};
