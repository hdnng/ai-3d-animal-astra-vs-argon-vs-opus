# LUPUS // Procedural 3D Timber Wolf Ecosystem Simulator

An interactive, 100% procedural 3D simulation of an **Alpha Timber Wolf (*Canis lupus*)** and its pack living in a dynamic alpine river valley ecosystem. Built with **Three.js**, **TypeScript**, **Vite**, and the **Web Audio API** with zero external asset files.

---

## Quick Start (One Command)

```bash
npm install && npm run dev
```

Then open **`http://127.0.0.1:5173`** in any modern browser.

### Additional Verification & Benchmark Commands

| Command | Description |
| :--- | :--- |
| `npm run build` | Type-checks with TypeScript (`tsc`) and builds the production bundle (`dist/`). |
| `npm test` | Runs the automated Playwright headless Chromium smoke test & captures 5 verification screenshots into `screenshots/`. |
| `npm run bench` | Runs a 30-second headless Chromium D3D11 benchmark and writes metrics to `bench-results.json`. |
| `npm run longrun` | Runs a 5-minute simulated stress & memory-leak verification test (9,000 steps + periodic resets). |

---

## Controls

| Input | Action |
| :--- | :--- |
| **`Tab`** (or HUD button) | Toggle between **AI Autonomy** and **Manual Control** |
| **`W` `A` `S` `D`** / **Arrow Keys** | Move forward / backward & steer left / right (Manual Mode) |
| **`Shift`** | Sprint / Rotary Gallop |
| **`Space`** | Jump over terrain |
| **`1`** or **`H`** | Trigger **Howl** (packmates answer in chorus!) |
| **`2`** or **`P`** | Trigger **Pounce** leap attack |
| **`3`** or **`K`** | Trigger **Shake-Off** (rotary body fur shake) |
| **`4`** or **`R`** | Trigger **Rest / Sleep** posture to recover stamina |
| **`E`** | Eat at forage site or Drink at river shoreline (Manual Mode) |
| **`C`** | Cycle Camera Mode (**Follow** → **Orbit** → **Cinematic Auto-Orbit**) |
| **`V`** | Toggle 34-bone **Skeleton Rig** debug overlay |
| **`M`** | Toggle procedural Web Audio soundscape mute |
| **Mouse Drag + Scroll Wheel** | Orbit camera angle & zoom distance |

---

## Features Checklist

- **100% Procedural Assets**: Every mesh, skeleton, skin-weight map, fur shader, water ripple, sky dome, particle, and sound effect is generated purely in TypeScript/GLSL/Web Audio code.
- **34-Bone Hierarchical Quadruped Skeleton & Lofted SkinnedMesh**:
  - Articulated `root`, `pelvis`, 3-segment spine (`spine1..3`), 2-segment neck (`neck1..2`), `head`, `jaw`, `earL`/`earR`, blinking `eyelidL`/`eyelidR`, 5-bone tail chain (`tail1..5`), and 4 limbs (`shoulder/hip` → `upper` → `lower` → `paw`).
  - Smooth anatomical cross-section lofting with multi-bone distance skin weights and an anisotropic guard-hair fur shader (`WolfMeshBuilder.ts`).
- **Blended State Machine, Secondary Spring Physics & Terrain Foot IK**:
  - Blended transitions across `idle`, `walk`, `run`, `swim`, `turn`, `rest`, `sleep`, `eat`, `drink`, `jump`, `howl`, `pounce`, and `shake`.
  - Analytic 2-bone limb IK (`solveTwoBoneIK`) queries exact terrain height under each paw so feet never float or sink, while the torso pitches and rolls to match terrain slopes.
  - Second-order spring-damper physics (`SpringDamper1D`/`3D`) drive spine turn lag, multi-bone tail wag propagation, ear bounce, breathing ribcage expansion, head look-at, and random blinking.
- **Utility AI & Living Ecosystem (91 Active Entities)**:
  - Utility AI (`WolfAI.ts`) continuously scores `hunger`, `thirst`, `energy`, and `curiosity` to autonomously hunt hares, forage at carcasses/berry bushes, drink at the river shoreline, rest, howl with the pack, or patrol territory while avoiding tree/rock obstacles.
  - **Pack Companion Wolves (3)** (`silver`, `tundra`, `russet` coats) move in flank formation with separation steering and answer the Alpha's howl.
  - **Mountain Hares (32 instanced)** graze, hop across meadows, and flee in zig-zag bounds when a wolf approaches.
  - **Alpine River Trout (55 instanced)** swim along the meandering river channel with vertex-shader S-wave tail undulation.
- **Procedural World, Day/Night Cycle, Weather & Post-Processing**:
  - Multi-octave Perlin/Simplex FBM + ridged multifractal mountain amphitheater and meandering river/lake basin (`Terrain.ts`).
  - Custom GLSL animated water shader with Gerstner ripples, Fresnel sky reflection, sun specular glitter, and shore foam (`Water.ts`).
  - Instanced wind-animated pine trees, golden birches, bushes, alpine wildflowers, mossy boulders, and 2,400 upward-normal meadow grass clusters (`Vegetation.ts`).
  - Dynamic 24-hour sun/moon sky dome with twinkling night stars, mountain rainstorm & alpine mist weather, and glowing nocturnal fireflies (`SkyWeather.ts`).
  - Single-pass custom `PostProcessor` combining depth-reconstructed Screen-Space Ambient Occlusion (SSAO), soft highlight Bloom, ACES filmic tone mapping, and vignette (`PostProcessor.ts`).
- **Procedural Web Audio Synthesizer**:
  - Real-time synthesis of dry/water footsteps, mountain wind, river stream babble, multi-harmonic formant-filtered wolf howls, and generative pentatonic ambient pads (`ProceduralAudio.ts`).

---

## Architecture Overview

```text
src/
├── main.ts                  # Application entry point & global simulation hook
├── core/
│   ├── Engine.ts            # Main simulation loop, subsystem coordinator & resize/disposal
│   ├── Clock.ts             # Delta timer, 24h day/night clock & rolling FPS telemetry
│   ├── Input.ts             # Keyboard & pointer/wheel input state manager
│   └── QualityManager.ts    # Graphics settings & adaptive FPS auto-scaler
├── animal/
│   ├── WolfMeshBuilder.ts   # 34-bone skeleton builder, lofted SkinnedMesh & fur shader
│   ├── WolfAnimator.ts      # Gait state machine, 2-bone terrain IK & spring secondary motion
│   └── WolfEntity.ts        # Wolf kinematics, biological needs, obstacle collision & actions
├── ai/
│   └── WolfAI.ts            # Utility AI decision engine, steering avoidance & debug vectors
├── world/
│   ├── Terrain.ts           # Multi-octave FBM & ridged mountain terrain + shoreline solver
│   ├── Water.ts             # Animated GLSL water surface with Fresnel & foam
│   ├── Vegetation.ts        # Instanced trees, grass, flowers, rocks & forage sites
│   ├── SkyWeather.ts        # Dynamic sun/moon sky dome, shadows, rain & fireflies
│   └── Ecosystem.ts         # Companion pack wolves, instanced hares & instanced trout
├── render/
│   ├── CameraRig.ts         # Spring-damped Follow, Orbit & Cinematic camera modes
│   ├── PostProcessor.ts     # Depth-based SSAO, Bloom, ACES tone mapping & Vignette
│   └── ParticlePool.ts      # Zero-allocation pooled dust, water splash & breath mist particles
├── audio/
│   └── ProceduralAudio.ts   # Pure Web Audio API foley, howl & ambient synthesizer
├── ui/
│   └── HUDManager.ts        # Telemetry HUD, need bars, 3D thought bubble & settings panel
└── utils/
    ├── math.ts              # 2-bone IK solver, SpringDamper1D/3D & math helpers
    ├── noise.ts             # Seeded PRNG, 2D Perlin, FBM & ridged multifractal noise
    └── dispose.ts           # Recursive Three.js GPU geometry/material/texture disposal
```

---

## Benchmark & Verification Results

Measured via `npm run bench` (30-second headless Chromium benchmark on `Intel(R) UHD Graphics 620 Direct3D11` at `1280×720`) and `npm run longrun` (5-minute simulated stress & leak test):

- **Average FPS**: **60.68 FPS** (`16.48 ms` average frame time)
- **1% Low FPS**: **18.62 FPS** (`53.70 ms` p99 frame time)
- **Draw Calls / Frame**: **33** (with 91 active entities and thousands of instanced flora elements)
- **Triangles / Frame**: **208,318** (including shadow map pass)
- **Memory Stability**: **22.03 MB start → 22.03 MB end (`0.00 MB` delta)** over 30s benchmark; **0 GPU geometry/texture leaks** and **0.00 MB heap growth** across 300 simulated seconds and multiple full resets.
- **Production Bundle Size (`npm run build`)**:
  - App code (`dist/assets/index-*.js`): **98.20 kB** (**30.35 kB** gzipped)
  - Three.js vendor chunk (`dist/assets/three-*.js`): **487.65 kB** (**123.05 kB** gzipped)

---

## Known Limitations

- **Headless Software Rasterizer Fallback**: If run in an environment without a hardware GPU or D3D11/OpenGL driver (falling back to CPU SwiftShader), adaptive quality will automatically step down resolution scale, shadow map size, and post-processing to maintain interactivity.
- **Browser Audio Autoplay Policy**: Web browsers suspend `AudioContext` until the first user key press or pointer click on the page, after which the procedural soundscape fades in automatically.
