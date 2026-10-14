/** Min binary heap keyed by a numeric score array (used by A*). */
export class BinaryHeap {
  private data: number[] = [];

  constructor(private score: Float32Array) {}

  get size(): number {
    return this.data.length;
  }

  clear(): void {
    this.data.length = 0;
  }

  push(node: number): void {
    const d = this.data;
    d.push(node);
    this.bubbleUp(d.length - 1);
  }

  pop(): number {
    const d = this.data;
    const top = d[0];
    const last = d.pop()!;
    if (d.length > 0) {
      d[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(n: number): void {
    const d = this.data;
    const s = this.score;
    const el = d[n];
    const es = s[el];
    while (n > 0) {
      const p = (n - 1) >> 1;
      const parent = d[p];
      if (es >= s[parent]) break;
      d[p] = el;
      d[n] = parent;
      n = p;
    }
  }

  private sinkDown(n: number): void {
    const d = this.data;
    const s = this.score;
    const len = d.length;
    const el = d[n];
    const es = s[el];
    for (;;) {
      const r = (n + 1) << 1;
      const l = r - 1;
      let swap = -1;
      let best = es;
      if (l < len && s[d[l]] < best) {
        swap = l;
        best = s[d[l]];
      }
      if (r < len && s[d[r]] < best) swap = r;
      if (swap === -1) break;
      d[n] = d[swap];
      d[swap] = el;
      n = swap;
    }
  }
}
