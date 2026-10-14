import * as T from "three";
import { fbm, clamp } from "../utils/math";
export const WORLD_RADIUS = 43;
export const POND = { x: 7, z: 3, rx: 7, rz: 4.8, level: -0.18 };
export function pondDistance(x: number, z: number) {
  return Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
}
function rawHeight(x: number, z: number) {
  const d = pondDistance(x, z);
  const base = fbm(x * 0.075, z * 0.075) * 1.7 + fbm(x * 0.29, z * 0.29) * 0.16;
  const rim = Math.max(base, 0.05);
  const basin = T.MathUtils.lerp(
    -0.9,
    rim,
    T.MathUtils.smoothstep(d, 0.75, 1.15),
  );
  const ground = T.MathUtils.lerp(
    basin,
    base,
    T.MathUtils.smoothstep(d, 1.15, 1.8),
  );
  return ground + Math.max(0, Math.hypot(x, z) - 25) * 0.08;
}
const segments = 140,
  span = 110,
  spacing = span / segments,
  grid = new Float32Array((segments + 1) ** 2);
for (let z = 0; z <= segments; z++)
  for (let x = 0; x <= segments; x++)
    grid[z * (segments + 1) + x] = rawHeight(
      x * spacing - span / 2,
      z * spacing - span / 2,
    );
/** Barycentric interpolation matches the rendered triangles exactly, including the pond bank.
 * Cached noise samples also remove thousands of trigonometric calls from every simulation step. */
export function heightAt(x: number, z: number) {
  const gx = clamp((x + span / 2) / spacing, 0, segments - 0.00001),
    gz = clamp((z + span / 2) / spacing, 0, segments - 0.00001);
  const ix = Math.floor(gx),
    iz = Math.floor(gz),
    u = gx - ix,
    v = gz - iz,
    a = iz * (segments + 1) + ix;
  const h00 = grid[a],
    h10 = grid[a + 1],
    h01 = grid[a + segments + 1],
    h11 = grid[a + segments + 2];
  return u + v <= 1
    ? h00 + (h10 - h00) * u + (h01 - h00) * v
    : h11 + (h10 - h11) * (1 - v) + (h01 - h11) * (1 - u);
}
export function createTerrain() {
  const geo = new T.PlaneGeometry(110, 110, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position,
    colors = [];
  const green = new T.Color("#647850"),
    sand = new T.Color("#a4a17b"),
    dark = new T.Color("#354b34");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      h = heightAt(x, z);
    p.setY(i, h);
    const c = green
      .clone()
      .lerp(dark, clamp(fbm(x * 0.16, z * 0.16) * 1.2 + 0.25));
    c.lerp(sand, clamp(1 - Math.abs(pondDistance(x, z) - 1.13) * 3.5) * 0.85);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new T.Mesh(
    geo,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  mesh.receiveShadow = true;
  mesh.name = "multi-octave terrain";
  return mesh;
}
