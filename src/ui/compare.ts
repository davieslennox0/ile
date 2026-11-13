/**
 * Compare: the design as it was at the start of the session beside the design
 * now — two small heat-mapped models, both Ilé Scores, and per-room change.
 */

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { comfortColor, scoreDay } from '../heat/score.ts';
import { BuildingView } from '../model/building.ts';
import { rooms, type Design } from '../model/state.ts';
import { Label, PALETTE } from './label.ts';

const THUMB_SCALE = 1 / 95;
const _c = new Color();

export class Compare {
  /** Positioned in table-local space, above the back of the table. */
  readonly group = new Group();
  private readonly before = new BuildingView({ noRoof: true });
  private readonly after = new BuildingView({ noRoof: true });
  private readonly beforeLabel: Label;
  private readonly afterLabel: Label;
  private readonly deltaLabel: Label;

  constructor() {
    this.group.visible = false;
    const shelf = new Mesh(
      new BoxGeometry(0.56, 0.008, 0.24),
      new MeshStandardMaterial({ color: 0x4d2c14, roughness: 0.8 }),
    );
    shelf.position.y = -0.006;
    this.group.add(shelf);

    const place = (view: BuildingView, x: number) => {
      const holder = new Group();
      holder.scale.setScalar(THUMB_SCALE);
      holder.position.set(x, 0.003, 0);
      holder.add(view.group);
      this.group.add(holder);
    };
    place(this.before, -0.14);
    place(this.after, 0.14);

    const title = (x: number) => {
      const l = new Label({ width: 0.25, height: 0.062, fontScale: 0.56, bold: true });
      l.mesh.position.set(x, 0.1, -0.1);
      this.group.add(l.mesh);
      return l;
    };
    this.beforeLabel = title(-0.14);
    this.afterLabel = title(0.14);

    this.deltaLabel = new Label({
      width: 0.6,
      height: 0.1,
      fontScale: 0.34,
      align: 'center',
    });
    this.deltaLabel.mesh.position.set(0, -0.06, 0.125);
    this.group.add(this.deltaLabel.mesh);
  }

  update(before: Design, now: Design): void {
    this.before.rebuild(before);
    this.after.rebuild(now);
    const a = scoreDay(before);
    const b = scoreDay(now);
    for (const id of Object.keys(a.rooms)) {
      this.before.setFloorColor(id, _c.setRGB(...comfortColor(a.rooms[id])), 0.25);
    }
    for (const id of Object.keys(b.rooms)) {
      this.after.setFloorColor(id, _c.setRGB(...comfortColor(b.rooms[id])), 0.25);
    }
    this.beforeLabel.setText(`Before  ${a.overall}`);
    const diff = b.overall - a.overall;
    this.afterLabel.setText(
      `Now  ${b.overall}  (${diff >= 0 ? '+' : ''}${diff})`,
      diff > 0 ? '#bff0b0' : diff < 0 ? '#ffb4a0' : PALETTE.cream,
    );
    // Biggest changes first; rooms that did not exist before are skipped.
    const parts = rooms(now)
      .filter((r) => a.rooms[r.id] !== undefined)
      .map((r) => ({ label: r.label, d: b.rooms[r.id] - a.rooms[r.id] }))
      .sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
      .slice(0, 4)
      .map((p) => `${p.label} ${p.d > 0 ? '+' : ''}${p.d}`);
    this.deltaLabel.setText(
      `${parts.slice(0, 2).join('   ·   ')}\n${parts.slice(2).join('   ·   ')}`,
    );
  }
}
