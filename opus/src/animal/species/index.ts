import type { SpeciesSpec } from './types';
import { WOLF } from './Wolf';
import { DEER } from './Deer';

/** Registry of all species by name (used by the mesh worker). */
export const SPECIES: Record<string, SpeciesSpec> = {
  wolf: WOLF,
  deer: DEER,
};
