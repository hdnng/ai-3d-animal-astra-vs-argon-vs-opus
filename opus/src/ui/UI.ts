/**
 * HTML overlay UI: performance stats, wolf status (state, thought, need bars,
 * utility scores), clock + weather, control buttons, settings panel, help,
 * minimap, floating thought bubble, toasts and the start screen.
 * Text is refreshed at ~8 Hz to keep layout work negligible.
 */
import * as THREE from 'three';
import type { App } from '../core/App';
import { events } from '../core/Events';
import type { SettingsData } from '../core/Settings';
import { HALF, WORLD_SIZE, WATER_LEVEL } from '../world/WorldGen';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const NEEDS: { key: 'hunger' | 'thirst' | 'fatigue' | 'social' | 'curiosity'; label: string; icon: string; invert?: boolean }[] = [
  { key: 'hunger', label: 'Hunger', icon: '🍖' },
  { key: 'thirst', label: 'Thirst', icon: '💧' },
  { key: 'fatigue', label: 'Energy', icon: '⚡', invert: true },
  { key: 'social', label: 'Social', icon: '🐺' },
  { key: 'curiosity', label: 'Curiosity', icon: '🧭' },
];

const _p = new THREE.Vector3();

export class UI {
  readonly root: HTMLElement;
  private stats: HTMLElement;
  private wolfPanel: HTMLElement;
  private stateEl: HTMLElement;
  private actionEl: HTMLElement;
  private modeBadge: HTMLElement;
  private bars = new Map<string, { fill: HTMLElement; val: HTMLElement }>();
  private scoresEl: HTMLElement;
  private clockEl: HTMLElement;
  private bubble: HTMLElement;
  private bubbleText: HTMLElement;
  /** Last measured bubble width (px), used to clamp it on screen. */
  private bubbleW = 160;
  private toasts: HTMLElement;
  private settingsPanel: HTMLElement;
  private helpPanel: HTMLElement;
  private debugPanel: HTMLElement;
  private minimap: HTMLCanvasElement;
  private minimapBase: HTMLCanvasElement;
  private camBtn!: HTMLButtonElement;
  private aiBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;
  private start: HTMLElement;
  private refreshT = 0;
  private mapT = 0;
  private settingsInputs = new Map<keyof SettingsData, HTMLInputElement | HTMLSelectElement>();
  private unsub: (() => void)[] = [];

  constructor(
    private app: App,
    container: HTMLElement,
  ) {
    this.root = el('div', 'ui-root');
    container.appendChild(this.root);

    // --- top-left: performance
    this.stats = el('div', 'panel stats');
    this.root.appendChild(this.stats);

    // --- left: wolf status
    this.wolfPanel = el('div', 'panel wolf');
    const head = el('div', 'wolf-head');
    head.appendChild(el('div', 'wolf-name', 'Alpha <span class="sub">grey wolf</span>'));
    this.modeBadge = el('div', 'badge', 'AI');
    head.appendChild(this.modeBadge);
    this.wolfPanel.appendChild(head);
    this.stateEl = el('div', 'wolf-state');
    this.actionEl = el('div', 'wolf-action');
    this.wolfPanel.append(this.stateEl, this.actionEl);
    const needs = el('div', 'needs');
    for (const n of NEEDS) {
      const row = el('div', `need need-${n.key}`);
      row.appendChild(el('span', 'need-icon', n.icon));
      row.appendChild(el('span', 'need-label', n.label));
      const bar = el('div', 'need-bar');
      const fill = el('div', 'need-fill');
      bar.appendChild(fill);
      row.appendChild(bar);
      const val = el('span', 'need-val');
      row.appendChild(val);
      needs.appendChild(row);
      this.bars.set(n.key, { fill, val });
    }
    this.wolfPanel.appendChild(needs);
    this.scoresEl = el('div', 'scores');
    this.wolfPanel.appendChild(this.scoresEl);
    this.root.appendChild(this.wolfPanel);

    // --- top-right: clock + buttons
    const tr = el('div', 'topright');
    this.clockEl = el('div', 'panel clock');
    tr.appendChild(this.clockEl);
    const btns = el('div', 'buttons');
    const mk = (label: string, title: string, fn: () => void, id: string): HTMLButtonElement => {
      const b = el('button', 'btn', label);
      b.title = title;
      b.id = id;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
        (b as HTMLButtonElement).blur();
      });
      btns.appendChild(b);
      return b;
    };
    this.camBtn = mk('🎥 Follow', 'Cycle camera (C)', () => events.emit('cameraMode', { mode: this.app.cameraRig.cycleMode() }), 'btn-camera');
    this.aiBtn = mk('🤖 AI', 'Toggle AI / manual control (T)', () => this.app.setManual(!this.app.manual), 'btn-ai');
    this.muteBtn = mk('🔊', 'Mute (M)', () => this.app.toggleMute(), 'btn-mute');
    mk('⚙', 'Settings (O)', () => this.toggle(this.settingsPanel), 'btn-settings');
    mk('🐞', 'Debug overlay (F3)', () => this.toggle(this.debugPanel), 'btn-debug');
    mk('↺', 'Reset simulation', () => this.app.resetSimulation(), 'btn-reset');
    mk('?', 'Controls (H)', () => this.toggle(this.helpPanel), 'btn-help');
    tr.appendChild(btns);
    this.root.appendChild(tr);

    // --- thought bubble
    this.bubble = el('div', 'bubble');
    this.bubbleText = el('span', 'bubble-text');
    this.bubble.appendChild(this.bubbleText);
    // First child, so HUD panels stay readable on top of it.
    this.root.prepend(this.bubble);

    this.toasts = el('div', 'toasts');
    this.root.appendChild(this.toasts);

    // --- minimap
    const mapWrap = el('div', 'panel minimap');
    this.minimap = el('canvas');
    this.minimap.width = this.minimap.height = 168;
    mapWrap.appendChild(this.minimap);
    this.root.appendChild(mapWrap);
    this.minimapBase = this.renderMapBase();

    this.settingsPanel = this.buildSettings();
    this.helpPanel = this.buildHelp();
    this.debugPanel = this.buildDebug();
    this.root.append(this.settingsPanel, this.helpPanel, this.debugPanel);

    this.start = this.buildStart();
    this.root.appendChild(this.start);

    this.root.style.display = app.settings.get('showHud') ? '' : 'none';
    this.unsub.push(
      app.settings.subscribe((s, key) => {
        if (key === 'showHud') this.root.style.display = s.showHud ? '' : 'none';
      }),
      events.on('notify', (e) => this.toast(e.text)),
      events.on('controlMode', (e) => this.toast(e.manual ? 'Manual control — WASD to move, Shift to run' : 'AI control — the wolf follows its needs')),
      events.on('cameraMode', (e) => this.toast(`Camera: ${e.mode}`)),
    );
  }

  private toggle(p: HTMLElement): void {
    p.classList.toggle('open');
  }

  toggleSettings(): void {
    this.toggle(this.settingsPanel);
  }

  toggleHelp(): void {
    this.toggle(this.helpPanel);
  }

  toggleDebug(): void {
    this.toggle(this.debugPanel);
  }

  toast(text: string): void {
    const t = el('div', 'toast', text);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  private buildStart(): HTMLElement {
    const s = el('div', 'start');
    s.innerHTML = `
      <div class="start-card">
        <div class="title">LUPUS</div>
        <div class="subtitle">A procedural grey-wolf ecosystem</div>
        <div class="start-hint">Click anywhere to enter the valley (enables sound)</div>
        <div class="start-keys">WASD move · Shift run · Space jump · Q howl · T toggle AI · C camera · H help</div>
      </div>`;
    const go = (): void => {
      s.classList.add('gone');
      this.app.audio.unlock();
      setTimeout(() => s.remove(), 900);
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return s;
  }

  dismissStart(): void {
    this.start.classList.add('gone');
    setTimeout(() => this.start.remove(), 900);
  }

  private buildHelp(): HTMLElement {
    const p = el('div', 'panel side help');
    p.innerHTML = `
      <h3>Controls</h3>
      <table>
        <tr><td>W A S D / Arrows</td><td>Move (camera relative) — takes manual control</td></tr>
        <tr><td>Shift</td><td>Run / gallop</td></tr>
        <tr><td>Ctrl / Alt</td><td>Walk slowly</td></tr>
        <tr><td>Space</td><td>Jump</td></tr>
        <tr><td>F</td><td>Pounce (toward a nearby hare)</td></tr>
        <tr><td>Q</td><td>Howl (the pack joins in)</td></tr>
        <tr><td>E</td><td>Eat / drink / sniff (context)</td></tr>
        <tr><td>R</td><td>Shake off water</td></tr>
        <tr><td>Z / X</td><td>Sit · Lie down → sleep</td></tr>
        <tr><td>V / B</td><td>Sniff · Play bow</td></tr>
        <tr><td>T</td><td>Toggle AI / manual control</td></tr>
        <tr><td>C · 1 2 3</td><td>Cycle camera · Follow / Orbit / Cinematic</td></tr>
        <tr><td>Mouse drag / wheel</td><td>Look around / zoom</td></tr>
        <tr><td>M · O · H · F3</td><td>Mute · Settings · Help · Debug</td></tr>
        <tr><td>U</td><td>Hide / show the HUD (photo mode)</td></tr>
        <tr><td>[ / ]</td><td>Slower / faster time</td></tr>
      </table>`;
    return p;
  }

  private buildDebug(): HTMLElement {
    const p = el('div', 'panel side debug');
    p.appendChild(el('h3', '', 'Debug overlay'));
    const add = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
      const row = el('label', 'row');
      const cb = el('input') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.checked = get();
      cb.addEventListener('change', () => set(cb.checked));
      row.append(cb, document.createTextNode(' ' + label));
      p.appendChild(row);
    };
    const d = this.app.debug;
    add('Skeleton view (bones + foot contacts)', () => d.showSkeleton, (v) => (d.showSkeleton = v));
    add('AI targets & paths', () => d.showAI, (v) => (d.showAI = v));
    add('Wireframe', () => d.wireframe, (v) => d.setWireframe(this.app.scene, v));
    add('Utility scores in HUD', () => this.scoresEl.classList.contains('show'), (v) => this.scoresEl.classList.toggle('show', v));
    return p;
  }

  private buildSettings(): HTMLElement {
    const p = el('div', 'panel side settings');
    p.appendChild(el('h3', '', 'Settings'));
    const s = this.app.settings;
    const row = (label: string, input: HTMLElement, out?: HTMLElement): void => {
      const r = el('div', 'row');
      r.appendChild(el('span', 'lbl', label));
      r.appendChild(input);
      if (out) r.appendChild(out);
      p.appendChild(r);
    };
    const select = (key: keyof SettingsData, label: string, opts: [string, string][], parse: (v: string) => unknown): void => {
      const sel = el('select') as HTMLSelectElement;
      for (const [v, t] of opts) {
        const o = el('option') as HTMLOptionElement;
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = String(s.get(key));
      sel.addEventListener('change', () => s.set(key, parse(sel.value) as never));
      this.settingsInputs.set(key, sel);
      row(label, sel);
    };
    const range = (key: keyof SettingsData, label: string, min: number, max: number, step: number, fmt: (v: number) => string): void => {
      const inp = el('input') as HTMLInputElement;
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(s.get(key));
      const out = el('span', 'val', fmt(Number(inp.value)));
      inp.addEventListener('input', () => {
        out.textContent = fmt(Number(inp.value));
        s.set(key, Number(inp.value) as never);
      });
      this.settingsInputs.set(key, inp);
      row(label, inp, out);
    };
    const check = (key: keyof SettingsData, label: string): void => {
      const inp = el('input') as HTMLInputElement;
      inp.type = 'checkbox';
      inp.checked = Boolean(s.get(key));
      inp.addEventListener('change', () => s.set(key, inp.checked as never));
      this.settingsInputs.set(key, inp);
      row(label, inp);
    };
    select('shadowQuality', 'Shadows', [['0', 'Off'], ['1', 'Low (1024)'], ['2', 'Medium (2048)'], ['3', 'High (4096)']], Number);
    range('resolutionScale', 'Resolution', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    check('postProcessing', 'Post-processing');
    check('ambientOcclusion', 'Ambient occlusion');
    check('bloom', 'Bloom');
    check('weatherEnabled', 'Weather');
    select('weatherMode', 'Weather mode', [['auto', 'Auto cycle'], ['clear', 'Clear'], ['rain', 'Rain']], String);
    range('timeSpeed', 'Time speed', 0, 10, 0.25, (v) => (v === 0 ? 'paused' : `${v}×`));
    range('grassDensity', 'Grass density', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    select('furQuality', 'Fur quality', [['0', 'Off'], ['1', 'Medium'], ['2', 'High']], Number);
    check('adaptiveQuality', 'Adaptive quality');
    // time of day slider (not a persisted setting)
    const tod = el('input') as HTMLInputElement;
    tod.type = 'range';
    tod.min = '0';
    tod.max = '24';
    tod.step = '0.1';
    tod.value = String(this.app.world.dayNight.time);
    const todOut = el('span', 'val', '');
    tod.addEventListener('input', () => {
      this.app.world.dayNight.setTime(Number(tod.value));
    });
    row('Time of day', tod, todOut);
    (p as HTMLElement & { _tod?: HTMLInputElement; _todOut?: HTMLElement })._tod = tod;
    (p as HTMLElement & { _tod?: HTMLInputElement; _todOut?: HTMLElement })._todOut = todOut;
    const music = el('input') as HTMLInputElement;
    music.type = 'checkbox';
    music.checked = true;
    music.addEventListener('change', () => this.app.audio.setMusic(music.checked));
    row('Music', music);
    return p;
  }

  private renderMapBase(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const N = 168;
    c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const img = g.createImageData(N, N);
    const d = this.app.world.data;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i / N) * WORLD_SIZE - HALF;
        const z = (j / N) * WORLD_SIZE - HALF;
        const h = d.heightAt(x, z);
        const hx = d.heightAt(x + 1.5, z) - h;
        const shade = 0.75 + Math.max(-0.35, Math.min(0.35, -hx * 0.35));
        let r: number, gg: number, b: number;
        if (h < WATER_LEVEL) [r, gg, b] = [60, 100, 120];
        else if (h > 40) [r, gg, b] = [215, 220, 228];
        else if (d.slopeAt(x, z) > 0.35) [r, gg, b] = [120, 116, 108];
        else {
          const f = d.forestAt(x, z);
          r = 120 - f * 70;
          gg = 128 - f * 40;
          b = 70 - f * 30;
        }
        const k = (j * N + i) * 4;
        img.data[k] = r * shade;
        img.data[k + 1] = gg * shade;
        img.data[k + 2] = b * shade;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private drawMap(): void {
    // Software (CPU) 2D canvases: tiny, and never force GPU synchronisation.
    const g = this.minimap.getContext('2d', { willReadFrequently: true })!;
    const N = this.minimap.width;
    g.drawImage(this.minimapBase, 0, 0);
    const toMap = (x: number, z: number): [number, number] => [((x + HALF) / WORLD_SIZE) * N, ((z + HALF) / WORLD_SIZE) * N];
    const eco = this.app.eco;
    const dot = (x: number, z: number, r: number, color: string): void => {
      const [mx, my] = toMap(x, z);
      g.fillStyle = color;
      g.beginPath();
      g.arc(mx, my, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const h of eco.hares.list) if (h.alive && h.mode !== 'hidden') dot(h.x, h.z, 1.2, '#e8d8b0');
    for (let i = 0; i < eco.deer.length; i++) {
      const d = eco.deer[i];
      if (!d.root.visible) continue;
      dot(d.pos.x, d.pos.z, 2.4, eco.deerBrains[i].mode === 'dead' ? '#c0392b' : '#b07a3f');
    }
    for (let i = 1; i < eco.wolves.length; i++) dot(eco.wolves[i].pos.x, eco.wolves[i].pos.z, 2.3, '#9aa3ad');
    // camera view cone
    const cam = this.app.cameraRig.camera;
    const [cx, cy] = toMap(cam.position.x, cam.position.z);
    cam.getWorldDirection(_p);
    const a = Math.atan2(_p.z, _p.x);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 22, a - 0.45, a + 0.45);
    g.closePath();
    g.fill();
    // alpha arrow
    const w = eco.alpha;
    const [ax, ay] = toMap(w.pos.x, w.pos.z);
    g.save();
    g.translate(ax, ay);
    g.rotate(-w.yaw + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -5.5);
    g.lineTo(4, 4);
    g.lineTo(0, 2);
    g.lineTo(-4, 4);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  update(dt: number): void {
    const app = this.app;
    // Thought bubble follows the wolf's head every frame.
    const w = app.eco.alpha;
    const cam = app.cameraRig.camera;
    w.headPosition(_p);
    _p.y += 0.55;
    const dist = _p.distanceTo(cam.position);
    _p.project(cam);
    const visible = _p.z < 1 && Math.abs(_p.x) < 1.1 && Math.abs(_p.y) < 1.1 && dist < 40;
    if (visible) {
      const scale = Math.max(0.7, Math.min(1, 8 / dist));
      // Keep the whole bubble on screen when the wolf is near an edge.
      const half = this.bubbleW * 0.5 * scale + 8;
      const x = Math.max(half, Math.min(window.innerWidth - half, (_p.x * 0.5 + 0.5) * window.innerWidth));
      const y = Math.max(40, (-_p.y * 0.5 + 0.5) * window.innerHeight);
      this.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      this.bubble.style.opacity = '1';
    } else this.bubble.style.opacity = '0';

    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.12;
    const r = app.renderer.renderer.info;
    const counts = app.eco.counts();
    const animals = counts.wolves + counts.deer + counts.hares + counts.birds + counts.fish + counts.butterflies;
    const veg = app.world.vegetation.stats();
    this.stats.innerHTML = `
      <div class="fps"><b>${app.fps.toFixed(0)}</b> FPS <span class="dim">${(1000 / Math.max(app.fps, 1)).toFixed(1)} ms · cpu ${app.cpuMs.toFixed(1)} ms</span></div>
      <div class="dim">draw ${r.render.calls} · tris ${(r.render.triangles / 1000).toFixed(0)}k · quality ${app.adaptive.describe()}</div>
      <div class="dim">animals ${animals} (🐺${counts.wolves} 🦌${counts.deer} 🐇${counts.hares} 🐦${counts.birds} 🐟${counts.fish} 🦋${counts.butterflies})</div>
      <div class="dim">plants ${veg.instances} (${veg.visible} drawn) · grass ${(app.world.grass.bladeCount / 1000).toFixed(0)}k · fx ${app.effects.particleCount}</div>`;

    const b = app.eco.alphaBrain;
    this.modeBadge.textContent = app.manual ? 'MANUAL' : 'AI';
    this.modeBadge.classList.toggle('manual', app.manual);
    this.stateEl.innerHTML = `<span class="lbl">State</span> ${w.describeMotion()} <span class="dim">${w.speed.toFixed(1)} m/s</span>`;
    this.actionEl.innerHTML = `<span class="lbl">Doing</span> ${b.icon} ${b.thought}`;
    for (const n of NEEDS) {
      const raw = b.needs[n.key];
      const v = n.invert ? 1 - raw : raw;
      const bar = this.bars.get(n.key)!;
      bar.fill.style.width = `${(v * 100).toFixed(0)}%`;
      bar.val.textContent = `${Math.round(v * 100)}`;
      bar.fill.classList.toggle('urgent', n.invert ? v < 0.2 : v > 0.8);
    }
    this.scoresEl.innerHTML = b.scores
      .slice(0, 5)
      .map((s) => `<div class="score"><span>${s.id}</span><i style="width:${Math.max(0, Math.min(1, s.score / 2)) * 100}%"></i><em>${s.score.toFixed(2)}</em></div>`)
      .join('');
    const bubbleText = `${b.icon} ${b.thought}`;
    if (bubbleText !== this.bubbleText.textContent) {
      this.bubbleText.textContent = bubbleText;
      this.bubbleW = this.bubble.offsetWidth || this.bubbleW;
    }

    const dn = app.world.dayNight;
    this.clockEl.innerHTML = `<div class="time">${dn.night > 0.5 ? '🌙' : '☀️'} ${dn.clock()}</div><div class="dim">${dn.phaseName()} · Day ${dn.day} · ${app.weather.describe()}</div>`;
    this.camBtn.textContent = `🎥 ${app.cameraRig.mode === 'cinematic' ? 'Cinematic' : app.cameraRig.mode === 'orbit' ? 'Orbit' : app.cameraRig.mode === 'follow' ? 'Follow' : 'Fixed'}`;
    this.aiBtn.textContent = app.manual ? '🎮 Manual' : '🤖 AI';
    this.muteBtn.textContent = app.audio.muted ? '🔇' : '🔊';
    const sp = this.settingsPanel as HTMLElement & { _tod?: HTMLInputElement; _todOut?: HTMLElement };
    if (sp._tod && document.activeElement !== sp._tod) sp._tod.value = String(dn.time);
    if (sp._todOut) sp._todOut.textContent = dn.clock();
    this.mapT -= 0.12;
    if (this.mapT <= 0) {
      this.mapT = 0.24;
      this.drawMap();
    }
  }

  syncSettings(): void {
    for (const [k, inp] of this.settingsInputs) {
      const v = this.app.settings.get(k);
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = Boolean(v);
      else inp.value = String(v);
    }
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.root.remove();
  }
}
