/**
 * Application root: owns renderer, scene, world, ecosystem, camera,
 * post-processing, effects, weather, audio, UI and the main loop.
 */
import * as THREE from 'three';
import { Settings, type SettingsData } from './Settings';
import { Input } from './Input';
import { events } from './Events';
import { Renderer, SHADOW_SIZES } from '../render/Renderer';
import { CameraRig, type CameraMode } from '../render/CameraRig';
import { PostFX } from '../render/PostFX';
import { Effects } from '../render/Effects';
import { AdaptiveQuality } from '../render/AdaptiveQuality';
import { DebugDraw } from '../render/DebugDraw';
import { World } from '../world/World';
import { Weather } from '../world/Weather';
import type { Animal } from '../animal/Animal';
import { WOLF } from '../animal/species/Wolf';
import { DEER } from '../animal/species/Deer';
import { PlayerController } from '../ai/PlayerController';
import { Ecosystem } from '../eco/Ecosystem';
import { globalUniforms } from '../render/Uniforms';
import { LAKE, loadTerrain } from '../world/WorldGen';
import { disposeSpeciesAssets, preloadSpecies } from '../animal/CreatureMesh';
import { disposeFurNoise } from '../animal/FurMaterial';
import { AudioEngine } from '../audio/AudioEngine';
import { UI } from '../ui/UI';

export interface AppOptions {
  seed: number;
  settings: Partial<SettingsData>;
  startTime?: number;
  /** Skip the start overlay (automation). */
  autostart?: boolean;
  /** Disable adaptive quality (benchmarks of a fixed configuration). */
  fixedQuality?: boolean;
}

const SHADOW_EXTENT = 34;

export class App {
  readonly settings: Settings;
  readonly input: Input;
  readonly renderer: Renderer;
  readonly scene = new THREE.Scene();
  readonly cameraRig: CameraRig;
  readonly audio = new AudioEngine();
  readonly adaptive = new AdaptiveQuality();
  readonly debug = new DebugDraw();
  world!: World;
  eco!: Ecosystem;
  wolf!: Animal;
  weather!: Weather;
  effects!: Effects;
  post!: PostFX;
  ui!: UI;
  readonly player = new PlayerController();
  manual = false;
  /** When paused the world is still rendered but not simulated. */
  paused = false;
  private running = false;
  private lastT = 0;
  simTime = 0;
  frame = 0;
  private rafId = 0;
  private frameTimes: number[] = [];
  fps = 0;
  /** CPU time spent in the last tick (simulation + render submission). */
  cpuMs = 0;
  private effective!: SettingsData;
  private tmpColor = new THREE.Color();
  private tmpColor2 = new THREE.Color();
  private unsub: (() => void)[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly opts: AppOptions,
  ) {
    this.settings = new Settings(opts.settings);
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, this.settings);
    this.cameraRig = new CameraRig(this.renderer.width / this.renderer.height);
    this.renderer.onResize = (w, h) => {
      this.cameraRig.setAspect(w / h);
      this.post?.setSize(w, h);
    };
    this.scene.name = 'scene';
    this.adaptive.enabled = !opts.fixedQuality && this.settings.get('adaptiveQuality');
    this.adaptive.onChange = () => this.applySettings();
    // Start from a sensible level for the detected GPU class, then adapt.
    if (this.adaptive.enabled) this.adaptive.setInitialLevel(this.renderer.gpuTier === 'low' ? 3 : this.renderer.gpuTier === 'mid' ? 1 : 0);
  }

  /** Async startup: terrain + creature meshes are generated in workers in parallel. */
  /** Startup phase durations (ms), exposed for diagnostics. */
  readonly timings: Record<string, number> = {};

  async init(progress: (msg: string) => void = () => {}): Promise<void> {
    let t = performance.now();
    const lap = (name: string): void => {
      const now = performance.now();
      this.timings[name] = Math.round(now - t);
      t = now;
    };
    // Creatures are sculpted in workers while the world is built and its shaders compile.
    const speciesReady = preloadSpecies([WOLF, DEER]);
    progress('Shaping the valley…');
    const terrain = await loadTerrain(this.opts.seed);
    lap('terrain worker');
    progress('Growing the forest…');
    await new Promise((r) => setTimeout(r, 0));
    this.buildWorld(terrain);
    lap('world');
    progress('Sculpting the creatures…');
    await Promise.all([speciesReady, this.compileScene()]);
    lap('creature workers ∥ world shaders');
    this.buildEcosystem();
    lap('ecosystem');
    this.post = new PostFX(this.renderer.renderer, this.scene, this.cameraRig.camera);
    this.post.setSize(this.renderer.width, this.renderer.height);
    this.ui = new UI(this, document.getElementById('ui')!);
    if (this.opts.autostart) this.ui.dismissStart();
    this.applySettings();
    this.unsub.push(this.settings.subscribe((_s, key) => this.onSetting(key)));
    this.assignShadowMaterials();
    lap('post + ui');
    progress('Compiling shaders…');
    this.step(1 / 60);
    this.world.vegetation.refresh(this.cameraRig.camera);
    await this.prewarm();
    lap('shader prewarm');
    // Prime the cinematic camera behind the start overlay.
    if (!this.opts.autostart) this.cameraRig.setMode('cinematic');
  }

  /**
   * three.js shares one depth material between all shadow casters, so skinned,
   * instanced and plain meshes would make it switch programs per object every
   * frame (re-deriving parameters, lots of garbage). Give each kind its own.
   */
  private assignShadowMaterials(): void {
    const skinned = new THREE.MeshDepthMaterial();
    const instanced = new THREE.MeshDepthMaterial();
    skinned.name = 'depth-skinned';
    instanced.name = 'depth-instanced';
    this.shadowMaterials.push(skinned, instanced);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.customDepthMaterial) return;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.customDepthMaterial = skinned;
      else if ((m as THREE.InstancedMesh).isInstancedMesh) m.customDepthMaterial = instanced;
    });
  }

  private shadowMaterials: THREE.Material[] = [];

  /**
   * Compiles every shader variant up front (both the post-processing render
   * target path and the direct-to-screen path, including objects that are
   * currently hidden) so no program is compiled mid-game.
   */
  private async prewarm(): Promise<void> {
    await this.compileScene();
    // One real frame through the post chain compiles shadow-depth and post shaders.
    const hidden = this.revealAll();
    this.post.render(1 / 60);
    for (const o of hidden) o.visible = false;
    this.post.render(1 / 60);
  }

  /** Makes every hidden object visible (so it gets compiled); returns them. */
  private revealAll(): THREE.Object3D[] {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    return hidden;
  }

  /**
   * Compiles all scene programs for the render-target (post-processing) path,
   * using KHR_parallel_shader_compile where available. The direct-to-screen
   * variants are only needed if post-processing gets disabled, so they compile
   * lazily in that case.
   */
  private compileScene(): Promise<unknown> {
    const r = this.renderer.renderer;
    const hidden = this.revealAll();
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    r.setRenderTarget(rt);
    const p = r.compileAsync(this.scene, this.cameraRig.camera);
    r.setRenderTarget(null);
    for (const o of hidden) o.visible = false;
    return p.finally(() => rt.dispose());
  }

  private buildWorld(terrain: Awaited<ReturnType<typeof loadTerrain>>): void {
    const t0 = performance.now();
    this.world = new World(terrain);
    this.timings['  world (terrain mesh, vegetation, water)'] = Math.round(performance.now() - t0);
    this.scene.add(this.world.group);
    const dn = this.world.dayNight;
    this.scene.add(dn.mainLight, dn.mainLight.target, dn.hemi);
    this.scene.fog = dn.fog;
    dn.setTime(this.opts.startTime ?? 16.4);
    this.weather = new Weather(dn);
    this.scene.add(this.weather.rainMesh);
  }

  private buildEcosystem(): void {
    const t1 = performance.now();
    this.eco = new Ecosystem(this.world, this.opts.seed);
    this.timings['  ecosystem (nav grid, animals, critters)'] = Math.round(performance.now() - t1);
    this.scene.add(this.eco.group);
    this.wolf = this.eco.alpha;
    this.eco.onRipple = (x, z, st) => this.world.water.ripple(x, z, this.simTime, st);
    this.effects = new Effects(this.world, this.world.vegetation);
    this.scene.add(this.effects.group);
    this.scene.add(this.debug.lines);
    this.unsub.push(
      events.on('footstep', (e) => {
        if (e.surface === 'water') this.world.water.ripple(e.x, e.z, this.simTime, 0.35 * e.strength);
      }),
      events.on('splash', (e) => this.world.water.ripple(e.x, e.z, this.simTime, e.strength)),
    );
  }

  setManual(m: boolean): void {
    if (this.manual === m) return;
    this.manual = m;
    if (m) this.eco.alphaBrain.stopCurrent();
    // Cinematic framing depends on the wolf's heading, which would make
    // camera-relative steering chase its own tail: drive with the follow cam.
    if (m && (this.cameraRig.mode === 'cinematic' || this.cameraRig.mode === 'fixed')) this.setCameraMode('follow');
    this.wolf.moveDir.set(0, 0);
    this.wolf.moveSpeed = 0;
    if (!m && this.wolf.state !== 'locomotion' && this.wolf.canAct()) this.wolf.play('locomotion');
    events.emit('controlMode', { manual: m });
  }

  toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
  }

  /** Resets creatures, time, weather and camera to the initial state. */
  resetSimulation(): void {
    this.eco.reset();
    this.effects.clear();
    this.world.dayNight.setTime(this.opts.startTime ?? 16.4);
    this.weather.setMode(this.settings.get('weatherMode'));
    this.setManual(false);
    this.cameraRig.setMode('follow');
    events.emit('reset', {});
    events.emit('notify', { text: 'Simulation reset' });
  }

  private onSetting(key: keyof SettingsData): void {
    if (key === 'adaptiveQuality') {
      this.adaptive.enabled = this.settings.get('adaptiveQuality') && !this.opts.fixedQuality;
      this.adaptive.setInitialLevel(0);
    }
    if (key === 'weatherMode') this.weather.setMode(this.settings.get('weatherMode'));
    // Restart the measurement window so the change itself is not judged.
    this.adaptive.reset();
    this.applySettings();
  }

  /** Applies user settings degraded by the adaptive-quality level. */
  applySettings(): void {
    const s = (this.effective = this.adaptive.effective(this.settings.data));
    const L = this.world.dayNight.mainLight;
    const size = SHADOW_SIZES[s.shadowQuality];
    const r = this.renderer.renderer;
    r.shadowMap.enabled = size > 0;
    L.castShadow = size > 0;
    if (size > 0 && L.shadow.mapSize.x !== size) {
      L.shadow.mapSize.set(size, size);
      L.shadow.map?.dispose();
      L.shadow.map = null;
    }
    const cam = L.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    L.shadow.bias = -0.0004;
    L.shadow.normalBias = 0.035;
    L.shadow.radius = s.shadowQuality >= 2 ? 3 : 2;
    // resolution scale is read by the renderer from the effective settings
    this.renderer.scaleOverride = s.resolutionScale;
    this.renderer.refresh();
    this.post?.apply(s);
    this.world.grass.setDensity(s.grassDensity);
    this.weather.enabled = s.weatherEnabled;
    this.weather.setMode(s.weatherMode);
  }

  start(): void {
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      // rAF timestamps can precede start(); never feed a negative dt.
      const dtReal = Math.max(0, Math.min((t - this.lastT) / 1000, 0.25));
      this.lastT = Math.max(t, this.lastT);
      this.tick(dtReal);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** One frame: simulate + render. */
  tick(dtReal: number): void {
    const t0 = performance.now();
    const dt = Math.min(dtReal, 1 / 20);
    if (!this.paused) this.step(dt);
    else this.cameraOnly(dt);
    this.render(dt);
    this.ui?.update(dtReal);
    this.input.endFrame();
    this.frame++;
    this.cpuMs = performance.now() - t0;
    if (dtReal > 0) {
      this.frameTimes.push(dtReal);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.fps = 1 / Math.max(avg, 1e-4);
      if (this.frame > 30) this.adaptive.sample(dtReal);
    }
  }

  private cameraOnly(dt: number): void {
    this.cameraRig.update(dt, { pos: this.wolf.root.position, yaw: this.wolf.yaw, speed: this.wolf.speed, height: 0.9 }, this.input, this.world);
    globalUniforms.uCameraPos.value.copy(this.cameraRig.camera.position);
  }

  /** Advances the simulation by dt seconds (no rendering). */
  step(dt: number): void {
    this.simTime += dt;
    globalUniforms.uTime.value = this.simTime;
    const cam = this.cameraRig.camera;
    this.handleGlobalKeys();
    this.cameraRig.manualSteer = this.manual;
    if (this.manual) {
      this.player.update(this.input, this.wolf, this.cameraRig.controlYaw);
      if (this.player.action) this.eco.handlePlayerAction(this.player.action);
    } else if (this.input.anyDown('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight')) {
      // Any movement key takes over control from the AI.
      this.setManual(true);
      this.player.update(this.input, this.wolf, this.cameraRig.controlYaw);
    }
    const dn = this.world.dayNight;
    this.weather.update(dt);
    this.eco.update(dt, this.simTime, dn.night, this.manual);
    this.cameraRig.update(dt, { pos: this.wolf.root.position, yaw: this.wolf.yaw, speed: this.wolf.speed, height: 0.9 }, this.input, this.world);
    this.world.update(dt, cam, this.settings.get('timeSpeed'));
    this.eco.updateLOD(cam, this.effective.furQuality);
    // Lightning brightens the ambient light.
    dn.hemi.intensity += this.weather.lightningBoost * 2.5;
    // Shadow camera follows the view focus, snapped to texels to avoid shimmer.
    const L = dn.mainLight;
    const focus = this.cameraRig.focusTarget;
    const size = L.shadow.mapSize.x || 2048;
    const texel = (SHADOW_EXTENT * 2) / size;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    L.target.position.set(fx, focus.y, fz);
    L.position.normalize().multiplyScalar(120).add(L.target.position);
    L.target.updateMatrixWorld();
    globalUniforms.uCameraPos.value.copy(cam.position);
    // Particle lighting follows the sky.
    this.tmpColor2.copy(L.color).multiplyScalar(L.intensity * 0.18);
    this.tmpColor.copy(dn.hemi.color).multiplyScalar(dn.hemi.intensity * 0.6).add(this.tmpColor2);
    this.effects.update(dt, this.simTime, cam, dn.night, this.tmpColor, this.weather.rain, this.weather.wind);
    this.debug.update(this.eco);
    this.audio.update(dt, cam, {
      night: dn.night,
      wind: this.weather.wind,
      rain: this.weather.rain,
      lakeDistance: Math.max(0, Math.hypot(cam.position.x - LAKE.x, cam.position.z - LAKE.z) - LAKE.r * 0.9),
      exertion: this.wolf.exertion,
      alphaPos: this.wolf.pos,
      timeOfDay: dn.time,
    });
  }

  private handleGlobalKeys(): void {
    const inp = this.input;
    if (inp.pressed('KeyT')) this.setManual(!this.manual);
    if (inp.pressed('KeyC')) events.emit('cameraMode', { mode: this.cameraRig.cycleMode() });
    if (inp.pressed('Digit1')) this.setCameraMode('follow');
    if (inp.pressed('Digit2')) this.setCameraMode('orbit');
    if (inp.pressed('Digit3')) this.setCameraMode('cinematic');
    if (inp.pressed('KeyM')) this.toggleMute();
    if (inp.pressed('KeyO')) this.ui?.toggleSettings();
    if (inp.pressed('KeyH')) this.ui?.toggleHelp();
    if (inp.pressed('F3')) this.ui?.toggleDebug();
    if (inp.pressed('KeyU')) this.settings.set('showHud', !this.settings.get('showHud'));
    if (inp.pressed('BracketLeft')) this.settings.set('timeSpeed', Math.max(0, this.settings.get('timeSpeed') / 2));
    if (inp.pressed('BracketRight')) this.settings.set('timeSpeed', Math.min(16, Math.max(0.25, this.settings.get('timeSpeed') * 2)));
  }

  render(dt = 1 / 60): void {
    const r = this.renderer.renderer;
    r.info.reset();
    // On reduced shadow quality the shadow map is refreshed at half rate (a
    // one-frame lag on moving shadows is invisible, the saving is not).
    const halfRate = this.effective.shadowQuality <= 1;
    r.shadowMap.autoUpdate = !halfRate;
    if (halfRate && (this.frame & 1) === 0) r.shadowMap.needsUpdate = true;
    r.toneMappingExposure = this.world.dayNight.exposure;
    if (this.post && this.effective.postProcessing) {
      this.post.setGrade(this.world.dayNight.night, this.cameraRig.mode === 'cinematic');
      this.post.render(dt);
    } else {
      r.render(this.scene, this.cameraRig.camera);
    }
  }

  setCameraMode(m: CameraMode): void {
    this.cameraRig.setMode(m);
    events.emit('cameraMode', { mode: m });
  }

  get effectiveSettings(): SettingsData {
    return this.effective;
  }

  dispose(): void {
    this.stop();
    this.unsub.forEach((u) => u());
    this.ui?.dispose();
    this.audio.dispose();
    this.input.dispose();
    this.eco.dispose();
    this.effects.dispose();
    this.weather.dispose();
    this.debug.dispose();
    this.world.dispose();
    this.post?.dispose();
    this.shadowMaterials.forEach((m) => m.dispose());
    disposeSpeciesAssets();
    disposeFurNoise();
    this.renderer.dispose();
  }
}
