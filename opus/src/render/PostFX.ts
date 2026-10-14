/**
 * Post-processing chain (pmndrs/postprocessing):
 *   RenderPass -> SAO (half-res ambient occlusion + depth-aware blur)
 *   -> EffectPass(AO composite, Bloom, AgX tone mapping, colour grading,
 *                 vignette, SMAA)
 * All effects are merged into a single fullscreen pass. When post-processing
 * is disabled the renderer applies AgX tone mapping directly.
 */
import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { SettingsData } from '../core/Settings';
import { AOCompositeEffect, SAOPass } from './SAO';

export class PostFX {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  readonly ao: SAOPass;
  private aoComposite: AOCompositeEffect;
  readonly bloom: BloomEffect;
  private effectPass: EffectPass;
  private tone: ToneMappingEffect;
  readonly vignette: VignetteEffect;
  private grade: HueSaturationEffect;
  private contrast: BrightnessContrastEffect;
  private smaa: SMAAEffect;
  enabled = true;
  private bloomOn = true;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.ao = new SAOPass(camera);
    this.composer.addPass(this.ao);

    this.aoComposite = new AOCompositeEffect(this.ao.texture);
    this.bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7, levels: 5 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new HueSaturationEffect({ saturation: 0.12, hue: 0 });
    this.contrast = new BrightnessContrastEffect({ brightness: 0, contrast: 0.06 });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.LOW });
    this.effectPass = new EffectPass(camera, this.aoComposite, this.bloom, this.tone, this.grade, this.contrast, this.vignette, this.smaa);
    this.composer.addPass(this.effectPass);
  }

  apply(s: SettingsData): void {
    this.enabled = s.postProcessing;
    this.ao.enabled = s.postProcessing && s.ambientOcclusion;
    this.aoComposite.strength = this.ao.enabled ? 1 : 0;
    this.bloomOn = s.bloom;
    this.bloom.blendMode.opacity.value = s.bloom ? 1 : 0;
    // The renderer keeps AgX tone mapping constant (switching it would force
    // every material to recompile). Renders into the composer's targets skip
    // tone mapping automatically; the effect pass applies it instead.
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  /** Night grading: cooler, slightly desaturated; stronger vignette in cinematic mode. */
  setGrade(night: number, cinematic: boolean): void {
    this.grade.saturation = 0.12 - night * 0.18;
    this.vignette.darkness = (cinematic ? 0.7 : 0.5) + night * 0.15;
    this.bloom.intensity = this.bloomOn ? 0.75 + night * 0.6 : 0;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
