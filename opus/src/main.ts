import './ui/styles.css';
import './ui/hud.css';
import { App } from './core/App';
import { installDebugApi } from './core/DebugApi';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 20261014) | 0;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

// Loading screen while the world and creatures are generated.
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = '<div class="title">LUPUS</div><div class="msg">Preparing…</div><div class="spinner"></div>';
document.getElementById('app')!.appendChild(loading);
const msg = loading.querySelector('.msg') as HTMLElement;

const app = new App(canvas, {
  seed,
  settings: {},
  startTime: params.has('time') ? Number(params.get('time')) : undefined,
  autostart: params.has('autostart'),
  fixedQuality: params.has('fixed'),
});

app
  .init((m) => (msg.textContent = m))
  .then(() => {
    installDebugApi(app);
    app.start();
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 700);
  });
