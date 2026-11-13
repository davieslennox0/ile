/**
 * The Table: a floating wooden table with a miniature Lagos plot on it —
 * ground tile, half-metre grid, compass rose and the sun's arc for the day.
 *
 * `site` is a child group in real-world metres, drawn at 1:50. ScaleShift
 * animates that one group up to 1:1 to put the user inside the house.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { formatHour, sunVector } from '../heat/score.ts';
import { LIMITS } from '../model/state.ts';
import { Label, PALETTE } from '../ui/label.ts';

export const MINI_SCALE = 1 / 50;
export const PLOT_SIZE = 26;
export const SUN_RADIUS = 13.5;
export const KNOB_RADIUS = 12.2;
/** Height of the site origin above the table top, in table units. */
export const SITE_LIFT = 0.26 * MINI_SCALE;
/** Table placement relative to the seated user's eyes. */
export const TABLE_FORWARD = 0.6;
export const TABLE_DROP = 0.26;

const _fwd = new Vector3();

export function sunPoint(hour: number, out = new Vector3()): Vector3 {
  const s = sunVector(hour);
  return out.set(s.x, s.y, s.z).multiplyScalar(SUN_RADIUS);
}

export class Table {
  /** World anchor. Local y = 0 is the table top. */
  readonly group = new Group();
  /** Wood top and leg; hidden while the user is inside the house. */
  readonly furniture = new Group();
  /** Real-world metres, scaled to the miniature. */
  readonly site = new Group();
  /** Plot dressing that only makes sense at miniature scale. */
  readonly gizmos = new Group();
  readonly sunBall: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly sunLabel: Label;
  readonly knob: Mesh<SphereGeometry, MeshStandardMaterial>;
  /** Large ground disc shown at full scale. */
  readonly ground: Mesh<CircleGeometry, MeshStandardMaterial>;

  constructor() {
    this.group.name = 'ile-table';
    const wood = new MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.7 });
    const dark = new MeshStandardMaterial({ color: 0x4d2c14, roughness: 0.8 });
    const top = new Mesh(new BoxGeometry(0.66, 0.03, 0.66), wood);
    top.position.y = -0.015;
    top.receiveShadow = true;
    const rim = new Mesh(new BoxGeometry(0.7, 0.014, 0.7), dark);
    rim.position.y = -0.034;
    const leg = new Mesh(new CylinderGeometry(0.035, 0.06, 0.7, 16), dark);
    leg.position.y = -0.39;
    const foot = new Mesh(new CylinderGeometry(0.2, 0.22, 0.03, 24), dark);
    foot.position.y = -0.75;
    this.furniture.add(top, rim, leg, foot);
    this.group.add(this.furniture);

    this.site.name = 'ile-site';
    this.site.scale.setScalar(MINI_SCALE);
    this.site.position.set(0, SITE_LIFT, 0);
    this.group.add(this.site);

    // Plot: the ground the plinth sits on.
    const plot = new Mesh(
      new PlaneGeometry(PLOT_SIZE, PLOT_SIZE),
      new MeshStandardMaterial({ color: 0xc58a55, roughness: 1 }),
    );
    plot.rotation.x = -Math.PI / 2;
    plot.position.y = -0.24;
    plot.receiveShadow = true;
    this.site.add(plot);

    this.ground = new Mesh(
      new CircleGeometry(90, 48),
      new MeshStandardMaterial({ color: 0xb98052, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.25;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.site.add(this.ground);

    this.site.add(this.gizmos);
    const grid = new GridHelper(PLOT_SIZE, PLOT_SIZE / LIMITS.grid, 0x5a3418, 0x5a3418);
    const gridMat = grid.material as LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.16;
    gridMat.depthWrite = false;
    grid.position.y = -0.22;
    this.gizmos.add(grid);

    // Compass rose: a north arrow and letter at the plot's north edge.
    const arrow = new Mesh(
      new ConeGeometry(0.7, 1.8, 3),
      new MeshBasicMaterial({ color: 0xf7ead0 }),
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.scale.z = 0.25;
    arrow.position.set(0, -0.18, -PLOT_SIZE / 2 + 1.4);
    this.gizmos.add(arrow);
    const north = new Label({
      width: 1.5,
      height: 1.5,
      ppm: 90,
      fontScale: 0.7,
      bg: 'rgba(0,0,0,0)',
      fg: PALETTE.cream,
      bold: true,
    });
    north.setText('N');
    north.mesh.rotation.x = -Math.PI / 2;
    north.mesh.position.set(1.5, -0.18, -PLOT_SIZE / 2 + 1.3);
    this.gizmos.add(north.mesh);

    // Sun arc for the day, with a tick at each whole hour.
    const arcPts: number[] = [];
    const p = new Vector3();
    for (let h = LIMITS.hour.min; h <= LIMITS.hour.max + 1e-6; h += 0.25) {
      sunPoint(h, p);
      arcPts.push(p.x, p.y, p.z);
    }
    const arcGeo = new BufferGeometry();
    arcGeo.setAttribute('position', new Float32BufferAttribute(arcPts, 3));
    const arc = new Line(
      arcGeo,
      new LineBasicMaterial({ color: 0xf2b23e, transparent: true, opacity: 0.8 }),
    );
    this.gizmos.add(arc);
    const tickGeo = new SphereGeometry(0.16, 8, 6);
    const tickMat = new MeshBasicMaterial({ color: 0xf2b23e });
    for (let h = LIMITS.hour.min; h <= LIMITS.hour.max; h += 1) {
      const tick = new Mesh(tickGeo, tickMat);
      tick.position.copy(sunPoint(h, p));
      this.gizmos.add(tick);
    }

    this.sunBall = new Mesh(
      new SphereGeometry(0.75, 20, 14),
      new MeshBasicMaterial({ color: 0xffd45a }),
    );
    this.gizmos.add(this.sunBall);
    this.sunLabel = new Label({
      width: 4.2,
      height: 1.3,
      ppm: 60,
      fontScale: 0.56,
      bold: true,
      fg: PALETTE.gold,
    });
    this.gizmos.add(this.sunLabel.mesh);

    // Orientation knob: rides a ring around the plot, pointing "house north".
    const ring = new Mesh(
      new TorusGeometry(KNOB_RADIUS, 0.06, 6, 72),
      new MeshBasicMaterial({ color: 0xf7ead0, transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.15;
    this.gizmos.add(ring);
    this.knob = new Mesh(
      new SphereGeometry(0.6, 18, 12),
      new MeshStandardMaterial({
        color: 0xf7ead0,
        emissive: 0xf7ead0,
        emissiveIntensity: 0.25,
        roughness: 0.5,
      }),
    );
    this.gizmos.add(this.knob);
  }

  setHour(hour: number): void {
    sunPoint(hour, this.sunBall.position);
    this.sunLabel.mesh.position.copy(this.sunBall.position);
    this.sunLabel.mesh.position.y += 1.7;
    this.sunLabel.setText(formatHour(hour));
  }

  setRotation(bearingDeg: number): void {
    const t = (bearingDeg * Math.PI) / 180;
    this.knob.position.set(Math.sin(t) * KNOB_RADIUS, 0, -Math.cos(t) * KNOB_RADIUS);
  }

  /** Place the table in front of a seated user, facing them. */
  anchor(headPos: Vector3, headQuat: Quaternion): void {
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    this.group.position
      .copy(headPos)
      .addScaledVector(_fwd, TABLE_FORWARD);
    this.group.position.y = Math.max(0.45, headPos.y - TABLE_DROP);
    this.group.rotation.set(0, Math.atan2(-_fwd.x, -_fwd.z), 0);
    this.group.updateMatrixWorld(true);
  }

  /** Turn the sun's hour label to face the viewer. */
  faceLabels(headPos: Vector3): void {
    this.sunLabel.mesh.lookAt(headPos);
  }
}
