import * as THREE from 'three';
import { WeatherMode } from '../core/QualityManager';
import { clamp, lerp, smoothstep } from '../utils/math';

/**
 * Dynamic Day/Night Cycle, Procedural Sky Dome, Sun/Moon Directional Lighting,
 * Atmospheric Fog, Rainstorm Streaks, and Nocturnal Bioluminescent Fireflies.
 */
export class SkyWeatherSystem {
  public sunLight: THREE.DirectionalLight;
  public ambientLight: THREE.HemisphereLight;
  public skyMesh: THREE.Mesh;
  public skyMaterial: THREE.ShaderMaterial;
  public fog: THREE.FogExp2;

  public sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  public sunColor = new THREE.Color(0xfff3d6);
  public skyZenithColor = new THREE.Color(0x2b6cb0);
  public skyHorizonColor = new THREE.Color(0x90cdf4);
  public currentFogColor = new THREE.Color(0x8bb8e8);

  // Weather particle systems
  private rainPoints: THREE.Points;
  private rainMat: THREE.PointsMaterial;
  private fireflyPoints: THREE.Points;
  private fireflyMat: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene) {
    // 1. Exponential atmospheric fog
    this.fog = new THREE.FogExp2(0x8bb8e8, 0.0055);
    this.scene.fog = this.fog;

    // 2. Hemisphere ambient fill + Directional Sun/Moon shadow caster
    this.ambientLight = new THREE.HemisphereLight(0x87b8f5, 0x38482f, 0.65);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4dc, 2.4);
    this.sunLight.position.set(35, 55, 25);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 140;
    const d = 36;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 3. Procedural Sky Dome with Sun Disc, Moon Disc, Horizon Glow, and Night Stars
    const skyGeo = new THREE.SphereGeometry(210, 32, 24);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDir.clone() },
        uZenithColor: { value: this.skyZenithColor.clone() },
        uHorizonColor: { value: this.skyHorizonColor.clone() },
        uSunColor: { value: this.sunColor.clone() },
        uNightFactor: { value: 0.0 },
        uTime: { value: 0.0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uZenithColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        uniform float uNightFactor;
        uniform float uTime;
        varying vec3 vWorldDir;

        float starHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float y = clamp(dir.y, 0.0, 1.0);

          // Sky gradient from horizon to zenith
          vec3 sky = mix(uHorizonColor, uZenithColor, pow(y, 0.55));

          // Mie scattering glow around sun
          float sunDot = max(dot(dir, uSunDir), 0.0);
          float sunHalo = pow(sunDot, 12.0) * 0.45 + pow(sunDot, 220.0) * 1.4;
          sky += uSunColor * sunHalo * (1.0 - uNightFactor * 0.85);

          // Crisp Sun disc
          float sunDisc = smoothstep(0.9982, 0.9994, dot(dir, uSunDir));
          sky = mix(sky, uSunColor * 2.0, sunDisc * (1.0 - uNightFactor));

          // Opposite Moon disc & silver halo at night
          vec3 moonDir = -uSunDir;
          float moonDot = max(dot(dir, moonDir), 0.0);
          float moonDisc = smoothstep(0.9985, 0.9993, moonDot);
          float moonHalo = pow(moonDot, 24.0) * 0.35;
          sky += vec3(0.55, 0.72, 0.98) * moonHalo * uNightFactor;
          sky = mix(sky, vec3(0.92, 0.96, 1.0) * 1.5, moonDisc * uNightFactor);

          // Procedural twinkling starfield at night
          if (uNightFactor > 0.05 && dir.y > 0.02) {
            vec3 starCell = floor(dir * 260.0);
            float h = starHash(starCell);
            if (h > 0.992) {
              float twinkle = 0.65 + 0.35 * sin(uTime * 3.5 + h * 100.0);
              float starIntensity = smoothstep(0.992, 1.0, h) * twinkle * uNightFactor * smoothstep(0.02, 0.25, dir.y);
              sky += vec3(0.88, 0.93, 1.0) * starIntensity * 1.8;
            }
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.scene.add(this.skyMesh);

    // 4. Weather: Rain / Alpine Mist Particles
    const rainCount = 1600;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 90;
      rainPositions[i * 3 + 1] = Math.random() * 35;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0xa8ccf0,
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    this.rainPoints = new THREE.Points(rainGeo, this.rainMat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);

    // 5. Nocturnal Fireflies / Floating Pollen Motes
    const fireflyCount = 260;
    const ffPos = new Float32Array(fireflyCount * 3);
    const ffPhase = new Float32Array(fireflyCount);
    for (let i = 0; i < fireflyCount; i++) {
      ffPos[i * 3] = (Math.random() - 0.5) * 110;
      ffPos[i * 3 + 1] = 0.5 + Math.random() * 4.5;
      ffPos[i * 3 + 2] = (Math.random() - 0.5) * 110;
      ffPhase[i] = Math.random() * Math.PI * 2;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    ffGeo.setAttribute('aPhase', new THREE.BufferAttribute(ffPhase, 1));

    this.fireflyMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uGlowStrength: { value: 0.5 }
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.9 + aPhase) * 0.8;
          p.y += cos(uTime * 1.3 + aPhase * 1.7) * 0.45;
          p.z += cos(uTime * 0.8 + aPhase * 2.3) * 0.8;
          vAlpha = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 3.2 + aPhase * 4.0));
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(42.0 / -mvPosition.z, 2.0, 12.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGlowStrength;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float radial = smoothstep(0.5, 0.05, d);
          vec3 col = vec3(0.68, 0.96, 0.32);
          gl_FragColor = vec4(col * 1.4, radial * vAlpha * uGlowStrength);
        }
      `
    });

    this.fireflyPoints = new THREE.Points(ffGeo, this.fireflyMat);
    this.scene.add(this.fireflyPoints);
  }

  private static readonly DAY_ZENITH = new THREE.Color(0x1f5fa8);
  private static readonly DAY_HORIZON = new THREE.Color(0x8ac4f4);
  private static readonly DUSK_ZENITH = new THREE.Color(0x282454);
  private static readonly DUSK_HORIZON = new THREE.Color(0xe87a48);
  private static readonly NIGHT_ZENITH = new THREE.Color(0x060b16);
  private static readonly NIGHT_HORIZON = new THREE.Color(0x122038);
  private static readonly DAY_SUN = new THREE.Color(0xfff5e0);
  private static readonly DUSK_SUN = new THREE.Color(0xff8438);
  private static readonly MOON_COLOR = new THREE.Color(0x8cb4f5);
  private static readonly STORM_GRAY = new THREE.Color(0x3b4859);
  private tempLightDir = new THREE.Vector3();

  update(
    dt: number,
    elapsed: number,
    timeOfDay: number,
    weather: WeatherMode,
    focusPos: THREE.Vector3
  ): void {
    // 1. Compute Sun Orbit Angle from timeOfDay (6:00 = sunrise, 12:00 = noon, 18:00 = sunset)
    const sunAngle = ((timeOfDay - 6.0) / 24.0) * Math.PI * 2;
    const sunElevation = Math.sin(sunAngle);
    const sunAzimuth = Math.cos(sunAngle);

    this.sunDir.set(sunAzimuth * 0.85, sunElevation, 0.38).normalize();

    const nightFactor = smoothstep(0.08, -0.22, sunElevation);
    const goldenHourFactor = smoothstep(0.38, 0.0, Math.abs(sunElevation)) * (1.0 - smoothstep(-0.12, -0.28, sunElevation));

    // 2. Interpolate Sky, Sun, Ambient, and Fog Palettes (zero allocations)
    this.skyZenithColor
      .copy(SkyWeatherSystem.DAY_ZENITH)
      .lerp(SkyWeatherSystem.DUSK_ZENITH, goldenHourFactor)
      .lerp(SkyWeatherSystem.NIGHT_ZENITH, nightFactor);
    this.skyHorizonColor
      .copy(SkyWeatherSystem.DAY_HORIZON)
      .lerp(SkyWeatherSystem.DUSK_HORIZON, goldenHourFactor)
      .lerp(SkyWeatherSystem.NIGHT_HORIZON, nightFactor);

    this.sunColor
      .copy(SkyWeatherSystem.DAY_SUN)
      .lerp(SkyWeatherSystem.DUSK_SUN, goldenHourFactor)
      .lerp(SkyWeatherSystem.MOON_COLOR, nightFactor);

    const weatherDim = weather === 'rain' ? 0.62 : weather === 'mist' ? 0.78 : 1.0;
    if (weather === 'rain') {
      this.skyZenithColor.lerp(SkyWeatherSystem.STORM_GRAY, 0.65);
      this.skyHorizonColor.lerp(SkyWeatherSystem.STORM_GRAY, 0.65);
    }

    // Position directional light along active celestial body (Sun during day, Moon at night)
    this.tempLightDir.copy(this.sunDir);
    if (nightFactor > 0.6) this.tempLightDir.negate();
    const lightDist = 60;
    this.sunLight.position.set(
      focusPos.x + this.tempLightDir.x * lightDist,
      Math.max(18, this.tempLightDir.y * lightDist),
      focusPos.z + this.tempLightDir.z * lightDist
    );
    this.sunLight.target.position.copy(focusPos);
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = lerp(2.5, 1.15, nightFactor) * weatherDim;

    this.ambientLight.color.copy(this.skyHorizonColor);
    this.ambientLight.groundColor.setRGB(
      lerp(0.24, 0.12, nightFactor),
      lerp(0.28, 0.15, nightFactor),
      lerp(0.20, 0.22, nightFactor)
    );
    this.ambientLight.intensity = lerp(0.80, 0.58, nightFactor);

    // Update Fog
    this.currentFogColor.copy(this.skyHorizonColor);
    this.fog.color.copy(this.currentFogColor);
    const baseFog = weather === 'rain' ? 0.011 : weather === 'mist' ? 0.014 : 0.0045;
    this.fog.density = baseFog;

    // Update Sky Dome
    this.skyMesh.position.copy(focusPos);
    this.skyMaterial.uniforms.uSunDir.value.copy(this.sunDir);
    this.skyMaterial.uniforms.uZenithColor.value.copy(this.skyZenithColor);
    this.skyMaterial.uniforms.uHorizonColor.value.copy(this.skyHorizonColor);
    this.skyMaterial.uniforms.uSunColor.value.copy(this.sunColor);
    this.skyMaterial.uniforms.uNightFactor.value = nightFactor;
    this.skyMaterial.uniforms.uTime.value = elapsed;

    // 3. Update Weather Particles (Rain / Mist)
    this.rainPoints.visible = weather !== 'clear';
    if (this.rainPoints.visible) {
      const posAttr = this.rainPoints.geometry.attributes.position as THREE.BufferAttribute;
      const fallSpeed = weather === 'rain' ? 24.0 : 3.5;
      this.rainMat.size = weather === 'rain' ? 0.22 : 0.35;
      this.rainMat.color.setHex(weather === 'rain' ? 0x9ec5eb : 0xdbe9f7);

      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) - fallSpeed * dt;
        let x = posAttr.getX(i) + (weather === 'rain' ? 3.5 : 1.2) * dt;
        if (y < 0) {
          y = 32;
          x = focusPos.x + (Math.random() - 0.5) * 85;
          posAttr.setZ(i, focusPos.z + (Math.random() - 0.5) * 85);
        }
        posAttr.setX(i, x);
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }

    // 4. Update Fireflies (brightest at dusk/night, subtle golden pollen in daylight)
    this.fireflyMat.uniforms.uTime.value = elapsed;
    this.fireflyMat.uniforms.uGlowStrength.value = clamp(nightFactor * 0.95 + goldenHourFactor * 0.65 + 0.18, 0.18, 1.0);
  }
}
