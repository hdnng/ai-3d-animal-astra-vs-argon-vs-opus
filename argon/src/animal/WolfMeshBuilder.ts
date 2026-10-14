import * as THREE from 'three';

export interface WolfBoneMap {
  root: THREE.Bone;
  pelvis: THREE.Bone;
  spine1: THREE.Bone;
  spine2: THREE.Bone;
  spine3: THREE.Bone;
  neck1: THREE.Bone;
  neck2: THREE.Bone;
  head: THREE.Bone;
  jaw: THREE.Bone;
  earL: THREE.Bone;
  earR: THREE.Bone;
  eyelidL: THREE.Bone;
  eyelidR: THREE.Bone;
  tail1: THREE.Bone;
  tail2: THREE.Bone;
  tail3: THREE.Bone;
  tail4: THREE.Bone;
  tail5: THREE.Bone;
  shoulderL: THREE.Bone;
  upperArmL: THREE.Bone;
  forearmL: THREE.Bone;
  pawL: THREE.Bone;
  shoulderR: THREE.Bone;
  upperArmR: THREE.Bone;
  forearmR: THREE.Bone;
  pawR: THREE.Bone;
  hipL: THREE.Bone;
  thighL: THREE.Bone;
  shinL: THREE.Bone;
  hindPawL: THREE.Bone;
  hipR: THREE.Bone;
  thighR: THREE.Bone;
  shinR: THREE.Bone;
  hindPawR: THREE.Bone;
}

export interface WolfRigResult {
  rootGroup: THREE.Group;
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  bones: WolfBoneMap;
  boneList: THREE.Bone[];
  material: THREE.MeshStandardMaterial;
}

interface LoftSlice {
  z: number;
  y: number;
  rx: number;
  ryTop: number;
  ryBot: number;
  primaryBone: number;
  secondaryBone: number;
  blend: number;
}

/**
 * Builds a complete hierarchical 34-bone Timber Wolf skeleton and a smooth,
 * lofted procedural SkinnedMesh with anatomical cross-sections, vertex fur coloration,
 * and procedural anisotropic fur shader.
 */
export class WolfMeshBuilder {
  static build(coatVariant: 'alpha' | 'silver' | 'tundra' | 'russet' = 'alpha'): WolfRigResult {
    const boneList: THREE.Bone[] = [];
    const makeBone = (name: string, parent?: THREE.Bone, x = 0, y = 0, z = 0): THREE.Bone => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      boneList.push(b);
      return b;
    };

    // 1. Hierarchical Skeleton Definition (Bind Pose in meters, +Z forward, +Y up)
    const root = makeBone('root', undefined, 0, 0, 0);
    const pelvis = makeBone('pelvis', root, 0, 0.62, -0.30);

    // Spine chain forward from pelvis
    const spine1 = makeBone('spine1', pelvis, 0, 0.01, 0.24);
    const spine2 = makeBone('spine2', spine1, 0, 0.02, 0.25);
    const spine3 = makeBone('spine3', spine2, 0, 0.02, 0.23); // withers at z = +0.42, y = 0.67

    // Neck & Head
    const neck1 = makeBone('neck1', spine3, 0, 0.09, 0.16);
    const neck2 = makeBone('neck2', neck1, 0, 0.10, 0.14);
    const head = makeBone('head', neck2, 0, 0.04, 0.11); // head pivot at z = +0.83, y = 0.90
    const jaw = makeBone('jaw', head, 0, -0.032, 0.065);
    const earL = makeBone('earL', head, 0.080, 0.102, -0.01);
    const earR = makeBone('earR', head, -0.080, 0.102, -0.01);
    const eyelidL = makeBone('eyelidL', head, 0.054, 0.026, 0.092);
    const eyelidR = makeBone('eyelidR', head, -0.054, 0.026, 0.092);

    // 5-Bone Tail Chain backward from pelvis
    const tail1 = makeBone('tail1', pelvis, 0, 0.03, -0.10);
    const tail2 = makeBone('tail2', tail1, 0, -0.03, -0.15);
    const tail3 = makeBone('tail3', tail2, 0, -0.04, -0.15);
    const tail4 = makeBone('tail4', tail3, 0, -0.03, -0.14);
    const tail5 = makeBone('tail5', tail4, 0, -0.02, -0.12);

    // Front Limbs (attached to spine3 / withers)
    const shoulderL = makeBone('shoulderL', spine3, 0.135, -0.06, 0.04);
    const upperArmL = makeBone('upperArmL', shoulderL, 0, 0, 0);
    const forearmL = makeBone('forearmL', upperArmL, 0, -0.28, 0.01);
    const pawL = makeBone('pawL', forearmL, 0, -0.27, 0.01);

    const shoulderR = makeBone('shoulderR', spine3, -0.135, -0.06, 0.04);
    const upperArmR = makeBone('upperArmR', shoulderR, 0, 0, 0);
    const forearmR = makeBone('forearmR', upperArmR, 0, -0.28, 0.01);
    const pawR = makeBone('pawR', forearmR, 0, -0.27, 0.01);

    // Hind Limbs (attached to pelvis)
    const hipL = makeBone('hipL', pelvis, 0.13, -0.03, -0.01);
    const thighL = makeBone('thighL', hipL, 0, 0, 0);
    const shinL = makeBone('shinL', thighL, 0, -0.27, -0.02);
    const hindPawL = makeBone('hindPawL', shinL, 0, -0.26, 0.02);

    const hipR = makeBone('hipR', pelvis, -0.13, -0.03, -0.01);
    const thighR = makeBone('thighR', hipR, 0, 0, 0);
    const shinR = makeBone('shinR', thighR, 0, -0.27, -0.02);
    const hindPawR = makeBone('hindPawR', shinR, 0, -0.26, 0.02);

    root.updateMatrixWorld(true);

    const bones: WolfBoneMap = {
      root, pelvis, spine1, spine2, spine3, neck1, neck2, head, jaw, earL, earR,
      eyelidL, eyelidR, tail1, tail2, tail3, tail4, tail5,
      shoulderL, upperArmL, forearmL, pawL,
      shoulderR, upperArmR, forearmR, pawR,
      hipL, thighL, shinL, hindPawL,
      hipR, thighR, shinR, hindPawR
    };

    const idx = (b: THREE.Bone) => boneList.indexOf(b);

    // 2. Build Smooth Lofted Anatomical Geometry with Multi-Bone Skinning
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const skinIndices: number[] = [];
    const skinWeights: number[] = [];
    const indices: number[] = [];

    const palette = WolfMeshBuilder.getCoatPalette(coatVariant);

    const addVertex = (
      x: number, y: number, z: number,
      nx: number, ny: number, nz: number,
      u: number, v: number,
      r: number, g: number, b: number,
      b0: number, w0: number,
      b1 = 0, w1 = 0,
      b2 = 0, w2 = 0,
      b3 = 0, w3 = 0
    ) => {
      positions.push(x, y, z);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nLen, ny / nLen, nz / nLen);
      uvs.push(u, v);
      colors.push(r, g, b);
      const wSum = w0 + w1 + w2 + w3 || 1;
      skinIndices.push(b0, b1, b2, b3);
      skinWeights.push(w0 / wSum, w1 / wSum, w2 / wSum, w3 / wSum);
    };

    const buildMainBodyAndTailLoft = () => {
      const iPelvis = idx(pelvis);
      const iSpine1 = idx(spine1);
      const iSpine2 = idx(spine2);
      const iSpine3 = idx(spine3);
      const iNeck1 = idx(neck1);
      const iNeck2 = idx(neck2);
      const iHead = idx(head);
      const iTail1 = idx(tail1);
      const iTail2 = idx(tail2);
      const iTail3 = idx(tail3);
      const iTail4 = idx(tail4);
      const iTail5 = idx(tail5);

      const slices: LoftSlice[] = [
        // Bushy wolf tail tip to tail base
        { z: -0.98, y: 0.49, rx: 0.014, ryTop: 0.014, ryBot: 0.014, primaryBone: iTail5, secondaryBone: iTail5, blend: 0 },
        { z: -0.89, y: 0.50, rx: 0.052, ryTop: 0.055, ryBot: 0.055, primaryBone: iTail5, secondaryBone: iTail4, blend: 0.3 },
        { z: -0.77, y: 0.53, rx: 0.082, ryTop: 0.086, ryBot: 0.084, primaryBone: iTail4, secondaryBone: iTail3, blend: 0.4 },
        { z: -0.63, y: 0.56, rx: 0.088, ryTop: 0.092, ryBot: 0.088, primaryBone: iTail3, secondaryBone: iTail2, blend: 0.4 },
        { z: -0.50, y: 0.60, rx: 0.076, ryTop: 0.080, ryBot: 0.075, primaryBone: iTail2, secondaryBone: iTail1, blend: 0.5 },
        { z: -0.40, y: 0.64, rx: 0.068, ryTop: 0.072, ryBot: 0.064, primaryBone: iTail1, secondaryBone: iPelvis, blend: 0.35 },

        // Pelvis / Rump / Flanks
        { z: -0.34, y: 0.63, rx: 0.148, ryTop: 0.138, ryBot: 0.128, primaryBone: iPelvis, secondaryBone: iTail1, blend: 0.15 },
        { z: -0.24, y: 0.64, rx: 0.172, ryTop: 0.158, ryBot: 0.148, primaryBone: iPelvis, secondaryBone: iSpine1, blend: 0.25 },
        { z: -0.12, y: 0.64, rx: 0.162, ryTop: 0.155, ryBot: 0.142, primaryBone: iSpine1, secondaryBone: iPelvis, blend: 0.3 },

        // Lumbar waist (athletic abdominal tuck)
        { z: 0.00, y: 0.65, rx: 0.155, ryTop: 0.158, ryBot: 0.148, primaryBone: iSpine1, secondaryBone: iSpine2, blend: 0.45 },
        { z: 0.14, y: 0.66, rx: 0.180, ryTop: 0.172, ryBot: 0.192, primaryBone: iSpine2, secondaryBone: iSpine1, blend: 0.25 },

        // Deep Thoracic Ribcage & Withers (Shoulder ruff)
        { z: 0.28, y: 0.67, rx: 0.198, ryTop: 0.192, ryBot: 0.222, primaryBone: iSpine2, secondaryBone: iSpine3, blend: 0.45 },
        { z: 0.42, y: 0.68, rx: 0.206, ryTop: 0.212, ryBot: 0.228, primaryBone: iSpine3, secondaryBone: iSpine2, blend: 0.20 },
        { z: 0.52, y: 0.72, rx: 0.186, ryTop: 0.186, ryBot: 0.195, primaryBone: iSpine3, secondaryBone: iNeck1, blend: 0.45 },

        // Thick Furred Wolf Neck Ruff
        { z: 0.62, y: 0.78, rx: 0.166, ryTop: 0.162, ryBot: 0.165, primaryBone: iNeck1, secondaryBone: iNeck2, blend: 0.35 },
        { z: 0.73, y: 0.86, rx: 0.150, ryTop: 0.144, ryBot: 0.142, primaryBone: iNeck2, secondaryBone: iHead, blend: 0.35 },

        // Cranium & Cheek Ruff
        { z: 0.82, y: 0.905, rx: 0.154, ryTop: 0.128, ryBot: 0.098, primaryBone: iHead, secondaryBone: iNeck2, blend: 0.15 },
        { z: 0.90, y: 0.915, rx: 0.136, ryTop: 0.112, ryBot: 0.072, primaryBone: iHead, secondaryBone: iHead, blend: 0 },

        // Brow Stop to Tapered Wolf Muzzle (Upper Snout)
        { z: 0.96, y: 0.905, rx: 0.090, ryTop: 0.074, ryBot: 0.042, primaryBone: iHead, secondaryBone: iHead, blend: 0 },
        { z: 1.03, y: 0.892, rx: 0.064, ryTop: 0.055, ryBot: 0.035, primaryBone: iHead, secondaryBone: iHead, blend: 0 },
        { z: 1.10, y: 0.888, rx: 0.045, ryTop: 0.042, ryBot: 0.028, primaryBone: iHead, secondaryBone: iHead, blend: 0 },
        { z: 1.135, y: 0.890, rx: 0.018, ryTop: 0.020, ryBot: 0.016, primaryBone: iHead, secondaryBone: iHead, blend: 0 }
      ];

      const radialSegs = 16;
      const baseVertex = positions.length / 3;

      for (let s = 0; s < slices.length; s++) {
        const sl = slices[s];
        const vCoord = s / (slices.length - 1);

        for (let r = 0; r <= radialSegs; r++) {
          const uCoord = r / radialSegs;
          const theta = uCoord * Math.PI * 2;
          const sinT = Math.sin(theta);
          const cosT = Math.cos(theta);

          let rxMod = sl.rx;
          if (sl.z > 0.76 && sl.z < 0.93 && Math.abs(sinT) > 0.55 && cosT < 0.25) {
            rxMod *= 1.20; // Prominent Timber Wolf cheek ruff
          }
          const furWave = 1.0 + 0.028 * Math.cos(theta * 6 + s * 1.3);

          const x = sinT * rxMod * furWave;
          const ry = cosT >= 0 ? sl.ryTop : sl.ryBot;
          const keelFactor = (cosT < 0 && sl.z > 0.1 && sl.z < 0.5) ? (1.0 - 0.15 * Math.pow(Math.abs(sinT), 1.5)) : 1.0;
          const y = sl.y + cosT * ry * keelFactor * furWave;
          const z = sl.z;

          const nx = sinT / Math.max(0.01, rxMod);
          const ny = cosT / Math.max(0.01, ry);
          const nz = s === 0 ? -0.5 : s === slices.length - 1 ? 0.6 : 0.0;

          const col = WolfMeshBuilder.computeBodyColor(x, y, z, cosT, palette);

          addVertex(
            x, y, z,
            nx, ny, nz,
            uCoord, vCoord,
            col.r, col.g, col.b,
            sl.primaryBone, 1 - sl.blend,
            sl.secondaryBone, sl.blend
          );
        }
      }

      const ringStride = radialSegs + 1;
      for (let s = 0; s < slices.length - 1; s++) {
        for (let r = 0; r < radialSegs; r++) {
          const a = baseVertex + s * ringStride + r;
          const b = a + ringStride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
    };

    // Articulated lower jaw tucked cleanly into upper muzzle when closed
    const buildLowerJaw = () => {
      const iJaw = idx(jaw);
      const iHead = idx(head);
      const jawSlices = [
        { z: 0.89, y: 0.858, rx: 0.068, ryTop: 0.016, ryBot: 0.032, wJaw: 0.6 },
        { z: 0.96, y: 0.856, rx: 0.052, ryTop: 0.014, ryBot: 0.028, wJaw: 0.95 },
        { z: 1.03, y: 0.858, rx: 0.038, ryTop: 0.012, ryBot: 0.022, wJaw: 1.0 },
        { z: 1.09, y: 0.864, rx: 0.022, ryTop: 0.010, ryBot: 0.015, wJaw: 1.0 }
      ];
      const radialSegs = 10;
      const baseVertex = positions.length / 3;

      for (let s = 0; s < jawSlices.length; s++) {
        const sl = jawSlices[s];
        for (let r = 0; r <= radialSegs; r++) {
          const u = r / radialSegs;
          const theta = u * Math.PI * 2;
          const sinT = Math.sin(theta);
          const cosT = Math.cos(theta);
          const x = sinT * sl.rx;
          const ry = cosT >= 0 ? sl.ryTop : sl.ryBot;
          const y = sl.y + cosT * ry;
          const z = sl.z;

          const isMouthInterior = cosT > 0.55 && s >= 1;
          const isLipEdge = Math.abs(cosT) <= 0.35 && s >= 1;
          const c = isMouthInterior
            ? { r: 0.52, g: 0.22, b: 0.24 }
            : isLipEdge
              ? { r: 0.14, g: 0.14, b: 0.16 }
              : palette.belly;

          addVertex(
            x, y, z,
            sinT, cosT, 0.1,
            u, s / (jawSlices.length - 1),
            c.r, c.g, c.b,
            iJaw, sl.wJaw,
            iHead, 1 - sl.wJaw
          );
        }
      }
      const stride = radialSegs + 1;
      for (let s = 0; s < jawSlices.length - 1; s++) {
        for (let r = 0; r < radialSegs; r++) {
          const a = baseVertex + s * stride + r;
          const b = a + stride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
    };

    const buildEar = (side: 1 | -1, earBoneIdx: number, headBoneIdx: number) => {
      const baseX = side * 0.080;
      const baseY = 0.990;
      const baseZ = 0.885;
      const radialSegs = 10;
      const earSlices = [
        { h: 0.00, rx: 0.042, rz: 0.038, tiltX: 0.0, tiltZ: 0.0, wEar: 0.6 },
        { h: 0.042, rx: 0.038, rz: 0.032, tiltX: side * 0.012, tiltZ: -0.005, wEar: 0.95 },
        { h: 0.088, rx: 0.025, rz: 0.020, tiltX: side * 0.022, tiltZ: -0.010, wEar: 1.0 },
        { h: 0.128, rx: 0.007, rz: 0.007, tiltX: side * 0.028, tiltZ: -0.012, wEar: 1.0 }
      ];
      const baseVertex = positions.length / 3;

      for (let s = 0; s < earSlices.length; s++) {
        const sl = earSlices[s];
        for (let r = 0; r <= radialSegs; r++) {
          const u = r / radialSegs;
          const theta = u * Math.PI * 2;
          const sinT = Math.sin(theta);
          const cosT = Math.cos(theta);
          const zOffset = cosT > 0 ? cosT * sl.rz * 0.55 : cosT * sl.rz;
          const x = baseX + sl.tiltX + sinT * sl.rx;
          const y = baseY + sl.h;
          const z = baseZ + sl.tiltZ + zOffset;

          const isInnerEar = cosT > 0.35 && s < 3;
          const col = isInnerEar ? palette.belly : palette.dorsal;

          addVertex(
            x, y, z,
            sinT, 0.25, cosT,
            u, s / (earSlices.length - 1),
            col.r, col.g, col.b,
            earBoneIdx, sl.wEar,
            headBoneIdx, 1 - sl.wEar
          );
        }
      }
      const stride = radialSegs + 1;
      for (let s = 0; s < earSlices.length - 1; s++) {
        for (let r = 0; r < radialSegs; r++) {
          const a = baseVertex + s * stride + r;
          const b = a + stride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
    };

    const buildEye = (side: 1 | -1, headBoneIdx: number, eyelidBoneIdx: number) => {
      const ex = side * 0.054;
      const ey = 0.926;
      const ez = 0.992;
      const rEye = 0.0165;
      const segs = 8;

      const baseEye = positions.length / 3;
      for (let lat = 0; lat <= segs; lat++) {
        const v = lat / segs;
        const phi = v * Math.PI;
        for (let lon = 0; lon <= segs; lon++) {
          const u = lon / segs;
          const theta = u * Math.PI * 2;
          const nx = Math.sin(phi) * Math.sin(theta);
          const ny = Math.cos(phi);
          const nz = Math.sin(phi) * Math.cos(theta);
          const isPupil = nz > 0.84;
          const isIris = nz > 0.48;
          const col = isPupil
            ? { r: 0.02, g: 0.02, b: 0.03 }
            : isIris
              ? { r: 0.96, g: 0.72, b: 0.14 }
              : { r: 0.12, g: 0.12, b: 0.12 };

          addVertex(
            ex + nx * rEye, ey + ny * rEye, ez + nz * rEye,
            nx, ny, nz,
            u, v,
            col.r, col.g, col.b,
            headBoneIdx, 1.0
          );
        }
      }
      const stride = segs + 1;
      for (let lat = 0; lat < segs; lat++) {
        for (let lon = 0; lon < segs; lon++) {
          const a = baseEye + lat * stride + lon;
          const b = a + stride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }

      // Recessed upper eyelid cap weighted to eyelidBoneIdx
      const baseLid = positions.length / 3;
      const rLid = 0.0172;
      for (let lat = 0; lat <= 3; lat++) {
        const v = lat / 3;
        const phi = v * (Math.PI * 0.48);
        for (let lon = 0; lon <= segs; lon++) {
          const u = lon / segs;
          const theta = u * Math.PI * 2;
          const nx = Math.sin(phi) * Math.sin(theta);
          const ny = Math.cos(phi);
          const nz = Math.sin(phi) * Math.cos(theta);
          addVertex(
            ex + nx * rLid, ey + ny * rLid, ez + nz * rLid,
            nx, ny, nz,
            u, v,
            palette.dorsal.r, palette.dorsal.g, palette.dorsal.b,
            eyelidBoneIdx, 1.0
          );
        }
      }
      for (let lat = 0; lat < 3; lat++) {
        for (let lon = 0; lon < segs; lon++) {
          const a = baseLid + lat * stride + lon;
          const b = a + stride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, b, d, b, c, d);
        }
      }
    };

    const buildLimb = (
      isFront: boolean,
      side: 1 | -1,
      bBody: number,
      bUpper: number,
      bLower: number,
      bPaw: number
    ) => {
      const rootX = side * (isFront ? 0.135 : 0.13);
      const rootY = isFront ? 0.61 : 0.59;
      const rootZ = isFront ? 0.46 : -0.31;

      const midY = isFront ? 0.33 : 0.32;
      const midZ = isFront ? 0.47 : -0.33;

      const pawY = 0.06;
      const pawZ = isFront ? 0.48 : -0.31;

      const limbRings = isFront
        ? [
            { y: rootY + 0.05, z: rootZ, rx: 0.080, rz: 0.102, b0: bBody, w0: 0.55, b1: bUpper, w1: 0.45 },
            { y: rootY - 0.06, z: rootZ, rx: 0.070, rz: 0.088, b0: bUpper, w0: 0.90, b1: bBody, w1: 0.10 },
            { y: rootY - 0.18, z: rootZ + 0.005, rx: 0.055, rz: 0.070, b0: bUpper, w0: 0.85, b1: bLower, w1: 0.15 },
            { y: midY, z: midZ, rx: 0.047, rz: 0.058, b0: bUpper, w0: 0.45, b1: bLower, w1: 0.55 },
            { y: midY - 0.11, z: midZ + 0.005, rx: 0.039, rz: 0.045, b0: bLower, w0: 0.95, b1: bUpper, w1: 0.05 },
            { y: pawY + 0.05, z: pawZ, rx: 0.035, rz: 0.040, b0: bLower, w0: 0.65, b1: bPaw, w1: 0.35 },
            { y: pawY + 0.022, z: pawZ + 0.025, rx: 0.048, rz: 0.062, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 },
            { y: 0.012, z: pawZ + 0.028, rx: 0.045, rz: 0.058, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 },
            { y: 0.008, z: pawZ + 0.025, rx: 0.012, rz: 0.014, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 }
          ]
        : [
            { y: rootY + 0.06, z: rootZ - 0.01, rx: 0.088, rz: 0.122, b0: bBody, w0: 0.50, b1: bUpper, w1: 0.50 },
            { y: rootY - 0.06, z: rootZ - 0.01, rx: 0.080, rz: 0.108, b0: bUpper, w0: 0.90, b1: bBody, w1: 0.10 },
            { y: rootY - 0.17, z: rootZ - 0.015, rx: 0.060, rz: 0.080, b0: bUpper, w0: 0.80, b1: bLower, w1: 0.20 },
            { y: midY, z: midZ, rx: 0.047, rz: 0.064, b0: bUpper, w0: 0.45, b1: bLower, w1: 0.55 },
            { y: midY - 0.11, z: midZ + 0.01, rx: 0.037, rz: 0.046, b0: bLower, w0: 0.95, b1: bUpper, w1: 0.05 },
            { y: pawY + 0.05, z: pawZ, rx: 0.034, rz: 0.040, b0: bLower, w0: 0.65, b1: bPaw, w1: 0.35 },
            { y: pawY + 0.022, z: pawZ + 0.025, rx: 0.046, rz: 0.058, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 },
            { y: 0.012, z: pawZ + 0.028, rx: 0.043, rz: 0.055, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 },
            { y: 0.008, z: pawZ + 0.025, rx: 0.012, rz: 0.014, b0: bPaw, w0: 1.0, b1: bLower, w1: 0.0 }
          ];

      const radialSegs = 12;
      const baseVertex = positions.length / 3;

      for (let s = 0; s < limbRings.length; s++) {
        const ring = limbRings[s];
        const heightNorm = clamp(ring.y / 0.65, 0, 1);
        for (let r = 0; r <= radialSegs; r++) {
          const u = r / radialSegs;
          const theta = u * Math.PI * 2;
          const sinT = Math.sin(theta);
          const cosT = Math.cos(theta);

          const x = rootX + sinT * ring.rx;
          const y = ring.y;
          const z = ring.z + cosT * ring.rz;

          const col = {
            r: palette.paws.r * (1 - heightNorm) + palette.flank.r * heightNorm,
            g: palette.paws.g * (1 - heightNorm) + palette.flank.g * heightNorm,
            b: palette.paws.b * (1 - heightNorm) + palette.flank.b * heightNorm
          };
          if (ring.y < 0.022) {
            col.r *= 0.62;
            col.g *= 0.62;
            col.b *= 0.62;
          }

          addVertex(
            x, y, z,
            sinT, 0.15, cosT,
            u, s / (limbRings.length - 1),
            col.r, col.g, col.b,
            ring.b0, ring.w0,
            ring.b1, ring.w1
          );
        }
      }

      const stride = radialSegs + 1;
      for (let s = 0; s < limbRings.length - 1; s++) {
        for (let r = 0; r < radialSegs; r++) {
          const a = baseVertex + s * stride + r;
          const b = a + stride;
          const c = b + 1;
          const d = a + 1;
          indices.push(a, d, b);
          indices.push(b, d, c);
        }
      }
    };

    buildMainBodyAndTailLoft();
    buildLowerJaw();
    buildEar(1, idx(earL), idx(head));
    buildEar(-1, idx(earR), idx(head));
    buildEye(1, idx(head), idx(eyelidL));
    buildEye(-1, idx(head), idx(eyelidR));

    buildLimb(true, 1, idx(spine3), idx(upperArmL), idx(forearmL), idx(pawL));
    buildLimb(true, -1, idx(spine3), idx(upperArmR), idx(forearmR), idx(pawR));
    buildLimb(false, 1, idx(pelvis), idx(thighL), idx(shinL), idx(hindPawL));
    buildLimb(false, -1, idx(pelvis), idx(thighR), idx(shinR), idx(hindPawR));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = WolfMeshBuilder.createFurMaterial();

    const skeleton = new THREE.Skeleton(boneList);
    const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
    skinnedMesh.castShadow = true;
    skinnedMesh.receiveShadow = true;
    skinnedMesh.frustumCulled = false;

    const rootGroup = new THREE.Group();
    rootGroup.add(root);
    rootGroup.add(skinnedMesh);
    skinnedMesh.bind(skeleton);

    return {
      rootGroup,
      skinnedMesh,
      skeleton,
      bones,
      boneList,
      material
    };
  }

  private static getCoatPalette(variant: 'alpha' | 'silver' | 'tundra' | 'russet') {
    switch (variant) {
      case 'silver':
        return {
          dorsal: { r: 0.16, g: 0.18, b: 0.22 },
          flank: { r: 0.48, g: 0.51, b: 0.56 },
          belly: { r: 0.86, g: 0.88, b: 0.91 },
          paws: { r: 0.72, g: 0.74, b: 0.78 }
        };
      case 'tundra':
        return {
          dorsal: { r: 0.58, g: 0.60, b: 0.64 },
          flank: { r: 0.80, g: 0.82, b: 0.84 },
          belly: { r: 0.95, g: 0.95, b: 0.96 },
          paws: { r: 0.88, g: 0.87, b: 0.85 }
        };
      case 'russet':
        return {
          dorsal: { r: 0.22, g: 0.16, b: 0.13 },
          flank: { r: 0.58, g: 0.40, b: 0.27 },
          belly: { r: 0.88, g: 0.82, b: 0.74 },
          paws: { r: 0.72, g: 0.56, b: 0.42 }
        };
      case 'alpha':
      default:
        return {
          dorsal: { r: 0.18, g: 0.19, b: 0.22 },
          flank: { r: 0.54, g: 0.47, b: 0.39 },
          belly: { r: 0.90, g: 0.87, b: 0.81 },
          paws: { r: 0.76, g: 0.68, b: 0.57 }
        };
    }
  }

  private static computeBodyColor(
    x: number,
    y: number,
    z: number,
    cosT: number,
    palette: ReturnType<typeof WolfMeshBuilder.getCoatPalette>
  ): { r: number; g: number; b: number } {
    if (z > 1.095) {
      return { r: 0.05, g: 0.05, b: 0.06 };
    }
    if (z < -0.82) {
      return { r: palette.dorsal.r * 0.7, g: palette.dorsal.g * 0.7, b: palette.dorsal.b * 0.7 };
    }
    if (cosT > 0.35) {
      const t = Math.min(1, (cosT - 0.35) / 0.65);
      return {
        r: palette.flank.r * (1 - t) + palette.dorsal.r * t,
        g: palette.flank.g * (1 - t) + palette.dorsal.g * t,
        b: palette.flank.b * (1 - t) + palette.dorsal.b * t
      };
    }
    if (cosT < -0.15) {
      const t = Math.min(1, (-0.15 - cosT) / 0.65);
      return {
        r: palette.flank.r * (1 - t) + palette.belly.r * t,
        g: palette.flank.g * (1 - t) + palette.belly.g * t,
        b: palette.flank.b * (1 - t) + palette.belly.b * t
      };
    }
    return palette.flank;
  }

  private static createFurMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.76,
      metalness: 0.04
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLocalPos;
         varying vec2 vFurUv;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vLocalPos = position;
         vFurUv = uv;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLocalPos;
         varying vec2 vFurUv;
         float furHash(vec2 p) {
           return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
         }
         float furNoise(vec2 p) {
           vec2 i = floor(p);
           vec2 f = fract(p);
           f = f * f * (3.0 - 2.0 * f);
           float a = furHash(i);
           float b = furHash(i + vec2(1.0, 0.0));
           float c = furHash(i + vec2(0.0, 1.0));
           float d = furHash(i + vec2(1.0, 1.0));
           return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
         }`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 strandCoord = vec2(vFurUv.x * 95.0, vFurUv.y * 28.0 + vLocalPos.z * 18.0);
         float strand1 = furNoise(strandCoord);
         float guardHair = smoothstep(0.62, 0.95, strand1);
         float undercoat = mix(0.86, 1.14, strand1);
         diffuseColor.rgb *= undercoat;
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + vec3(0.05, 0.045, 0.04), guardHair * 0.42);`
      );
    };

    return mat;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
