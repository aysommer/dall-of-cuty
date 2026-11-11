// Главный цикл: движение, эффекты, отрисовка; отладочный доступ window.game.
import { PLAYER, SLIDE, STREAK } from '../shared/map.js';
import { sendMsg } from './core/net.js';
import { camera, fog, renderer, scene } from './core/scene.js';
import { settings } from './core/settings.js';
import { keys, me, remotes, state } from './core/state.js';
import { $ } from './core/util.js';
import { corpses, updateCorpses } from './fx/corpses.js';
import { bursts, updateFireworks } from './fx/fireworks.js';
import { stepCount, updateSteps } from './fx/footsteps.js';
import { sprays, updateSprays } from './fx/sprays.js';
import { updateEffects } from './fx/tracers.js';
import { packFx, updateAmmoPacks } from './pickups/ammo.js';
import { updateCrate } from './pickups/crate.js';
import { medkitFx, updateMedkits } from './pickups/medkits.js';
import { FACE_STEPS, faceTexture, faceUrl } from './render/players.js';
import { gunner, gunshipFx, markerEls, updateGunship } from './streaks/gunship.js';
import { missileCtl, remoteMissiles, updateMissile } from './streaks/missile.js';
import { updateNuke } from './streaks/nuke.js';
import { updateMinimap } from './streaks/uav.js';
import { hotbar } from './ui/hotbar.js';
import { updateHud } from './ui/hud.js';
import { timerText, updateVote } from './ui/match.js';
import { updateCratePrompt } from './ui/prompt.js';
import { cookStart, grenadeFx, updateGrenades } from './weapons/grenade.js';
import { updateKnives } from './weapons/knife.js';
import { updateRockets } from './weapons/rockets.js';
import { updateShooting } from './weapons/shooting.js';
import { animateGun, animateScope, poseGun, scopeAnim, sniperSway, SWING_MS, updateAim, viewGun, viewModel } from './weapons/viewmodel.js';
import { brokenIds, currentMap, openDoors, updateDoors } from './world/map.js';
import { move } from './world/physics.js';
import { sinking, updateSinking, updateUnderground } from './world/underground.js';
import { updateWeather, weatherKind } from './world/weather.js';

let last = performance.now(), sendAcc = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.joined) {
    if (me.alive) {
      move(dt);
      const eyeTarget = (state.low ? SLIDE.eye : PLAYER.eye) * (me.big ? STREAK.bigScale : 1);
      state.eyeH += (eyeTarget - state.eyeH) * Math.min(1, dt * 14);
      camera.position.set(me.pos.x, me.pos.y + state.eyeH, me.pos.z);
    } else {
      // После смерти камера смотрит на место гибели сверху
      camera.position.set(me.pos.x, me.pos.y + 6, me.pos.z + 4);
      const left = Math.max(0, Math.ceil((state.respawnAt - now) / 1000));
      if (!state.roundOver && left > 0) {
        const first = ($('center-msg').textContent ?? '').split('\n')[0];
        $('center-msg').textContent = `${first}\nВозрождение через ${left} сек.`;
      }
    }
    const sway = sniperSway(now);
    camera.rotation.set(me.alive ? Math.min(1.5, me.pitch + state.recoil + sway.pitch) : -0.9, me.alive ? me.yaw + sway.yaw : 0, 0);
    // Камера ракеты с неба перекрывает обычный вид
    updateMissile(now, dt);
    updateGunship(now, dt);

    updateShooting(now);
    updateAim(dt);
    state.kick = Math.max(0, state.kick - dt * 0.6);
    state.recoil *= Math.exp(-dt / 0.12);
    // Взмах ножом — горизонтальный: справа налево, с выносом вперёд в середине
    const sw = now < state.swingUntil ? 1 - (state.swingUntil - now) / SWING_MS : -1;
    const swing = sw >= 0 ? Math.sin(Math.PI * sw) : 0;
    // В прицеле глаз подводится к прицелу: прицел оказывается в aim.relief метрах перед глазом,
    // а приклад уходит назад к щеке, за пределы обзора. Отдача в прицеле мягче.
    const aim = me.weapon === 'sniper' && !state.scopeOn ? viewGun.iron : viewGun.aim;
    const aimZ = aim ? -aim.relief - aim.z * viewModel.scale.z : -0.25;
    viewModel.position.z = -0.45 + (aimZ + 0.45) * state.adsK + state.kick * (1 - 0.7 * state.adsK) - swing * 0.12;
    viewModel.position.x += sw >= 0 ? 0.2 - 0.4 * sw : 0;
    viewModel.rotation.y = sw >= 0 ? -1.1 + 2.2 * sw : 0;
    viewModel.rotation.z = sw >= 0 ? -Math.PI / 2 * swing * 0.6 : 0;
    viewModel.rotation.x = state.kick * 1.5;
    poseGun(dt);
    animateGun(now);
    animateScope(now);

    sendAcc += dt;
    if (sendAcc >= 0.05) {
      sendAcc = 0;
      sendMsg({
        t: 'state',
        p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)],
        yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), w: me.weapon, sl: state.low,
      });
    }
  } else {
    // Облёт карты под меню
    const a = now / 9000;
    const r = Math.max(currentMap.half.x, currentMap.half.z) * 1.4;
    camera.position.set(Math.sin(a) * r, r * 0.62, Math.cos(a) * r);
    camera.lookAt(0, 0, 0);
  }
  const scoped = me.weapon === 'sniper' && state.scopeOn && state.adsK > 0.85;
  viewModel.visible = state.joined && me.alive && !scoped && !missileCtl && !gunner;
  $('scope').classList.toggle('hidden', !(state.joined && me.alive && scoped));
  $('crosshair').classList.toggle('ads', state.adsK > 0.5);
  // С коллиматором своя красная точка, крест в прицеле не нужен
  $('crosshair').classList.toggle('sight', state.adsK > 0.5 && !!viewGun.sight);
  // У снайперки креста нет: от бедра — без прицела, в прицеле — оптика
  $('crosshair').classList.toggle('hidden', me.weapon === 'sniper');

  const k = 1 - Math.exp(-16 * dt);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    const dy = r.targetYaw - r.yaw;
    r.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k;
    r.g.position.copy(r.pos);
    r.g.rotation.y = r.yaw;
    r.hand.rotation.x = r.pitch;
    r.gun.flash.visible = now < r.flashUntil;
    // Подкат: прямоугольник ложится вдоль взгляда и встаёт обратно
    r.poseK += ((r.slide ? 1 : 0) - r.poseK) * Math.min(1, dt * 12);
    r.pose.rotation.x = (-Math.PI / 2) * r.poseK;
    r.pose.position.set(0, (PLAYER.w / 2) * r.poseK, (PLAYER.h / 2) * r.poseK);
    r.label.position.y = r.labelY + (1.4 - r.labelY) * r.poseK;
  }

  updateRockets(now, dt);
  updateEffects(now);
  updateCrate(now);
  updateCratePrompt(now);
  updateCorpses(now);
  updateSprays(now);
  updateMedkits(now);
  updateSteps(dt);
  updateKnives(dt);
  updateSinking(now);
  updateFireworks(dt);
  updateDoors(dt);
  updateGrenades(now);
  updateAmmoPacks(now);
  updateUnderground();
  updateWeather(dt);
  updateMinimap(now);
  updateNuke(now);
  updateVote(now);
  const timer = document.getElementById('match-timer');
  if (timer) timer.textContent = timerText();
  renderer.render(scene, camera);
}

// Для отладки из консоли
declare global {
  interface Window {
    game: {
      me: typeof me; remotes: typeof remotes; keys: typeof keys;
      steer: (yaw: number, pitch: number) => void; faces: () => string[]; dbg: () => Record<string, unknown>;
    };
  }
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initLoop(): void {
  updateHud();
  requestAnimationFrame(frame);
  window.game = {
    me, remotes, keys,
    steer: (yaw: number, pitch: number) => {
      if (missileCtl) { missileCtl.yaw = yaw; missileCtl.pitch = pitch; }
      if (gunner) { gunner.yaw = yaw; gunner.pitch = pitch; }
    },
    faces: () => FACE_STEPS.map((_, l) => { faceTexture(l); return faceUrl[l]!; }),
    dbg: () => ({ openDoors: [...openDoors], sprintK: state.sprintK, wallK: state.wallK, broken: [...brokenIds], grenades: [...grenadeFx.values()].map((g) => g.mesh.position.toArray().map((v) => +v.toFixed(2))), myGrenades: state.myGrenades, cooking: cookStart > 0, scopeOn: state.scopeOn, scopeAnim: !!scopeAnim, sway: sniperSway(performance.now()), fovNow: camera.fov, gunship: gunshipFx ? gunshipFx.mesh.position.toArray() : null, gunner: gunner ? { heat: gunner.heat, over: performance.now() < gunner.overheatUntil } : null, markers: markerEls.size, bursts: bursts.length, weather: weatherKind, fogFar: fog.far, underground: state.underground, sinking: sinking.length, remoteMissiles: remoteMissiles.size, packs: packFx.size,
      kit: settings.kit, reserve: { ...me.reserve }, hotbar: hotbar().map((h) => `${h.key}:${h.label}`).join(' '),
      missile: missileCtl ? missileCtl.pos.toArray() : null, low: state.low, adsK: state.adsK, fov: camera.fov, crateState: state.crateState, crateAt: state.crateAt, eyeH: state.eyeH, recoil: state.recoil, corpses: corpses.length, sprays: sprays.length,
      steps: stepCount, medkits: medkitFx.size, boltUntil: state.boltUntil, menuClosed: state.menuClosed, armor: me.armor }),
  };
}
