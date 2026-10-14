/**
 * Procedural geometry for vegetation and props. Every generator returns a
 * non-indexed-or-indexed BufferGeometry with vertex colours and an `aWind`
 * attribute (0 = rigid, 1 = fully flexible) used by the wind shader.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from '../utils/noise';
import { Random } from '../utils/Random';

const noise = new SimplexNoise(4242);

function setColor(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, i: number) => THREE.Color): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = fn(p, n, i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function setWind(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const w = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    w[i] = fn(p);
  }
  geo.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
}

/** Keeps only the attributes every merged part shares. */
function clean(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aWind'].includes(k)) g.deleteAttribute(k);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(clean), false);
  if (!m) throw new Error('merge failed');
  for (const p of parts) p.dispose();
  m.computeBoundingSphere();
  return m;
}

function trunk(height: number, r0: number, radial: number, rings: number, bend: number, seed: number, color: (y: number, a: number) => THREE.Color): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r0 * 0.18, r0, height, radial, rings, true);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = y / height;
    const flare = 1 + Math.pow(1 - t, 6) * 0.6;
    const bx = Math.sin(t * 2.2 + seed) * bend * t;
    const bz = Math.cos(t * 1.7 + seed * 1.3) * bend * t;
    pos.setXYZ(i, x * flare + bx, y, z * flare + bz);
  }
  geo.computeVertexNormals();
  setColor(geo, (p) => color(p.y / height, Math.atan2(p.z, p.x)));
  setWind(geo, (p) => Math.pow(p.y / height, 2) * 0.35);
  return geo;
}

const PINE_DARK = new THREE.Color(0x1d3320);
const PINE_MID = new THREE.Color(0x2c4a2a);
const PINE_TIP = new THREE.Color(0x4f6b35);
const BARK = new THREE.Color(0x4a3a2c);

/** Conifer: tapered trunk + stacked jagged drooping cones. */
export function pineGeometry(lod: number, seed: number): THREE.BufferGeometry {
  const rnd = new Random(seed);
  const H = 9 + rnd.next() * 3;
  const parts: THREE.BufferGeometry[] = [];
  const radial = [7, 5, 4][lod];
  parts.push(
    trunk(H * 0.95, 0.26, radial, lod === 0 ? 5 : 2, 0.12, seed, (t) => BARK.clone().multiplyScalar(0.7 + 0.3 * t)),
  );
  const tiers = [7, 5, 2][lod];
  const segs = [11, 8, 6][lod];
  const c = new THREE.Color();
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1 || 1);
    const baseY = H * (0.2 + f * 0.62);
    const coneH = H * (lod === 2 ? 0.55 : 0.34 - f * 0.12);
    const radius = (lod === 2 ? 2.4 : 2.6) * (1 - f * 0.78) + 0.25;
    const cone = new THREE.ConeGeometry(radius, coneH, segs, lod === 0 ? 3 : 1, true);
    cone.translate(0, baseY + coneH / 2, 0);
    const pos = cone.attributes.position as THREE.BufferAttribute;
    const phase = rnd.next() * 10;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const rr = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const edge = rr / radius;
      const jag = 1 + 0.22 * Math.sin(a * segs * 0.5 + phase) * edge + noise.noise2(a * 2 + k, phase) * 0.12 * edge;
      const droop = edge * edge * radius * 0.28;
      pos.setXYZ(i, x * jag, y - droop, z * jag);
    }
    cone.computeVertexNormals();
    // Soften normals toward a sphere around the tree for fluffy lighting.
    const nor = cone.attributes.normal as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), (pos.getY(i) - H * 0.55) * 0.6, pos.getZ(i)).normalize();
      const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, 0.55).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    setColor(cone, (p) => {
      const rr = Math.hypot(p.x, p.z) / radius;
      c.copy(PINE_DARK).lerp(PINE_MID, rr).lerp(PINE_TIP, Math.max(0, rr - 0.65) * 1.2 * (0.6 + f * 0.5));
      return c.multiplyScalar(0.85 + 0.3 * noise.noise2(p.x * 0.8 + seed, p.z * 0.8 + p.y));
    });
    setWind(cone, (p) => Math.min(1, Math.pow(p.y / H, 1.5) + (Math.hypot(p.x, p.z) / radius) * 0.4));
    parts.push(cone);
  }
  return merge(parts);
}

/** Autumn palette for deciduous canopies. */
export const AUTUMN = [0xd9a12b, 0xe0b23a, 0xc8692a, 0xb9461f, 0x8e2c1a, 0x9aa23a, 0x6d8a2f].map((h) => new THREE.Color(h));

/** Deciduous tree (birch/aspen): pale trunk, a few branches, clustered blob canopy. */
export function broadleafGeometry(lod: number, seed: number, palette: THREE.Color[]): THREE.BufferGeometry {
  const rnd = new Random(seed);
  const H = 6.5 + rnd.next() * 2.5;
  const parts: THREE.BufferGeometry[] = [];
  const birch = rnd.next() < 0.6;
  const barkA = birch ? new THREE.Color(0xd8d2c4) : new THREE.Color(0x5a4636);
  const barkB = birch ? new THREE.Color(0x2a2622) : new THREE.Color(0x3b2e24);
  parts.push(
    trunk(H * 0.75, 0.18, [7, 5, 4][lod], lod === 0 ? 5 : 2, 0.18, seed, (t, a) => {
      const spot = noise.noise2(a * 3, t * 18 + seed) > 0.45 ? 1 : 0;
      return barkA.clone().lerp(barkB, birch ? spot * 0.85 : 0.2 + 0.3 * t);
    }),
  );
  const clusters = [12, 6, 3][lod];
  const detail = [2, 1, 0][lod];
  const base = palette[Math.floor(rnd.next() * palette.length)];
  const alt = palette[Math.floor(rnd.next() * palette.length)];
  const c = new THREE.Color();
  const crownR = 1.9 + rnd.next() * 0.6;
  for (let k = 0; k < clusters; k++) {
    // Distribute clusters over an ellipsoidal crown.
    const a = (k / clusters) * Math.PI * 2 + rnd.next() * 0.8;
    const up = k === 0 ? 1 : rnd.next();
    const rr = k === 0 ? 0 : crownR * (0.45 + 0.55 * Math.sqrt(1 - up * up)) * (lod === 2 ? 0.6 : 1);
    const cy = H * 0.66 + up * H * 0.3;
    const size = (lod === 2 ? 1.7 : 0.85 + rnd.next() * 0.55) * (k === 0 ? 1.35 : 1);
    const blob = mergeVertices(new THREE.IcosahedronGeometry(size, detail).deleteAttribute('normal').deleteAttribute('uv'));
    const pos = blob.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const d = 1 + noise.noise3(x * 1.6 + k * 3, y * 1.6, z * 1.6 + seed) * 0.3;
      pos.setXYZ(i, x * d, y * d * 0.8, z * d);
    }
    blob.translate(Math.cos(a) * rr, cy, Math.sin(a) * rr);
    blob.computeVertexNormals();
    const center = new THREE.Vector3(0, H * 0.78, 0);
    const nor = blob.attributes.normal as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).normalize();
      const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, 0.5).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    const mix = rnd.next();
    setColor(blob, (p) => {
      const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (p.y - H * 0.5) / (H * 0.45)));
      c.copy(base).lerp(alt, mix * 0.6 + 0.4 * (noise.noise3(p.x * 0.9, p.y * 0.9, p.z * 0.9) * 0.5 + 0.5));
      return c.multiplyScalar(ao * (0.85 + 0.25 * noise.noise3(p.x * 3, p.y * 3, p.z * 3)));
    });
    setWind(blob, (p) => Math.min(1, 0.55 + (p.y / H) * 0.45));
    parts.push(blob);
    // A branch toward each outer cluster (LOD0 only).
    if (lod === 0 && k > 0 && k < 7) {
      const from = new THREE.Vector3(0, H * (0.42 + rnd.next() * 0.2), 0);
      const to = new THREE.Vector3(Math.cos(a) * rr * 0.85, cy - size * 0.4, Math.sin(a) * rr * 0.85);
      const len = from.distanceTo(to);
      const br = new THREE.CylinderGeometry(0.03, 0.065, len, 5, 1, true);
      br.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      br.applyQuaternion(q);
      br.translate(from.x, from.y, from.z);
      setColor(br, () => barkA.clone().multiplyScalar(0.8));
      setWind(br, () => 0.4);
      parts.push(br);
    }
  }
  return merge(parts);
}

/** Boulder / stone: displaced icosphere with moss on top. */
export function rockGeometry(lod: number, seed: number, flat = 0.65): THREE.BufferGeometry {
  const detail = [3, 2, 1][lod];
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const rnd = new Random(seed);
  const sx = 0.8 + rnd.next() * 0.5;
  const sz = 0.8 + rnd.next() * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let d = 1 + noise.fbm3(x * 1.3 + seed, y * 1.3, z * 1.3 - seed, 4) * 0.35;
    d += Math.abs(noise.noise3(x * 3 + seed, y * 3, z * 3)) * -0.12;
    // facet-like flattening on a few planes
    const planeCut = Math.max(0, x * 0.6 + y * 0.8 - 0.75) * 0.5;
    d -= planeCut;
    pos.setXYZ(i, x * d * sx, y * d * flat, z * d * sz);
  }
  geo.computeVertexNormals();
  const c = new THREE.Color();
  const base = new THREE.Color(0x77736b);
  const dark = new THREE.Color(0x4a4741);
  const moss = new THREE.Color(0x4d5a2a);
  const lichen = new THREE.Color(0xa49a6a);
  setColor(geo, (p, n) => {
    const v = noise.fbm3(p.x * 2 + seed, p.y * 2, p.z * 2, 3);
    c.copy(base).lerp(dark, Math.max(0, -v) * 1.2 + Math.max(0, -p.y) * 0.3);
    c.lerp(moss, Math.max(0, n.y - 0.45) * 1.6 * (0.6 + v));
    if (noise.noise3(p.x * 6, p.y * 6, p.z * 6 + seed) > 0.55) c.lerp(lichen, 0.5);
    return c;
  });
  setWind(geo, () => 0);
  geo.computeBoundingSphere();
  return geo;
}

/** Shrub made of several small leafy blobs, optionally with berries. */
export function bushGeometry(lod: number, seed: number, leaf: THREE.Color, berries: boolean): THREE.BufferGeometry {
  const rnd = new Random(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = [7, 4, 1][lod];
  const c = new THREE.Color();
  const dark = leaf.clone().multiplyScalar(0.45);
  for (let k = 0; k < n; k++) {
    const r = lod === 2 ? 0.6 : 0.26 + rnd.next() * 0.2;
    const blob = mergeVertices(new THREE.IcosahedronGeometry(r, lod === 0 ? 1 : 0).deleteAttribute('normal').deleteAttribute('uv'));
    const pos = blob.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const d = 1 + noise.noise3(pos.getX(i) * 5 + k, pos.getY(i) * 5, pos.getZ(i) * 5 + seed) * 0.22;
      pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * d * 0.85, pos.getZ(i) * d);
    }
    const a = rnd.next() * Math.PI * 2;
    const off = lod === 2 ? 0 : 0.1 + rnd.next() * 0.38;
    blob.translate(Math.cos(a) * off, r * 0.7 + rnd.next() * 0.25, Math.sin(a) * off);
    blob.computeVertexNormals();
    const nor = blob.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i) - 0.2, pos.getZ(i)).normalize();
      const nn = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, 0.7).normalize();
      nor.setXYZ(i, nn.x, nn.y, nn.z);
    }
    setColor(blob, (p) => {
      const ao = Math.min(1, 0.45 + p.y * 0.9);
      c.copy(dark).lerp(leaf, ao);
      return c.multiplyScalar(0.85 + 0.3 * noise.noise3(p.x * 9, p.y * 9, p.z * 9));
    });
    setWind(blob, (p) => Math.min(1, 0.25 + p.y * 0.9));
    parts.push(blob);
  }
  if (berries && lod === 0) {
    const red = new THREE.Color(0xa3141c);
    for (let k = 0; k < 16; k++) {
      const b = new THREE.IcosahedronGeometry(0.035, 0);
      const a = rnd.next() * Math.PI * 2;
      const h = 0.25 + rnd.next() * 0.45;
      const rr = 0.3 + rnd.next() * 0.2;
      b.translate(Math.cos(a) * rr, h, Math.sin(a) * rr);
      setColor(b, () => red);
      setWind(b, () => 0.6);
      parts.push(b);
    }
  }
  return merge(parts);
}

/** Small meadow flower: two crossed stem quads + petal disc. Coloured per instance. */
export function flowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stemC = new THREE.Color(0x3d5a22);
  for (let k = 0; k < 2; k++) {
    const stem = new THREE.PlaneGeometry(0.02, 0.32, 1, 2);
    stem.translate(0, 0.16, 0);
    stem.rotateY(k * Math.PI * 0.5);
    setColor(stem, () => stemC);
    setWind(stem, (p) => p.y / 0.32);
    parts.push(stem);
  }
  const head = new THREE.CircleGeometry(0.065, 7);
  const pos = head.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const petal = 0.75 + 0.25 * Math.cos(a * 5);
    pos.setXY(i, Math.cos(a) * r * petal, Math.sin(a) * r * petal);
  }
  head.rotateX(-Math.PI / 2 + 0.35);
  head.translate(0, 0.32, 0);
  head.computeVertexNormals();
  setColor(head, (p) => (Math.hypot(p.x, p.z) < 0.02 ? new THREE.Color(0.9, 0.75, 0.2) : new THREE.Color(1, 1, 1)));
  setWind(head, () => 1);
  parts.push(head);
  return merge(parts);
}

/** Fly-agaric mushroom (red cap, white stem). */
export function mushroomGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.025, 0.035, 0.12, 6, 1);
  stem.translate(0, 0.06, 0);
  setColor(stem, () => new THREE.Color(0xe8e2d0));
  setWind(stem, () => 0);
  const cap = new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.65, 1);
  cap.translate(0, 0.11, 0);
  setColor(cap, (p) => (noise.noise2(p.x * 60, p.z * 60) > 0.55 ? new THREE.Color(0xf2ece0) : new THREE.Color(0xb3241a)));
  setWind(cap, () => 0);
  return merge([stem, cap]);
}

/** Fallen log with bark and pale cut ends. */
export function logGeometry(length: number, radius: number): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(radius, radius * 1.08, length, 9, 4, false);
  body.rotateZ(Math.PI / 2);
  const pos = body.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = 1 + noise.noise2(pos.getX(i) * 2, Math.atan2(z, y) * 2) * 0.08;
    pos.setY(i, y * d);
    pos.setZ(i, z * d);
  }
  body.computeVertexNormals();
  const bark = new THREE.Color(0x4b3a2a);
  const wood = new THREE.Color(0xb59a6e);
  const moss = new THREE.Color(0x4f5d2a);
  setColor(body, (p, n) => {
    if (Math.abs(n.x) > 0.9) return wood;
    const c = bark.clone().multiplyScalar(0.8 + 0.3 * noise.noise2(p.x * 3, p.y * 9));
    return c.lerp(moss, Math.max(0, n.y - 0.5) * 1.2);
  });
  setWind(body, () => 0);
  return body;
}

/** Shoreline reeds / cattails. */
export function reedGeometry(seed: number): THREE.BufferGeometry {
  const rnd = new Random(seed);
  const parts: THREE.BufferGeometry[] = [];
  const green = new THREE.Color(0x5a6e2a);
  const dry = new THREE.Color(0xa08850);
  for (let k = 0; k < 7; k++) {
    const h = 0.9 + rnd.next() * 0.8;
    const blade = new THREE.PlaneGeometry(0.035, h, 1, 3);
    blade.translate(0, h / 2, 0);
    const pos = blade.attributes.position as THREE.BufferAttribute;
    const lean = (rnd.next() - 0.5) * 0.35;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / h;
      pos.setX(i, pos.getX(i) * (1 - t * 0.8) + lean * t * t);
    }
    blade.rotateY(rnd.next() * Math.PI);
    blade.translate((rnd.next() - 0.5) * 0.3, 0, (rnd.next() - 0.5) * 0.3);
    blade.computeVertexNormals();
    const mix = rnd.next();
    setColor(blade, (p) => green.clone().lerp(dry, mix * 0.7).multiplyScalar(0.6 + 0.4 * (p.y / h)));
    setWind(blade, (p) => p.y / h);
    parts.push(blade);
    if (k < 2) {
      const head = new THREE.CylinderGeometry(0.03, 0.03, 0.16, 5);
      head.translate(lean * 0.9, h * 0.92, 0);
      setColor(head, () => new THREE.Color(0x4a2e1c));
      setWind(head, () => 1);
      parts.push(head);
    }
  }
  return merge(parts);
}

/** Floating lily pad. */
export function lilyGeometry(): THREE.BufferGeometry {
  const pad = new THREE.CircleGeometry(0.28, 10, 0.3, Math.PI * 2 - 0.6);
  pad.rotateX(-Math.PI / 2);
  setColor(pad, (p) => new THREE.Color(0x3d5e26).multiplyScalar(0.8 + 0.4 * Math.hypot(p.x, p.z) / 0.28));
  setWind(pad, () => 0.15);
  return pad;
}
