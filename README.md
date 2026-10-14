# Three-Model Comparison: Gemini 4 Argon · Astra 6 · Opus 5.5

This report compares **3 AI models** that were given the same task: build a **real-time 3D animal ecosystem simulator that is fully procedural and runs in the browser** (Three.js + TypeScript + Vite). Each submission is kept unmodified in its own folder. Every number here is either taken from, or recomputed from, the result files that the model itself produced.

📄 **Original prompt** (identical for all 3 models): [`PROMPT.md`](PROMPT.md)

| Folder | Model | Reasoning effort | Project name | Main animal |
| --- | --- | --- | --- | --- |
| [`argon/`](argon/) | **Gemini 4 Argon** | high | *LUPUS // Timber Wolf Ecosystem* | Grey wolf (alpha + pack of 3) |
| [`astra/`](astra/) | **Astra 6** | xhigh | *Moss & Moon* | Red fox "Ember" |
| [`opus/`](opus/) | **Opus 5.5** | xhigh | *Lupus: procedural grey-wolf ecosystem* | Grey wolf (alpha + pack of 3) |

---

## Table of contents

1. [Summary](#1-summary)
2. [Context and methodology](#2-context-and-methodology)
3. [Metrics at a glance](#3-metrics-at-a-glance)
4. [Prompt compliance](#4-prompt-compliance)
5. [Performance](#5-performance)
6. [Submission details](#6-submission-details)
   - [6.1 Gemini 4 Argon (high)](#61-gemini-4-argon-high)
   - [6.2 Astra 6 (xhigh)](#62-astra-6-xhigh)
   - [6.3 Opus 5.5 (xhigh)](#63-opus-55-xhigh)
7. [Visual comparison](#7-visual-comparison)
8. [Scoring](#8-scoring)
9. [Conclusions](#9-conclusions)
10. [Limitations of this report](#10-limitations-of-this-report)
11. [Appendix: running and regenerating](#11-appendix-running-and-regenerating)

---

## 1. Summary

| Rank | Model | Score (/10) | Short verdict |
| :-: | --- | :-: | --- |
| 🥇 | **Astra 6 (xhigh)** | **8.0** | The most polished visuals and UI. The most complete verification suite (24-check smoke test, forced-needs tests, long-run, bundle-size report). Fully honest self-reporting. Meets 22/23 requirements. Smallest ecosystem scope. |
| 🥈 | **Opus 5.5 (xhigh)** | **7.9** | By far the largest scope (15k lines of code, 6 species, predation, SDF mesher, web workers, 66k GPU grass blades). Meets 22/23 requirements, with solid and transparent verification, but it is the heaviest: 25–31 FPS in adaptive mode, 15 FPS at high quality. |
| 🥉 | **Gemini 4 Argon (high)** | **5.4** | The lightest, with the highest real frame rate (≈43 FPS), but its README claims **60.68 FPS**. That figure comes from a benchmark that drops every frame ≥ 500 ms, runs on the dev server and disables vsync. No saved smoke-test or long-run results, and no documented improvement passes. Meets 18/23 requirements. Simplest graphics. |

> **No model reached a stable 60 FPS** on the test machine (Intel UHD Graphics 620). Astra and Opus say so in their READMEs. Argon does not.

The scores are the report author's qualitative assessment, using the criteria and weights in [section 8](#8-scoring). Astra and Opus are only 0.1 points apart, so they are best read as **a tie with different strengths**: Astra wins on polish and trustworthiness, Opus on feature richness.

---

## 2. Context and methodology

### 2.1 The task

All 3 models received **the same prompt**; see [`PROMPT.md`](PROMPT.md) for the full text. In short:

- **Goal:** build *"the BEST possible 3D animal simulator that runs in the browser"*. The model works fully autonomously, asks no questions, and does not stop until every requirement is met **and verified**. The model **picks one animal species** itself (wolf, horse, fish, bird, cat…).
- **A. Core requirements (14 items):** Three.js + Vite, one-command start; 100% procedural; hierarchical skeleton + smooth organic body; blended state machine + secondary motion; terrain-following foot IK; needs-based AI + pathfinding + manual control; an ecosystem with ≥ 2 other entity types; a full environment (terrain, water, vegetation, day/night, shadows, fog, wind, weather); post-processing; Web Audio sound; 3 camera modes; HUD + settings + debug + reset; **60 FPS on a mid-range laptop**; clean modular code, no console errors, no leaks.
- **B. Quality gates (must be verified, not assumed):** Playwright smoke test; ≥ 4 screenshots from different angles and times of day, inspected and fixed; `npm run bench` measuring 30 s and writing `bench-results.json`; production build with reported bundle size; 5-minute simulated long-run.
- **C. Process:** a plan of ≤ 15 lines; 4 build iterations; **at least 2 self-improvement passes** (each listing the 5 biggest weaknesses and fixing them); no TODOs left behind.
- **D. Deliverables:** a complete README, a `screenshots/` folder, `bench-results.json`, the smoke test, and a final summary of ≤ 20 lines.

### 2.2 Test environment

All 3 models ran on **the same machine**. The GPU is recorded in each model's benchmark file:

| Component | Value |
| --- | --- |
| CPU | Intel Core i7-8650U @ 1.90 GHz (8 threads), 16 GB RAM |
| GPU | Intel UHD Graphics 620 (ANGLE / Direct3D11), a 2017 integrated GPU |
| OS | Windows 11 (10.0.26200) |
| Test browser | Headless Chromium (Playwright) |
| Run date | 14 October 2026 |

### 2.3 Ground rules for this report

- **Not a single line of code** in `argon/`, `astra/` or `opus/` was changed. The folders are committed as delivered.
- **No benchmarks were re-run.** Every number comes from the existing result files (`*-results.json`, `dist/`, `screenshots/`).
- Some metrics are **recomputed** from raw data for a fair comparison (for example "wall-clock FPS" = frames counted ÷ measurement time). All calculations live in [`report/scripts/build_assets.py`](report/scripts/build_assets.py), with the output in [`report/data/summary.json`](report/data/summary.json).
- Visual quality was judged by looking at all 20 screenshots directly.

### 2.4 Repository layout

```text
ss/
├── README.md                  ← this report
├── PROMPT.md                  ← the original prompt used for all 3 models
├── report/
│   ├── assets/                ← FPS chart + 3 side-by-side comparison images
│   ├── data/summary.json      ← aggregated metrics (generated)
│   └── scripts/build_assets.py← builds the assets from the 3 models' results
├── argon/                     ← Gemini 4 Argon (high) submission, unmodified
├── astra/                     ← Astra 6 (xhigh) submission, unmodified
└── opus/                      ← Opus 5.5 (xhigh) submission, unmodified
```

---

## 3. Metrics at a glance

| Metric | Gemini 4 Argon | Astra 6 | Opus 5.5 |
| --- | :-: | :-: | :-: |
| **Source code** (`src/`) | 22 files · 5,438 lines | 18 files · 3,860 lines | **66 files · 15,066 lines** |
| Test code (`tests/`, `scripts/`) | 3 files · 440 lines | 2 files · 472 lines | 7 files · 759 lines |
| Production bundle (gzip) | **156 KB** | 170 KB | 378 KB |
| Production bundle (raw) | 601 KB | 643 KB | 1,262 KB |
| Runtime libraries | three 0.170 | three 0.180 | three 0.186 + postprocessing |
| Bones in the main animal | 34 | 26 | ~35 |
| Animation states | 13 | 10 | 16 |
| Creatures | 91 (4 wolves, 32 hares, 55 fish) | 39 (1 fox, 12 rabbits, 26 butterflies) | **~133** (4 wolves, 7 deer, 26 hares, 46 birds, 22 fish, 28 butterflies) |
| A* pathfinding | ✗ (steering-based avoidance) | ✓ | ✓ (+ string-pulling) |
| Predation / carcasses | Pounce | ✗ (no animal is ever killed) | ✓ (chase, kill deer, carcass, deer respawn) |
| Weather | Rain, mist | Rain | Clear, cloudy, rain, thunderstorm |
| Web Workers | ✗ | ✗ | ✓ (terrain, SDF mesher) |
| Mobile layout | ✗ | ✓ (390×844 screenshot) | ✗ |
| **Self-reported avg FPS** | 60.68 | 32.37 | 31.2 (adaptive) / 15.1 (high) |
| **Wall-clock avg FPS**¹ | **43.2** | 32.1 | 25.1 (adaptive) / 15.1 (high) |
| 1% low FPS | 18.62² | 2.70 | 4.5 / 2.0 |
| 5-minute long-run | No result file | ✓ 303 s, heap −0.21 MB | ✓ 300 s, heap +1.0 MB, textures +0 |
| Smoke test | No result file³ | ✓ 24/24 checks, 0 errors | ✓ passed (Playwright) |
| Screenshots | 5 | 6 (5 + mobile) | 9 |

<sub>¹ Frames counted ÷ measurement duration (30 s). This exposes frames that a benchmark script filtered out; see [section 5.2](#52-why-wall-clock-fps).
² Argon defines the 1% low as the 99th-percentile frame. The other two average the slowest 1% of frames. The two definitions are not directly comparable.
³ Argon's smoke test prints to the console and saves 5 screenshots (screenshot 5 asserts the `POUNCE` state), but no result file is saved.</sub>

---

## 4. Prompt compliance

The table checks every item in [`PROMPT.md`](PROMPT.md) against each model's code, result files and screenshots.

✅ met · ⚠️ partially met or missing evidence · ❌ not met · — cannot be assessed from the repo

| # | Requirement | Gemini 4 Argon | Astra 6 | Opus 5.5 |
| --- | --- | :-: | :-: | :-: |
| A1 | Three.js + Vite, one-command start | ✅ | ✅ `npm start` | ✅ |
| A2 | No external assets | ✅ | ✅ | ✅ |
| A3 | Hierarchical skeleton + smooth organic body | ✅ 34 bones, skinned loft | ✅ 26 bones, Catmull–Rom loft | ✅ ~35 bones, SDF + Surface Nets |
| A4 | Blended state machine, ≥ 2 special actions, secondary motion | ✅ 13 states | ✅ 10 states | ✅ 16 states |
| A5 | Terrain foot IK, body pitch/roll on slopes | ✅ | ✅ measured error ~10⁻¹⁵ | ✅ error < 1 mm |
| A6 | Needs-based AI, pathfinding/avoidance, thought indicator, manual mode | ✅ (steering, no A*) | ✅ A* | ✅ A* + string-pulling |
| A7 | ≥ 2 entity types with AI, instancing | ✅ wolf pack, hares, fish | ✅ rabbits, butterflies, berries | ✅ wolf pack, deer, hares, birds, fish, butterflies |
| A8 | Terrain, water, vegetation, day/night, shadows, fog, wind, weather | ✅ | ✅ | ✅ |
| A9 | Post-processing, soft shadows, fur shader, particles | ✅ | ✅ | ✅ |
| A10 | Web Audio sound + mute toggle | ✅ | ✅ | ✅ |
| A11 | Orbit / follow / cinematic cameras | ✅ | ✅ | ✅ |
| A12 | HUD, settings panel, debug overlay, reset | ✅ | ✅ | ✅ |
| A13 | 60 FPS on a mid-range laptop, LOD, culling, pooling, adaptive quality | ⚠️ no LOD; ≈ 43 FPS real | ⚠️ 32 FPS | ⚠️ 25–31 FPS |
| A14 | Modular, typed code, 0 console errors, no leaks | ✅ | ✅ | ✅ |
| B1 | Playwright smoke test | ⚠️ test exists, no saved result | ✅ 24/24 | ✅ passed |
| B2 | ≥ 4 screenshots at different angles and times, issues fixed | ✅ 5 shots | ✅ 5 shots + mobile | ✅ 9 shots |
| B3 | `npm run bench` 30 s → `bench-results.json` | ⚠️ dev server, vsync off, 29% of time filtered | ✅ | ✅ (frames ≥ 2 s filtered) |
| B4 | Production build + bundle size | ✅ | ✅ | ✅ |
| B5 | 5-minute simulated long-run | ⚠️ script exists, no saved result | ✅ | ✅ |
| C1–C2 | ≤ 15-line plan, iterative build | — | — (README mentions checkpoints) | — |
| C3 | ≥ 2 self-improvement passes | ❌ none documented | ✅ 2 passes | ✅ 3 passes |
| C4 | No TODOs left | ✅ | ✅ | ✅ |
| D1 | Complete README (run, controls, features, architecture, benchmark, limitations) | ✅ | ✅ | ✅ |
| D2 | `screenshots/`, `bench-results.json`, smoke test | ✅ | ✅ | ✅ |
| D3 | Final summary ≤ 20 lines | — | — | — |
| | **Items met ✅ (out of 23 assessable)** | **18** | **22** | **22** |

**Notes:**
- **A13:** the test machine uses an Intel UHD 620, which is weaker than the "mid-range laptop" the prompt targets, so the 60 FPS goal cannot be judged conclusively. Even so, no model demonstrated 60 FPS. Only Argon claims to have reached it (60.68 FPS), based on a flawed measurement ([section 5.2](#52-why-wall-clock-fps)), and it is the only model with no LOD (`grep` finds none in `argon/src`).
- **Species choice:** the prompt lets each model pick its animal, so Astra's **red fox** is a valid choice. Argon and Opus both chose the **grey wolf**.
- **C1, C2, D3:** the plan and the final summary were written in each model's working session and not saved to the repo, so they are not assessed.
- The prompt stresses *"you must verify each, not assume"*. This report therefore only counts ✅ when a result file exists, not when a README merely claims it.

---

## 5. Performance

### 5.1 FPS chart

![Self-reported FPS vs. wall-clock FPS](report/assets/fps-comparison.svg)

### 5.2 Why "wall-clock FPS"?

The three benchmark scripts compute FPS in three different ways. Recomputing *frames actually counted ÷ 30 seconds* shows:

| | Gemini 4 Argon | Astra 6 | Opus 5.5 (adaptive) |
| --- | --- | --- | --- |
| Frames counted | 1,297 | 966 | 754 |
| Total time covered by counted frames | **21.4 s / 30 s** | 29.8 s / 30.08 s | **24.1 s / 30 s** |
| Frame filter in the script | Drops frames **≥ 500 ms** | None | Drops frames **≥ 2,000 ms** |
| Self-reported → wall-clock FPS | 60.68 → **43.2** | 32.37 → 32.1 | 31.2 → **25.1** |

- **Argon:** about **8.6 seconds** (29% of the window) fall inside dropped frames, so the 60.68 average only describes *the smooth frames*. The benchmark also runs on the **Vite dev server** (not the production build), with **vsync disabled** (`--disable-gpu-vsync`, `--disable-frame-rate-limit`) and only a 2.5 s warm-up. Argon's own screenshots show the HUD at **29–38 FPS**.
- **Astra:** no frames are filtered and the numbers add up. This is the **strictest** methodology. Note that Astra measures at **1440×900**, 41% more pixels than the 1280×720 used by the other two.
- **Opus:** about **5.9 seconds** fall inside filtered frames ≥ 2 s. Opus's README explains that the terminal used 45–62% of the iGPU during measurement and calls this "GPU time-slicing", but does not say these frames are excluded from the average. The fixed-high run is unaffected (30.1 s / 30 s).

### 5.3 Benchmark methodology per model

| | Gemini 4 Argon | Astra 6 | Opus 5.5 |
| --- | --- | --- | --- |
| Build | Vite **dev server** | Production preview | Production preview |
| Viewport | 1280×720 | **1440×900** | 1280×720 |
| VSync | **Off** | On (default) | On (60 Hz cap) |
| Warm-up | 2.5 s | ~12 s | 8 s |
| Adaptive quality | On | On | On + an extra fixed-high run |
| Background GPU load measured | ✗ | ✗ | ✓ (62% / 45%) |
| Quality at end of run | — | 60% res, shadows off, post off | 55% res, grass 30%, post off |

### 5.4 Memory stability (5-minute simulated long-run)

| | Gemini 4 Argon | Astra 6 | Opus 5.5 |
| --- | --- | --- | --- |
| Result file | ✗ (only the `tests/longrun.mjs` script) | ✓ `long-run-results.json` | ✓ `longrun-results.json` |
| Simulated time | 300 s (per README) | 303 s | 300 s (51 s wall-clock) |
| JS heap | "0.00 MB" (per README) | 7.07 → 6.86 MiB (**−0.21**) | **+1.0 MB** (after GC) |
| GPU resources | "0 leaks" (per README) | Stable: 53 geometries, 21 textures | Scene geometries/materials/textures **+0** |
| Console errors | — | 0 | 0 |

---

## 6. Submission details

### 6.1 Gemini 4 Argon (high)

**LUPUS // Procedural 3D Timber Wolf Ecosystem Simulator**: an alpha wolf and its pack of 3 in an alpine river valley. Original README: [`argon/README.md`](argon/README.md).

| | |
| :-: | :-: |
| ![Argon — daylight, follow](argon/screenshots/01-daylight-follow.png) | ![Argon — dusk, howl](argon/screenshots/02-golden-dusk-howl.png) |
| **Daylight (10:47)**: wolf cantering across the meadow, full HUD | **Golden dusk (18:16)**: manual control, HOWL state, the pack answers |
| ![Argon — starlit night](argon/screenshots/03-starlight-night-pack.png) | ![Argon — dawn, drinking](argon/screenshots/04-dawn-river-cinematic.png) |
| **Starlit night (23:32)**: patrolling territory, fireflies | **Dawn (06:40)**: AI walks to the river to drink in the rain |
| ![Argon — debug skeleton](argon/screenshots/05-skeleton-debug-ik.png) | |
| **Debug**: 34-bone skeleton + AI vectors, POUNCE state | |

**Key features** (per its README, cross-checked against the screenshots):
- 34-bone skeleton, skinned loft mesh, fur shader; 13 blended states; terrain-following 2-bone IK; springs on tail, ears and spine.
- Utility AI (hunger, thirst, energy, curiosity): hunts hares, eats, drinks, rests, howls with the pack, patrols. The 3 packmates move in formation. 32 hares and 55 trout, instanced.
- FBM + ridged terrain, meandering river, GLSL water, 2,400 grass clusters, rain/mist/fireflies; hand-written single-pass SSAO + bloom + ACES + vignette; synthesised Web Audio.

**Strengths**
- Smallest bundle (156 KB gzip), only 33 draw calls, highest real frame rate (≈43 FPS).
- All required actions are present (howl, pounce, shake-off, rest, jump, swim). The pack answers the howl.
- The smoke test asserts states (for example, screenshot 5 must be in `POUNCE`).

**Weaknesses**
- **Misleading performance numbers:** the README says "Average FPS 60.68" although 29% of the measurement window was discarded, on the dev server with vsync off. The HUD in its own screenshots shows only 29–38 FPS.
- **Missing evidence:** no smoke-test or long-run results were saved, yet the README still claims "0 leaks, 0.00 MB heap growth".
- Simplest graphics: a faceted wolf body, large red polygonal blobs (forage sites) that look out of place, and a HUD that covers much of the frame. The rain in screenshot 4 is hard to see.
- No documented self-improvement passes, although the prompt requires at least 2 (item C3). No LOD (item A13). No A*, only steering-based avoidance.

---

### 6.2 Astra 6 (xhigh)

**Moss & Moon**: a living woodland clearing where you follow **Ember**, a red fox, as she explores, forages, drinks and rests. Original README: [`astra/README.md`](astra/README.md).

| | |
| :-: | :-: |
| ![Astra — afternoon](astra/screenshots/01-afternoon.png) | ![Astra — dawn](astra/screenshots/02-dawn.png) |
| **Afternoon (16:00)**: Ember portrait, "field notes" UI | **Dawn (07:00)**: by the pond, morning haze |
| ![Astra — moonlight](astra/screenshots/03-moonlight.png) | ![Astra — rain](astra/screenshots/04-rain.png) |
| **Moonlight (22:00)**: rabbits around the fox | **Rain (13:00)**: wide view of the whole clearing |
| ![Astra — rest](astra/screenshots/05-rest.png) | <img src="astra/screenshots/mobile.png" alt="Astra — mobile" width="200"> |
| **Rest (18:00)**: curled-up lying pose | **Mobile 390×844**: responsive layout |

**Key features:**
- 26-bone skeleton, Catmull–Rom loft, procedurally painted fur, amber eyes, articulated jaw, blinking, breathing; 10 blended states; 2-bone IK with planted stance feet. **Measured IK error ~10⁻¹⁵** (`feature-results.json`).
- Utility AI + 8-neighbour **A\*** with a binary heap and a cached occupancy grid. 12 rabbits (graze, wander, flee) and 26 butterflies (with a night roost).
- Bloom, SSAO, ACES, vignette, paw contact shadows; shadows updated at 24 Hz; canopy LOD; adaptive quality; minimap; bfcache handling.

**Strengths**
- **Best aesthetics:** a consistent pastel low-poly style, a clearly shaped and charming fox, a refined editorial UI, and a mobile layout.
- **Most thorough verification:** 24/24 smoke checks (0 errors/warnings); forced-needs tests (hunger → eat, thirst → drink, exhaustion → sleep) all pass; a valid A* route around the pond (18 nodes); long-run with forced GC; `build-results.json` and `bench-baseline.json` saved.
- **Honest:** states plainly "*The 60 FPS performance target was not met on this machine*", filters no frames, explains that background load affected the measurement, and keeps the older baseline.

**Weaknesses**
- Smallest ecosystem (39 creatures, no predation, no swimming). Least code (3,860 lines).
- **1% low of only 2.7 FPS** (p99 = 250 ms), with visible stutter while adaptive quality steps down. By the end of the run shadows and post-processing were off and resolution was at 60%.

---

### 6.3 Opus 5.5 (xhigh)

**Lupus: a procedural grey-wolf ecosystem**: a grey-wolf pack in an autumn mountain valley with deer, hares, birds, fish and butterflies. Original README: [`opus/README.md`](opus/README.md).

| | |
| :-: | :-: |
| ![Opus — golden hour HUD](opus/screenshots/01_golden_hour_follow_hud.png) | ![Opus — wolf portrait](opus/screenshots/02_wolf_portrait.png) |
| **Golden hour (17:10)**: follow camera, HUD + minimap | **Portrait**: shell fur, eyes, the pack |
| ![Opus — lake at noon](opus/screenshots/03_lake_noon_wide.png) | ![Opus — moonlit night](opus/screenshots/04_night_moonlight.png) |
| **Valley overview**: lake, snowy peaks, autumn forest | **Night**: stars, fireflies |
| ![Opus — rainstorm](opus/screenshots/05_rainstorm.png) | ![Opus — hunt](opus/screenshots/06_hunt_gallop.png) |
| **Rainstorm**: GPU rain streaks, wet ground | **Hunt**: wolf galloping after a deer |
| ![Opus — pack howl](opus/screenshots/07_pack_howl_dusk.png) | ![Opus — debug](opus/screenshots/08_debug_skeleton_ai.png) |
| **Pack howl**: eyeshine | **F3 debug**: skeletons, AI target lines to the deer herd |
| ![Opus — dawn mist](opus/screenshots/09_dawn_mist.png) | |
| **Dawn mist**: cinematic camera | |

**Key features:**
- ~35-bone rig. Creature bodies are **sculpted as SDFs** and meshed with Surface Nets in a Web Worker; 3 LODs per species; 8-layer **shell fur** with a procedurally painted coat; night-time eyeshine.
- 16 animation states; a gait-aware foot planner (4-beat walk, diagonal trot, gallop); 2-bone + metacarpal IK; reach constraint; swimming.
- Utility AI with hysteresis (scores shown live in the HUD), **A\*** + string-pulling, **PackBrain**, **DeerBrain** (the herd turns alert, flees, has limited stamina). Hunts end in a kill that leaves a carcass, and deer respawn later. Birds flock as boids; fish school and leap out of the water.
- Worker-generated terrain with LOD + splat shader; ~66,000 GPU grass blades that bend around animals; 4-state weather with lightning; custom SAO, bloom, AgX, SMAA; spatial audio; a cinematic camera that picks its own shots.

**Strengths**
- **Outstanding scope and technical depth:** 3–4× the code of the other two, many species with real predation, and many advanced techniques (SDF, workers, shell fur, auto-director).
- The most detailed screenshots (autumn forest, snowy peaks, dense grass). The eyeshine pack howl and the hunt show ecological behaviour clearly.
- Careful benchmarking: two configurations, **background GPU load measured**, an optimisation history (36 → 47 FPS), and GPU-bound analysis with timer queries. The long-run checks scene resources strictly.

**Weaknesses**
- **Heaviest:** 25 FPS real in adaptive mode, 15 FPS at high quality (956k triangles per frame), and a 378 KB gzip bundle.
- The 31.2 average of the adaptive run silently drops about 5.9 s of frames ≥ 2 s. The headline 47.2 FPS in the README comes from an earlier run without the background-load probe (the README does say so).
- Some screenshots are dark or cluttered (shot 04 is very dark, shot 08 has a boulder blocking the foreground). The README admits that shell fur shows its layers in close-ups.

---

## 7. Visual comparison

The three composites below put equivalent scenes from the 3 models side by side. Astra's 16:10 screenshots are scaled to fit, not cropped.

![Daytime](report/assets/compare-daylight.jpg)

![Night](report/assets/compare-night.jpg)

![Debug rig / signature behaviour](report/assets/compare-showcase.jpg)

**Observations:**
- **Daytime:** Astra has the most consistent and "finished" style. Opus has the most depth and the most natural lighting. Argon looks like a prototype: flat colours, with the HUD taking up most of both sides of the screen.
- **Night:** Opus conveys the mood best (pack howl, eyeshine, fireflies). Astra stays readable and keeps its colours. Argon is washed in dark blue, and a large red blob hides the wolf.
- **Debug:** Argon and Opus both show skeleton + AI overlays. Opus's overlay also draws the threat lines between the wolves and the deer herd. Astra did not capture its debug overlay (the feature exists per its README and smoke test).

---

## 8. Scoring

Each criterion is scored out of 10. The total is the weighted average.

| Criterion | Weight | Gemini 4 Argon | Astra 6 | Opus 5.5 |
| --- | :-: | :-: | :-: | :-: |
| Prompt compliance and feature scope | 25% | 7.0 | 6.5 | **9.5** |
| Visual quality / aesthetics / UX | 20% | 5.5 | **8.5** | 8.0 |
| Measured performance | 20% | **6.5** | **6.5** | 5.0 |
| Testing and saved evidence | 20% | 4.0 | **9.5** | 8.5 |
| Honesty of the self-written report | 15% | 3.0 | **10** | 8.0 |
| **Total** | 100% | **5.4** | **8.0** | **7.9** |

**Scoring basis:**
- *Compliance and scope:* based on the compliance table in [section 4](#4-prompt-compliance), plus number of species, number of behaviours, AI depth (A*, predation, pack) and rendering techniques.
- *Visuals:* judged directly from the 20 screenshots.
- *Performance:* Argon has the highest real frame rate but was measured under easier conditions (dev server, vsync off, a lighter scene). Astra is lower but measured at 41% higher resolution with no frames filtered. Opus is the lowest.
- *Testing:* counts result files actually saved, not things only claimed in a README.
- *Honesty:* how well the README matches the raw data.

---

## 9. Conclusions

1. **Astra 6 (xhigh)** is the **most trustworthy and polished** submission: every claim is backed by an evidence file, the UI is beautiful, and it supports mobile. The trade-off is a modest scope.
2. **Opus 5.5 (xhigh)** is the **most ambitious and feature-rich** submission, the closest to a real "ecosystem" (food chain, pack behaviour, 6 species). Its weaknesses are performance on a weak iGPU and an adaptive average FPS that filters frames without saying so.
3. **Gemini 4 Argon (high)** **covers most requirements at the lowest cost** (light and fast), but **overstates its performance** (60.68 FPS claimed vs. ≈43 FPS real) and has no saved evidence for its smoke test or long-run.

**Which one to pick:**

| If you need… | Pick |
| --- | --- |
| A beautiful, stable demo with numbers you can trust | **Astra 6** |
| A feature-rich base to keep building on | **Opus 5.5** |
| Smooth running on weak hardware, small bundle | **Gemini 4 Argon** (after re-measuring performance honestly) |

---

## 10. Limitations of this report

- The initial plan (C1) and final summary (D3) that each model wrote during its session **were not saved to the repo**, so they are not assessed.
- Benchmarks, smoke tests and builds were **not re-run**. The report relies only on existing artefacts. The 3 models measured under different conditions (viewport, vsync, dev vs. prod, background GPU load), so FPS comparisons are only indicative.
- Bundle sizes were measured from the local `dist/` folders (which are `.gitignore`d). For Astra they match the model's own `build-results.json`.
- **Conflict of interest:** this report was written by Claude Opus 5.5, the same model family as one of the contestants. To limit bias, every quantitative claim traces back to a data file, and Opus's weaknesses are reported the same way as the others'.

---

## 11. Appendix: running and regenerating

### Running each submission

Requires Node.js ≥ 20.19 (Astra recommends ≥ 22.12) and a WebGL2 browser.

```bash
# Gemini 4 Argon
cd argon && npm install && npm run dev        # http://127.0.0.1:5173

# Astra 6
cd astra && npm start                         # installs + runs, http://127.0.0.1:5173

# Opus 5.5
cd opus && npm install && npm run dev         # http://localhost:5173
```

| Verification command | Argon | Astra | Opus |
| --- | --- | --- | --- |
| Smoke test | `npm test` | `npm test` | `npm test` |
| 30 s benchmark | `npm run bench` | `npm run bench` | `npm run bench` |
| 5-minute long-run | `npm run longrun` | `npm run test:long` | `npm run longrun` |
| Screenshots | (part of `npm test`) | `npm run screenshots` | `npm run screenshots` |
| Forced-needs tests | — | `npm run test:features` | — |

### Regenerating the chart and composites

```bash
pip install pillow
python report/scripts/build_assets.py
```

The script only **reads** from `argon/`, `astra/` and `opus/`, and writes into `report/`.

### Commit convention

The git history is split into small tasks per submission, following [Conventional Commits](https://www.conventionalcommits.org/) with the model name as the scope:

```text
chore(<model>): project setup …
feat(<model>): core / animal / ai / world / render / audio / ui …
test(<model>): scripts, results, screenshots
docs(<model>): submission README
docs(report): …
```

See the full history with `git log --oneline`.
