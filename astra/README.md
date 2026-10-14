# Moss & Moon

A living, entirely procedural woodland. Follow **Ember**, a red fox, as she explores, forages, drinks, investigates rabbits, and rests. Take control at any time, or watch the clearing change from afternoon to moonlight.

## Run

Install Node.js 22.12+ (verified with Node 24). From this directory, one command installs dependencies and starts the app:

```sh
npm start
```

Open **http://127.0.0.1:5173**. The usual `npm install && npm run dev` also works in shells supporting `&&`. After installation, `npm run dev` starts immediately. No asset server, account, API key, or internet connection is needed at runtime.

```sh
npm run build
npm run preview
```

The production preview defaults to port 4173. Deploy the generated `dist/` directory to any static host. WebGL2 is required. Audio starts only when you click the sound button.

## Controls

| Control               | Action                                    |
| --------------------- | ----------------------------------------- |
| M / Autonomous switch | Toggle AI and manual control              |
| W/S or up/down        | Forward / backward in manual mode         |
| A/D or left/right     | Turn in manual mode                       |
| Shift                 | Run                                       |
| Space                 | Jump                                      |
| H                     | Fox call                                  |
| Q                     | Shake off                                 |
| R                     | Rest; press again or move to wake         |
| E                     | Eat near berries or drink near the pond   |
| C / camera buttons    | Follow, orbit, cinematic                  |
| Drag / scroll         | Orbit camera / zoom                       |
| Sound button          | Enable or mute synthesized audio          |
| Settings button       | Graphics, rain, clock, debug views, reset |

Follow mode travels with Ember while preserving your orbit angle. Orbit holds its center. Cinematic smoothly follows a moving orbit. Ground clearance prevents the camera entering the terrain. The mini-map shows Ember, rabbits, trees, rocks, and the pond. On narrow screens, the interface condenses; manual movement still requires a keyboard.

## Features

- A 26-bone hierarchy: four spine bones, neck, head, jaw, two ears, five tail bones, and upper/lower/paw bones for all four limbs.
- Smooth Catmull–Rom lofts with weighted skinning for the torso and continuous tail; procedurally painted fur, cream markings, amber eyes, articulated jaw, blinking, and breathing.
- Ten blended states: idle, walk, run, turn, sleep, eat, drink, jump, call, shake. Gait cadence depends on speed. Spring integration adds spine, tail, and ear lag.
- Analytic two-bone IK, planted stance feet, body support-height constraints, and terrain pitch/roll. Physics uses the same triangle-interpolated height field as rendering.
- Utility AI for hunger, thirst, and energy; cached occupancy and eight-neighbor A* with a binary heap; water/tree/rock avoidance and a visible thought indicator.
- Twelve autonomous rabbits with graze/wander/flee behavior and 26 butterflies with destination seeking, fox avoidance, and a night roost. Berries are food resources. No animals are killed.
- Seeded, multi-octave terrain; a shaped pond basin; animated reflective water; instanced branching trees, grass, bushes, berries, flowers, ferns, reeds, lily pads, and rocks.
- Moving sun and moon, a procedural sky and stars, fog, wind-deformed foliage, soft real-time shadows, rain, nighttime fireflies, and pooled dust/splash particles.
- Bloom, depth-based screen-space ambient occlusion, ACES tone mapping, vignette, and analytic paw-contact shadows. All effects can run without external assets.
- Web Audio wind/water ambience, filtered-noise footsteps, synthesized fox calls and woodland chirps. No recordings.
- FPS/frame-time HUD, needs, time, entity count, graphics settings, adaptive quality, skeleton overlay, AI route overlay, wireframe, and simulation reset.

All meshes, textures, shaders, sounds, icons, and styling are code-generated. System fonts are used. Runtime requests stay on the local origin.

## Architecture

| Directory            | Responsibility                                                              |
| -------------------- | --------------------------------------------------------------------------- |
| `src/core`           | Fixed 60 Hz simulation, input, orchestration, lifecycle, test hooks         |
| `src/animal`         | Loft geometry, fur texture, weighted rig, state blending, springs, IK       |
| `src/ai`             | Needs/utility decisions, cached occupancy, bounded A*                       |
| `src/world`          | Seeded terrain, instanced ecosystem, wildlife, water, particle pool         |
| `src/render`         | Camera modes, lights, shadows, post-processing, contact occlusion, disposal |
| `src/audio`          | Gesture-activated procedural Web Audio graph                                |
| `src/ui`             | Responsive field notes, controls, settings, mini-map                        |
| `src/utils`          | Seeded randomness, noise, interpolation, springs                            |
| `scripts/verify.mjs` | Playwright smoke, feature, screenshot, benchmark, and long-run checks       |

Rendering uses instancing, spatial grass tiles, frustum culling, canopy geometry LOD, distance-dependent grass density, a fixed particle pool, and capped device pixel ratio. Shadows update at 24 Hz. Adaptive quality reduces resolution, shadow quality, and post-processing when sustained performance drops. The HUD shows the actual settings. Disable adaptation when comparing fixed quality levels.

The loading screen waits for asynchronous compilation of the post-processed, direct-rendered, and shadow-free shader variants. This moves first-use compilation work out of normal interaction.

Resizing updates both the renderer and post-processing targets. Reset reuses GPU resources. Page teardown removes listeners, stops audio, and disposes geometries, materials, textures, skeletons, instance buffers, render targets, and controls. Returning from the browser back/forward cache reconstructs the simulation.

## Verification

Install the test browser once:

```sh
npx playwright install chromium
npm run build
npm test
npm run test:features
npm run screenshots
npm run bench
npm run test:long
```

Each command launches and closes its own headless Chromium and production preview server. Run them sequentially so they do not compete for the GPU. `TEST_URL` can target an existing dev/preview server, and `BROWSER_CHANNEL=chrome` can opt into installed Chrome. Windows tests request ANGLE D3D11 to avoid software-renderer fallback.

- **Smoke:** checks load, console errors/warnings, keyboard movement, run, jump/call/shake/rest, HUD changes, all camera modes, audio activation, weather, debug controls, post-processing, shadow quality, reset, and narrow-screen overflow. Saves `smoke-results.json` and `screenshots/mobile.png`.
- **Features:** forces hunger, thirst, and exhaustion separately, simulates each for 60 seconds, verifies the relevant behavior, measures IK error, and validates a path around the pond. Saves `feature-results.json`.
- **Screenshots:** five inspected views: afternoon, dawn, moonlight, rain, and resting. The first four use different angles and times. Saved under `screenshots/`.
- **Benchmark:** warms up for 12 seconds, records real animation-frame intervals for 30 seconds at 1440×900, and saves average FPS, mean frame time, 1% low FPS, p99 frame time, JS heap usage, GPU/CPU identification, settings, and draw statistics in `bench-results.json`. The 1% low is the reciprocal of the mean of the slowest 1% of frame intervals. No slow frames are discarded.
- **Long run:** executes 18,000 fixed simulation steps (five simulated minutes), renders between one-minute batches, forces GC, and checks crashes, finite state, GPU resource counts, and retained JS heap growth. This is an accelerated simulation test, not a claim of five minutes of wall-clock soak testing. Saves `long-run-results.json`.

## Measured results

Final production verification on Windows, Chromium 156.0.8078.4, Intel Core i7-8650U / Intel UHD Graphics 620 (ANGLE D3D11), 14 October 2026:

| Measurement                         | Result                                           |
| ----------------------------------- | ------------------------------------------------ |
| Benchmark window / viewport         | 30.08 seconds / 1440 × 900, DPR 1                |
| Average FPS                         | **32.37**                                        |
| 1% low FPS                          | **2.70**                                         |
| Mean / p99 frame time               | 30.89 / 249.90 ms                                |
| Benchmark JS heap                   | 8.53 → 7.44 MiB                                  |
| Adaptive quality at end             | 60% resolution; shadows off; post-processing off |
| Production payload, all HTML/CSS/JS | **643.10 kB raw / 171.54 kB gzip**               |
| Simulated soak duration             | 303.02 seconds                                   |
| Soak retained JS heap, after GC     | 7.069 → 6.864 MiB (−0.205 MiB)                   |
| Soak GPU resources                  | Stable: 53 geometries, 21 textures               |

The **60 FPS performance target was not met on this machine**. These are the final run's results, not a selection of the fastest frames or previous runs. External applications were left untouched. A rendering-isolation check measured 39.72 FPS with simulation, 56.54 with the scene frozen, and 42.97 even with scene objects hidden; simulation updates averaged 0.94 ms. That variability makes this a workload-contended measurement, not a clean hardware certification. Earlier benchmark results are retained in `bench-baseline.json` for context, not as a claim of a controlled before/after comparison.

The production smoke test passed all 24 checks with zero browser errors or warnings. Forced-need scenarios reached eating, drinking, and sleeping; the maximum measured 3D foot-joint-to-target error was below 10⁻¹² world units (5 mm test tolerance). Five final camera/time/weather/rest screenshots were opened and inspected, plus a mobile-layout capture. `npm start` was also checked separately and returned the correct app with HTTP 200.

Raw evidence lives in `bench-results.json`, `build-results.json`, `smoke-results.json`, `feature-results.json`, and `long-run-results.json`. The build regenerates its size report automatically. The soak fixes graphics quality so adaptive disposal is not mistaken for changing resource ownership. For additional local diagnosis, `node scripts/verify.mjs profile` compares presets, and `node scripts/verify.mjs isolate` compares simulation/rendering overhead.

## Review and improvement passes

The rig checkpoint and world/AI checkpoint both ran in Chromium before the next layer was added. The first full-interface smoke test passed before the two review passes.

**Pass 1 — visual coherence and scene cost:** corrected multiplied/dark instance colors; added branching trunks and varied understory; replaced rectangular butterflies and added rabbit eyes/noses; rebuilt water shading and added shoreline plants; cached navigation and limited shadow/grass rendering costs. An Intel-driver compositing problem was fixed by removing CSS backdrop blur from the HUD panels.

**Pass 2 — physical and interaction correctness:** matched IK to the rendered terrain triangles and solved body support before legs; verified resource-seeking AI; added camera ground clearance and refined resting/call poses; synchronized adaptive settings and reset behavior; added canopy LOD, eliminated duplicate fractional updates, split the production bundle, and audited disposal. Additional screenshots exposed a raised pond edge, which was fixed by reshaping the basin. Forced-needs testing exposed overextended planted feet, fixed with a shared support-height solve.

## Known limitations

- This is a stylized ecological simulation, not a veterinary or biological model. Wildlife populations are fixed; food is renewable; there is no reproduction, combat, inventory, persistence, or multiplayer.
- Fur uses a procedural texture rather than individual strand geometry. Water uses analytic highlights/reflections rather than expensive full-scene planar reflection. The ambient-occlusion pass uses depth samples rather than a separate normal buffer.
- The clearing is deliberately bounded. Fox movement avoids deep water; it does not swim. Camera clearance covers terrain; close tree canopies may occasionally obstruct a view, which orbit/zoom can resolve.
- A steady 60 FPS cannot be promised on every GPU or under unrelated CPU/GPU load. The measured machine is an older Intel UHD 620 laptop; Windows also reported 100% CPU load with the test browser closed during part of verification. See the measured benchmark rather than inferring a universal hardware guarantee.
- The responsive UI supports observation and action buttons on mobile; manual locomotion is designed for a keyboard. Chromium was verified; other WebGL2 browsers have not been tested here.

## Technical references

Three.js [skinned meshes](https://threejs.org/docs/#api/en/objects/SkinnedMesh) and [post-processing](https://threejs.org/manual/pages/post-processing.html). The geometry, animation solver, AI, shaders, and audio in this project are implemented locally; no external model or art packs are used.
