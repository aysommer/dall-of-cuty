// Карта «Кубики»: компактная снайперская арена из цветных блоков.
// Две базы на возвышении друг напротив друга, открытая середина с укрытиями
// и башня в центре, на которую ведут две лестницы.
// Цвета блоков нарочно не зелёные и не красные, чтобы игроки с ними не сливались.
import { builder, type GameMap, type Ladder, type SpawnPoint } from './types.js';

const HALF = { x: 16, z: 28 };
const WALL_H = 7;

const BLUE = '#2f6fde';
const NAVY = '#1f3f8f';
const YELLOW = '#f4c430';
const ORANGE = '#f08a24';
const WHITE = '#eef0f3';
const PURPLE = '#8a4fd0';
const CYAN = '#35b8d6';

const { boxes, b, sym } = builder();

// Внешние стены
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, NAVY);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, NAVY);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, BLUE);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, BLUE);

// --- Базы (описана южная, северная получается отражением) ---
const BASE_H = 1.2;
sym(-HALF.x, 22, HALF.x, HALF.z, BASE_H, WHITE);            // помост
sym(-2, 20.8, 2, 22, 0.6, YELLOW);                          // ступенька на помост
sym(-14, 22, -10, 22.8, 1.2, BLUE, BASE_H);                 // зубцы-укрытия на краю помоста
sym(-6, 22, -2, 22.8, 1.2, YELLOW, BASE_H);
sym(2, 22, 6, 22.8, 1.2, YELLOW, BASE_H);
sym(10, 22, 14, 22.8, 1.2, BLUE, BASE_H);
sym(13, 25, 16, 28, 1.2, ORANGE, BASE_H);                   // угловая тумба повыше
sym(-11, 24.2, -4, 24.8, 2.6, CYAN, BASE_H);                // стенки, за которыми появляются игроки:
sym(4, 24.2, 11, 24.8, 2.6, CYAN, BASE_H);                  // закрывают и от чужой базы, и от башни

// --- Середина ---
sym(-12, 9, -5, 10, 1.4, ORANGE);                           // длинная низкая стенка
sym(6, 11, 8, 13, 3.2, PURPLE);                             // высокая колонна
sym(-16, -1, -12.5, 1, 2.4, WHITE);                         // боковые выступы у стен
sym(9, 3, 12, 5, 1.2, BLUE);                                // два блока «ступенькой»
sym(9, 3, 10.5, 5, 1.2, YELLOW, 1.2);
sym(-9, 15, -7, 18, 2, CYAN);                               // укрытие перед базой
sym(-1.5, 13, 1.5, 14, 1.2, WHITE);                         // заслон на прямой «база — башня»
sym(-6.5, 3.5, -4.5, 5.5, 1.2, PURPLE);                     // ящик у башни

// --- Башня в центре ---
const TOWER = 2, TOWER_H = 5;
b(-TOWER, -TOWER, TOWER, TOWER, TOWER_H, YELLOW);
sym(-TOWER, TOWER - 0.4, TOWER, TOWER, 0.9, ORANGE, TOWER_H); // бортики со стороны баз

// Лестницы на восточной и западной стенах башни
const LADDER_W = 0.6, LADDER_D = 0.45;
const ladders: Ladder[] = [
  { min: [TOWER, 0, -LADDER_W], max: [TOWER + LADDER_D, TOWER_H + 0.4, LADDER_W], normal: [1, 0] },
  { min: [-TOWER - LADDER_D, 0, -LADDER_W], max: [-TOWER, TOWER_H + 0.4, LADDER_W], normal: [-1, 0] },
];

const S = Math.PI; // взгляд на юг (+z)
const P = BASE_H;
const green: SpawnPoint[] = [
  [-9.5, 26.6, 0, P], [-5.5, 26.6, 0, P], [5.5, 26.6, 0, P], [9.5, 26.6, 0, P], [-7.5, 26.6, 0, P], [7.5, 26.6, 0, P],
];
const red: SpawnPoint[] = green.map(([x, z, , y]) => [-x, -z, S, y]);
const spawns: GameMap['spawns'] = {
  green,
  red,
  ffa: [
    ...green, ...red,
    [-14, 6, 0], [14, -6, S], [13, 17, 0], [-13, -17, S],
    [7, 14.2, 0], [-7, -14.2, S], [-8, 19.2, 0], [8, -19.2, S],
  ],
};

export const BRICKS: GameMap = {
  id: 'bricks',
  name: 'Кубики',
  half: HALF,
  floor: '#c4c9d1',
  sky: '#bfe3ff',
  boxes,
  ladders,
  spawns,
};
