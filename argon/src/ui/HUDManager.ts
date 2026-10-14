import * as THREE from 'three';
import { SimulationClock } from '../core/Clock';
import { QualityManager, ShadowQuality, WeatherMode } from '../core/QualityManager';
import { WolfEntity } from '../animal/WolfEntity';
import { CameraRig } from '../render/CameraRig';
import { ProceduralAudio } from '../audio/ProceduralAudio';

export interface HUDCallbacks {
  onReset: () => void;
  onToggleDebugSkeleton: (visible: boolean) => void;
  onToggleDebugAI: (visible: boolean) => void;
  onToggleWireframe: (visible: boolean) => void;
}

/**
 * UI & HUD Controller
 * Synchronizes telemetry (FPS, frame time, state, time of day, entity count, biological need bars),
 * 3D floating thought indicator, graphics settings, and debug overlays.
 */
export class HUDManager {
  private elFps = document.getElementById('hud-fps')!;
  private elFrameTime = document.getElementById('hud-frametime')!;
  private elTime = document.getElementById('hud-time')!;
  private elPhase = document.getElementById('hud-phase')!;
  private elMode = document.getElementById('hud-mode')!;
  private elState = document.getElementById('hud-state')!;
  private elSpeed = document.getElementById('hud-speed')!;
  private elEntities = document.getElementById('hud-entities')!;

  private valHunger = document.getElementById('val-hunger')!;
  private barHunger = document.getElementById('bar-hunger')!;
  private valThirst = document.getElementById('val-thirst')!;
  private barThirst = document.getElementById('bar-thirst')!;
  private valEnergy = document.getElementById('val-energy')!;
  private barEnergy = document.getElementById('bar-energy')!;
  private valCuriosity = document.getElementById('val-curiosity')!;
  private barCuriosity = document.getElementById('bar-curiosity')!;

  private thoughtBubble = document.getElementById('thought-bubble')!;
  private thoughtIcon = document.getElementById('thought-icon')!;
  private thoughtText = document.getElementById('thought-text')!;

  private btnToggleAI = document.getElementById('btn-toggle-ai')!;
  private btnCamMode = document.getElementById('btn-cam-mode')!;
  private btnMute = document.getElementById('btn-mute')!;
  private btnPostFx = document.getElementById('btn-postfx')!;
  private btnAdaptive = document.getElementById('btn-adaptive')!;
  private btnDbgSkeleton = document.getElementById('btn-dbg-skeleton')!;
  private btnDbgAI = document.getElementById('btn-dbg-ai')!;
  private btnDbgWire = document.getElementById('btn-dbg-wire')!;

  private selShadow = document.getElementById('sel-shadow') as HTMLSelectElement;
  private rngScale = document.getElementById('rng-scale') as HTMLInputElement;
  private lblScale = document.getElementById('lbl-scale')!;
  private rngTime = document.getElementById('rng-time') as HTMLInputElement;
  private lblTod = document.getElementById('lbl-tod')!;
  private rngTimeSpeed = document.getElementById('rng-timespeed') as HTMLInputElement;
  private lblTimeSpeed = document.getElementById('lbl-timespeed')!;
  private selWeather = document.getElementById('sel-weather') as HTMLSelectElement;

  public debugSkeleton = false;
  public debugAI = false;
  public debugWireframe = false;

  private tempProj = new THREE.Vector3();

  constructor(
    private clock: SimulationClock,
    private quality: QualityManager,
    private wolf: WolfEntity,
    private cameraRig: CameraRig,
    private audio: ProceduralAudio,
    private callbacks: HUDCallbacks
  ) {
    this.bindEvents();
  }

  private bindEvents(): void {
    this.btnToggleAI.addEventListener('click', () => this.toggleControlMode());
    this.btnCamMode.addEventListener('click', () => this.cycleCameraMode());

    document.getElementById('btn-action-howl')?.addEventListener('click', () => {
      this.wolf.triggerSpecialAction('howl');
    });
    document.getElementById('btn-action-pounce')?.addEventListener('click', () => {
      this.wolf.triggerSpecialAction('pounce');
    });
    document.getElementById('btn-action-shake')?.addEventListener('click', () => {
      this.wolf.triggerSpecialAction('shake');
    });
    document.getElementById('btn-action-rest')?.addEventListener('click', () => {
      this.wolf.triggerSpecialAction('rest');
    });

    this.btnMute.addEventListener('click', () => {
      const isMuted = this.audio.toggleMute();
      this.btnMute.textContent = isMuted ? '🔇 Muted' : '🔊 Audio';
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    this.selShadow.addEventListener('change', () => {
      this.quality.settings.shadowQuality = this.selShadow.value as ShadowQuality;
      this.quality.notifyChange();
    });

    this.rngScale.addEventListener('input', () => {
      const val = parseFloat(this.rngScale.value);
      this.lblScale.textContent = val.toFixed(1);
      this.quality.settings.resolutionScale = val;
      this.quality.notifyChange();
    });

    this.rngTime.addEventListener('input', () => {
      const val = parseFloat(this.rngTime.value);
      this.clock.timeOfDay = val;
      this.lblTod.textContent = val.toFixed(1);
    });

    this.rngTimeSpeed.addEventListener('input', () => {
      const val = parseFloat(this.rngTimeSpeed.value);
      this.clock.timeSpeed = val;
      this.lblTimeSpeed.textContent = val.toFixed(1);
    });

    this.selWeather.addEventListener('change', () => {
      this.quality.settings.weather = this.selWeather.value as WeatherMode;
      this.quality.notifyChange();
    });

    this.btnPostFx.addEventListener('click', () => {
      this.quality.settings.postProcessing = !this.quality.settings.postProcessing;
      this.btnPostFx.textContent = this.quality.settings.postProcessing ? 'ON' : 'OFF';
      this.btnPostFx.classList.toggle('active', this.quality.settings.postProcessing);
      this.quality.notifyChange();
    });

    this.btnAdaptive.addEventListener('click', () => {
      this.quality.settings.adaptiveQuality = !this.quality.settings.adaptiveQuality;
      this.btnAdaptive.textContent = this.quality.settings.adaptiveQuality ? 'ON' : 'OFF';
      this.btnAdaptive.classList.toggle('active', this.quality.settings.adaptiveQuality);
    });

    this.btnDbgSkeleton.addEventListener('click', () => this.toggleSkeletonDebug());
    this.btnDbgAI.addEventListener('click', () => {
      this.debugAI = !this.debugAI;
      this.btnDbgAI.classList.toggle('active', this.debugAI);
      this.callbacks.onToggleDebugAI(this.debugAI);
    });
    this.btnDbgWire.addEventListener('click', () => {
      this.debugWireframe = !this.debugWireframe;
      this.btnDbgWire.classList.toggle('active', this.debugWireframe);
      this.callbacks.onToggleWireframe(this.debugWireframe);
    });

    this.quality.onChange((s) => {
      this.selShadow.value = s.shadowQuality;
      this.rngScale.value = s.resolutionScale.toString();
      this.lblScale.textContent = s.resolutionScale.toFixed(1);
      this.btnPostFx.textContent = s.postProcessing ? 'ON' : 'OFF';
      this.btnPostFx.classList.toggle('active', s.postProcessing);
    });
  }

  toggleControlMode(): void {
    this.wolf.isManualControl = !this.wolf.isManualControl;
    const isAI = !this.wolf.isManualControl;
    this.btnToggleAI.textContent = isAI ? '🤖 AI Mode' : '🎮 Manual WASD';
    this.btnToggleAI.classList.toggle('active', isAI);
    this.elMode.textContent = isAI ? 'AI Autonomy' : 'Manual Control';
    this.elMode.style.color = isAI ? 'var(--accent-blue)' : 'var(--accent-gold)';
  }

  cycleCameraMode(): void {
    const mode = this.cameraRig.cycleMode();
    const label = mode === 'follow' ? 'Follow' : mode === 'orbit' ? 'Orbit' : 'Cinematic';
    this.btnCamMode.textContent = `🎥 Cam: ${label}`;
  }

  toggleSkeletonDebug(): void {
    this.debugSkeleton = !this.debugSkeleton;
    this.btnDbgSkeleton.classList.toggle('active', this.debugSkeleton);
    this.callbacks.onToggleDebugSkeleton(this.debugSkeleton);
  }

  private lastStateStr = '';
  private lastHudTick = -1;
  private lastThoughtStr = '';

  update(entityCount: number, force = false): void {
    const stateStr = this.wolf.animator.state.toUpperCase();
    const stateChanged = stateStr !== this.lastStateStr;
    const nowElapsed = this.clock.elapsed;

    // Throttle heavy DOM text/style updates to ~10Hz unless state changed or forced
    if (force || stateChanged || nowElapsed - this.lastHudTick >= 0.1 || this.lastHudTick < 0) {
      this.lastHudTick = nowElapsed;
      this.lastStateStr = stateStr;

      const fps = Math.round(this.clock.fps);
      this.elFps.textContent = `${fps} FPS`;
      this.elFps.style.color = fps >= 50 ? 'var(--accent-green)' : fps >= 35 ? 'var(--accent-gold)' : 'var(--accent-red)';
      this.elFrameTime.textContent = `${this.clock.frameTimeMs.toFixed(1)} ms`;
      this.elTime.textContent = this.clock.getFormattedTime();
      this.elPhase.textContent = this.clock.getDayPhaseLabel();
      this.elState.textContent = stateStr;
      this.elSpeed.textContent = `${this.wolf.speed.toFixed(1)} m/s`;
      this.elEntities.textContent = entityCount.toString();

      if (document.activeElement !== this.rngTime) {
        this.rngTime.value = this.clock.timeOfDay.toFixed(1);
        this.lblTod.textContent = this.clock.timeOfDay.toFixed(1);
      }

      const h = Math.round(this.wolf.needs.hunger);
      const t = Math.round(this.wolf.needs.thirst);
      const e = Math.round(this.wolf.needs.energy);
      const c = Math.round(this.wolf.needs.curiosity);

      this.valHunger.textContent = `${h}%`;
      this.barHunger.style.width = `${h}%`;
      this.valThirst.textContent = `${t}%`;
      this.barThirst.style.width = `${t}%`;
      this.valEnergy.textContent = `${e}%`;
      this.barEnergy.style.width = `${e}%`;
      this.valCuriosity.textContent = `${c}%`;
      this.barCuriosity.style.width = `${c}%`;
    }

    // Project 3D Floating Thought Indicator above wolf's head
    this.wolf.getHeadWorldPosition(this.tempProj);
    this.tempProj.y += 0.42;
    this.tempProj.project(this.cameraRig.camera);

    if (this.tempProj.z < 1.0) {
      const screenX = (this.tempProj.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-this.tempProj.y * 0.5 + 0.5) * window.innerHeight;
      this.thoughtBubble.style.opacity = '1';
      this.thoughtBubble.style.left = `${screenX.toFixed(1)}px`;
      this.thoughtBubble.style.top = `${screenY.toFixed(1)}px`;
      const combinedThought = `${this.wolf.thoughtIcon}|${this.wolf.thoughtText}`;
      if (combinedThought !== this.lastThoughtStr) {
        this.lastThoughtStr = combinedThought;
        this.thoughtIcon.textContent = this.wolf.thoughtIcon;
        this.thoughtText.textContent = this.wolf.thoughtText;
      }
    } else {
      this.thoughtBubble.style.opacity = '0';
    }
  }
}
