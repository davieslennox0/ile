/**
 * ScaleShift: the move between the miniature on the table and sitting inside
 * the house at 1:1.
 *
 * The user never moves. The whole site group grows (or shrinks) around the
 * chosen room so that room's centre lands under the user's seat, while a
 * vignette narrows the view to keep the motion comfortable. Room-to-room hops
 * are a quick blink, not a glide.
 */

import {
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { Sfx } from '../audio.ts';
import { rotateXZ } from '../heat/score.ts';
import { rectCx, rectCz, roomById, roomLabel, type RoomId } from '../model/state.ts';
import { MINI_SCALE, SITE_LIFT } from '../scene/table.ts';

const DURATION = 1.2;
const HOP = 0.45;
/** Room floors sit 2 cm above the site origin. */
const FLOOR_Y = 0.02;

const smooth = (t: number) => t * t * (3 - 2 * t);
const _head = new Vector3();
const _quat = new Quaternion();
const _target = new Vector3();

type Phase = 'idle' | 'in' | 'out' | 'hop';

export class ScaleShift {
  readonly vignette: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly app: App;
  private phase: Phase = 'idle';
  private t = 0;
  private room: RoomId = '';
  private hopDone = false;
  /** Room centre in site-local metres (after the building's rotation). */
  private readonly centre = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();

  constructor(app: App) {
    this.app = app;
    this.vignette = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uStrength: { value: 0 }, uInner: { value: 0.5 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uStrength;
          uniform float uInner;
          void main() {
            float r = distance(vUv, vec2(0.5)) * 2.0;
            float a = smoothstep(uInner, uInner + 0.35, r) * uStrength;
            gl_FragColor = vec4(0.03, 0.02, 0.01, a);
          }`,
      }),
    );
    this.vignette.renderOrder = 999;
    this.vignette.frustumCulled = false;
    this.vignette.visible = false;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  private roomCentre(room: RoomId): Vector3 {
    const d = this.app.design;
    const r = roomById(d, room);
    const p = rotateXZ({ x: rectCx(r), z: rectCz(r) }, d.rotation);
    return this.centre.set(p.x, FLOOR_Y, p.z);
  }

  /** Where the room centre must end up, in table-local coordinates. */
  private seatTarget(out: Vector3): Vector3 {
    this.app.headPose(_head, _quat);
    _target.set(_head.x, 0, _head.z);
    return this.app.table.group.worldToLocal(out.copy(_target));
  }

  enter(room: RoomId): void {
    if (this.phase !== 'idle' || this.app.mode !== 'table') return;
    this.room = room;
    this.roomCentre(room);
    const site = this.app.table.site;
    this.from.copy(this.centre).multiplyScalar(MINI_SCALE).add(site.position);
    this.seatTarget(this.to);
    this.phase = 'in';
    this.t = 0;
    this.app.setMode('shifting', room);
    Sfx.whoosh();
  }

  exit(): void {
    if (this.phase !== 'idle' || this.app.mode !== 'inside') return;
    this.roomCentre(this.room);
    // Glide back from wherever the seat is now to the room's spot on the table.
    this.to.copy(this.centre).add(this.app.table.site.position);
    this.from.copy(this.centre).multiplyScalar(MINI_SCALE).add(new Vector3(0, SITE_LIFT, 0));
    this.phase = 'out';
    this.t = 0;
    this.app.setMode('shifting', this.room);
    Sfx.whoosh();
  }

  hop(room: RoomId): void {
    if (this.phase !== 'idle' || this.app.mode !== 'inside') return;
    this.room = room;
    this.phase = 'hop';
    this.t = 0;
    this.hopDone = false;
    Sfx.grab();
  }

  /** Re-seat the user after the design changed while they were inside. */
  reseat(): void {
    if (this.app.mode !== 'inside' || this.phase !== 'idle') return;
    this.place(1, this.seatTarget(_target), this.roomCentre(this.room));
    this.showDoors();
  }

  private place(scale: number, centreAt: Vector3, centre: Vector3): void {
    const site = this.app.table.site;
    site.scale.setScalar(scale);
    site.position.copy(centre).multiplyScalar(-scale).add(centreAt);
    site.updateMatrixWorld(true);
  }

  private showDoors(): void {
    this.app.handles.showDoors(this.room);
  }

  update(delta: number): void {
    this.followHead();
    const u = this.vignette.material.uniforms;
    if (this.phase === 'idle') {
      this.vignette.visible = false;
      return;
    }
    this.vignette.visible = true;

    if (this.phase === 'hop') {
      this.t += delta / HOP;
      const k = Math.sin(Math.min(1, this.t) * Math.PI);
      u.uStrength.value = k;
      u.uInner.value = -0.35 * k + 0.4 * (1 - k);
      if (this.t >= 0.5 && !this.hopDone) {
        this.hopDone = true;
        this.place(1, this.seatTarget(_target), this.roomCentre(this.room));
        this.app.setMode('inside', this.room);
        this.showDoors();
        this.app.toast(roomLabel(this.app.design, this.room));
      }
      if (this.t >= 1) this.phase = 'idle';
      return;
    }

    this.t = Math.min(1, this.t + delta / DURATION);
    const e = smooth(this.phase === 'in' ? this.t : 1 - this.t);
    const scale = Math.exp(Math.log(MINI_SCALE) * (1 - e));
    _target.copy(this.from).lerp(this.to, e);
    this.place(scale, _target, this.centre);
    this.app.setShiftProgress(e);

    const k = Math.sin(this.t * Math.PI);
    u.uStrength.value = 0.92 * k;
    u.uInner.value = 0.75 - 0.6 * k;

    if (this.t >= 1) {
      const entered = this.phase === 'in';
      this.phase = 'idle';
      if (entered) {
        this.app.setMode('inside', this.room);
        this.showDoors();
      } else {
        this.app.handles.showDoors(null);
        const site = this.app.table.site;
        site.scale.setScalar(MINI_SCALE);
        site.position.set(0, SITE_LIFT, 0);
        this.app.setMode('table', null);
      }
    }
  }

  /** Keep the vignette quad just in front of the eyes. */
  private followHead(): void {
    this.app.headPose(_head, _quat);
    this.vignette.position.copy(_head).add(_target.set(0, 0, -0.3).applyQuaternion(_quat));
    this.vignette.quaternion.copy(_quat);
  }
}
