# Lupus: a procedural grey-wolf ecosystem

A real-time 3D wolf simulator that runs in the browser. A pack of grey wolves
lives in a small mountain valley with deer, hares, birds, fish and butterflies,
through a full day/night cycle with weather. **Everything is procedural**: the
terrain, the wolf's skinned and furred body, vegetation, sky, water, particles,
textures and all audio are generated in code. The project has no asset files.

![Golden hour, follow camera with HUD](screenshots/01_golden_hour_follow_hud.png)

## Run it

```bash
npm install && npm run dev
```

Then open **http://localhost:5173** and click anywhere to enter the valley (the
click also unlocks audio). Requires Node 20.19+ (or 22.12+) and a WebGL2
browser (Chrome, Edge, Firefox or Safari 15+).

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc --noEmit`) and production build into `dist/` |
| `npm run preview` | Serve the production build (port 4173) |
| `npm test` | Playwright smoke test in headless Chromium (`tests/smoke.spec.ts`) |
| `npm run screenshots` | Regenerate the 9 showcase screenshots in `screenshots/` |
| `npm run bench` | 30 s benchmark of the production build, writes `bench-results.json` |
| `npm run longrun` | 5 minutes of simulated time; checks for crashes and leaks, writes `longrun-results.json` |
| `npm run typecheck` | TypeScript only |

The test, screenshot, bench and long-run scripts download Playwright's Chromium
automatically on first use (`scripts/ensure-browser.mjs`).

URL parameters: `?seed=123` (different valley), `?time=21.5` (start hour),
`?autostart` (skip the start screen), `?fixed` (disable adaptive quality).

## Controls

| Input | Action |
| --- | --- |
| **W A S D / Arrows** | Move, relative to the camera (pressing one takes manual control) |
| **Shift** | Run (trot, then gallop) |
| **Ctrl / Alt** | Walk slowly |
| **Space** | Jump |
| **F** | Pounce (toward a nearby hare) |
| **Q** | Howl (the pack joins in) |
| **E** | Context action: eat a carcass, drink at water, otherwise sniff |
| **R** | Shake off water |
| **Z / X** | Sit / lie down (lying long enough becomes sleep) |
| **V / B** | Sniff / play bow |
| **T** | Toggle AI and manual control |
| **C**, **1 2 3** | Cycle camera, or pick follow / orbit / cinematic |
| **Mouse drag / wheel** | Rotate / zoom the camera |
| **M / O / H / F3** | Mute / settings / help / debug overlay |
| **U** | Hide the HUD (photo mode) |
| **[ / ]** | Slow down / speed up time |

The HUD buttons (camera, AI, mute, settings, debug, reset, help) do the same
things with the mouse.

## Features

**The wolf**
- A real hierarchical skeleton of about 35 bones: pelvis, spine, chest, a ribs
  bone for breathing, a two-segment neck, head, jaw, two ears, a six-segment
  tail chain, and four legs (scapula/thigh, upper, lower, metacarpal/metatarsal
  and toe).
- An organic body mesh sculpted as a **signed distance field** (smoothly
  unioned ellipsoids and round cones) and polygonised in a Web Worker by a
  Surface Nets mesher (gradient-projected vertices, Newton refinement). Skin
  weights come from how strongly each bone-bound primitive owns a surface
  point, which gives soft joints. Each species has three mesh LODs.
- **Shell-fur** shader (8 shells in one instanced draw) with a 3D-noise strand
  texture, wind flutter and a wet-fur look. The coat pattern is painted
  procedurally: dark saddle, tawny flanks, cream underside, pale face mask and
  dark tail tip. Eyes are merged into the mesh, with a blink shader and night
  **eyeshine**.
- An **animation state machine** of 16 blended states: locomotion (idle,
  walk, trot and gallop blended by speed, plus turning), sit, lie, sleep, eat,
  drink, howl, shake-off, jump, pounce, swim, sniff, stalk, alert, play bow and
  dead (deer). Transitions crossfade, and each state is driven by procedural
  parameters rather than keyframes.
- **Secondary motion** via damped springs. The tail chain and ears swing
  with body and head acceleration, and ears twitch at random. The spine
  lags into and out of turns, arches when braking and flexes with the gallop.
  There is also breathing (a ribs bone), head look-at toward prey, packmates
  and nearby animals, and blinking.
- **Procedural locomotion**: a foot planner with gait phase offsets (lateral
  4-beat walk, diagonal trot, transverse gallop), two-bone + metacarpal
  **IK** onto the terrain heightfield (stance paws stay planted at ground
  height, verified numerically), and body pitch and roll fitted to the four foot contacts on
  slopes. It also has a reach constraint that lowers the body instead of
  over-stretching legs, and swimming in deep water.

**AI and ecosystem**
- **Needs** (hunger, thirst, energy, social, curiosity, plus fear in deer)
  drive a **utility AI**: idle, explore, rest, sleep, drink, hunt (stalk, then
  chase and kill), eat, howl, socialise, shake off and investigate. Each
  option is scored every tick with hysteresis, and the scores are visible
  live in the HUD.
- **A\* pathfinding** on a navigation grid baked from trees, rocks and water,
  with string-pulling and local steering (obstacle avoidance and separation).
- **Pack AI** for the other three wolves: they follow the alpha, join hunts,
  howl together and rest nearby.
- **Deer herd** (7): graze and wander as a herd, turn alert when they notice
  a wolf, then flee around obstacles with limited stamina, and rest at
  night. Kills leave a carcass, and deer respawn later. Deer use the same
  rig and animation system with their own SDF body and antlers.
- **Critters** (one instanced draw call per type, each with simple AI):
  - 26 hares that nibble, then zig-zag to burrows when chased (wolves can
    catch them).
  - 46 birds in a boids flock that land to peck, scatter from wolves and
    roost at night.
  - 22 fish that school in the lake and sometimes leap with a splash.
  - 28 butterflies that flit between flowers by day.
- A **thought bubble** above the wolf plus a HUD panel showing the current
  action, state, needs and utility scores. A minimap shows every animal.

**World**
- **Terrain** from multi-octave simplex fBm with domain warping, ridged
  mountains around the rim and a lake basin. It is generated in a Web Worker
  and rendered as 3-level LOD chunks (with skirts) using a procedural splat
  shader: grass, dry grass, forest floor, dirt, rock, sand and snow, with a
  wet sheen in rain.
- **Water**: an animated normal-mapped surface with Fresnel reflection of the
  sky, a sharp sun glint, a shallow-to-deep tint from the heightmap,
  shoreline foam, and ripple rings and splashes from animals and fish.
- **Vegetation** (all instanced, with distance LOD and frustum culling):
  pines and broadleaf trees in autumn colours, bushes, flowers, mushrooms,
  reeds, lily pads, boulders and fallen logs, about 3,700 instances. There are
  also about **66,000 GPU grass blades** that bend away from animals.
- **Wind** animation on grass, leaves and fur from a shared wind field.
- **Day/night cycle** with a moving sun and moon. The sky shader has an
  atmosphere gradient, a sun disc with Mie glow, a moon with phases,
  twinkling stars, the Milky Way and animated fbm clouds. Light colour, fog
  and ambient light follow the sun.
- **Weather** cycles through clear, cloudy, rain or thunderstorm, then
  clearing:
  - GPU rain streaks (one draw call), lightning and thunder.
  - Ground and fur get wet.
  - Fog thickens in rain and as dawn mist.
  - Fireflies come out at night and pollen drifts in sunlight.

**Rendering**
- Soft PCF **shadows** (blurred, 1024–4096 maps) from a texel-snapped
  directional light that follows the view.
- **Post-processing** (pmndrs `postprocessing`): a custom SAO ambient-occlusion
  pass, mipmap bloom, AgX tone mapping, colour grading, vignette and SMAA.
- **Particles** from pooled GPU billboards: dust puffs from paws, splashes,
  water drops from shaking off, falling leaves, pollen and fireflies. Paw-print
  decals form trails in the dirt.

**Audio** (Web Audio API, fully synthesised)
- **Ambience**: wind, lake water, rain and thunder, crickets and owls at
  night.
- **Creatures**: footsteps by surface, formant-synthesised **wolf howls**
  (each wolf at its own pitch), growls, barks, panting, chewing and lapping,
  deer snorts, and bird chirps and wing flutters.
- **Events**: splashes, shake-offs and landings.
- **Music**: a slow generative pad with occasional plucked notes.

All sounds are spatialised and have a mute toggle (M or the button).

**Camera**
- **Follow** (spring arm with terrain and canopy collision), **orbit**
  (free mouse orbit) and **cinematic** (an auto-director that cuts between
  orbit, tracking, wide, close-up and frontal shots and avoids shots blocked
  by trees). Mode changes interpolate smoothly.

**UI / HUD**
- FPS, frame time and CPU time, draw calls, triangles, quality level and
  entity counts.
- Wolf state, current action and need bars, clock and weather, minimap,
  toasts and a help screen.
- **Settings panel**: shadow quality (off to 4096), resolution scale,
  post-processing, ambient occlusion, bloom, weather on/off and mode, time of
  day, time speed, grass density, fur quality, adaptive quality and music.
- **Debug overlay** (F3): skeleton view (bones and foot contacts), AI
  targets and paths (including deer threat lines), wireframe and live
  utility scores.
- **Reset** button (regenerates the simulation state).

**Performance**
- Instancing for all vegetation, grass, critters, particles and eyes. Mesh
  **LOD** for creatures, trees, rocks and terrain chunks, distance culling and
  frustum culling. Pooled particle buffers and preallocated scratch vectors
  (the hot loop is close to allocation-free).
- **Web Workers** for terrain generation and SDF meshing. Shaders are
  pre-compiled during loading (no hitches on first sight).
- **Adaptive quality**: a controller watches the trimmed-mean frame time and
  walks down an 8-step ladder (AO, then resolution, shadows/grass/fur, bloom,
  …). It steps back up when there is headroom, and the starting step is
  chosen from the GPU tier.
- Proper disposal of every geometry, material, texture and render target on
  reset and teardown (`Disposer`). Handles resizing and `devicePixelRatio`
  (capped at 2).

## Architecture

```
src/
  main.ts            entry: loading screen, URL params, boot
  core/              App (init phases, main loop, settings application), Settings,
                     Input, Events (typed bus), DebugApi (window.__lupus automation hooks)
  animal/            Rig (skeleton), SDFMesher + meshWorker (body meshing), SpeciesBuilder,
                     CreatureMesh (skinned mesh, LOD, eyes), FurMaterial (shells),
                     Pose, Animator + AnimStates (state machine), FootPlanner, Animal (IK, springs)
    species/         Wolf, Deer (proportions, SDF sculpt, coat paint)
  ai/                Needs, WolfBrain (utility AI), PackBrain, DeerBrain,
                     NavGrid (A*), Steering, PlayerController
  eco/               Ecosystem (wolves, deer, kills, carcasses, LOD), Critters (instanced hares,
                     birds, fish, butterflies)
  world/             WorldGen + terrainWorker, Terrain, Water, Sky, DayNight, Weather,
                     Vegetation (+ geometry, InstancedLOD), Grass, Obstacles, World
  render/            Renderer (GPU tiering), CameraRig, PostFX + SAO, Particles, Effects,
                     AdaptiveQuality, DebugDraw, WindMaterial, Uniforms, ProceduralTextures
  audio/             AudioEngine (procedural Web Audio graph)
  ui/                UI (HUD, settings, debug, minimap), CSS
  utils/             math, Random, noise, Spring, SpatialHash, BinaryHeap, Disposer
tests/smoke.spec.ts  Playwright smoke test
scripts/             bench, screenshots, longrun, peek (ad-hoc dev views), shared harness
```

The main loop in `App.tick` runs these steps in order:
1. Input and the player controller.
2. Weather.
3. The ecosystem: AI brains, then `Animal.update` (state machine, foot
   planner, IK, springs), then kills, carcasses and critters.
4. The camera rig.
5. The world: day/night, sky, terrain and vegetation LOD.
6. Creature LOD.
7. Effects, debug lines and audio.
8. Render: shadow map, then the post-processing composer.
9. The HUD.

Simulation uses a clamped variable timestep. `DebugApi.step()` lets the
scripts advance time deterministically without rendering.

## Verification

All checks below were run on the final code:

| Check | Result |
| --- | --- |
| `npm run typecheck` / `npm run build` | 0 errors. Main-thread JS **≈ 988 KB raw / 303 KB gzip** (app 268 KB, three.js 557 KB, postprocessing 163 KB), CSS 7 KB, plus workers loaded on demand (mesher 175 KB, terrain 91 KB). `dist/` is 1.3 MB in total |
| `npm test` (smoke) | **Pass.** Loads the page and runs 5 s. Asserts there are no console errors or warnings and the HUD and FPS are live. Presses T (manual), W, Shift+W (gallop), Space (jump), Q (howl), C (camera), M (mute), O (settings), F3 (debug), T (back to AI) and Reset, checking the state and HUD after each |
| `npm run screenshots` | 9 shots from different cameras and times of day, no console errors. I inspected them and fixed what they showed (see below) |
| `npm run longrun` | **Pass.** 300 s simulated (45–60 s wall) through day, night, storms, camera modes, manual control, resets and post-processing toggles. JS heap growth **+1.0 MB** (forced GC), scene geometries/materials/textures **+0**, 0 errors or warnings |
| Foot IK | Stance paws measured at exactly paw height (error < 1 mm). Swing feet lift, and the trot uses diagonal pairs |

## Benchmark

`npm run bench` builds the production bundle and serves it. It then measures
two configurations in headless Chromium (1280×720, DPR 1): 8 s warm-up, then
30 s of recording. Results go to `bench-results.json`.

Machine: **Intel i7-8650U laptop with Intel UHD Graphics 620** (a 2017
low-end integrated GPU). The GPU is shared with other apps, so the benchmark
records the background 3D-engine load from other processes just before each
run (`backgroundGpu3DPercent`). The GPU-rendered terminal hosting the
development session alone used 45–62% of this iGPU during the final runs.

| Configuration | Run | Avg FPS | 1% low | Frame time avg / p50 / p99 | JS heap | Draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| **Adaptive (default)** | lighter background load | **47.2** | 13.8 | 21.2 / 16.7 / 66.7 ms | 12–15 MB | ~140 |
| Fixed high quality (all effects) | lighter background load | 26.0 | 8.8 | 38.4 / 33.4 / 100 ms | 13–17 MB | ~130 |
| **Adaptive (default)** | final, 62% background GPU load | 31.2 | 4.5 | 32.0 / 16.7 / 150 ms | 11–17 MB | ~90 |
| Fixed high quality (all effects) | final, 45% background GPU load | 15.1 | 2.0 | 66.3 / 50 / 383 ms | 12–13 MB | ~130 |

`bench-results.json` holds the final run. The lighter-load run used the same
rendering code (the only later changes were CPU-side spine springs and HUD
layout), but it was taken before the background-load probe existed, so its
background load was not recorded. All runs had 0 console errors or warnings.

- CPU time is **5–9 ms per frame** for simulation and render submission (the
  simulation step alone is about 1.6 ms). On this machine the app is
  **GPU fill-rate bound**: a trivial WebGL page in the same headless setup holds
  a steady 60 FPS (1% low 59.5). At full quality the GPU needs about 20–27 ms
  per frame, and about 9–12 ms at the reduced settings adaptive quality picks
  (timer-query measurements). With a static scene and nothing else using the
  GPU heavily, the adaptive ladder's middle settings run at 52–56 FPS.
- Optimisation history on the same machine (adaptive config, comparable
  load): 36 → 45 → 47 FPS average, and 1% low 8 → 14. The main wins:
  - Replacing N8AO with a custom SAO pass (about 10 ms down to 2–3 ms of GPU time).
  - Removing shader recompiles and adding prewarming.
  - Cutting allocations by more than half (11.3 → 4.9 MB/s) and the CPU
    simulation step from 8.6 to 1.6 ms.
  - Software-canvas minimap, removing HUD backdrop blur, and half-rate shadow
    updates at reduced quality.
  - Switching the adaptive controller from a median to a trimmed mean. Under
    vsync, a GPU that misses every other frame still shows a 60 FPS median.
- Not measured here: typical mid-range laptop GPUs (Iris Xe, MX-class, RTX
  3050 or Apple M-series) are roughly 2–5× faster than UHD 620. On those
  the reduced settings should hold 60 FPS, and the adaptive controller
  climbs back toward full quality when there is headroom.
- The 1% lows are dominated by GPU time-slicing with other processes
  (stalls of 150–500 ms when another app holds the GPU), not by work inside
  the app.

## Screenshots

| | |
| --- | --- |
| ![](screenshots/02_wolf_portrait.png) Portrait at golden hour (fur shells, eyes) | ![](screenshots/03_lake_noon_wide.png) The valley and lake at noon |
| ![](screenshots/04_night_moonlight.png) Howling under the stars | ![](screenshots/05_rainstorm.png) Rainstorm |
| ![](screenshots/06_hunt_gallop.png) Gallop during a hunt (deer fleeing) | ![](screenshots/07_pack_howl_dusk.png) Pack howl at dusk (eyeshine) |
| ![](screenshots/08_debug_skeleton_ai.png) Debug overlay: skeletons, AI target lines | ![](screenshots/09_dawn_mist.png) Dawn mist, cinematic camera |

## Improvement passes

After the first complete version I reviewed screenshots and benchmarks
critically. Each pass fixed the five biggest weaknesses I found:

1. **Pass 1**
   - Stutter and low FPS: replaced N8AO with SAO, removed runtime shader
     recompiles, pre-compiled shaders, removed `getWorldPosition` chain walks
     and reduced GC churn.
   - Grass with black back faces and spiky far LOD.
   - Rain invisible because its quads were culled.
   - Wolf head too small and eyes invisible: rescaled the head, added
     eyeshine.
   - Manual steering fighting the follow camera: added a stable control yaw.
2. **Pass 2**
   - Startup time: 10 s → 6 s (workers in parallel with shader
     compilation).
   - Flaky smoke test made deterministic.
   - Deer herd hidden in the forest, so moved it to the meadow.
   - Overbright night sky, dust and bush colours.
   - Long-run leak-test false positives. Also added camera collision with
     tree canopies, occlusion-aware cinematic shots and the HUD toggle.
3. **Final pass**
   - The adaptive controller's median metric under vsync, and the ladder
     reordered by measured cost (+8–15 FPS average).
   - Added a spring-driven spine lag (the spine bend previously followed the
     turn rate rigidly).
   - The thought bubble clipping at the screen edge and covering the HUD.
   - The screenshot pipeline: the hunt shot sometimes caught the wolf eating
     in a dark forest. It now lines up the chase and picks the least
     cluttered camera angle. Screenshot writes also failed on Windows file
     locks.
   - Benchmark context: added the background GPU-load probe after finding
     that the terminal used about half of the iGPU.

## Known limitations

- On low-end integrated GPUs (UHD 620 class) the default config averages
  30–47 FPS with reduced effects (depending on what else uses the GPU), not
  a locked 60. Full quality runs at 15–26 FPS there.
- The art style is deliberately stylised low-poly (faceted trees and rocks).
  Fur is shell-based, so it looks best from mid distance, and very close-ups
  show the shell layers.
- Water reflects only the sky (no planar or screen-space reflections of
  trees and animals).
- One species is player-controllable (the alpha wolf). The rest of the pack
  is AI-only.
- Audio starts only after the first click or keypress (browser autoplay
  policy).
- The headless benchmark uses the same ANGLE/D3D11 path as desktop Chrome, but
  absolute numbers depend on what else is using the GPU.
