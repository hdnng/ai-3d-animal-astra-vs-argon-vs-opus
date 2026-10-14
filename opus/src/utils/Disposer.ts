import * as THREE from 'three';

interface Disposable {
  dispose(): void;
}

/**
 * Tracks GPU resources (geometries, materials, textures, render targets) so a
 * subsystem can release everything it created in one call. Prevents leaks when
 * the world is reset/regenerated.
 */
export class Disposer {
  private items = new Set<Disposable>();

  track<T extends Disposable>(item: T): T {
    this.items.add(item);
    return item;
  }

  /** Tracks every geometry/material/texture referenced by an object subtree. */
  trackObject(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) this.items.add(mesh.geometry);
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (mat) {
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) this.trackMaterial(m);
      }
    });
  }

  trackMaterial(m: THREE.Material): void {
    this.items.add(m);
    for (const key of Object.keys(m)) {
      const v = (m as unknown as Record<string, unknown>)[key];
      if (v instanceof THREE.Texture) this.items.add(v);
    }
    const sm = m as THREE.ShaderMaterial;
    if (sm.uniforms) {
      for (const u of Object.values(sm.uniforms)) {
        if (u && u.value instanceof THREE.Texture) this.items.add(u.value);
      }
    }
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
