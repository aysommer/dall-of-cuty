// Главный цикл: движение, эффекты, отрисовка; отладочный доступ window.game.
import type { WeaponId } from '../shared/protocol.js';
import * as THREE from 'three';
import { CROUCH, PLAYER, SLIDE, STREAK } from '../shared/map.js';
import { sendMsg } from './core/net.js';
import { postState, renderFrame } from './core/post.js';
import { camera, fog, renderer, sun, sunDirection, updateSun } from './core/scene.js';
import { settings } from './core/settings.js';
import { keys, me, remotes, state } from './core/state.js';
import { $ } from './core/util.js';
import { corpseDebug, corpses, updateCorpses } from './fx/corpses.js';
import { blindK, mineFx, updateBlind, updateMines } from './weapons/mines.js';
import { gear } from './ui/hotbar.js';
import { bursts, updateFireworks } from './fx/fireworks.js';
import { glassState, setGlassLife, updateGlass } from './fx/glass.js';
import { bakeInfo } from './world/blocks.js';
import { stepCount, updateSteps } from './fx/footsteps.js';
import { sprays, updateSprays } from './fx/sprays.js';
import { updateEffects } from './fx/tracers.js';
import { packFx, updateAmmoPacks } from './pickups/ammo.js';
import { onCrate, updateCrate } from './pickups/crate.js';
import { medkitFx, updateMedkits } from './pickups/medkits.js';
import { applyLook, updateRemote } from './render/players.js';
import { updateViewArms, viewArmsDebug, viewArmsReady } from './render/viewarms.js';
import { characterFailed, characterReady, loadCharacterModel } from './render/character.js';
import { gunner, gunshipFx, markerEls, updateGunship } from './streaks/gunship.js';
import { missileCtl, remoteMissiles, updateMissile } from './streaks/missile.js';
import { updateNuke } from './streaks/nuke.js';
import { updateMinimap } from './streaks/uav.js';
import { slotsText } from './ui/hotbar.js';
import { updateHud } from './ui/hud.js';
import { onVote, timerText, updateVote } from './ui/match.js';
import { updateCratePrompt } from './ui/prompt.js';
import { cookStart, grenadeFx, updateGrenades } from './weapons/grenade.js';
import { updateKnives } from './weapons/knife.js';
import { updateRockets } from './weapons/rockets.js';
import { updateShooting } from './weapons/shooting.js';
import { aimPoint, lastDrawMs, animateGun, animateScope, poseGun, scopeAnim, setWeapon, sniperSway, SWING_MS, updateAim, viewGun, viewModel } from './weapons/viewmodel.js';
import { brokenIds, currentMap, openDoors, updateDoors } from './world/map.js';
import { move, touchingLadder } from './world/physics.js';
import { sinking, updateSinking } from './world/underground.js';
import { updateWeather, weatherKind } from './world/weather.js';

let last = performance.now(), sendAcc = 0;

/** Когда последний раз стояли на земле: «в воздухе» — только если оторвались дольше чем на мгновение */
let groundedAt = 0, airFrames = 0;
/** Покачивание камеры на ходу: фаза шага, сглаженный размах, текущие сдвиг по высоте и наклон */
let bobPhase = 0, bobAmp = 0, bobY = 0, bobRoll = 0, bobGun = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.25, (now - last) / 1000);
  const dt = Math.min(0.05, rawDt);
  last = now;

  if (state.joined) {
    if (me.alive) {
      move(dt);
      if (me.grounded) { groundedAt = now; airFrames = 0; } else airFrames++;
      const eyeTarget = (state.low ? SLIDE.eye : state.crouch ? CROUCH.eye : PLAYER.eye) * (me.big ? STREAK.bigScale : 1);
      state.eyeH += (eyeTarget - state.eyeH) * Math.min(1, dt * 14);
      // Покачивание при ходьбе и беге: шаг задаёт пройденный путь, размах — скорость; в прицеле почти гаснет
      const ground = Math.hypot(me.vel.x, me.vel.z);
      const walking = me.grounded && !state.low ? Math.min(1, ground / 8) : 0;
      bobAmp += (walking - bobAmp) * Math.min(1, dt * 8);
      bobPhase += ground * dt * 1.75;
      const calm = 1 - 0.8 * state.adsK;
      // На бегу качает заметно сильнее, чем на шаге
      const hard = 0.6 + 0.9 * Math.max(0, Math.min(1, (ground - 6.5) / 1.6));
      bobY = Math.abs(Math.sin(bobPhase)) * -0.05 * bobAmp * calm * hard;
      bobRoll = Math.sin(bobPhase) * 0.009 * bobAmp * calm * hard;
      bobGun = bobAmp * calm * hard;
      camera.position.set(me.pos.x, me.pos.y + state.eyeH + bobY, me.pos.z);
    } else {
      bobAmp = 0; bobY = 0; bobRoll = 0; bobGun = 0;
      // После смерти камера смотрит на место гибели сверху
      camera.position.set(me.pos.x, me.pos.y + 6, me.pos.z + 4);
      const left = Math.max(0, Math.ceil((state.respawnAt - now) / 1000));
      if (!state.roundOver && left > 0) {
        const first = ($('center-msg').textContent ?? '').split('\n')[0];
        $('center-msg').textContent = `${first}\nВозрождение через ${left} сек.`;
      }
    }
    const sway = sniperSway(now);
    camera.rotation.set(me.alive ? Math.min(1.5, me.pitch + state.recoil + sway.pitch) : -0.9, me.alive ? me.yaw + sway.yaw : 0, me.alive ? bobRoll : 0);
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
    const aim = aimPoint();
    const aimZ = aim ? -aim.relief - aim.z * viewModel.scale.z : -0.25;
    viewModel.position.z = -0.45 + (aimZ + 0.45) * state.adsK + state.kick * (1 - 0.7 * state.adsK) - swing * 0.12;
    viewModel.position.x += sw >= 0 ? 0.2 - 0.4 * sw : 0;
    viewModel.rotation.y = sw >= 0 ? -1.1 + 2.2 * sw : 0;
    viewModel.rotation.z = sw >= 0 ? -Math.PI / 2 * swing * 0.6 : 0;
    viewModel.rotation.x = state.kick * 1.5;
    poseGun(dt);
    // Оружие тоже ходит в такт шагам: из стороны в сторону, вверх-вниз и с лёгким креном
    viewModel.position.x += Math.sin(bobPhase) * 0.02 * bobGun;
    viewModel.position.y += Math.cos(bobPhase * 2) * 0.012 * bobGun;
    viewModel.rotation.z += Math.sin(bobPhase) * 0.035 * bobGun;
    viewModel.rotation.y += Math.sin(bobPhase) * 0.02 * bobGun;
    animateGun(now);
    animateScope(now);

    sendAcc += dt;
    if (sendAcc >= 0.05) {
      sendAcc = 0;
      sendMsg({
        t: 'state',
        p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)],
        yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), w: me.weapon, sl: state.low, cr: state.crouch,
        air: airFrames >= 2 && now - groundedAt > 120 && !touchingLadder(me.pos), rl: performance.now() < me.reloadUntil,
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
  updateViewArms(now);
  $('scope').classList.toggle('hidden', !(state.joined && me.alive && scoped));
  $('crosshair').classList.toggle('ads', state.adsK > 0.5);
  // С коллиматором своя красная точка, крест в прицеле не нужен
  $('crosshair').classList.toggle('sight', state.adsK > 0.5 && !!viewGun.sight);
  // У снайперки креста нет: от бедра — без прицела, в прицеле — оптика
  $('crosshair').classList.toggle('hidden', me.weapon === 'sniper');

  const k = 1 - Math.exp(-16 * dt);
  for (const r of remotes.values()) {
    updateRemote(r, dt, now, k);
  }

  updateRockets(now, dt);
  updateEffects(now);
  updateCrate(now);
  updateCratePrompt(now);
  updateCorpses(now, rawDt);  // тела догоняют реальное время сами (до 0,12 с за кадр)
  updateSprays(now);
  updateMedkits(now);
  updateSteps(dt);
  updateKnives(dt);
  updateSinking(now);
  updateFireworks(dt);
  updateGlass(now, rawDt);
  updateDoors(dt);
  updateGrenades(now);
  updateMines(now);
  updateBlind(now);
  updateAmmoPacks(now);
  updateWeather(dt);
  updateMinimap(now);
  updateNuke(now);
  updateVote(now);
  const timer = document.getElementById('match-timer');
  if (timer) timer.textContent = timerText();
  updateSun();
  if (dbgView) {
    // Отладочный вид со стороны: камера стоит рядом с глазами игрока (в его координатах) и смотрит на руки
    camera.updateMatrixWorld(true);
    dbgCam.aspect = camera.aspect; dbgCam.updateProjectionMatrix();
    dbgCam.position.copy(camera.localToWorld(new THREE.Vector3(...dbgView.from)));
    dbgCam.lookAt(camera.localToWorld(new THREE.Vector3(...dbgView.at)));
    renderFrame(dbgCam);
  } else renderFrame(camera);
}

/** Отладочный вид со стороны (game.view): откуда и куда смотрит камера, в координатах глаз игрока */
let dbgView: { from: [number, number, number]; at: [number, number, number] } | null = null;
const dbgCam = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

// Для отладки из консоли
declare global {
  interface Window {
    game: {
      me: typeof me; remotes: typeof remotes; keys: typeof keys; applyLook: typeof applyLook;
      steer: (yaw: number, pitch: number) => void; dbg: () => Record<string, unknown>; vote: typeof onVote; equip: (w: WeaponId) => void; view: (v: { from: [number, number, number]; at: [number, number, number] } | null) => void; crate: typeof onCrate; glassLife: typeof setGlassLife;
    };
  }
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initLoop(): void {
  loadCharacterModel();
  updateHud();
  requestAnimationFrame(frame);
  window.game = {
    me, remotes, keys, applyLook, vote: onVote,
    view: (v: typeof dbgView) => { dbgView = v; },
    // Для скриптов: показать ящик у себя (как будто пришло сообщение сервера)
    crate: onCrate,
    glassLife: setGlassLife,
    // Для скриптов: взять любой ствол, даже не из набора (набор на это время подменяется)
    equip: (w: WeaponId) => {
      if (w !== 'knife' && w !== 'grenade' && w !== 'rocket' && !settings.kit.includes(w)) settings.kit = [w, settings.kit[1] ?? 'pistol'];
      if (w === 'grenade') state.myGrenades = Math.max(1, state.myGrenades);
      setWeapon(w);
    },
    steer: (yaw: number, pitch: number) => {
      if (missileCtl) { missileCtl.yaw = yaw; missileCtl.pitch = pitch; }
      if (gunner) { gunner.yaw = yaw; gunner.pitch = pitch; }
    },
    dbg: () => ({ openDoors: [...openDoors], sprintK: state.sprintK, wallK: state.wallK, broken: [...brokenIds], grenades: [...grenadeFx.values()].map((g) => g.mesh.position.toArray().map((v) => +v.toFixed(2))), myGrenades: state.myGrenades, cooking: cookStart > 0, scopeOn: state.scopeOn, scopeAnim: !!scopeAnim, sway: sniperSway(performance.now()), fovNow: camera.fov, gunship: gunshipFx ? gunshipFx.mesh.position.toArray() : null, gunner: gunner ? { heat: gunner.heat, over: performance.now() < gunner.overheatUntil } : null, markers: markerEls.size, bursts: bursts.length, weather: weatherKind, fogFar: fog.far, sinking: sinking.length, remoteMissiles: remoteMissiles.size, packs: packFx.size,
      kit: settings.kit, reserve: { ...me.reserve }, hotbar: slotsText(),
      missile: missileCtl ? missileCtl.pos.toArray() : null, low: state.low, crouch: state.crouch, adsK: state.adsK, fov: camera.fov, crateState: state.crateState, crateAt: state.crateAt, chute: !!state.crateChute?.visible, cook: !document.getElementById('cook')!.classList.contains('hidden'), eyeH: state.eyeH, recoil: state.recoil, mines: [...mineFx.values()].map((m) => ({ kind: m.info.kind, armed: m.info.armed > 0, p: m.info.p, to: m.info.to })), blind: +blindK(performance.now()).toFixed(2), arms: viewArmsReady(), armsFit: viewArmsDebug(), drawMs: lastDrawMs(), gear, gunBob: +bobGun.toFixed(2), bob: +bobY.toFixed(3),
      corpses: corpses.length, corpse: corpseDebug(), model: characterReady() ? 'ready' : characterFailed() ? 'failed' : 'loading',
      remoteAnim: [...remotes.values()].map((r) => r.char ? { walk: +r.char.walk.getEffectiveWeight().toFixed(2), run: +r.char.run.getEffectiveWeight().toFixed(2), air: +r.char.airK.toFixed(2), reload: r.reloading, speed: +r.char.speed.toFixed(1) } : null), sprays: sprays.length,
      shadow: { on: renderer.shadowMap.enabled, pending: renderer.shadowMap.needsUpdate, cast: sun.castShadow, map: !!sun.shadow.map, box: [sun.shadow.camera.left, sun.shadow.camera.right, sun.shadow.camera.near, sun.shadow.camera.far].map((v) => +v.toFixed(1)) }, drawCalls: renderer.info.render.calls, glass: glassState(), skyBake: { ...bakeInfo }, post: postState(), sunDir: sunDirection().toArray().map((v) => +v.toFixed(3)),
      steps: stepCount, medkits: medkitFx.size, boltUntil: state.boltUntil, menuClosed: state.menuClosed, armor: me.armor }),
  };
}
