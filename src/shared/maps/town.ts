// Карта «Городок»: площадь с фонтаном в центре, две лавки с внутренними комнатами
// и плоскими крышами (на крышу — лестница снаружи), стоянки с машинами, киоски и переулки.
// Команды появляются на западной и восточной окраинах. Планировка своя и симметрична
// относительно центра, чтобы стороны были в равных условиях.
import { builder, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGroundAndSewer } from './sewer.js';

const HALF = { x: 25, z: 20 };
const WALL_H = 7;

const FENCE = '#d9cfc0';
const STONE = '#a7a29a';
const WATER = '#4fa3d9';
const BRICK = '#b5523b';
const PLASTER = '#e8dcc2';
const ROOF = '#5b4a3f';
const WOOD = '#8a5a2b';
const CAR_A = '#2f6fde';
const CAR_B = '#f2c230';
const GLASS = '#2b2f36';

const { boxes, b, sym } = builder();

// Внешние стены — высокий забор вокруг городка
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, FENCE);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, FENCE);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, FENCE);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, FENCE);

// --- Площадь: фонтан с чашей и колонной, скамейки ---
b(-2.5, -2.5, 2.5, -2, 0.7, STONE);
b(-2.5, 2, 2.5, 2.5, 0.7, STONE);
b(-2.5, -2, -2, 2, 0.7, STONE);
b(2, -2, 2.5, 2, 0.7, STONE);
b(-2, -2, 2, 2, 0.45, WATER);
b(-0.5, -0.5, 0.5, 0.5, 2.2, STONE);
sym(-1.5, 5, 1.5, 5.6, 0.5, WOOD);
sym(5, -1.5, 5.6, 1.5, 0.5, WOOD);

// --- Лавки (северо-запад и, отражением, юго-восток): стены с дверями и окнами, крыша ---
// Коробка 10×9 м, стены 0.3 м, высота 3.2 м. Двери — на площадь (юг) и в переулок (восток).
const H = 3.2;
const [X1, Z1, X2, Z2] = [-18, -18, -8, -9];
const T = 0.3;
sym(X1, Z1, X2, Z1 + T, H, PLASTER);                        // северная стена
sym(X1, Z1, X1 + T, Z2, H, PLASTER);                        // западная стена
// южная стена: дверь (x −14…−12.6) и окно (x −11.5…−9.5, подоконник 1 м)
sym(X1, Z2 - T, -14, Z2, H, PLASTER);
sym(-12.6, Z2 - T, -11.5, Z2, H, PLASTER);
sym(-11.5, Z2 - T, -9.5, Z2, 1, PLASTER);
sym(-11.5, Z2 - T, -9.5, Z2, H - 2.2, PLASTER, 2.2);
sym(-9.5, Z2 - T, X2, Z2, H, PLASTER);
// восточная стена: дверь (z −15…−13.6)
sym(X2 - T, Z1, X2, -15, H, PLASTER);
sym(X2 - T, -13.6, X2, Z2, H, PLASTER);
sym(X2 - T, -15, X2, -13.6, H - 2.3, PLASTER, 2.3);         // над дверью
// внутренняя перегородка с проходом: торговый зал и подсобка
sym(X1, -14.2, -13.5, -13.9, H, BRICK);
// прилавок и стеллажи
sym(-12, -12.6, -9, -12, 1.1, WOOD);
sym(-17.6, -17.6, -16.8, -14.6, 2, WOOD);
// крыша с бортиком; у лестницы (западный край) в бортике проход, свеса над лестницей нет
sym(X1, Z1, X2, Z2, 0.3, ROOF, H);
sym(X1, Z1, X2, Z1 + 0.4, 0.8, ROOF, H + 0.3);
sym(X1, Z1 + 0.4, X1 + 0.4, -15, 0.8, ROOF, H + 0.3);
sym(X1, -13, X1 + 0.4, Z2, 0.8, ROOF, H + 0.3);
const ROOF_Y = H + 0.3;
const ladders: Ladder[] = [
  // снаружи на западной стене лавки, на крышу
  { min: [X1 - 0.45, 0, -14.6], max: [X1, ROOF_Y + 0.4, -13.4], normal: [-1, 0] },
  { min: [-X1, 0, 13.4], max: [-X1 + 0.45, ROOF_Y + 0.4, 14.6], normal: [1, 0] },
];

// --- Стоянки (северо-восток и юго-запад): машины из двух блоков — кузов и салон ---
const car = (x: number, z: number, color: string, alongX = false): void => {
  const [w, d] = alongX ? [4, 2] : [2, 4];
  sym(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1, color);
  const [cw, cd] = alongX ? [2, 1.6] : [1.6, 2];
  sym(x - cw / 2, z - cd / 2, x + cw / 2, z + cd / 2, 0.7, GLASS, 1);
};
car(12, -12, CAR_A);
car(17, -10, CAR_B);
car(14, -16.5, CAR_A, true);
sym(9, -18, 9.3, -6, 1, FENCE);                             // низкий заборчик стоянки

// --- Киоски и укрытия на подходах к площади ---
sym(8, 3, 10, 5, 2.4, BRICK);
sym(8, 5, 10, 5.4, 0.3, ROOF, 2.4);
sym(-6, 8, -4, 10, 1.2, WOOD);                              // ящики у переулка
sym(-4.2, 8.2, -3, 9.4, 1.2, WOOD, 1.2);
sym(3, -11, 5, -10, 1.6, STONE);                            // клумба

// --- Окраины, где появляются команды: стенки с проходами ---
sym(-20, -10, -19.4, -3, 2.6, BRICK);
sym(-20, 3, -19.4, 10, 2.6, BRICK);
sym(-23, -1, -21.5, 1, 1.4, WOOD);

// Канализация: под площадью, с севера на юг
const { lamps } = addGroundAndSewer(boxes, ladders, HALF, { axis: 'z', from: -16, to: 16, at: 0 }, '#9aa36b');

// Зелёные — на западе (взгляд на восток), красные — на востоке
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-22.5, -7, E], [-22.5, -4, E], [-23, 4, E], [-22.5, 7, E], [-24, -12, E], [-24, 12, E]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, W]);

export const TOWN: GameMap = {
  id: 'town',
  name: 'Городок',
  half: HALF,
  floor: '#9aa36b',
  sky: '#b8dcf5',
  boxes,
  ladders,
  lamps,
  // Ящик падает на крышу одной из лавок или на площадь у скамейки
  crateDrops: [[-13, ROOF_Y, -11.5], [13, ROOF_Y, 11.5], [0, 0, 7.5]],
  medkitDrops: [[-6, 0, 3], [6, 0, -3], [-10, 0, 14], [10, 0, -14]],
  spawns: {
    green,
    red,
    // Плюс точки в подсобках лавок и в северном и южном переулках
    ffa: [...green, ...red, [-13, -16, 0], [13, 16, Math.PI], [-2, -18.5, Math.PI], [2, 18.5, 0]],
  },
};
