import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { heightAt, pondDistance, POND } from "./terrain";
import { random } from "../utils/math";

export function woodlandDetails() {
  const group = new T.Group(),
    rnd = random(182),
    dummy = new T.Object3D();
  const pieces: T.BufferGeometry[] = [];
  for (let arm = 0; arm < 4; arm++)
    for (let leaf = 0; leaf < 5; leaf++)
      for (const side of [-1, 1]) {
        const t = leaf / 5,
          angle = (arm / 4) * Math.PI * 2;
        const leafGeo = new T.PlaneGeometry(0.17 * (1 - t) + 0.025, 0.06, 1, 1);
        leafGeo.rotateX(-Math.PI / 2);
        leafGeo.rotateY(side * 0.55);
        leafGeo.translate(
          side * (0.045 + 0.05 * (1 - t)),
          0.08 + Math.sin(t * Math.PI) * 0.17,
          t * 0.48,
        );
        leafGeo.rotateY(angle);
        pieces.push(leafGeo);
      }
  const fernGeo = mergeGeometries(pieces)!;
  pieces.forEach((g) => g.dispose());
  const ferns = new T.InstancedMesh(
    fernGeo,
    new T.MeshStandardMaterial({
      color: "#83965a",
      side: T.DoubleSide,
      roughness: 1,
    }),
    150,
  );
  for (let i = 0; i < 150; i++) {
    let x = (rnd() - 0.5) * 60,
      z = (rnd() - 0.5) * 60;
    if (pondDistance(x, z) < 1.2) x -= 12;
    dummy.position.set(x, heightAt(x, z), z);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.setScalar(0.6 + rnd() * 0.8);
    dummy.updateMatrix();
    ferns.setMatrixAt(i, dummy.matrix);
  }
  group.add(ferns);
  const reedPieces = [
    new T.CylinderGeometry(0.012, 0.017, 0.8, 4).translate(0, 0.4, 0),
    new T.CapsuleGeometry(0.035, 0.16, 2, 5).translate(0, 0.78, 0),
  ];
  const reeds = new T.InstancedMesh(
    mergeGeometries(reedPieces)!,
    new T.MeshStandardMaterial({ color: "#9a8e57", roughness: 1 }),
    190,
  );
  reedPieces.forEach((g) => g.dispose());
  for (let i = 0; i < 190; i++) {
    const a = rnd() * 6.28,
      r = 1.15 + rnd() * 0.15,
      x = POND.x + Math.sin(a) * POND.rx * r,
      z = POND.z + Math.cos(a) * POND.rz * r;
    dummy.position.set(x, heightAt(x, z), z);
    dummy.rotation.set((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3);
    dummy.scale.setScalar(0.4 + rnd() * 0.65);
    dummy.updateMatrix();
    reeds.setMatrixAt(i, dummy.matrix);
  }
  group.add(reeds);
  const lilies = new T.InstancedMesh(
    new T.CircleGeometry(0.19, 12, 0, Math.PI * 1.86),
    new T.MeshStandardMaterial({
      color: "#537b57",
      side: T.DoubleSide,
      roughness: 0.35,
    }),
    25,
  );
  for (let i = 0; i < 25; i++) {
    const a = rnd() * 6.28,
      r = 0.65 + rnd() * 0.25;
    dummy.position.set(
      POND.x + Math.sin(a) * POND.rx * r,
      POND.level + 0.025,
      POND.z + Math.cos(a) * POND.rz * r,
    );
    dummy.rotation.set(-Math.PI / 2, 0, rnd() * 6.28);
    dummy.scale.setScalar(0.7 + rnd() * 0.7);
    dummy.updateMatrix();
    lilies.setMatrixAt(i, dummy.matrix);
  }
  group.add(lilies);
  return group;
}

export function butterflyGeometry() {
  const parts: T.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const s = new T.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(side * 0.05, 0.16, side * 0.17, 0.1, side * 0.13, 0.01);
    s.bezierCurveTo(side * 0.16, -0.1, side * 0.04, -0.14, 0, 0);
    parts.push(new T.ShapeGeometry(s, 6));
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}
