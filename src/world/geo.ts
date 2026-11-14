/**
 * Small geometry helpers for the diorama: many coloured boxes merged into one
 * mesh (one draw call), and striped "rammed earth" canvas textures.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from '@iwsdk/core';

const unit = new BoxGeometry(1, 1, 1);
const _c = new Color();

export interface ColorBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  /** Rotation about the vertical axis, radians. */
  rot?: number;
}

/** Merge coloured boxes into a single vertex-coloured mesh. */
export function mergeColorBoxes(boxes: ColorBox[], opts: { shadows?: boolean; emissive?: number } = {}): Mesh {
  const pos = unit.getAttribute('position');
  const nor = unit.getAttribute('normal');
  const idx = unit.getIndex() as BufferAttribute;
  const vc = pos.count;
  const ic = idx.count;
  const P = new Float32Array(boxes.length * vc * 3);
  const N = new Float32Array(boxes.length * vc * 3);
  const C = new Float32Array(boxes.length * vc * 3);
  const I = new Uint32Array(boxes.length * ic);
  boxes.forEach((b, n) => {
    const cos = Math.cos(b.rot ?? 0);
    const sin = Math.sin(b.rot ?? 0);
    _c.setHex(b.color);
    for (let i = 0; i < vc; i += 1) {
      const lx = pos.getX(i) * b.sx;
      const lz = pos.getZ(i) * b.sz;
      const o = (n * vc + i) * 3;
      P[o] = b.x + lx * cos + lz * sin;
      P[o + 1] = b.y + pos.getY(i) * b.sy;
      P[o + 2] = b.z - lx * sin + lz * cos;
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      N[o] = nx * cos + nz * sin;
      N[o + 1] = nor.getY(i);
      N[o + 2] = -nx * sin + nz * cos;
      C[o] = _c.r;
      C[o + 1] = _c.g;
      C[o + 2] = _c.b;
    }
    for (let i = 0; i < ic; i += 1) I[n * ic + i] = idx.getX(i) + n * vc;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(P, 3));
  g.setAttribute('normal', new BufferAttribute(N, 3));
  g.setAttribute('color', new BufferAttribute(C, 3));
  g.setIndex(new BufferAttribute(I, 1));
  const m = new Mesh(
    g,
    new MeshLambertMaterial({
      vertexColors: true,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissive ? 1 : 0,
    }),
  );
  m.castShadow = !!opts.shadows;
  m.receiveShadow = true;
  return m;
}

/** Horizontal earth bands, the look of rammed-earth walls. */
export function earthTexture(colors = ['#b9744a', '#c88a5c', '#a6633d', '#d39a6c']): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  let y = 0;
  let i = 0;
  while (y < c.height) {
    const h = 6 + ((i * 7) % 9);
    g.fillStyle = colors[i % colors.length];
    g.fillRect(0, y, c.width, h);
    y += h;
    i += 1;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/** Ankara-style print: bold dots, diamonds and stripes on a strong ground. */
export function ankaraTexture(palette: string[], seed = 1): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = palette[0];
  g.fillRect(0, 0, 64, 64);
  const style = seed % 3;
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const cx = x * 16 + 8 + (y % 2 ? 8 : 0);
      const cy = y * 16 + 8;
      g.fillStyle = palette[1 + ((x + y + seed) % (palette.length - 1))];
      g.beginPath();
      if (style === 0) g.arc(cx % 64, cy, 5, 0, Math.PI * 2);
      else if (style === 1) {
        g.moveTo(cx % 64, cy - 6);
        g.lineTo((cx % 64) + 6, cy);
        g.lineTo(cx % 64, cy + 6);
        g.lineTo((cx % 64) - 6, cy);
      } else g.rect((cx % 64) - 6, cy - 2, 12, 4);
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}
