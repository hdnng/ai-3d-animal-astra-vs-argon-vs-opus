import * as THREE from 'three';

/**
 * Recursively disposes geometries, materials, and textures on an Object3D hierarchy
 * to guarantee zero GPU memory leaks across resets or long runs.
 */
export function disposeHierarchy(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material) {
          disposeMaterial(mat);
        }
      } else {
        disposeMaterial(mesh.material);
      }
    }
  });
}

export function disposeMaterial(mat: THREE.Material): void {
  const anyMat = mat as unknown as Record<string, unknown>;
  for (const key of Object.keys(anyMat)) {
    const val = anyMat[key];
    if (val && typeof val === 'object' && 'isTexture' in val) {
      (val as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}
