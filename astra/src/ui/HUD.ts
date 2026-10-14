import { Brain } from "../ai/Brain";
import { Renderer } from "../render/Renderer";
import { World } from "../world/World";
export type UIActions = {
  manual: () => void;
  camera: (mode: string) => void;
  action: (state: string) => void;
  audio: () => void;
  reset: () => void;
  setting: (name: string, value: string | boolean) => void;
};
const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icons = {
  sun: icon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  ),
  sound: icon(
    '<path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 010 8m3-11a10 10 0 010 14"/>',
  ),
  settings: icon(
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#24372f"/><circle cx="16" cy="17" r="3" fill="#24372f"/>',
  ),
  eye: icon(
    '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  ),
};
export class HUD {
  root = document.createElement("div");
  map: CanvasRenderingContext2D;
  private refs: Record<string, HTMLElement> = {};
  private click: (e: MouseEvent) => void;
  private change: (e: Event) => void;
  constructor(public actions: UIActions) {
    this.root.id = "hud";
    this.root.innerHTML = `
 <header><div class="brand"><div class="eyebrow"><span class="small-line"></span> AN INTERACTIVE WILDLIFE STUDY</div><h1>Moss <em>&</em> Moon<span>®</span></h1><p>A small world. A wild life.</p></div><div class="top-tools"><div class="clock glass">${icons.sun}<div><b id="clock">16:00</b><span id="daylight">GOLDEN AFTERNOON</span></div><span class="weather-label" id="weather-label">18° · Clear</span></div><button class="icon-button glass" data-command="audio" aria-label="Enable procedural audio" title="Sound · Mute / unmute" id="audio-button">${icons.sound}<span class="sound-off"></span></button><button class="icon-button glass" data-command="settings" aria-label="Open settings" title="Settings">${icons.settings}</button></div></header>
 <div class="place"><span class="live-dot"></span> LIVE FROM THE WOODLAND <span class="separator">/</span> <span>THE WILLOW CLEARING</span></div>
 <aside class="subject glass"><div class="card-heading"><span>FIELD NOTES</span><span>NO. 001</span></div><div class="subject-title"><div><h2>Ember</h2><i>Vulpes vulpes</i></div><div class="fox-mark">◈</div></div><div class="species-line">RED FOX <span>·</span> YOUNG ADULT</div><div class="behavior"><span class="live-dot"></span><b id="state">Exploring</b><span id="state-icon">↗</span></div><p id="thought">A familiar scent on the breeze</p><div class="needs"><div class="need"><span>Hunger</span><div><i id="hunger-bar"></i></div><b id="hunger">26%</b></div><div class="need thirst"><span>Thirst</span><div><i id="thirst-bar"></i></div><b id="thirst">33%</b></div><div class="need energy"><span>Energy</span><div><i id="energy-bar"></i></div><b id="energy">84%</b></div></div><button class="control-toggle" data-command="manual" id="manual-button"><span class="toggle-track"><i></i></span><span id="mode">Autonomous</span><kbd>M</kbd></button><div class="subject-footer"><span id="distance">0 m explored</span><span>◌ &nbsp; Free-roaming</span></div></aside>
 <div class="observation"><span class="observation-dot"></span><span id="observation">Let the woodland tell its story.</span></div>
 <nav class="camera-bar glass" aria-label="Camera mode"><span class="camera-label">${icons.eye}</span><button data-camera="follow" class="active">Follow</button><button data-camera="orbit">Orbit</button><button data-camera="cinematic">Cinematic</button></nav>
 <div class="actions"><button data-action="jump"><kbd>SPACE</kbd> Jump</button><button data-action="howl"><kbd>H</kbd> Call</button><button data-action="shake"><kbd>Q</kbd> Shake</button><button data-action="sleep"><kbd>R</kbd> Rest</button></div>
 <aside class="map-panel"><div class="map-title"><span>THE CLEARING</span><span>N ↑</span></div><canvas id="minimap" width="170" height="170" aria-label="Map of fox, pond, trees, and rabbits"></canvas><div class="map-key"><span><i></i> Ember</span><span><i></i> Wildlife</span></div></aside>
 <footer><div><span class="live-dot"></span><b id="fps">60 FPS</b><span id="frametime">16.7 ms</span><span class="footer-divider">|</span><span id="entities">39 creatures</span><span id="quality">HIGH</span></div><div class="control-hint"><kbd>W A S D</kbd> move <kbd>SHIFT</kbd> run <span>·</span> Drag to look <span>·</span> Scroll to explore</div><span class="edition">PROCEDURAL BY NATURE</span></footer>
 <section id="settings" class="settings glass" hidden aria-label="Settings"><div class="settings-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h2>The observatory</h2></div><button data-command="settings" aria-label="Close settings">×</button></div><label>Shadow quality<select name="shadows"><option value="high">High · 2048</option><option value="medium">Medium · 1024</option><option value="off">Off</option></select></label><label>Resolution <output id="resolution-value">100%</output><input name="resolution" type="range" min="0.5" max="1.5" step="0.1" value="1"></label><label>Post-processing<input name="post" type="checkbox" checked></label><label>Rain<input name="weather" type="checkbox"></label><label>Adaptive quality<input name="adaptive" type="checkbox" checked></label><label>Time speed <output id="time-speed-value">1×</output><input name="timeSpeed" type="range" min="0" max="10" step="0.5" value="1"></label><label>Time of day<input name="hour" type="range" min="0" max="23.9" step="0.1" value="16"></label><div class="settings-divider">UNDER THE CANOPY · DEBUG</div><label>Skeleton<input name="skeleton" type="checkbox"></label><label>AI route<input name="target" type="checkbox"></label><label>Wireframe<input name="wireframe" type="checkbox"></label><button class="reset-button" data-command="reset">↻ &nbsp; Reset the woodland</button><p>Everything here is grown from code.<br>No models, textures, recordings, or downloads.</p></section>
 <div id="toast" role="status" aria-live="polite"></div>`;
    document.body.append(this.root);
    this.map = (
      this.root.querySelector("#minimap") as HTMLCanvasElement
    ).getContext("2d")!;
    this.root
      .querySelectorAll<HTMLElement>("[id]")
      .forEach((e) => (this.refs[e.id] = e));
    this.click = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.camera) {
        actions.camera(b.dataset.camera);
        return;
      }
      if (b.dataset.action) {
        actions.action(b.dataset.action);
        return;
      }
      switch (b.dataset.command) {
        case "settings":
          this.refs.settings.hidden = !this.refs.settings.hidden;
          break;
        case "manual":
          actions.manual();
          break;
        case "audio":
          actions.audio();
          break;
        case "reset":
          actions.reset();
          break;
      }
    };
    this.change = (e) => {
      const el = e.target as HTMLInputElement;
      actions.setting(el.name, el.type === "checkbox" ? el.checked : el.value);
      if (el.name === "resolution")
        this.refs["resolution-value"].textContent =
          `${Math.round(+el.value * 100)}%`;
      if (el.name === "timeSpeed")
        this.refs["time-speed-value"].textContent = `${el.value}×`;
    };
    this.root.addEventListener("click", this.click);
    this.root.addEventListener("input", this.change);
  }
  toast(message: string) {
    this.refs.toast.textContent = message;
    this.refs.toast.classList.remove("show");
    void this.refs.toast.offsetWidth;
    this.refs.toast.classList.add("show");
  }
  update(
    brain: Brain,
    view: Renderer,
    world: World,
    fps: number,
    ms: number,
    hour: number,
  ) {
    const f = brain.fox;
    const stateNames: Record<string, string> = {
      idle: "Listening",
      walk: "Exploring",
      run: "On the move",
      turn: "Looking around",
      sleep: "Resting",
      eat: "Foraging",
      drink: "Drinking",
      jump: "In the air",
      howl: "Calling",
      shake: "Shaking off",
    };
    this.refs.state.textContent = stateNames[f.state];
    this.refs.state.dataset.state = f.state;
    this.refs.thought.textContent = brain.manual
      ? "Your footsteps. Your adventure."
      : brain.thought;
    this.refs.mode.textContent = brain.manual ? "Manual control" : "Autonomous";
    this.refs["manual-button"].classList.toggle("manual", brain.manual);
    for (const [key, value] of Object.entries(brain.needs)) {
      this.refs[key].textContent = `${Math.round(value)}%`;
      this.refs[key + "-bar"].style.width = `${value}%`;
    }
    this.refs.clock.textContent = `${Math.floor(hour).toString().padStart(2, "0")}:${Math.floor(
      (hour % 1) * 60,
    )
      .toString()
      .padStart(2, "0")}`;
    this.refs.daylight.textContent =
      hour < 6 || hour >= 20
        ? "UNDER THE STARS"
        : hour < 9
          ? "FIRST LIGHT"
          : hour < 15
            ? "DAY IN THE WOODLAND"
            : hour < 18
              ? "GOLDEN AFTERNOON"
              : "THE BLUE HOUR";
    this.refs["weather-label"].textContent = world.weather
      ? "14° · Rain"
      : "18° · Clear";
    this.refs.fps.textContent = `${Math.round(fps)} FPS`;
    this.refs.frametime.textContent = `${ms.toFixed(1)} ms`;
    this.refs.entities.textContent = `${world.animalCount + 1} creatures`;
    this.refs.quality.textContent = `${view.quality.toUpperCase()} · ${Math.round(view.scale * 100)}%`;
    const settings = this.refs.settings;
    if (!settings.hidden) {
      const shadow =
        settings.querySelector<HTMLSelectElement>("[name=shadows]")!;
      if (document.activeElement !== shadow) shadow.value = view.quality;
      const res =
        settings.querySelector<HTMLInputElement>("[name=resolution]")!;
      if (document.activeElement !== res) {
        res.value = String(view.scale);
        this.refs["resolution-value"].textContent =
          `${Math.round(view.scale * 100)}%`;
      }
      settings.querySelector<HTMLInputElement>("[name=post]")!.checked =
        view.post;
    }
    this.refs.distance.textContent = `${Math.floor(brain.distance)} m explored`;
    this.root
      .querySelectorAll<HTMLElement>("[data-camera]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.camera === view.mode),
      );
    this.drawMap(brain, world);
  }
  drawMap(brain: Brain, world: World) {
    const c = this.map;
    c.clearRect(0, 0, 170, 170);
    c.fillStyle = "#d6debc10";
    for (const o of world.obstacles) {
      c.beginPath();
      c.arc(85 + o.x * 1.7, 85 + o.z * 1.7, o.r * 1.7 + 1, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#8ca7a340";
    c.beginPath();
    c.ellipse(97, 90, 12, 8, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#e1d7b777";
    world.rabbits.forEach((r) => {
      c.beginPath();
      c.arc(85 + r.x * 1.7, 85 + r.z * 1.7, 1.4, 0, 6.28);
      c.fill();
    });
    c.save();
    c.translate(
      85 + brain.fox.root.position.x * 1.7,
      85 + brain.fox.root.position.z * 1.7,
    );
    c.rotate(-brain.fox.heading);
    c.fillStyle = "#e5a173";
    c.shadowColor = "#eeaa77";
    c.shadowBlur = 8;
    c.beginPath();
    c.moveTo(0, 6);
    c.lineTo(-3, -3);
    c.lineTo(3, -3);
    c.closePath();
    c.fill();
    c.restore();
  }
  resetControls() {
    for (const name of ["weather", "skeleton", "target", "wireframe"])
      (this.root.querySelector(`[name=${name}]`) as HTMLInputElement).checked =
        false;
    (this.root.querySelector("[name=timeSpeed]") as HTMLInputElement).value =
      "1";
    (this.root.querySelector("[name=hour]") as HTMLInputElement).value = "16";
    this.refs["time-speed-value"].textContent = "1×";
  }
  setMuted(muted: boolean) {
    this.refs["audio-button"].classList.toggle("audible", !muted);
    this.refs["audio-button"].setAttribute(
      "aria-label",
      muted ? "Enable procedural audio" : "Mute audio",
    );
  }
  dispose() {
    this.root.removeEventListener("click", this.click);
    this.root.removeEventListener("input", this.change);
    this.root.remove();
  }
}
