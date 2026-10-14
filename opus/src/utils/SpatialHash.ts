/**
 * Uniform-grid spatial hash for 2D (xz) proximity queries. Rebuilt or
 * incrementally updated each frame for moving agents; static obstacles are
 * inserted once.
 */
export interface SpatialItem {
  x: number;
  z: number;
  radius: number;
}

export class SpatialHash<T extends SpatialItem> {
  private cells = new Map<number, T[]>();

  constructor(private cellSize = 4) {}

  private key(ix: number, iz: number): number {
    return ((ix + 32768) << 16) | ((iz + 32768) & 0xffff);
  }

  clear(): void {
    for (const arr of this.cells.values()) arr.length = 0;
  }

  insert(item: T): void {
    const cs = this.cellSize;
    const x0 = Math.floor((item.x - item.radius) / cs);
    const x1 = Math.floor((item.x + item.radius) / cs);
    const z0 = Math.floor((item.z - item.radius) / cs);
    const z1 = Math.floor((item.z + item.radius) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) {
          arr = [];
          this.cells.set(k, arr);
        }
        arr.push(item);
      }
    }
  }

  /** Collects unique items whose cells overlap the query circle. */
  query(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const z0 = Math.floor((z - r) / cs);
    const z1 = Math.floor((z + r) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(this.key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i];
          if (out.indexOf(it) === -1) out.push(it);
        }
      }
    }
    return out;
  }
}
