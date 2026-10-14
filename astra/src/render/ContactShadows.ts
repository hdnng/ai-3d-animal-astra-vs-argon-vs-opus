import * as T from "three";
import { Fox } from "../animal/Fox";
import { heightAt } from "../world/terrain";
import { clamp } from "../utils/math";

/** Small analytic occlusion patches keep planted paws readable in full shade. */
export class ContactShadows {
  group = new T.Group();
  private patches: T.Mesh[] = [];
  private point = new T.Vector3();
  private normal = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);
  constructor() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!,
      g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(15,22,12,.6)");
    g.addColorStop(0.35, "rgba(15,22,12,.32)");
    g.addColorStop(1, "rgba(15,22,12,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const map = new T.CanvasTexture(c),
      geometry = new T.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const m = new T.Mesh(
        geometry,
        new T.MeshBasicMaterial({
          map,
          transparent: true,
          depthWrite: false,
          opacity: i ? 1 : 0.35,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
      this.patches.push(m);
      this.group.add(m);
    }
  }
  update(fox: Fox) {
    this.patches.forEach((m, i) => {
      if (i) fox.legs[i - 1].foot.getWorldPosition(this.point);
      else this.point.copy(fox.root.position);
      const x = this.point.x,
        z = this.point.z,
        h = heightAt(x, z);
      m.position.set(x, h + 0.012, z);
      this.normal
        .set(
          -(heightAt(x + 0.05, z) - heightAt(x - 0.05, z)) / 0.1,
          1,
          -(heightAt(x, z + 0.05) - heightAt(x, z - 0.05)) / 0.1,
        )
        .normalize();
      m.quaternion.setFromUnitVectors(this.up, this.normal);
      m.rotateY(fox.heading);
      m.scale.set(i ? 0.16 : 0.4, 1, i ? 0.2 : 0.85);
      (m.material as T.MeshBasicMaterial).opacity = i
        ? clamp(1 - (this.point.y - h) / 0.18) * 0.75
        : 0.3 * clamp(1 - (fox.root.position.y - h));
    });
  }
}
