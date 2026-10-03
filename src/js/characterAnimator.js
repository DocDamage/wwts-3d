/**
 * Character Animator — layered procedural animation for the Mixamo-rigged
 * contestants. The baked "Breathing Idle" clip runs as the base layer; every
 * other motion (walk, DJ scratching, dances, taunts, reactions) is applied as
 * additive local rotations on top, so moves blend instead of fighting the clip.
 *
 * Each frame: undo last frame's offsets → mixer.update (idle) → add layers.
 * (AnimationMixer only writes a bone when its value changes, so we must undo
 * our own offsets rather than reset to bind pose, or held keys would snap to T-pose.)
 */

import * as THREE from 'three';

// Canonical Mixamo joint names we drive
const JOINTS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'
];

/**
 * Map canonical names → real bones. FBX exports nest zero-length helper bones
 * that reuse the parent's name, so skip any bone whose parent has its own name.
 */
function mapJoints(root) {
  const map = {};
  root.traverse((node) => {
    if (!node.isBone) return;
    const name = node.name.replace(/^mixamorig\d*:?/, '');
    if (map[name] || (node.parent && node.parent.name === node.name)) return;
    map[name] = node;
  });
  return map;
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

class CharacterAnimator {
  constructor(root, mixer) {
    this.root = root;
    this.mixer = mixer;
    this.bones = mapJoints(root);

    // Accumulated offsets for the current frame: name -> [x, y, z]
    this.frame = {};
    // Offsets applied last frame (name -> inverse quaternion) so they can be undone
    this.applied = {};
    this.rootLift = 0;
    this.rootYaw = 0;
    this.debugOffsets = null;
  }

  /** Add a local rotation offset (radians, XYZ euler) for this frame, scaled by weight */
  add(name, x = 0, y = 0, z = 0, weight = 1) {
    if (!this.bones[name] || weight === 0) return;
    const f = this.frame[name] || (this.frame[name] = [0, 0, 0]);
    f[0] += x * weight;
    f[1] += y * weight;
    f[2] += z * weight;
  }

  /** Mirror helper: side = 'Left' | 'Right' */
  addSide(side, joint, x, y, z, weight = 1) {
    this.add(side + joint, x, y, z, weight);
  }

  /*
   * Semantic helpers. Axis/sign mapping was measured on the Mixamo rig in its
   * idle pose (character faces +Z, its left is +X):
   *   Arm x− raises the arm out sideways (both sides); Arm z raises it forward
   *   (+ for left, − for right); ForeArm/Hand z bends the elbow/wrist the same way;
   *   UpLeg x+ lifts the leg forward, Leg x− bends the knee, UpLeg z abducts
   *   (+ left, − right); Spine/Neck/Head x+ bends forward, z+ leans to the
   *   character's right, y+ turns toward the character's left.
   */

  /** side: 'Left' | 'Right'. raise/fwd/elbow are in radians (raise≈1.5 = T-pose, ≈2.8 = overhead) */
  arm(side, { raise = 0, fwd = 0, twist = 0, elbow = 0, inward = 0, wrist = 0, shrug = 0 } = {}, w = 1) {
    const s = side === 'Left' ? 1 : -1;
    this.add(side + 'Arm', -raise, twist * s, fwd * s, w);
    this.add(side + 'ForeArm', inward, 0, elbow * s, w);
    if (wrist) this.add(side + 'Hand', 0, 0, wrist * s, w);
    if (shrug) this.add(side + 'Shoulder', 0, 0, shrug * s, w);
  }

  /** lift = hip flexion (leg forward/up), knee = knee bend, out = abduct, foot = ankle */
  leg(side, { lift = 0, knee = 0, out = 0, foot = 0 } = {}, w = 1) {
    const s = side === 'Left' ? 1 : -1;
    this.add(side + 'UpLeg', lift, 0, out * s, w);
    this.add(side + 'Leg', -knee, 0, 0, w);
    if (foot) this.add(side + 'Foot', foot, 0, 0, w);
  }

  /** Spread a bend across the three spine joints. lean+ = toward the character's right */
  spine({ bend = 0, lean = 0, twist = 0 } = {}, w = 1) {
    ['Spine', 'Spine1', 'Spine2'].forEach(j => this.add(j, bend / 3, twist / 3, lean / 3, w));
  }

  /** nod+ = chin down, turn+ = look to the character's left, tilt+ = toward right shoulder */
  head({ nod = 0, turn = 0, tilt = 0 } = {}, w = 1) {
    this.add('Neck', nod * 0.4, turn * 0.4, tilt * 0.4, w);
    this.add('Head', nod * 0.6, turn * 0.6, tilt * 0.6, w);
  }

  /** Root-level vertical offset (jumps, bounces) for this frame */
  lift(y, w = 1) {
    this.rootLift += y * w;
  }

  /** Root-level extra facing rotation (spins, turns) for this frame */
  yaw(a, w = 1) {
    this.rootYaw += a * w;
  }

  beginFrame(delta) {
    Object.entries(this.applied).forEach(([name, inverse]) => {
      this.bones[name].quaternion.multiply(inverse);
    });
    this.applied = {};
    if (this.mixer) this.mixer.update(delta);
    this.frame = {};
    this.rootLift = 0;
    this.rootYaw = 0;
  }

  endFrame() {
    if (this.debugOffsets) {
      Object.entries(this.debugOffsets).forEach(([name, v]) => this.add(name, v[0], v[1], v[2]));
    }
    Object.entries(this.frame).forEach(([name, v]) => {
      const bone = this.bones[name];
      if (!bone) return;
      _euler.set(v[0], v[1], v[2], 'XYZ');
      _quat.setFromEuler(_euler);
      bone.quaternion.multiply(_quat);
      this.applied[name] = _quat.clone().invert();
    });
  }
}

export { CharacterAnimator, mapJoints, JOINTS };
