/// <reference lib="webworker" />
/** Web Worker: generates the heightfield and biome masks off the main thread. */
import { TerrainData } from './WorldGen';

self.onmessage = (e: MessageEvent<{ seed: number }>) => {
  const t = new TerrainData(e.data.seed);
  const a = t.toArrays();
  (self as DedicatedWorkerGlobalScope).postMessage(a, [a.heights.buffer, a.normals.buffer, a.forest.buffer, a.grass.buffer, a.meadow.buffer] as ArrayBuffer[]);
};
