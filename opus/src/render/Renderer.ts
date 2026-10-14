/** WebGL renderer setup: color management, shadows, resize + DPR handling. */
import * as THREE from 'three';
import type { Settings } from '../core/Settings';

export const SHADOW_SIZES = [0, 1024, 2048, 4096];

export type GpuTier = 'low' | 'mid' | 'high';

/** Rough GPU class from the unmasked renderer string (used for the initial quality guess). */
export function classifyGpu(name: string): GpuTier {
  if (/swiftshader|llvmpipe|software|microsoft basic/i.test(name)) return 'low';
  if (/intel.*(hd|uhd) graphics|mali-[gt][0-9]|adreno \(tm\) [3-5]|powervr/i.test(name)) return 'low';
  if (/intel|iris|radeon\(tm\) graphics|radeon graphics|vega [0-9]+ graphics|adreno|mali|apple m1/i.test(name)) return 'mid';
  return 'high';
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  width = 1;
  height = 1;
  pixelRatio = 1;
  /** GPU name and class detected at startup. */
  readonly gpuName: string;
  readonly gpuTier: GpuTier;
  /** Effective resolution scale (user setting degraded by adaptive quality). */
  scaleOverride: number | null = null;
  private resizeObserver: ResizeObserver;
  onResize: ((w: number, h: number, pr: number) => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private settings: Settings,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.gpuTier = classifyGpu(this.gpuName);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize = (): void => {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    const scale = this.scaleOverride ?? this.settings.get('resolutionScale');
    const pr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    if (w === this.width && h === this.height && pr === this.pixelRatio) return;
    this.width = w;
    this.height = h;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.onResize) this.onResize(w, h, pr);
  };

  /** Re-applies the pixel ratio after a resolution-scale change. */
  refresh(): void {
    this.pixelRatio = -1;
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
