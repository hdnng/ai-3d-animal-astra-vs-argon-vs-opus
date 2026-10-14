import * as THREE from 'three';
import { SimulationClock } from './Clock';
import { InputManager } from './Input';
import { QualityManager, QualitySettings } from './QualityManager';
import { Terrain } from '../world/Terrain';
import { WaterSurface } from '../world/Water';
import { VegetationManager } from '../world/Vegetation';
import { SkyWeatherSystem } from '../world/SkyWeather';
import { EcosystemManager } from '../world/Ecosystem';
import { WolfEntity } from '../animal/WolfEntity';
import { WolfAIController } from '../ai/WolfAI';
import { PostProcessor } from '../render/PostProcessor';
import { ParticlePool } from '../render/ParticlePool';
import { CameraRig } from '../render/CameraRig';
import { ProceduralAudio } from '../audio/ProceduralAudio';
import { HUDManager } from '../ui/HUDManager';
import { disposeHierarchy } from '../utils/dispose';

/**
 * Main 3D Wolf Ecosystem Simulation Engine
 * Coordinates Three.js renderer, world subsystems, hierarchical wolf rig,
 * Utility AI, ecosystem entities, post-processing, audio, and UI.
 */
export class SimulationEngine {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public clock: SimulationClock;
  public input: InputManager;
  public quality: QualityManager;

  public terrain: Terrain;
  public water: WaterSurface;
  public vegetation: VegetationManager;
  public skyWeather: SkyWeatherSystem;
  public ecosystem: EcosystemManager;

  public alphaWolf: WolfEntity;
  public aiController: WolfAIController;
  public cameraRig: CameraRig;
  public postProcessor: PostProcessor;
  public particles: ParticlePool;
  public audio: ProceduralAudio;
  public hud: HUDManager;

  private animFrameId = 0;
  private breathTimer = 0;
  private dummyInput: InputManager;
  private resizeHandler: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.clock = new SimulationClock();
    this.input = new InputManager(this.canvas);
    this.dummyInput = this.input;
    this.quality = new QualityManager();
    this.audio = new ProceduralAudio();

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameraRig = new CameraRig(width / Math.max(1, height));

    // Build World & Ecosystem
    this.terrain = new Terrain(this.scene);
    this.water = new WaterSurface(this.scene, this.terrain.size, this.terrain.waterLevel);
    this.vegetation = new VegetationManager(this.scene, this.terrain);
    this.skyWeather = new SkyWeatherSystem(this.scene);
    this.particles = new ParticlePool(this.scene);

    // Build Alpha Wolf & Pack Ecosystem
    this.alphaWolf = new WolfEntity(this.scene, 'alpha', (action) => {
      this.audio.playActionCue(action);
    });
    this.alphaWolf.reset(0, 8, (x, z) => this.terrain.getHeightAt(x, z));

    this.ecosystem = new EcosystemManager(this.scene, this.terrain);
    this.aiController = new WolfAIController(this.scene);

    // Setup Post-Processor & Quality hooks
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality.settings.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.postProcessor = new PostProcessor(this.renderer, width * dpr, height * dpr);

    this.cameraRig.snapToTarget(this.alphaWolf, (x, z) => this.terrain.getHeightAt(x, z));

    this.hud = new HUDManager(
      this.clock,
      this.quality,
      this.alphaWolf,
      this.cameraRig,
      this.audio,
      {
        onReset: () => this.resetSimulation(),
        onToggleDebugSkeleton: (vis) => {
          this.alphaWolf.skeletonHelper.visible = vis;
          for (const pw of this.ecosystem.packWolves) {
            pw.skeletonHelper.visible = vis;
          }
        },
        onToggleDebugAI: (vis) => {
          this.aiController.debugGroup.visible = vis;
        },
        onToggleWireframe: (vis) => {
          this.setSceneWireframe(vis);
        }
      }
    );

    this.quality.onChange((s) => this.applyQualitySettings(s));

    this.resizeHandler = () => this.onWindowResize();
    window.addEventListener('resize', this.resizeHandler);

    // Pre-compile all scene & custom shaders to avoid runtime frame stalls
    this.renderer.compile(this.scene, this.cameraRig.camera);
  }

  private applyQualitySettings(s: QualitySettings): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * s.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.postProcessor.resize(width * dpr, height * dpr);

    if (s.shadowQuality === 'off') {
      this.renderer.shadowMap.enabled = false;
      this.skyWeather.sunLight.castShadow = false;
    } else {
      this.renderer.shadowMap.enabled = true;
      this.skyWeather.sunLight.castShadow = true;
      const mapSize = s.shadowQuality === 'high' ? 1024 : s.shadowQuality === 'medium' ? 512 : 256;
      if (this.skyWeather.sunLight.shadow.mapSize.x !== mapSize) {
        this.skyWeather.sunLight.shadow.mapSize.set(mapSize, mapSize);
        if (this.skyWeather.sunLight.shadow.map) {
          this.skyWeather.sunLight.shadow.map.dispose();
          this.skyWeather.sunLight.shadow.map = null;
        }
      }
    }
  }

  private setSceneWireframe(wireframe: boolean): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh !== this.skyWeather.skyMesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && 'wireframe' in mat) {
          mat.wireframe = wireframe;
        }
      }
    });
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameraRig.camera.aspect = width / Math.max(1, height);
    this.cameraRig.camera.updateProjectionMatrix();

    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality.settings.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.postProcessor.resize(width * dpr, height * dpr);
  }

  resetSimulation(): void {
    this.clock.reset();
    this.alphaWolf.reset(0, 8, (x, z) => this.terrain.getHeightAt(x, z));
    this.cameraRig.snapToTarget(this.alphaWolf, (x, z) => this.terrain.getHeightAt(x, z));
  }

  start(): void {
    const loop = (now: number) => {
      this.animFrameId = requestAnimationFrame(loop);
      const dt = this.clock.tick(now);
      this.quality.updateAdaptive(this.clock.fps, dt);
      this.stepSimulation(dt);
      this.renderFrame();
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Advances simulation state by dt seconds (callable directly for deterministic testing)
   */
  stepSimulation(dt: number): void {
    // Global keyboard shortcuts
    if (this.input.consumeJustPressed('Tab')) {
      this.hud.toggleControlMode();
    }
    if (this.input.consumeJustPressed('KeyC')) {
      this.hud.cycleCameraMode();
    }
    if (this.input.consumeJustPressed('KeyV')) {
      this.hud.toggleSkeletonDebug();
    }
    if (this.input.consumeJustPressed('KeyM')) {
      this.audio.toggleMute();
    }
    if (!this.alphaWolf.isManualControl) {
      // Allow manual trigger of special actions even in AI mode!
      if (this.input.consumeJustPressed('KeyH') || this.input.consumeJustPressed('Digit1')) {
        this.alphaWolf.triggerSpecialAction('howl');
      } else if (this.input.consumeJustPressed('KeyP') || this.input.consumeJustPressed('Digit2')) {
        this.alphaWolf.triggerSpecialAction('pounce');
      } else if (this.input.consumeJustPressed('KeyK') || this.input.consumeJustPressed('Digit3')) {
        this.alphaWolf.triggerSpecialAction('shake');
      } else if (this.input.consumeJustPressed('KeyR') || this.input.consumeJustPressed('Digit4')) {
        this.alphaWolf.triggerSpecialAction('rest');
      } else if (this.input.consumeJustPressed('Space')) {
        this.alphaWolf.triggerSpecialAction('jump');
      }
    }

    const sampleTerrain = (x: number, z: number) => this.terrain.getHeightAt(x, z);

    // Update AI controller
    this.aiController.update(
      dt,
      this.alphaWolf,
      this.terrain,
      this.ecosystem,
      this.vegetation.foodSites,
      this.vegetation.obstacles
    );

    // Update Alpha Wolf kinematics, IK & footsteps
    this.alphaWolf.update(
      dt,
      this.input,
      sampleTerrain,
      this.terrain.waterLevel,
      this.vegetation.obstacles,
      (ev) => {
        if (ev.inWater) {
          this.particles.emitWaterSplash(ev.worldPos, ev.speed / 5.0);
        } else {
          this.particles.emitFootstepDust(ev.worldPos, ev.speed / 6.0);
        }
        this.audio.playFootstep(ev.inWater, ev.speed);
      }
    );

    // Cold breath vapor mist during howl or cool night/morning
    this.breathTimer -= dt;
    if (
      this.breathTimer <= 0 &&
      (this.alphaWolf.animator.state === 'howl' ||
        this.clock.timeOfDay < 7.5 ||
        this.clock.timeOfDay > 19.0)
    ) {
      this.breathTimer = this.alphaWolf.animator.state === 'howl' ? 0.14 : 1.6;
      const headPos = this.alphaWolf.getHeadWorldPosition();
      this.particles.emitBreathMist(headPos, this.alphaWolf.heading);
    }

    // Update Ecosystem (Pack Wolves, Hares, River Trout)
    this.ecosystem.update(
      dt,
      this.clock.elapsed,
      this.alphaWolf,
      this.vegetation.obstacles,
      this.dummyInput
    );

    // Update World & Weather
    this.vegetation.update(this.clock.elapsed);
    this.skyWeather.update(
      dt,
      this.clock.elapsed,
      this.clock.timeOfDay,
      this.quality.settings.weather,
      this.alphaWolf.position
    );
    this.water.update(
      this.clock.elapsed,
      this.skyWeather.sunDir,
      this.skyWeather.sunColor,
      this.skyWeather.skyHorizonColor,
      this.skyWeather.currentFogColor
    );

    this.particles.update(dt);
    this.cameraRig.update(dt, this.alphaWolf, this.input, sampleTerrain);
    this.audio.update(dt, this.alphaWolf.position, this.terrain.waterLevel);
    this.hud.update(this.ecosystem.getTotalEntityCount());

    this.input.endFrame();
  }

  renderFrame(): void {
    this.postProcessor.render(
      this.scene,
      this.cameraRig.camera,
      this.quality.settings.postProcessing
    );
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.resizeHandler);
    this.input.dispose();
    this.postProcessor.dispose();
    disposeHierarchy(this.scene);
    this.renderer.dispose();
  }
}
