/** Minimal strongly-typed event bus used to decouple simulation, audio and UI. */
import type * as THREE from 'three';

export interface SimEvents {
  footstep: { x: number; y: number; z: number; strength: number; surface: 'grass' | 'dirt' | 'water' | 'rock'; animal: 'wolf' | 'deer' };
  howl: { x: number; y: number; z: number; pitch: number; leader: boolean };
  growl: { x: number; y: number; z: number };
  bark: { x: number; y: number; z: number; pitch: number };
  splash: { x: number; y: number; z: number; strength: number };
  shake: { x: number; y: number; z: number };
  jump: { x: number; y: number; z: number };
  land: { x: number; y: number; z: number; strength: number };
  kill: { x: number; y: number; z: number; prey: string };
  eat: { x: number; y: number; z: number };
  drink: { x: number; y: number; z: number };
  deerAlarm: { x: number; y: number; z: number };
  birdScatter: { x: number; y: number; z: number };
  fishJump: { x: number; y: number; z: number };
  lightning: { intensity: number; delay: number };
  reset: Record<string, never>;
  controlMode: { manual: boolean };
  thought: { text: string; icon: string };
  notify: { text: string };
  cameraMode: { mode: string };
  pointOfInterest: { pos: THREE.Vector3 };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof SimEvents, Set<Handler<unknown>>>();

  on<K extends keyof SimEvents>(type: K, fn: Handler<SimEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<SimEvents[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const events = new EventBus();
