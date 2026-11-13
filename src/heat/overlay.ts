/**
 * Heat overlay: tints each room's floor from cool blue to red by its comfort
 * score and floats the number above the room on the miniature.
 */

import { Color, Group, Vector3 } from '@iwsdk/core';
import type { BuildingView } from '../model/building.ts';
import { ROOM_IDS, rectCx, rectCz, rooms, type Design, type RoomId } from '../model/state.ts';
import { Label } from '../ui/label.ts';
import { comfortColor, type DesignScore } from './score.ts';

const _c = new Color();

export class HeatOverlay {
  /** Per-room comfort numbers; lives in building-local metres. */
  readonly labels = new Group();
  private readonly byRoom = new Map<RoomId, Label>();
  private hovered: RoomId | null = null;

  constructor() {
    for (const id of ROOM_IDS) {
      const label = new Label({
        width: 2.3,
        height: 1.5,
        ppm: 70,
        fontScale: 0.6,
        bold: true,
        bg: 'rgba(30, 18, 10, 0.82)',
      });
      this.byRoom.set(id, label);
      this.labels.add(label.mesh);
    }
    this.labels.visible = false;
  }

  setHover(room: RoomId, on: boolean): void {
    if (on) this.hovered = room;
    else if (this.hovered === room) this.hovered = null;
  }

  update(view: BuildingView, d: Design, score: DesignScore, on: boolean, showNumbers: boolean): void {
    this.labels.visible = on && showNumbers;
    for (const room of rooms(d)) {
      const s = score.rooms[room.id];
      const hot = this.hovered === room.id;
      if (on) {
        const [r, g, b] = comfortColor(s.comfort);
        view.setFloorColor(room.id, _c.setRGB(r, g, b), hot ? 0.55 : 0.22);
      } else if (hot) {
        view.setFloorColor(room.id, _c.setHex(0xffe2a0), 0.45);
      } else {
        view.setFloorColor(room.id, null);
      }
      const label = this.byRoom.get(room.id);
      if (label) {
        label.mesh.position.set(rectCx(room), d.wallHeight + 2.6, rectCz(room));
        const [r, g, b] = comfortColor(s.comfort);
        const css = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
        label.setText(`${s.comfort}`, '#ffffff', css);
      }
    }
  }

  faceLabels(headPos: Vector3): void {
    if (!this.labels.visible) return;
    for (const label of this.byRoom.values()) label.mesh.lookAt(headPos);
  }
}
