import * as T from "three";
import { lerp } from "../utils/math";
export type Section = [number, number, number, number];
/** Smooth elliptical loft along Z. Sections are [z, vertical center, x radius, y radius]. */
export function loft(sections: Section[], rings = 40, sides = 24) {
  const curve = new T.CatmullRomCurve3(
    sections.map((s) => new T.Vector3(s[0], s[2], s[3])),
  );
  const center = new T.CatmullRomCurve3(
    sections.map((s) => new T.Vector3(s[0], s[1], 0)),
  );
  const verts = [],
    uv = [],
    ix = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = curve.getPoint(t),
      c = center.getPoint(t);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      verts.push(
        Math.cos(a) * Math.max(0.003, r.y),
        c.y + Math.sin(a) * Math.max(0.003, r.z),
        r.x,
      );
      uv.push(i / sides, t);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < sides; i++) {
      const a = j * (sides + 1) + i,
        b = a + sides + 1;
      ix.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}
export function furTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#eee7d9";
  ctx.fillRect(0, 0, 256, 256);
  let seed = 72;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 18000; i++) {
    const x = rnd() * 256,
      y = rnd() * 256;
    ctx.strokeStyle = `rgba(${rnd() > 0.5 ? "255,242,210" : "90,46,21"},${rnd() * 0.21})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y + lerp(2, 9, rnd()));
    ctx.stroke();
  }
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
export function limbGeometry(length: number, r1: number, r2: number) {
  return new T.LatheGeometry(
    [
      new T.Vector2(0.005, -length - 0.025),
      new T.Vector2(r2 * 0.8, -length),
      new T.Vector2(r2, -length * 0.8),
      new T.Vector2(r1 * 0.9, -length * 0.32),
      new T.Vector2(r1, -length * 0.15),
      new T.Vector2(r1 * 0.6, 0.015),
      new T.Vector2(0.005, 0.04),
    ],
    16,
  );
}
