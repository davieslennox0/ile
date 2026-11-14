/**
 * Life HUD, world-space at the back of the table: a status strip (day and
 * clock, ₦ savings, Energy / Comfort / Joy bars, Ilé Score) and event cards
 * that slide in on a cream background with a dark outline.
 */

import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { Label } from './label.ts';

export interface Status {
  day: number;
  clock: number;
  savings: number;
  energy: number;
  comfort: number;
  joy: number;
  score: number;
}

function clockText(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - Math.floor(h)) * 60 / 15) * 15;
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}

export class StatusStrip {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private key = '';

  constructor(width = 0.7, height = 0.085) {
    this.canvas.width = 1400;
    this.canvas.height = 170;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    this.mesh.renderOrder = 30;
  }

  set(s: Status): void {
    const key = JSON.stringify([s.day, clockText(s.clock), Math.round(s.savings), Math.round(s.energy), Math.round(s.comfort), Math.round(s.joy), s.score]);
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f7ead0';
    g.strokeStyle = '#2a1a0e';
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 40);
    g.fill();
    g.stroke();
    const font = (px: number, w = 800) => `${w} ${px}px system-ui, "Segoe UI", Roboto, sans-serif`;
    // Day + clock chip.
    g.fillStyle = '#2a1a0e';
    g.beginPath();
    g.roundRect(26, 30, 330, 110, 30);
    g.fill();
    g.fillStyle = '#f7ead0';
    g.font = font(46);
    g.textBaseline = 'middle';
    g.fillText(`Day ${s.day}`, 50, 64);
    g.font = font(36, 600);
    g.fillText(clockText(s.clock), 50, 112);
    // Savings pill.
    g.fillStyle = '#d9692b';
    g.beginPath();
    g.roundRect(372, 40, 330, 90, 45);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = font(50);
    g.textAlign = 'center';
    g.fillText(`₦${Math.round(s.savings).toLocaleString('en-NG')}`, 537, 87);
    g.textAlign = 'left';
    // Needs bars.
    const bars: [string, number, string][] = [['Energy', s.energy, '#f2bf12'], ['Comfort', s.comfort, '#2fa58f'], ['Joy', s.joy, '#e04f3a']];
    bars.forEach(([name, v, color], i) => {
      const x = 724 + i * 190;
      g.fillStyle = '#2a1a0e';
      g.font = font(30, 700);
      g.fillText(name, x, 58);
      g.fillStyle = 'rgba(42,26,14,0.18)';
      g.beginPath();
      g.roundRect(x, 82, 170, 34, 17);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, 82, Math.max(17, 170 * Math.max(0, Math.min(1, v / 100))), 34, 17);
      g.fill();
    });
    // Ilé Score.
    g.fillStyle = '#2a1a0e';
    g.font = font(28, 700);
    g.textAlign = 'center';
    g.fillText('Ilé', 1320, 60);
    g.font = font(54);
    g.fillText(String(s.score), 1320, 108);
    g.textAlign = 'left';
    this.texture.needsUpdate = true;
  }
}

export class EventCard {
  readonly group = new Group();
  readonly label: Label;
  private t = 0;
  private life = 0;
  private shown = false;

  constructor() {
    this.label = new Label({ width: 0.56, height: 0.15, fontScale: 0.2, bold: true, bg: 'rgba(247, 234, 208, 0.98)', fg: '#2a1a0e', border: '#2a1a0e', maxLines: 3 });
    (this.label.mesh.material as MeshBasicMaterial).depthTest = false;
    this.label.mesh.renderOrder = 40;
    this.group.add(this.label.mesh);
    this.group.visible = false;
  }

  /** Slide a card in: a short title over one or two lines of text. */
  show(title: string, body: string, seconds = 6): void {
    this.label.setText(`${title}\n${body}`);
    this.t = 0;
    this.life = seconds;
    this.shown = true;
    this.group.visible = true;
  }

  hide(): void {
    this.shown = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    if (this.shown && this.t > this.life) this.shown = false;
    const target = this.shown ? 0 : 0.9;
    const x = this.group.position.x;
    const from = this.t < 0.6 && this.shown ? 0.9 * (1 - this.t / 0.6) ** 2 : x + (target - x) * Math.min(1, dt * 6);
    this.group.position.x = from;
    if (!this.shown && from > 0.85) this.group.visible = false;
  }
}
