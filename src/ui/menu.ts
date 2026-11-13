/**
 * The palm menu. Hold a hand palm-up for half a second and the tools bloom
 * above it; pinch one (directly, by hand ray, or by gaze) to use it. A "Menu"
 * token on the table opens the same menu for anyone who prefers to pinch.
 */

import { Group, Vector3 } from '@iwsdk/core';
import type { App } from '../app.ts';
import { Sfx } from '../audio.ts';
import { Label, PALETTE } from './label.ts';

export interface MenuItem {
  label: string;
  run: () => void;
}

const SLOTS = 8;
const SIZE = 0.062;
const GAP = 0.072;
const LIFETIME = 9;

export class PalmMenu {
  readonly group = new Group();
  private readonly labels: Label[] = [];
  private items: MenuItem[] = [];
  private hover = -1;
  private age = 0;

  constructor(app: App) {
    this.group.visible = false;
    for (let i = 0; i < SLOTS; i += 1) {
      const label = new Label({
        width: SIZE,
        height: SIZE,
        ppm: 3200,
        fontScale: 0.26,
        round: true,
        bold: true,
        border: PALETTE.gold,
      });
      this.labels.push(label);
      this.group.add(label.mesh);
      app.gestures.add({
        id: `menu-${i}`,
        object: label.mesh,
        radius: SIZE * 0.55,
        enabled: () => this.group.visible && i < this.items.length,
        onHover: (on) => {
          this.hover = on ? i : this.hover === i ? -1 : this.hover;
          this.age = 0;
          this.paint();
        },
        onClick: () => {
          const item = this.items[i];
          this.close();
          item?.run();
        },
      });
    }
  }

  get isOpen(): boolean {
    return this.group.visible;
  }

  open(items: MenuItem[], at: Vector3, headPos: Vector3): void {
    this.items = items.slice(0, SLOTS);
    this.hover = -1;
    this.age = 0;
    const perRow = Math.min(4, Math.ceil(this.items.length / (this.items.length > 4 ? 2 : 1)));
    const rows = Math.ceil(this.items.length / perRow);
    this.labels.forEach((label, i) => {
      label.mesh.visible = i < this.items.length;
      if (i >= this.items.length) return;
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, this.items.length - row * perRow);
      const col = i - row * perRow;
      label.mesh.position.set(
        (col - (inRow - 1) / 2) * GAP,
        (rows - 1 - row) * GAP,
        0,
      );
    });
    this.paint();
    this.group.position.copy(at);
    this.group.lookAt(headPos);
    this.group.visible = true;
    Sfx.open();
  }

  close(): void {
    this.group.visible = false;
    this.items = [];
  }

  update(delta: number): void {
    if (!this.group.visible) return;
    this.age += delta;
    if (this.age > LIFETIME) this.close();
  }

  private paint(): void {
    this.items.forEach((item, i) => {
      const hot = this.hover === i;
      this.labels[i].setText(
        item.label,
        hot ? PALETTE.ink : PALETTE.cream,
        hot ? PALETTE.gold : PALETTE.panel,
      );
      this.labels[i].mesh.scale.setScalar(hot ? 1.15 : 1);
    });
  }
}
