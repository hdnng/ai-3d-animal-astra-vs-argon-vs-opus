import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { heightAt } from "../world/terrain";
export type CameraMode = "follow" | "orbit" | "cinematic";
export class Renderer {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(43, 1, 0.1, 180);
  renderer: T.WebGLRenderer;
  controls: OrbitControls;
  composer: EffectComposer;
  sun = new T.DirectionalLight("#ffe1ad", 3);
  moon = new T.DirectionalLight("#95bbec", 0.1);
  moonDisc = new T.Mesh(
    new T.SphereGeometry(0.9, 16, 12),
    new T.MeshBasicMaterial({ color: "#dde8ed", fog: false }),
  );
  hemi = new T.HemisphereLight("#c9e2da", "#595331", 2);
  fill = new T.DirectionalLight("#c4d9e4", 0.85);
  mode: CameraMode = "follow";
  post = true;
  scale = 0.9;
  adaptive = true;
  quality = "medium";
  autoAngle = 0;
  sky: T.Mesh;
  skyUniforms = {
    sun: { value: new T.Vector3(0, 1, 0) },
    day: { value: 1 },
    time: { value: 0 },
  };
  private target = new T.Vector3();
  private desired = new T.Vector3();
  private resizeHandler = () => this.resize();
  private ao: ShaderPass;
  private shadowTimer = 1;
  constructor(container: HTMLElement) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three dimensional woodland",
    );
    this.camera.position.set(4, 4, 10);
    this.scene.fog = new T.FogExp2("#bac7ac", 0.018);
    this.scene.add(
      this.hemi,
      this.sun,
      this.sun.target,
      this.moon,
      this.fill,
      this.fill.target,
      this.moonDisc,
    );
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -15,
      right: 15,
      top: 15,
      bottom: -15,
      near: 0.5,
      far: 90,
    });
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.sky = new T.Mesh(
      new T.SphereGeometry(120, 24, 16),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        uniforms: this.skyUniforms,
        vertexShader:
          "varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `varying vec3 vP;uniform vec3 sun;uniform float day;uniform float time;void main(){vec3 d=normalize(vP);float h=pow(max(d.y,0.),.48);vec3 col=mix(vec3(.68,.74,.65),vec3(.22,.43,.48),h);vec3 night=mix(vec3(.065,.12,.19),vec3(.012,.027,.075),h);col=mix(night,col,day);float s=max(0.,dot(d,normalize(sun)));col+=vec3(1.,.72,.34)*pow(s,350.)*day;float stars=step(.9986,fract(sin(dot(floor(d.xz/(abs(d.y)+.2)*500.),vec2(12.9,78.2)))*43758.54));col+=stars*(1.-day)*max(d.y,0.)*.7;gl_FragColor=vec4(col,1.);}`,
      }),
    );
    this.scene.add(this.sky);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 32;
    this.controls.enablePan = false;
    this.controls.addEventListener("start", () => {
      if (this.mode === "cinematic") this.mode = "orbit";
    });
    const rt = new T.WebGLRenderTarget(innerWidth, innerHeight, {
      type: T.HalfFloatType,
    });
    rt.depthTexture = new T.DepthTexture(innerWidth, innerHeight);
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // A single depth-based ambient-occlusion pass avoids an extra normal-buffer scene render.
    this.ao = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        pixel: { value: new T.Vector2(1 / innerWidth, 1 / innerHeight) },
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `uniform sampler2D tDiffuse;uniform sampler2D tDepth;uniform vec2 pixel;varying vec2 vUv;float linearDepth(vec2 uv){float d=texture2D(tDepth,uv).r;return 18./(180.1-d*179.9);}void main(){vec3 color=texture2D(tDiffuse,vUv).rgb;float center=linearDepth(vUv);float occlusion=0.;for(int i=0;i<8;i++){float a=float(i)*.7854;float nearD=linearDepth(vUv+vec2(cos(a),sin(a))*pixel*4.);float delta=center-nearD;occlusion+=smoothstep(.018,.14,delta)*(1.-smoothstep(.2,.8,delta));}gl_FragColor=vec4(color*(1.-occlusion*.035),1.);}`,
    });
    this.composer.addPass(this.ao);
    this.composer.addPass(
      new UnrealBloomPass(new T.Vector2(800, 600), 0.13, 0.65, 1.05),
    );
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader:
          "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float v=1.-.25*pow(length((vUv-.5)*1.3),1.5);gl_FragColor=vec4(c*v,1.);}",
      }),
    );
    this.composer.addPass(new OutputPass());
    window.addEventListener("resize", this.resizeHandler);
    this.resize();
  }
  resize() {
    const w = innerWidth,
      h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * this.scale);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * this.scale);
    this.composer.setSize(w, h);
  }
  setScale(s: number) {
    this.scale = s;
    this.resize();
  }
  setShadows(q: string) {
    this.quality = q;
    this.sun.castShadow = q !== "off";
    const n = q === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
  }
  /** Compile the adaptive render paths before play, avoiding first-switch shader stalls. */
  async warmup() {
    this.renderer.setRenderTarget(this.composer.readBuffer);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.sun.castShadow = false;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.sun.castShadow = this.quality !== "off";
    this.renderer.shadowMap.needsUpdate = true;
  }
  update(dt: number, position: T.Vector3, hour: number, time: number) {
    this.shadowTimer += dt;
    if (this.shadowTimer > 1 / 24) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowTimer = 0;
    }
    const angle = ((hour - 6) / 24) * Math.PI * 2,
      day = T.MathUtils.smoothstep(Math.sin(angle), -0.16, 0.35);
    this.skyUniforms.day.value = day;
    this.skyUniforms.time.value = time;
    this.skyUniforms.sun.value.set(Math.cos(angle), Math.sin(angle), -0.35);
    this.sun.position
      .copy(position)
      .addScaledVector(this.skyUniforms.sun.value, 35);
    this.sun.target.position.copy(position);
    this.sun.intensity = day * 3.4;
    this.sun.color.setHSL(0.08 + day * 0.025, 0.42, 0.83);
    const twilight =
      1 - T.MathUtils.smoothstep(Math.abs(Math.sin(angle)), 0.02, 0.55);
    this.sun.color.lerp(new T.Color("#ffbb83"), twilight * 0.5);
    this.moon.position
      .copy(position)
      .addScaledVector(this.skyUniforms.sun.value, -35);
    this.moonDisc.position
      .copy(this.skyUniforms.sun.value)
      .normalize()
      .multiplyScalar(-80)
      .add(position);
    this.moon.intensity = (1 - day) * 1.5;
    this.hemi.intensity = 0.75 + day * 1.25;
    this.fill.position.copy(this.camera.position);
    this.fill.target.position.copy(position);
    this.fill.intensity = 0.6 + day * 0.3;
    (this.scene.fog as T.FogExp2).color
      .set("#182e40")
      .lerp(
        new T.Color("#bac7ac").lerp(new T.Color("#d9b89d"), twilight * 0.4),
        day,
      );
    this.sky.position.copy(this.camera.position);
    if (this.mode === "cinematic") {
      this.autoAngle += dt * 0.1;
      this.desired.set(
        Math.sin(this.autoAngle) * 9,
        3.6 + Math.sin(time * 0.13) * 0.7,
        Math.cos(this.autoAngle) * 9,
      );
      this.desired.add(position);
      this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 2));
      this.controls.target.lerp(
        this.target.copy(position).add(new T.Vector3(0, 0.7, 0)),
        1 - Math.exp(-dt * 3),
      );
    } else if (this.mode === "follow") {
      this.target.copy(position).add(new T.Vector3(0, 0.8, 0));
      this.desired.copy(this.target).sub(this.controls.target);
      this.camera.position.addScaledVector(this.desired, 1 - Math.exp(-dt * 3));
      this.controls.target.lerp(this.target, 1 - Math.exp(-dt * 3));
    }
    this.controls.update();
    this.camera.position.y = Math.max(
      this.camera.position.y,
      heightAt(this.camera.position.x, this.camera.position.z) + 0.45,
    );
  }
  render() {
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.post) {
      this.ao.uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
      this.ao.uniforms.pixel.value.set(
        1 / (innerWidth * this.scale),
        1 / (innerHeight * this.scale),
      );
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    window.removeEventListener("resize", this.resizeHandler);
    this.controls.dispose();
    this.composer.passes.forEach((p) => p.dispose());
    this.composer.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      const m = o as T.Mesh;
      if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
      if (o instanceof T.InstancedMesh) o.dispose();
      if (m.geometry) geometries.add(m.geometry);
      if (m.material)
        (Array.isArray(m.material) ? m.material : [m.material]).forEach(
          (mat) => {
            materials.add(mat);
            Object.values(mat).forEach((v) => {
              if (v instanceof T.Texture) textures.add(v);
            });
          },
        );
    });
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
    this.sun.shadow.dispose();
    this.ao.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
