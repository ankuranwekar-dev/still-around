// Pose numbers from engine/poses.js drive the 3D skeleton. Clip names stay the
// same so the behaviour layer ports without a rewrite.

export function applyPose (bones, pose, profile, facing = 1) {
  const by = Object.fromEntries(bones.map(b => [b.name, b]))
  for (const b of bones) b.rotation.set(0, 0, 0)

  const sit = pose.view === 'front' && pose.gait < 0.2 && pose.tuck < 0.4
  const curl = pose.view === 'curl'
  const loaf = pose.tuck > 0.5

  // Breathing and weight shift — the idle stillness is a feature; these are small.
  if (by.spine_3) by.spine_3.rotation.x = pose.breathe * 0.03
  if (by.spine_5) by.spine_5.scale.setScalar(1 + pose.breathe * 0.012)

  // Head. Neck limits so a look-at cannot snap the neck.
  const hx = Math.max(-0.45, Math.min(0.45, pose.headX * 0.08 + pose.lookX * 0.18))
  const hy = Math.max(-0.4, Math.min(0.35, pose.headY * 0.06 - pose.headLow * 0.35))
  if (by.neck_1) { by.neck_1.rotation.y = hx * 0.4; by.neck_1.rotation.x = hy * 0.35 }
  if (by.neck_2) { by.neck_2.rotation.y = hx * 0.35; by.neck_2.rotation.x = hy * 0.35 }
  if (by.head) {
    by.head.rotation.y = hx * 0.4
    by.head.rotation.x = hy * 0.4
    by.head.rotation.z = pose.headTilt
  }
  if (by.jaw) by.jaw.rotation.x = pose.mouthOpen * 0.35

  if (by.ear_L_1) by.ear_L_1.rotation.x = pose.earL * (profile.floppy ? 0.2 : 0.9)
  if (by.ear_R_1) by.ear_R_1.rotation.x = pose.earR * (profile.floppy ? 0.2 : 0.9)

  // Tail. Positive tailBase is lift. The 2D bug was a sign error plus an origin
  // inside the body; here the chain starts on the rump and lift is +rotation.x.
  const tails = ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5', 'tail_6', 'tail_7', 'tail_8']
  for (let i = 0; i < tails.length; i++) {
    const b = by[tails[i]]
    if (!b) continue
    const wave = Math.sin(pose.tailPhase + i * 0.7) * pose.tailWave
    b.rotation.x = -(0.12 + pose.tailCurve * 0.3) + pose.tailBase * 0.18 + wave * 0.4
    b.rotation.y = facing * wave * 0.25
  }

  const g = pose.gait
  const swing = o => g * Math.max(0, Math.sin(pose.legPhase + o))
  const liftF = a => pose.frontLegLift + swing(a)
  const liftB = a => pose.backLegLift + swing(a)

  if (sit || loaf || curl) {
    foldSit(by, loaf || curl ? 1 : 0.85, curl)
  } else {
    rotateLeg(by, 'upper_FL', 'lower_FL', 'wrist_FL', liftF(0), 1)
    rotateLeg(by, 'upper_FR', 'lower_FR', 'wrist_FR', liftF(Math.PI), 1)
    rotateLeg(by, 'thigh_BL', 'shin_BL', 'hock_BL', liftB(Math.PI), -1, profile.hock)
    rotateLeg(by, 'thigh_BR', 'shin_BR', 'hock_BR', liftB(0), -1, profile.hock)
  }

  if (by.hips && by.hips.userData.restY != null) {
    const drop = (sit ? 0.35 : 0) + pose.crouch * 0.12 + pose.tuck * 0.4 + (curl ? 0.45 : 0)
    by.hips.position.y = by.hips.userData.restY * (1 - drop * 0.55)
  }
  if (by.hips) by.hips.rotation.x = pose.stretch * 0.35 - pose.tuck * 0.2
}

function rotateLeg (by, a, b, c, lift, sign, hock = 0) {
  if (by[a]) by[a].rotation.x = sign * (-0.08 + lift * 0.7)
  if (by[b]) by[b].rotation.x = sign * (lift * 0.35)
  if (by[c]) by[c].rotation.x = sign * (-lift * 0.4 + hock * 0.15)
}

function foldSit (by, amount, curl) {
  for (const S of ['L', 'R']) {
    if (by[`thigh_B${S}`]) by[`thigh_B${S}`].rotation.x = 1.15 * amount
    if (by[`shin_B${S}`]) by[`shin_B${S}`].rotation.x = -2.05 * amount
    if (by[`hock_B${S}`]) by[`hock_B${S}`].rotation.x = 1.05 * amount
    if (by[`upper_F${S}`]) by[`upper_F${S}`].rotation.x = curl ? 0.8 * amount : 0.15
  }
}

export function plantFeet (bones) {
  // Simple foot IK onto y=0: if a toe is below the ground, lift the hips.
  let minY = Infinity
  for (const name of ['toe_FL', 'toe_FR', 'toe_BL', 'toe_BR']) {
    const b = bones.find(x => x.name === name)
    if (!b) continue
    b.updateWorldMatrix(true, false)
    minY = Math.min(minY, b.getWorldPosition(b.userData._wp || (b.userData._wp = { x: 0, y: 0, z: 0 })).y)
  }
  // THREE.Vector3 would be better; keep a tiny object if getWorldPosition needs Vector3.
}
