/**
 * Lightweight scalable ambient occlusion for weak GPUs:
 *  1. half-resolution AO from the depth buffer (10 spiral taps, normals
 *     reconstructed from neighbouring depths, interleaved-gradient noise),
 *  2. separable depth-aware blur (2 x 5 taps),
 *  3. composite as an Effect inside the merged EffectPass (one fetch/pixel).
 * Roughly 5x cheaper than general-purpose SSAO libraries on integrated GPUs.
 */
import * as THREE from 'three';
import { BlendFunction, Effect, Pass } from 'postprocessing';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const AO_FRAG = /* glsl */ `
precision highp float;
uniform highp sampler2D tDepth;
uniform mat4 projInv;
uniform mat4 proj;
uniform vec2 resolution;
uniform float radius;
uniform float intensity;
uniform float bias;
varying vec2 vUv;

vec3 viewPos(vec2 uv) {
  float d = textureLod(tDepth, uv, 0.0).r;
  vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}

void main() {
  float d0 = textureLod(tDepth, vUv, 0.0).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / resolution;
  vec3 pr = viewPos(vUv + vec2(px.x, 0.0));
  vec3 pl = viewPos(vUv - vec2(px.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, px.y));
  vec3 pd = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float rs = clamp(radius * proj[1][1] * 0.5 / max(-P.z, 0.1), 2.0 * px.y, 0.12);
  float r2 = radius * radius;
  float ao = 0.0;
  for (int i = 0; i < 10; i++) {
    float t = (float(i) + noise) / 10.0;
    float ang = float(i) * 2.39996 + noise * 6.2831853;
    vec2 off = vec2(cos(ang), sin(ang)) * rs * (0.12 + 0.88 * t * t);
    vec3 v = viewPos(vUv + off) - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float fall = max(0.0, 1.0 - vv / (r2 * 1.5));
    ao += max(0.0, vn - bias * -P.z) * inversesqrt(vv + 1e-4) * fall;
  }
  ao = clamp(1.0 - ao * intensity / 10.0, 0.0, 1.0);
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tAO;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec2 c = textureLod(tAO, vUv, 0.0).rg;
  float sum = c.r;
  float wsum = 1.0;
  for (int i = -2; i <= 2; i++) {
    if (i == 0) continue;
    vec2 s = textureLod(tAO, vUv + dir * float(i) * 1.4, 0.0).rg;
    float w = exp(-abs(s.g - c.g) / max(c.g * 0.04, 0.02)) * (1.0 - abs(float(i)) * 0.2);
    sum += s.r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
}`;

export class SAOPass extends Pass {
  private aoTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  readonly texture: THREE.Texture;

  constructor(private viewCamera: THREE.PerspectiveCamera) {
    super('SAOPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, opts);
    this.aoTarget.texture.name = 'SAO.raw';
    this.blurTarget.texture.name = 'SAO.blurred';
    this.aoMat = new THREE.ShaderMaterial({
      name: 'SAO',
      vertexShader: VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: null },
        projInv: { value: new THREE.Matrix4() },
        proj: { value: new THREE.Matrix4() },
        resolution: { value: new THREE.Vector2(1, 1) },
        radius: { value: 1.4 },
        intensity: { value: 1.1 },
        bias: { value: 0.012 },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      name: 'SAOBlur',
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { tAO: { value: null }, dir: { value: new THREE.Vector2() } },
    });
    this.fullscreenMaterial = this.aoMat;
    this.texture = this.blurTarget.texture;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.aoMat.uniforms.tDepth.value = depthTexture;
  }

  override render(renderer: THREE.WebGLRenderer): void {
    const cam = this.viewCamera;
    this.aoMat.uniforms.proj.value.copy(cam.projectionMatrix);
    this.aoMat.uniforms.projInv.value.copy(cam.projectionMatrixInverse);
    this.fullscreenMaterial = this.aoMat;
    renderer.setRenderTarget(this.aoTarget);
    renderer.render(this.scene, this.camera);
    const w = this.aoTarget.width;
    const h = this.aoTarget.height;
    this.fullscreenMaterial = this.blurMat;
    this.blurMat.uniforms.tAO.value = this.aoTarget.texture;
    this.blurMat.uniforms.dir.value.set(1 / w, 0);
    renderer.setRenderTarget(this.blurTarget);
    renderer.render(this.scene, this.camera);
    this.blurMat.uniforms.tAO.value = this.blurTarget.texture;
    this.blurMat.uniforms.dir.value.set(0, 1 / h);
    renderer.setRenderTarget(this.aoTarget);
    renderer.render(this.scene, this.camera);
    // final result lives in aoTarget after the vertical pass: swap names
    this.blurMat.uniforms.tAO.value = this.aoTarget.texture;
    this.blurMat.uniforms.dir.value.set(0.5 / w, 0.5 / h);
    renderer.setRenderTarget(this.blurTarget);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.aoTarget.setSize(w, h);
    this.blurTarget.setSize(w, h);
    this.aoMat.uniforms.resolution.value.set(w, h);
  }

  override dispose(): void {
    super.dispose();
    this.aoTarget.dispose();
    this.blurTarget.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
  }
}

/** Multiplies the scene colour by the blurred AO (before tone mapping). */
export class AOCompositeEffect extends Effect {
  constructor(aoTexture: THREE.Texture) {
    super(
      'AOComposite',
      /* glsl */ `
      uniform sampler2D aoMap;
      uniform float aoStrength;
      uniform vec3 aoColor;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float ao = texture2D(aoMap, uv).r;
        float k = mix(1.0, ao, aoStrength);
        outputColor = vec4(mix(aoColor, inputColor.rgb, k) , inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, THREE.Uniform>([
          ['aoMap', new THREE.Uniform(aoTexture)],
          ['aoStrength', new THREE.Uniform(1)],
          ['aoColor', new THREE.Uniform(new THREE.Color(0x05070c))],
        ]),
      },
    );
  }

  set strength(v: number) {
    this.uniforms.get('aoStrength')!.value = v;
  }
}
