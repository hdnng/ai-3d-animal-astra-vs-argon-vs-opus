import { Vector3 } from "three";
import { World } from "../world/World";
import { heightAt } from "../world/terrain";
import { clamp } from "../utils/math";

/** Static occupancy + an allocation-free binary heap keep A* off the frame-time hot path. */
export class Navigation {
  private size = 81;
  private step = 1;
  private half = 40;
  private blocked = new Uint8Array(6561);
  private costs = new Float32Array(6561);
  private closed = new Uint8Array(6561);
  private parent = new Int32Array(6561);
  private scores = new Float32Array(6561);
  private heap: number[] = [];
  constructor(world: World) {
    for (let z = 0; z < this.size; z++)
      for (let x = 0; x < this.size; x++)
        this.blocked[z * this.size + x] = Number(
          world.blocked(x - this.half, z - this.half, 0.5),
        );
  }
  private push(n: number) {
    let i = this.heap.length;
    this.heap.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[this.heap[p]] <= this.scores[n]) break;
      this.heap[i] = this.heap[p];
      i = p;
    }
    this.heap[i] = n;
  }
  private pop() {
    const root = this.heap[0],
      last = this.heap.pop()!;
    if (this.heap.length) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.heap.length &&
          this.scores[this.heap[c + 1]] < this.scores[this.heap[c]]
        )
          c++;
        if (this.scores[last] <= this.scores[this.heap[c]]) break;
        this.heap[i] = this.heap[c];
        i = c;
      }
      this.heap[i] = last;
    }
    return root;
  }
  path(start: Vector3, end: Vector3) {
    const size = this.size,
      half = this.half;
    const index = (p: Vector3) =>
      clamp(Math.round(p.z) + half, 0, size - 1) * size +
      clamp(Math.round(p.x) + half, 0, size - 1);
    const s = index(start);
    let goal = index(end);
    if (this.blocked[goal]) {
      let best = -1,
        bestD = Infinity;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = (goal % size) + dx,
            z = Math.floor(goal / size) + dz,
            n = z * size + x;
          if (x < 0 || z < 0 || x >= size || z >= size || this.blocked[n])
            continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            best = n;
            bestD = d;
          }
        }
      if (best < 0) return [];
      goal = best;
    }
    const gx = goal % size,
      gz = Math.floor(goal / size);
    const heuristic = (n: number) => {
      const dx = Math.abs((n % size) - gx),
        dz = Math.abs(Math.floor(n / size) - gz);
      return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
    };
    this.costs.fill(Infinity);
    this.closed.fill(0);
    this.parent.fill(-1);
    this.heap.length = 0;
    this.costs[s] = 0;
    this.scores[s] = heuristic(s);
    this.push(s);
    let found = false;
    for (let loops = 0; this.heap.length && loops < 2500; loops++) {
      const c = this.pop();
      if (c === goal) {
        found = true;
        break;
      }
      if (this.closed[c]) continue;
      this.closed[c] = 1;
      const cx = c % size,
        cz = Math.floor(c / size);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx,
            z = cz + dz,
            n = z * size + x;
          if (
            x < 0 ||
            z < 0 ||
            x >= size ||
            z >= size ||
            this.closed[n] ||
            this.blocked[n]
          )
            continue;
          if (
            dx &&
            dz &&
            (this.blocked[cz * size + x] || this.blocked[z * size + cx])
          )
            continue;
          const cost = this.costs[c] + (dx && dz ? Math.SQRT2 : 1);
          if (cost < this.costs[n]) {
            this.parent[n] = c;
            this.costs[n] = cost;
            this.scores[n] = cost + heuristic(n);
            this.push(n);
          }
        }
    }
    if (!found) return [];
    const result: Vector3[] = [];
    for (let n = goal; n !== s; n = this.parent[n]) {
      const x = (n % size) - half,
        z = Math.floor(n / size) - half;
      result.unshift(new Vector3(x, heightAt(x, z), z));
    }
    if (!this.blocked[index(end)]) result.push(end.clone());
    return result;
  }
}
