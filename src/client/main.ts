// Точка входа клиента: запускает модули в том же порядке, в каком код шёл в исходном game.ts.
// Сами модули при импорте ничего не делают — только объявляют функции и данные.
import { initScene } from './core/scene.js';
import { initMap } from './world/map.js';
import { initState } from './core/state.js';
import { initNet } from './core/net.js';
import { initMenu } from './ui/menu.js';
import { initInput } from './core/input.js';
import { initTouch } from './core/touch.js';
import { initSettingsMenu } from './ui/settings-menu.js';
import { initRanks } from './ui/ranks.js';
import { initClasses } from './ui/classes.js';
import { initPause } from './ui/pause.js';
import { initLoop } from './loop.js';

initScene();
initMap();
initState();
initNet();
initMenu();
initInput();
initTouch();
initSettingsMenu();
initRanks();
initClasses();
initPause();
initLoop();
