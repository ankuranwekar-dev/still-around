// Original quadruped. Capsules in bind pose, skinned to the joint schema.
// Topology is fixed so morphs are vertex deltas of the same mesh — a beagle and
// a labrador are one dog mesh at different morph weights, never a scaled cat.

import { Part } from '../engine/raster.js'
import { felisProfile, canisProfile, MORPH_NAMES, zeroMorphs } from './species/profiles.js'

const RADIAL = 8
const RINGS = 5

export { MORPH_NAMES, zeroMorphs }

export function buildSpecies (THREE, species, morphs = {}) {
  const m = { ...zeroMorphs(), ...morphs }
  const profile = species === 'dog' ? canisProfile(m) : felisProfile(m)
  const { geometry, bones, rest, layout } = assemble(THREE, profile)
  const skeleton = new THREE.Skeleton(bones)
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.72,
    metalness: 0.02,
  }))
  mesh.frustumCulled = false
  mesh.add(bones[0])
  mesh.bind(skeleton)
  return { mesh, skeleton, bones, rest, layout, profile, species }
}

function assemble (THREE, p) {
  const layout = jointLayout(p)
  const bones = makeBones(THREE, layout)
  const b = new Buf()
  const idx = name => bones.findIndex(bone => bone.name === name)
  const W = (a, b) => world(layout, a, b)

  // Spine: hips → withers. u along the body, v around.
  const spine = ['hips', 'spine_1', 'spine_2', 'spine_3', 'spine_4', 'spine_5']
  for (let i = 0; i < spine.length - 1; i++) {
    const t0 = i / (spine.length - 1)
    const t1 = (i + 1) / (spine.length - 1)
    const r0 = lerp(p.hipR, p.chestR, t0)
    const r1 = lerp(p.hipR, p.chestR, t1)
    // Waist tucks in the middle of the dog, not the cat.
    const waist = p.species === 'dog' ? lerp(1, p.waistR / p.chestR, Math.sin(t0 * Math.PI)) : 1
    b.capsule(W(spine[i]), W(spine[i + 1]), r0 * (t0 > 0.3 && t0 < 0.7 ? lerp(1, waist, 0.8) : 1), r1, idx(spine[i]), Part.body, t0, t1)
  }

  // Neck.
  const neck = ['spine_5', 'neck_1', 'neck_2', 'neck_3', 'head']
  for (let i = 0; i < neck.length - 1; i++) {
    b.capsule(W(neck[i]), W(neck[i + 1]), p.neckR, p.neckR * 0.9, idx(neck[i]), Part.body, 0.85, 1)
  }

  // Head + muzzle. Separate parts so the coat does not draw a muzzle/head seam
  // as a hard material edge — UVs are continuous across the join.
  b.ellipsoid(W('head'), p.headR * 1.05, p.headH, p.headR, idx('head'), Part.head, 0.2, 0.8)
  const muzzleEnd = add(W('head'), [0, -p.headH * 0.15, p.muzzleLen])
  b.capsule(add(W('head'), [0, -p.headH * 0.05, p.headR * 0.35]), muzzleEnd,
    p.muzzleR * 1.15, p.muzzleR, idx('jaw'), Part.muzzle, 0.3, 1)

  // Ears. Floppy dog ears hang from the top of the skull, not the sides.
  for (const side of [-1, 1]) {
    const name1 = side < 0 ? 'ear_L_1' : 'ear_R_1'
    const name2 = side < 0 ? 'ear_L_2' : 'ear_R_2'
    const part = side < 0 ? Part.earL : Part.earR
    const root = W(name1)
    const tip = W(name2)
    b.capsule(root, tip, p.earW, p.earW * 0.35, idx(name1), part, 0, 1)
  }

  // Legs. Front: straight columns. Back: hocked on the dog.
  for (const side of [-1, 1]) {
    const S = side < 0 ? 'L' : 'R'
    const front = [`shoulder_${S}`, `upper_F${S}`, `lower_F${S}`, `wrist_F${S}`, `toe_F${S}`]
    const fpart = side < 0 ? Part.legFL : Part.legFR
    for (let i = 0; i < front.length - 1; i++) {
      const u0 = i / (front.length - 1)
      b.capsule(W(front[i]), W(front[i + 1]), 0.016, 0.013, idx(front[i]), fpart, u0, u0 + 0.25)
    }
    b.ellipsoid(W(`toe_F${S}`), p.pawR, p.pawR * 0.55, p.pawR * 1.1, idx(`toe_F${S}`), Part.paw, 0, 1)

    const back = [`hip_${S}`, `thigh_B${S}`, `shin_B${S}`, `hock_B${S}`, `foot_B${S}`, `toe_B${S}`]
    const bpart = side < 0 ? Part.legBL : Part.legBR
    for (let i = 0; i < back.length - 1; i++) {
      const u0 = i / (back.length - 1)
      const thick = i < 2 ? 0.020 : 0.014
      b.capsule(W(back[i]), W(back[i + 1]), thick, thick * 0.85, idx(back[i]), bpart, u0, u0 + 0.2)
    }
    b.ellipsoid(W(`toe_B${S}`), p.pawR, p.pawR * 0.55, p.pawR * 1.15, idx(`toe_B${S}`), Part.paw, 0, 1)
  }

  // Tail. Origin on the *top* of the rump — burying it in the body capsule made
  // every walking animal tailless for months.
  const tails = ['hips', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6', 'tail_7', 'tail_8']
  for (let i = 0; i < tails.length - 1; i++) {
    const t = i / (tails.length - 1)
    b.capsule(W(tails[i]), W(tails[i + 1]), lerp(p.tailR * 1.4, p.tailR * 0.45, t), lerp(p.tailR * 1.3, p.tailR * 0.4, t),
      idx(tails[Math.max(1, i)]), Part.tail, t, t + 1 / 8)
  }

  const geometry = b.toGeometry(THREE)
  return { geometry, bones, rest: layout, layout }
}

function jointLayout (p) {
  const withersY = p.height
  const hipY = withersY - p.topline
  const chestZ = p.bodyLen * 0.32
  const hipZ = -p.bodyLen * 0.32
  const headZ = chestZ + p.neckLen + p.headR * 0.4
  const headY = withersY + p.neckLen * 0.85
  const L = {}
  L.root = [0, 0, 0]
  L.hips = [0, hipY, hipZ]
  L.spine_1 = [0, lerp(hipY, withersY, 0.2), lerp(hipZ, chestZ, 0.2)]
  L.spine_2 = [0, lerp(hipY, withersY, 0.4), lerp(hipZ, chestZ, 0.4)]
  L.spine_3 = [0, lerp(hipY, withersY, 0.6), lerp(hipZ, chestZ, 0.6)]
  L.spine_4 = [0, lerp(hipY, withersY, 0.8), lerp(hipZ, chestZ, 0.8)]
  L.spine_5 = [0, withersY, chestZ]
  L.neck_1 = [0, lerp(withersY, headY, 0.33), lerp(chestZ, headZ, 0.33)]
  L.neck_2 = [0, lerp(withersY, headY, 0.66), lerp(chestZ, headZ, 0.66)]
  L.neck_3 = [0, headY - p.headH * 0.2, headZ - p.headR * 0.2]
  L.head = [0, headY, headZ]
  L.jaw = [0, headY - p.headH * 0.35, headZ + p.muzzleLen * 0.4]
  L.eye_L = [-p.headR * 0.45, headY + p.headH * 0.15, headZ + p.headR * 0.55]
  L.eye_R = [p.headR * 0.45, headY + p.headH * 0.15, headZ + p.headR * 0.55]

  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'L' : 'R'
    const earRoot = [side * p.headR * p.earSet, headY + p.headH * 0.7, headZ]
    L[`ear_${tag}_1`] = earRoot
    if (p.floppy) {
      L[`ear_${tag}_2`] = [earRoot[0] + side * p.earW * 0.4, earRoot[1] - p.earH, earRoot[2] + p.earH * 0.15]
    } else {
      const fold = p.earFold
      L[`ear_${tag}_2`] = [
        earRoot[0] + side * p.earW * (0.3 + fold * 0.8),
        earRoot[1] + p.earH * (1 - fold * 0.7),
        earRoot[2] + p.earH * fold * 0.5,
      ]
    }
    const shoulder = [side * p.chestR * 0.55, withersY - p.chestR * 0.15, chestZ - 0.01]
    L[`shoulder_${tag}`] = shoulder
    L[`upper_F${tag}`] = [shoulder[0], lerp(shoulder[1], p.pawR, 0.35), shoulder[2] + 0.005]
    L[`lower_F${tag}`] = [shoulder[0], lerp(shoulder[1], p.pawR, 0.70), shoulder[2] + 0.008]
    L[`wrist_F${tag}`] = [shoulder[0], p.pawR * 2.2, shoulder[2] + 0.01]
    L[`toe_F${tag}`] = [shoulder[0], p.pawR * 0.55, shoulder[2] + p.pawR * 1.2]

    const hip = [side * p.hipR * 0.7, hipY - p.hipR * 0.1, hipZ + 0.01]
    L[`hip_${tag}`] = hip
    const hockY = lerp(hip[1], p.pawR, 0.55)
    const hockBack = -p.hock * 0.045
    L[`thigh_B${tag}`] = [hip[0], lerp(hip[1], p.pawR, 0.28), hip[2] + hockBack * 0.3]
    L[`shin_B${tag}`] = [hip[0], hockY, hip[2] + hockBack]
    L[`hock_B${tag}`] = [hip[0], hockY - 0.01, hip[2] + hockBack]
    L[`foot_B${tag}`] = [hip[0], p.pawR * 2.0, hip[2] + hockBack * 0.3]
    L[`toe_B${tag}`] = [hip[0], p.pawR * 0.55, hip[2] + p.pawR]
  }

  const tailDir = [0, 0.25, -1]
  const tlen = Math.hypot(...tailDir)
  const nd = tailDir.map(v => v / tlen)
  const rump = [0, hipY + p.hipR * 0.55, hipZ - p.hipR * 0.2]
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    L[`tail_${i}`] = [
      rump[0],
      rump[1] + nd[1] * p.tailLen * t,
      rump[2] + nd[2] * p.tailLen * t,
    ]
  }
  return L
}

function makeBones (THREE, layout) {
  const parentOf = {
    root: null,
    hips: 'root',
    spine_1: 'hips', spine_2: 'spine_1', spine_3: 'spine_2', spine_4: 'spine_3', spine_5: 'spine_4',
    neck_1: 'spine_5', neck_2: 'neck_1', neck_3: 'neck_2', head: 'neck_3', jaw: 'head',
    ear_L_1: 'head', ear_L_2: 'ear_L_1', ear_R_1: 'head', ear_R_2: 'ear_R_1',
    eye_L: 'head', eye_R: 'head',
    shoulder_L: 'spine_5', upper_FL: 'shoulder_L', lower_FL: 'upper_FL', wrist_FL: 'lower_FL', toe_FL: 'wrist_FL',
    shoulder_R: 'spine_5', upper_FR: 'shoulder_R', lower_FR: 'upper_FR', wrist_FR: 'lower_FR', toe_FR: 'wrist_FR',
    hip_L: 'hips', thigh_BL: 'hip_L', shin_BL: 'thigh_BL', hock_BL: 'shin_BL', foot_BL: 'hock_BL', toe_BL: 'foot_BL',
    hip_R: 'hips', thigh_BR: 'hip_R', shin_BR: 'thigh_BR', hock_BR: 'shin_BR', foot_BR: 'hock_BR', toe_BR: 'foot_BR',
    tail_1: 'hips', tail_2: 'tail_1', tail_3: 'tail_2', tail_4: 'tail_3',
    tail_5: 'tail_4', tail_6: 'tail_5', tail_7: 'tail_6', tail_8: 'tail_7',
  }
  const byName = {}
  const order = Object.keys(parentOf)
  for (const name of order) {
    const bone = new THREE.Bone()
    bone.name = name
    byName[name] = bone
    const parent = parentOf[name]
    const here = layout[name]
    if (!parent) {
      bone.position.set(here[0], here[1], here[2])
    } else {
      const par = layout[parent]
      bone.position.set(here[0] - par[0], here[1] - par[1], here[2] - par[2])
      byName[parent].add(bone)
    }
    bone.userData.restY = bone.position.y
  }
  byName.root.updateMatrixWorld(true)
  return order.map(n => byName[n])
}

function world (layout, a, b) {
  return layout[a]
}

function add (p, d) { return [p[0] + d[0], p[1] + d[1], p[2] + d[2]] }
function lerp (a, b, t) { return a + (b - a) * t }

class Buf {
  constructor () {
    this.pos = []
    this.nor = []
    this.uv = []
    this.region = []
    this.skin = []
    this.weight = []
    this.idx = []
  }

  capsule (p0, p1, r0, r1, bone, region, u0, u1) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2]
    const len = Math.hypot(dx, dy, dz) || 1e-6
    const ax = dx / len, ay = dy / len, az = dz / len
    let bx = 0, by = 1, bz = 0
    if (Math.abs(ay) > 0.9) { bx = 1; by = 0 }
    let cx = ay * bz - az * by
    let cy = az * bx - ax * bz
    let cz = ax * by - ay * bx
    const cl = Math.hypot(cx, cy, cz) || 1
    cx /= cl; cy /= cl; cz /= cl
    bx = cy * az - cz * ay
    by = cz * ax - cx * az
    bz = cx * ay - cy * ax
    const base = this.pos.length / 3
    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS
      const r = r0 + (r1 - r0) * t
      const px = p0[0] + dx * t
      const py = p0[1] + dy * t
      const pz = p0[2] + dz * t
      const along = u0 + (u1 - u0) * t
      for (let j = 0; j <= RADIAL; j++) {
        const a = (j / RADIAL) * Math.PI * 2
        const c = Math.cos(a), s = Math.sin(a)
        const nx = c * bx + s * cx
        const ny = c * by + s * cy
        const nz = c * bz + s * cz
        this.pos.push(px + nx * r, py + ny * r, pz + nz * r)
        this.nor.push(nx, ny, nz)
        this.uv.push(along, j / RADIAL)
        this.region.push(region)
        this.skin.push(bone, 0, 0, 0)
        this.weight.push(1, 0, 0, 0)
      }
    }
    const cols = RADIAL + 1
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < RADIAL; j++) {
        const a = base + i * cols + j
        const b = a + cols
        this.idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }

  ellipsoid (c, rx, ry, rz, bone, region, u0, u1) {
    const segs = 8, rings = 6
    const base = this.pos.length / 3
    for (let i = 0; i <= rings; i++) {
      const v = i / rings
      const phi = v * Math.PI
      const sp = Math.sin(phi), cp = Math.cos(phi)
      for (let j = 0; j <= segs; j++) {
        const u = j / segs
        const th = u * Math.PI * 2
        const ct = Math.cos(th), st = Math.sin(th)
        const nx = st * sp, ny = cp, nz = ct * sp
        this.pos.push(c[0] + nx * rx, c[1] + ny * ry, c[2] + nz * rz)
        this.nor.push(nx, ny, nz)
        this.uv.push(u0 + (u1 - u0) * v, u)
        this.region.push(region)
        this.skin.push(bone, 0, 0, 0)
        this.weight.push(1, 0, 0, 0)
      }
    }
    const cols = segs + 1
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * cols + j
        const b = a + cols
        this.idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }

  toGeometry (THREE) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('region', new THREE.Float32BufferAttribute(this.region, 1))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.weight, 4))
    g.setIndex(this.idx)
    g.computeVertexNormals()
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}
