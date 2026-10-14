/// <reference lib="webworker" />
/** Web Worker: sculpts one species mesh (SDF -> surface nets -> skin) off the main thread. */
import { buildSpeciesData, transferablesOf } from './SpeciesBuilder';
import { SPECIES } from './species';

self.onmessage = (e: MessageEvent<{ name: string }>) => {
  const spec = SPECIES[e.data.name];
  if (!spec) {
    (self as DedicatedWorkerGlobalScope).postMessage({ error: `unknown species ${e.data.name}` });
    return;
  }
  const data = buildSpeciesData(spec);
  (self as DedicatedWorkerGlobalScope).postMessage({ data }, transferablesOf(data));
};
