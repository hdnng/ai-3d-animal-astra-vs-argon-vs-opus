# Prompt dùng cho cả 3 model

Đây là prompt **nguyên văn, không chỉnh sửa**, được gửi giống hệt nhau cho cả 3 model: Gemini 4 Argon (high), Astra 6 (xhigh) và Opus 5.5 (xhigh). Mỗi model bắt đầu trong một thư mục trống và làm việc tự động hoàn toàn. Kết quả nằm trong [`argon/`](argon/), [`astra/`](astra/) và [`opus/`](opus/). Phần đối chiếu từng yêu cầu với 3 bài làm nằm ở [mục 4 của README](README.md#4-mức-đáp-ứng-đề-bài).

---

```text
Build the BEST possible 3D animal simulator that runs in the browser, in the current empty working directory. Work fully autonomously: do not ask me questions, make reasonable decisions yourself, and do not stop until every requirement and quality gate below is met and verified. Use your full capability and effort. Do not settle for a "good enough" prototype; aim for a polished, impressive, production-quality result.

## Concept
Pick ONE animal species (e.g. wolf, horse, fish, bird, cat) and build a rich, interactive 3D simulation of it living in a small ecosystem.

## A. Core requirements (must all be met)
1. Tech: Three.js with Vite + npm (TypeScript preferred). Must start with ONE command (e.g. `npm install && npm run dev`), documented in README.md.
2. No external assets. All geometry, textures, materials, and sound must be procedural (code only).
3. Animal rig: a real hierarchical skeleton (spine segments, neck, head, jaw, ears, tail chain, 4 limbs with upper/lower/foot joints, or wings/fins as appropriate). Smooth organic-looking body (e.g. lofted or metaball-style procedural mesh, or skinned mesh with vertex weights), NOT just stacked boxes or spheres.
4. Animation system: a state machine with blended transitions (idle, walk, run/swim/fly with speed-dependent gait, turn, rest/sleep, eat/drink, and 2+ special actions such as jump, howl, shake-off, pounce). Add secondary motion: tail/ear/spine lag via spring physics, breathing, head look-at toward targets, and blinking.
5. Procedural locomotion: foot placement with IK against terrain height (feet must not float or sink), body pitch/roll adapting to slopes.
6. AI: behavior with needs (hunger, thirst, energy, maybe fear/curiosity), utility-based or behavior-tree decision making, pathfinding/obstacle avoidance around trees and rocks, and a visible state/thought indicator. Manual control with WASD/arrows + Space + Shift, and a toggle between AI and manual control.
7. Ecosystem: at least 2 other entity types (e.g. prey/predator, food sources, other animals of the same species) with their own simple AI, so the world feels alive. Use instancing for large counts.
8. Environment: procedurally generated terrain (multi-octave noise), water with animated surface, vegetation (instanced trees, grass, bushes, flowers), rocks, a dynamic day/night cycle with a moving sun/moon, real-time shadows, fog, sky shader, wind animation on grass/leaves, and weather (at least rain or particles/fireflies).
9. Visual quality: post-processing (bloom, SSAO or similar, tone mapping, vignette), well-chosen color palette, soft shadows, procedural fur/skin/feather shader or texture, particle effects (dust, footsteps, splashes).
10. Audio: procedural sound with the Web Audio API (footsteps, ambient wind/water, animal sounds, music or ambience) with a mute toggle.
11. Camera: orbit, follow-animal, cinematic/auto-orbit mode, and smooth transitions between modes.
12. UI/HUD: FPS, frame time, state, need bars, time of day, entity count, a settings panel (shadow quality, resolution scale, toggle post-processing, toggle weather, time speed), a debug overlay (skeleton view, AI target lines, wireframe), and a reset button.
13. Performance: 60 FPS on a mid-range laptop. Use instancing, LOD, frustum culling, object pooling, adaptive quality (auto lower settings if FPS drops), and proper disposal of geometries/materials/textures. Handle resize and devicePixelRatio.
14. Code quality: clean modular architecture (core, animal, ai, world, render, audio, ui, utils), typed, commented where non-obvious, no console errors or warnings, no memory leaks.

## B. Quality gates (you must verify each, not assume)
- Install Playwright (or Puppeteer) and run the app in headless Chromium. Write an automated smoke test that loads the page, waits several seconds, asserts there are no console errors, simulates key presses, and confirms the state/HUD changes.
- Take screenshots from at least 4 different camera angles and times of day, inspect them yourself, and fix visual problems you find (floating feet, clipping, ugly proportions, flat lighting, z-fighting).
- Write a benchmark script (`npm run bench`) that measures average FPS, 1% low FPS, frame time, and memory over 30 seconds in headless mode, and saves results to `bench-results.json`. Optimize until results are as high as you can get them and report the numbers.
- Run a build (`npm run build`) and confirm the production build works and report its bundle size.
- Run a simple long-run test (5 minutes simulated) to check for crashes or memory growth.

## C. Process
1. Write a short plan (max 15 lines) with the architecture and the animal choice, then implement.
2. Build in iterations: (1) skeleton + animation, (2) world + AI, (3) visuals + audio, (4) performance + tests. After each iteration, run and verify before moving on.
3. After the first fully working version, do at least TWO improvement passes: review your own output critically (look at screenshots and benchmark results), list the 5 biggest weaknesses, and fix them.
4. Fix every bug you find yourself. Do not leave TODOs.

## D. Deliverables
- Fully runnable project, plus `README.md` with: run instructions, controls, features list, architecture overview, benchmark results, and known limitations.
- `screenshots/` folder with at least 4 screenshots.
- `bench-results.json` and the smoke test.
- A final summary (max 20 lines): what was built, what was verified, final FPS numbers, and what you would improve next.

Do not stop at a partial result. The final project must run with one command and look impressive.
```
