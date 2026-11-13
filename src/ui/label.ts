/**
 * Canvas-backed text panels. Everything Ilé says on screen goes through here:
 * plain Three.js planes with a CanvasTexture, so text needs no font assets and
 * renders identically on Quest, the VR Glasses and the desktop emulator.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export interface LabelOptions {
  /** Panel size in metres. */
  width: number;
  height: number;
  /** Canvas pixels per metre of panel. */
  ppm?: number;
  /** Font size as a fraction of panel height. */
  fontScale?: number;
  bg?: string;
  fg?: string;
  border?: string;
  round?: boolean;
  bold?: boolean;
  align?: 'center' | 'left';
  /** Shrink the font until the text fits in this many lines (0 = any). */
  maxLines?: number;
}

export const PALETTE = {
  ink: '#2a1a0e',
  panel: 'rgba(36, 22, 12, 0.88)',
  cream: '#f7ead0',
  gold: '#f2b23e',
  clay: '#c4622d',
  leaf: '#4f9a52',
  sky: '#3d8fd9',
  hot: '#d8361f',
};

export class Label {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly opts: Required<LabelOptions>;
  private current = '\u0000';

  constructor(options: LabelOptions) {
    this.opts = {
      ppm: 1400,
      fontScale: 0.42,
      bg: PALETTE.panel,
      fg: PALETTE.cream,
      border: '',
      round: false,
      bold: false,
      align: 'center',
      maxLines: 0,
      ...options,
    };
    const { width, height, ppm } = this.opts;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(32, Math.round(width * ppm));
    this.canvas.height = Math.max(32, Math.round(height * ppm));
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.renderOrder = 20;
  }

  /** Redraw with new text. Newlines split lines; long lines wrap. */
  setText(text: string, fg?: string, bg?: string): void {
    const key = `${text}|${fg ?? ''}|${bg ?? ''}`;
    if (key === this.current) return;
    this.current = key;
    const { ctx, canvas, opts } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const r = opts.round ? Math.min(W, H) / 2 : Math.min(W, H) * 0.18;
    ctx.beginPath();
    ctx.roundRect(2, 2, W - 4, H - 4, r);
    ctx.fillStyle = bg ?? opts.bg;
    ctx.fill();
    if (opts.border) {
      ctx.lineWidth = Math.max(3, H * 0.035);
      ctx.strokeStyle = opts.border;
      ctx.stroke();
    }

    const pad = opts.round ? W * 0.14 : H * 0.16;
    const maxW = W - pad * 2;
    let size = H * opts.fontScale;
    let lines: string[] = [];
    const weight = opts.bold ? '700' : '500';
    // Shrink the font until the wrapped text fits the panel.
    for (let i = 0; i < 12; i += 1) {
      ctx.font = `${weight} ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
      lines = this.wrap(text, maxW);
      const tooTall = lines.length * size * 1.22 > H - pad * 0.9;
      const tooWide = lines.some((l) => ctx.measureText(l).width > maxW);
      const tooMany = opts.maxLines > 0 && lines.length > opts.maxLines;
      if (!tooTall && !tooWide && !tooMany) break;
      size *= 0.86;
    }
    ctx.fillStyle = fg ?? opts.fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = opts.align;
    const lh = size * 1.22;
    const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
    const x = opts.align === 'center' ? W / 2 : pad;
    lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * lh));
    this.texture.needsUpdate = true;
  }

  private wrap(text: string, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && this.ctx.measureText(next).width > maxW) {
          out.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      out.push(line);
    }
    return out;
  }

  set opacity(v: number) {
    this.mesh.material.opacity = v;
  }
}
