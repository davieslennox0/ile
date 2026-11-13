/**
 * Heat overlay: tints each room's floor from cool blue to red by its comfort
 * score and floats the number above the room on the miniature.
 */

import { Color, Group, Vector3 } from '@iwsdk/core';
import type { BuildingView } from '../model/building.ts';
import { rectCx, rectCz, rooms, type Design, type RoomId } from '../model/state.ts';
import { Label } from '../ui/label.ts';
import { comfortColor, type DesignScore } from './score.ts';

const _c = new Color();

export class HeatOverlay {
  /** Per-room comfort numbers; lives in building-local metres. */
  readonly labels = new Group();
  private readonly byRoom = new Map<RoomId, Label>();
  private hovered: RoomId | null = null;

  constructor() {
    this.labels.visible = false;
  }

  setHover(room: RoomId, on: boolean): void {
    if (on) this.hovered = room;
    else if (this.hovered === room) this.hovered = null;
  }

  private labelFor(id: RoomId): Label {
    let label = this.byRoom.get(id);
    if (!label) {
      label = new Label({
        width: 2.6,
        height: 1.7,
        ppm: 70,
        fontScale: 0.62,
        bold: true,
        bg: 'rgba(30, 18, 10, 0.82)',
      });
      this.byRoom.set(id, label);
      this.labels.add(label.mesh);
    }
    return label;
  }

  update(view: BuildingView, d: Design, score: DesignScore, on: boolean, showNumbers: boolean): void {
    this.labels.visible = on && showNumbers;
    const rs = rooms(d);
    const live = new Set(rs.map((r) => r.id));
    for (const [id, label] of this.byRoom) label.mesh.visible = live.has(id);
    for (const room of rs) {
      const s = score.rooms[room.id];
      if (!s) continue;
      const hot = this.hovered === room.id;
      const [r, g, b] = comfortColor(s.comfort);
      if (on) view.setFloorColor(room.id, _c.setRGB(r, g, b), hot ? 0.55 : 0.22);
      else if (hot) view.setFloorColor(room.id, _c.setHex(0xffe2a0), 0.45);
      else view.setFloorColor(room.id, null);
      const label = this.labelFor(room.id);
      label.mesh.position.set(rectCx(room), Math.max(2.4, d.wallHeight) + 2.8, rectCz(room));
      const css = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      label.setText(`${s.comfort}`, '#ffffff', css);
    }
  }

  faceLabels(headPos: Vector3): void {
    if (!this.labels.visible) return;
    for (const label of this.byRoom.values()) label.mesh.lookAt(headPos);
  }
}
