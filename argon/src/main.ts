import { SimulationEngine } from './core/Engine';

declare global {
  interface Window {
    __WOLF_SIM__?: SimulationEngine;
  }
}

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Missing #viewport canvas element');
}

const engine = new SimulationEngine(canvas);
window.__WOLF_SIM__ = engine;
engine.start();
