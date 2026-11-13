/**
 * Hands-first input for Ilé.
 *
 * One small layer turns every way of pointing into the same thing — a
 * "pointer" that can hover a target, pinch it, and drag it:
 *
 *  - Quest hands: pinch right on a handle (near), or point a hand ray at it.
 *  - Meta VR Glasses: look at a handle (gaze ray) and pinch either hand; the
 *    drag then follows the pinching hand.
 *  - Controllers work too (trigger = pinch), but are never required.
 *  - Desktop preview: mouse ray + button, so the build can be judged in a tab.
 *
 * On top of pointers it detects the whole-hand gestures: wrist twist while
 * pinching, two-hand spread, palm-up hold, and a sideways flick.
 */

import {
  Matrix4,
  Object3D,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  Vector3,
  type World,
} from '@iwsdk/core';
import { Sfx } from '../audio.ts';

export type Hand = 'left' | 'right';
type PointerId = Hand | 'mouse';

export interface DragInfo {
  /** World-space movement of the pinching hand since the grab. */
  delta: Vector3;
  /** Current world-space position of the pinching hand. */
  position: Vector3;
  /** World-space position of the hand when the grab began. */
  start: Vector3;
  /** Wrist twist since the grab, radians. */
  twist: number;
  /** With two hands on one target: current spread / spread at second grab. */
  spread: number;
  twoHands: boolean;
}

export interface Target {
  id: string;
  /** Position (and, for surfaces, mesh) used for picking. */
  object: Object3D;
  /** Pick radius in the object's own units; scaled by its world scale. */
  radius: number;
  /** Pick by ray-casting the mesh instead of a sphere (floors, panels). */
  surface?: boolean;
  enabled: () => boolean;
  onHover?: (on: boolean) => void;
  /** Fired on release for targets with no drag handler. */
  onClick?: () => void;
  onDragStart?: () => void;
  onDrag?: (info: DragInfo) => void;
  onDragEnd?: () => void;
}

interface Drag {
  target: Target;
  start: Vector3;
  twist: number;
  /** Distance between both hands when the second one joined. */
  pairStart: number;
  plane: Plane | null;
}

interface Pointer {
  id: PointerId;
  active: boolean;
  ray: Ray;
  /** Thumb–index midpoint when hand joints are tracked. */
  near: Vector3 | null;
  handPos: Vector3;
  quat: Quaternion;
  prevQuat: Quaternion;
  hasPrevQuat: boolean;
  down: boolean;
  wasDown: boolean;
  jointPinch: boolean;
  hover: Target | null;
  drag: Drag | null;
  // Whole-hand gesture tracking.
  prevPos: Vector3;
  hasPrevPos: boolean;
  velocity: Vector3;
  palmUpTime: number;
  palmFired: boolean;
  palmUp: boolean;
}

type JointFrame = {
  getJointPose?: (joint: XRSpace, base: XRSpace) => XRPose | undefined;
};

const PINCH_ON = 0.018;
const PINCH_OFF = 0.035;
const NEAR_REACH = 0.03;
const RAY_SLOP = 0.012;
const PALM_HOLD = 0.5;
const FLICK_SPEED = 1.7;
const FLICK_COOLDOWN = 0.9;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const UP = new Vector3(0, 1, 0);

function makePointer(id: PointerId): Pointer {
  return {
    id,
    active: false,
    ray: new Ray(),
    near: null,
    handPos: new Vector3(),
    quat: new Quaternion(),
    prevQuat: new Quaternion(),
    hasPrevQuat: false,
    down: false,
    wasDown: false,
    jointPinch: false,
    hover: null,
    drag: null,
    prevPos: new Vector3(),
    hasPrevPos: false,
    velocity: new Vector3(),
    palmUpTime: 0,
    palmFired: false,
    palmUp: false,
  };
}

export class Gestures {
  readonly targets: Target[] = [];
  /** Fired once when a hand has been held palm-up for half a second. */
  onPalmUp: (hand: Hand, above: Vector3) => void = () => {};
  /** Fired on a quick sideways flick of an open hand. */
  onFlick: (direction: 'left' | 'right', hand: Hand) => void = () => {};
  /** Fired on every pinch start, whether or not it hit a target. */
  onPinch: (hitTarget: boolean) => void = () => {};

  private readonly world: World;
  private readonly pointers: Record<PointerId, Pointer> = {
    left: makePointer('left'),
    right: makePointer('right'),
    mouse: makePointer('mouse'),
  };
  private readonly raycaster = new Raycaster();
  private readonly nearScratch = { left: new Vector3(), right: new Vector3() };
  private mouseNdc = { x: 0, y: 0 };
  private mouseDown = false;
  private mouseSeen = false;
  private lastFlick = -10;
  private time = 0;
  private readonly cleanup: (() => void)[] = [];

  constructor(world: World) {
    this.world = world;
    const el = world.renderer.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      this.mouseNdc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouseNdc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.mouseSeen = true;
    };
    const down = (e: PointerEvent) => {
      move(e);
      this.mouseDown = true;
    };
    const up = () => {
      this.mouseDown = false;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.cleanup.push(() => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    });
  }

  add(target: Target): Target {
    this.targets.push(target);
    return target;
  }

  remove(target: Target): void {
    const i = this.targets.indexOf(target);
    if (i >= 0) this.targets.splice(i, 1);
    for (const p of Object.values(this.pointers)) {
      if (p.hover === target) p.hover = null;
      if (p.drag?.target === target) p.drag = null;
    }
  }

  /** True while any pointer is dragging a target. */
  get dragging(): boolean {
    return Object.values(this.pointers).some((p) => p.drag !== null);
  }

  /** True when at least one tracked hand or controller is present. */
  get hasHands(): boolean {
    return this.pointers.left.active || this.pointers.right.active;
  }

  /** Position of a tracked hand, or null. */
  handPosition(hand: Hand): Vector3 | null {
    const p = this.pointers[hand];
    return p.active ? p.handPos : null;
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
  }

  update(delta: number, time: number): void {
    this.time = time;
    const inXR = !!this.world.session;
    this.updateHand('left', inXR, delta);
    this.updateHand('right', inXR, delta);
    this.updateMouse(inXR);

    for (const p of Object.values(this.pointers)) this.step(p);
    // Drags are dispatched after every pointer has moved, so a two-hand
    // gesture sees both hands in the same frame.
    const done = new Set<Target>();
    for (const p of Object.values(this.pointers)) {
      if (!p.drag || done.has(p.drag.target)) continue;
      done.add(p.drag.target);
      this.dispatchDrag(p);
    }
    for (const p of Object.values(this.pointers)) p.wasDown = p.down;
  }

  // ---------------------------------------------------------------- sources

  private updateHand(hand: Hand, inXR: boolean, delta: number): void {
    const p = this.pointers[hand];
    const xr = this.world.input.xr;
    const source = inXR ? xr.getPrimaryInputSource(hand) : undefined;
    if (!source) {
      this.deactivate(p);
      return;
    }
    p.active = true;
    const player = this.world.player;
    const raySpace = player.raySpaces[hand];
    raySpace.updateWorldMatrix(true, false);
    raySpace.getWorldPosition(p.handPos);
    raySpace.getWorldQuaternion(p.quat);

    // Gaze picks the target on the VR Glasses; hands only pinch.
    const gaze = player.gazeOrigin === 'tracked';
    const aim = gaze ? player.eyeSpace : raySpace;
    aim.updateWorldMatrix(true, false);
    aim.getWorldPosition(p.ray.origin);
    aim.getWorldQuaternion(_q);
    p.ray.direction.set(0, 0, -1).applyQuaternion(_q).normalize();

    // Hand joints: exact pinch point, pinch distance, palm facing.
    p.near = null;
    p.palmUp = false;
    const frame = this.world.xrFrame as (XRFrame & JointFrame) | null;
    const ref = this.world.xrReferenceSpace;
    const joints = (source as XRInputSource & { hand?: Map<string, XRSpace> })
      .hand;
    if (frame && ref && joints && frame.getJointPose) {
      const thumb = joints.get('thumb-tip');
      const index = joints.get('index-finger-tip');
      const wrist = joints.get('wrist');
      const tp = thumb ? frame.getJointPose(thumb, ref) : undefined;
      const ip = index ? frame.getJointPose(index, ref) : undefined;
      if (tp && ip) {
        player.updateWorldMatrix(true, false);
        const a = _v1
          .set(tp.transform.position.x, tp.transform.position.y, tp.transform.position.z)
          .applyMatrix4(player.matrixWorld);
        const b = _v2
          .set(ip.transform.position.x, ip.transform.position.y, ip.transform.position.z)
          .applyMatrix4(player.matrixWorld);
        const gap = a.distanceTo(b);
        if (gap < PINCH_ON) p.jointPinch = true;
        else if (gap > PINCH_OFF) p.jointPinch = false;
        p.near = this.nearScratch[hand].copy(a).add(b).multiplyScalar(0.5);
        p.handPos.copy(p.near);
      }
      const wp = wrist ? frame.getJointPose(wrist, ref) : undefined;
      if (wp) {
        const o = wp.transform.orientation;
        _q.set(o.x, o.y, o.z, o.w);
        // A joint's +Y points out of the back of the hand.
        const back = _v3.set(0, 1, 0).applyQuaternion(_q);
        back.transformDirection(player.matrixWorld);
        p.palmUp = back.y < -0.72;
        // Use the wrist for twist: steadier than the aim ray.
        player.getWorldQuaternion(p.quat).multiply(_q);
      }
    } else {
      p.jointPinch = false;
    }
    p.down = xr.getSelectState(hand).active || p.jointPinch;
    this.trackWholeHand(p, hand, delta);
  }

  private updateMouse(inXR: boolean): void {
    const p = this.pointers.mouse;
    if (inXR || !this.mouseSeen) {
      this.deactivate(p);
      return;
    }
    p.active = true;
    const cam = this.world.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(p.ray.origin);
    p.ray.direction
      .set(this.mouseNdc.x, this.mouseNdc.y, 0.5)
      .unproject(cam)
      .sub(p.ray.origin)
      .normalize();
    p.down = this.mouseDown;
    p.near = null;
    if (p.drag?.plane) {
      if (!p.ray.intersectPlane(p.drag.plane, p.handPos)) {
        p.handPos.copy(p.drag.start);
      }
    } else {
      p.handPos.copy(p.ray.direction).multiplyScalar(0.6).add(p.ray.origin);
    }
  }

  private deactivate(p: Pointer): void {
    if (p.hover) {
      if (!this.heldElsewhere(p, p.hover)) p.hover.onHover?.(false);
      p.hover = null;
    }
    if (p.drag) {
      p.drag.target.onDragEnd?.();
      p.drag = null;
    }
    p.active = false;
    p.down = false;
    p.near = null;
    p.hasPrevQuat = false;
    p.hasPrevPos = false;
    p.palmUpTime = 0;
    p.jointPinch = false;
  }

  // -------------------------------------------------------------- gestures

  private trackWholeHand(p: Pointer, hand: Hand, delta: number): void {
    // Palm-up hold opens the tool menu.
    if (p.palmUp && !p.down && !p.drag) {
      p.palmUpTime += delta;
      if (p.palmUpTime >= PALM_HOLD && !p.palmFired) {
        p.palmFired = true;
        this.onPalmUp(hand, _v1.copy(p.handPos).addScaledVector(UP, 0.1).clone());
      }
    } else {
      p.palmUpTime = 0;
      if (!p.palmUp) p.palmFired = false;
    }

    // Sideways flick of an open hand.
    if (p.hasPrevPos && delta > 1e-4) {
      _v1.copy(p.handPos).sub(p.prevPos).divideScalar(delta);
      p.velocity.lerp(_v1, 0.5);
      if (!p.down && !p.drag && !p.palmUp && this.time - this.lastFlick > FLICK_COOLDOWN) {
        const head = this.world.player.head;
        head.updateWorldMatrix(true, false);
        _m.extractRotation(head.matrixWorld);
        const right = _v2.set(1, 0, 0).applyMatrix4(_m);
        const fwd = _v3.set(0, 0, -1).applyMatrix4(_m);
        const vx = p.velocity.dot(right);
        const vz = p.velocity.dot(fwd);
        const vy = p.velocity.y;
        if (
          Math.abs(vx) > FLICK_SPEED &&
          Math.abs(vx) > 2 * Math.abs(vy) &&
          Math.abs(vx) > 2 * Math.abs(vz)
        ) {
          this.lastFlick = this.time;
          this.onFlick(vx < 0 ? 'left' : 'right', hand);
        }
      }
    }
    p.prevPos.copy(p.handPos);
    p.hasPrevPos = true;
  }

  /** Signed rotation about the hand's own forward axis since last frame. */
  private twistStep(p: Pointer): number {
    if (!p.hasPrevQuat) {
      p.prevQuat.copy(p.quat);
      p.hasPrevQuat = true;
      return 0;
    }
    _q.copy(p.prevQuat).invert().premultiply(p.quat); // world-space delta
    const axis = _v1.set(0, 0, -1).applyQuaternion(p.quat);
    const proj = _q.x * axis.x + _q.y * axis.y + _q.z * axis.z;
    let angle = 2 * Math.atan2(proj, _q.w);
    if (angle > Math.PI) angle -= Math.PI * 2;
    if (angle < -Math.PI) angle += Math.PI * 2;
    p.prevQuat.copy(p.quat);
    return Math.abs(angle) < 0.6 ? angle : 0; // ignore tracking jumps
  }

  // ---------------------------------------------------------------- picking

  private pick(p: Pointer): Target | null {
    let best: Target | null = null;

    // 1. Direct: the pinch point is on a handle.
    if (p.near) {
      let bestD = Infinity;
      for (const t of this.targets) {
        if (t.surface || !t.enabled()) continue;
        t.object.getWorldPosition(_v1);
        const reach = t.radius * t.object.getWorldScale(_v2).x + NEAR_REACH;
        const dist = _v1.distanceTo(p.near);
        if (dist < reach && dist < bestD) {
          bestD = dist;
          best = t;
        }
      }
      if (best) return best;
    }

    // 2. Ray onto a handle sphere (with a little angular slop).
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (t.surface || !t.enabled()) continue;
      t.object.getWorldPosition(_v1);
      const along = _v2.copy(_v1).sub(p.ray.origin).dot(p.ray.direction);
      if (along <= 0.02) continue;
      const radius = t.radius * t.object.getWorldScale(_v3).x + RAY_SLOP * along;
      const miss = Math.sqrt(p.ray.distanceSqToPoint(_v1));
      if (miss > radius) continue;
      const score = miss / radius + along * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) return best;

    // 3. Ray onto a surface (room floors, panels).
    this.raycaster.ray.copy(p.ray);
    this.raycaster.near = 0.01;
    this.raycaster.far = 200;
    let bestDist = Infinity;
    for (const t of this.targets) {
      if (!t.surface || !t.enabled()) continue;
      const hits = this.raycaster.intersectObject(t.object, false);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        bestDist = hits[0].distance;
        best = t;
      }
    }
    return best;
  }

  private heldElsewhere(p: Pointer, target: Target): boolean {
    return Object.values(this.pointers).some(
      (o) => o !== p && (o.hover === target || o.drag?.target === target),
    );
  }

  private step(p: Pointer): void {
    if (!p.active) return;
    const justDown = p.down && !p.wasDown;
    const justUp = !p.down && p.wasDown;

    if (p.drag) {
      p.drag.twist += this.twistStep(p);
      if (justUp || !p.drag.target.enabled()) {
        const t = p.drag.target;
        p.drag = null;
        if (!this.heldElsewhere(p, t)) {
          t.onDragEnd?.();
          if (justUp && t.onClick && !t.onDrag) t.onClick();
          if (t.onDrag) Sfx.release();
        }
      }
      return;
    }

    if (!p.down) {
      const next = this.pick(p);
      if (next !== p.hover) {
        if (p.hover && !this.heldElsewhere(p, p.hover)) p.hover.onHover?.(false);
        if (next && !this.heldElsewhere(p, next)) next.onHover?.(true);
        p.hover = next;
      }
      return;
    }

    if (justDown) {
      Sfx.unlock();
      this.onPinch(p.hover !== null);
      const t = p.hover;
      if (!t) return;
      const other = Object.values(this.pointers).find(
        (o) => o !== p && o.drag?.target === t,
      );
      let plane: Plane | null = null;
      if (p.id === 'mouse') {
        t.object.getWorldPosition(_v1);
        this.world.camera.getWorldDirection(_v2);
        plane = new Plane().setFromNormalAndCoplanarPoint(_v2, _v1);
        p.ray.intersectPlane(plane, p.handPos);
      }
      p.drag = {
        target: t,
        start: p.handPos.clone(),
        twist: 0,
        pairStart: other ? other.handPos.distanceTo(p.handPos) : 0,
        plane,
      };
      p.hasPrevQuat = false;
      if (other?.drag) other.drag.pairStart = p.drag.pairStart;
      else {
        t.onDragStart?.();
        Sfx.grab();
      }
    }
  }

  private dispatchDrag(p: Pointer): void {
    const drag = p.drag;
    if (!drag || !drag.target.onDrag) return;
    const other = Object.values(this.pointers).find(
      (o) => o !== p && o.drag?.target === drag.target,
    );
    const twoHands = !!other && drag.pairStart > 0.01;
    const spread = twoHands
      ? (other as Pointer).handPos.distanceTo(p.handPos) / drag.pairStart
      : 1;
    drag.target.onDrag({
      delta: _v1.copy(p.handPos).sub(drag.start).clone(),
      position: p.handPos,
      start: drag.start,
      twist: drag.twist,
      spread,
      twoHands,
    });
  }
}
