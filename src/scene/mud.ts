/**
 * The mixing pit: building mud made by hand.
 *
 * Before walls can rise on an empty plot, the builder carries red earth, sand
 * and water to a pit at the corner of the plot and stirs them together — the
 * way earth walls are really made. Everything is a pinch: pinch a heap and
 * carry a scoop to the pit; pinch in the pit and circle the hand to stir.
 */

import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { Sfx } from '../audio.ts';
import type { DragInfo } from '../interact/gestures.ts';

export type Ingredient = 'earth' | 'sand' | 'water';

const INGREDIENTS: { id: Ingredient; label: string; color: number; x: number; z: number }[] = [
  { id: 'earth', label: 'Red earth', color: 0xa8432a, x: 6.6, z: 11.3 },
  { id: 'sand', label: 'Sand', color: 0xe6cc93, x: 8.4, z: 8.2 },
  { id: 'water', label: 'Water', color: 0x4f9fd8, x: 11.6, z: 6.9 },
];
/** Pit centre on the plot, in site metres (the south-east corner). */
const PIT = { x: 10.6, z: 10.6, r: 1.7 };
const PER_INGREDIENT = 2;
/** Full circles of the hand needed to finish the mix. */
const TURNS = 3;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Color();

export class MudPit {
  /** Lives on the plot, in site metres. */
  readonly group = new Group();
  ready = false;
  private readonly app: App;
  private readonly added: Record<Ingredient, number> = { earth: 0, sand: 0, water: 0 };
  private readonly surface: Mesh<CircleGeometry, MeshLambertMaterial>;
  private readonly streak: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly stick: Mesh<CylinderGeometry, MeshLambertMaterial>;
  private readonly scoop: Mesh<SphereGeometry, MeshLambertMaterial>;
  private stirred = 0;
  private lastAngle: number | null = null;

  constructor(app: App) {
    this.app = app;
    const g = this.group;
    const y = -0.2;

    const rim = new Mesh(
      new TorusGeometry(PIT.r, 0.22, 8, 36),
      new MeshLambertMaterial({ color: 0x5b3a22 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.set(PIT.x, y + 0.1, PIT.z);
    this.surface = new Mesh(new CircleGeometry(PIT.r, 36), new MeshLambertMaterial({ color: 0x3a2a1c }));
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.set(PIT.x, y + 0.04, PIT.z);
    // A lighter swirl that turns as the mud is stirred.
    this.streak = new Mesh(
      new TorusGeometry(PIT.r * 0.55, 0.09, 6, 24, Math.PI * 1.2),
      new MeshBasicMaterial({ color: 0xd9a070, transparent: true, opacity: 0 }),
    );
    this.streak.rotation.x = Math.PI / 2;
    this.streak.position.set(PIT.x, y + 0.07, PIT.z);
    this.stick = new Mesh(new CylinderGeometry(0.07, 0.07, 2.6, 8), new MeshLambertMaterial({ color: 0x7a4a24 }));
    this.stick.visible = false;
    this.scoop = new Mesh(new SphereGeometry(0.42, 14, 10), new MeshLambertMaterial({ color: 0xffffff }));
    this.scoop.visible = false;
    g.add(rim, this.surface, this.streak, this.stick, this.scoop);

    const here = () => this.group.visible && app.mode === 'table' && !app.compareOn;

    for (const ing of INGREDIENTS) {
      const heap =
        ing.id === 'water'
          ? new Mesh(new SphereGeometry(0.75, 16, 12), new MeshLambertMaterial({ color: ing.color, emissive: ing.color, emissiveIntensity: 0.15 }))
          : new Mesh(new ConeGeometry(1.0, 1.1, 14), new MeshLambertMaterial({ color: ing.color }));
      heap.position.set(ing.x, y + (ing.id === 'water' ? 0.55 : 0.55), ing.z);
      heap.castShadow = true;
      if (ing.id === 'water') {
        // A calabash bowl under the water.
        const bowl = new Mesh(new SphereGeometry(0.85, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new MeshLambertMaterial({ color: 0x8a5a2b }));
        bowl.position.copy(heap.position);
        heap.scale.set(1, 0.45, 1);
        g.add(bowl);
      }
      g.add(heap);
      app.gestures.add({
        id: `mud-${ing.id}`,
        object: heap,
        radius: 1.3,
        enabled: () => here() && !this.ready,
        onHover: (on) => {
          heap.scale.setScalar(on ? 1.18 : 1);
          if (ing.id === 'water') heap.scale.y *= 0.45;
          if (on) app.toast(`${ing.label}: pinch and carry it to the pit.`, 1.2);
        },
        onDragStart: () => {
          this.scoop.material.color.setHex(ing.color);
          this.scoop.position.copy(heap.position);
          this.scoop.visible = true;
        },
        onDrag: (info) => {
          this.scoop.position.copy(heap.position).add(this.delta(info));
          this.scoop.position.y = Math.max(y + 0.4, this.scoop.position.y);
        },
        onDragEnd: () => {
          this.scoop.visible = false;
          const dx = this.scoop.position.x - PIT.x;
          const dz = this.scoop.position.z - PIT.z;
          if (Math.hypot(dx, dz) > PIT.r + 0.9) return;
          if (this.added[ing.id] >= PER_INGREDIENT) {
            app.toast(`Enough ${ing.label.toLowerCase()}.`, 1.4);
            return;
          }
          this.added[ing.id] += 1;
          Sfx.release();
          this.paint();
          app.toast(this.hasAll() ? 'Now pinch in the pit and stir in circles.' : `${ing.label} in. ${this.missing()}`, 2);
          app.mudChanged();
        },
      });
    }

    // Stirring: pinch in the pit and circle the hand.
    const centre = new Group();
    centre.position.set(PIT.x, y + 0.3, PIT.z);
    g.add(centre);
    app.gestures.add({
      id: 'mud-pit',
      object: centre,
      radius: PIT.r,
      enabled: () => here() && !this.ready,
      onHover: (on) => rim.scale.setScalar(on ? 1.06 : 1),
      onDragStart: () => {
        this.lastAngle = null;
        if (!this.hasAll()) app.toast(`The pit needs ${this.missing().toLowerCase()}`, 2);
      },
      onDrag: (info) => {
        if (!this.hasAll()) return;
        const d = this.delta(info);
        const reach = Math.hypot(d.x, d.z);
        this.stick.visible = true;
        const r = Math.min(PIT.r * 0.7, Math.max(0.3, reach));
        const angle = Math.atan2(d.z, d.x);
        this.stick.position.set(PIT.x + Math.cos(angle) * r, y + 1.2, PIT.z + Math.sin(angle) * r);
        this.stick.rotation.set(Math.sin(angle) * 0.25, 0, -Math.cos(angle) * 0.25);
        if (reach < 0.25) return; // too close to the centre to tell a direction
        if (this.lastAngle !== null) {
          let step = angle - this.lastAngle;
          if (step > Math.PI) step -= Math.PI * 2;
          if (step < -Math.PI) step += Math.PI * 2;
          this.stirred += Math.abs(step) / (Math.PI * 2);
          this.streak.rotation.z -= step;
          if (Math.floor(this.stirred * 4) !== Math.floor((this.stirred - Math.abs(step) / (Math.PI * 2)) * 4)) Sfx.tick();
          this.paint();
          if (this.stirred >= TURNS) this.finish();
        }
        this.lastAngle = angle;
      },
      onDragEnd: () => {
        this.stick.visible = false;
        if (this.hasAll() && !this.ready) app.toast('Keep stirring: circle your hand in the pit.', 1.8);
      },
    });
    this.paint();
  }

  /** Hand movement since the grab, in site metres. */
  private delta(info: DragInfo): Vector3 {
    const site = this.app.table.site;
    site.updateWorldMatrix(true, false);
    return site.worldToLocal(_a.copy(info.position)).sub(site.worldToLocal(_b.copy(info.start)));
  }

  private hasAll(): boolean {
    return this.added.earth > 0 && this.added.sand > 0 && this.added.water > 0;
  }

  private missing(): string {
    const need = INGREDIENTS.filter((i) => this.added[i.id] === 0).map((i) => i.label.toLowerCase());
    return need.length ? `Still needs ${need.join(' and ')}.` : '';
  }

  /** Colour of the pit: the ingredients blended, darkening as it is stirred. */
  private paint(): void {
    const total = this.added.earth + this.added.sand + this.added.water;
    if (total === 0) {
      this.surface.material.color.setHex(0x3a2a1c);
      this.streak.material.opacity = 0;
      return;
    }
    const mix = new Color(0, 0, 0);
    for (const ing of INGREDIENTS) {
      _c.setHex(ing.color);
      mix.r += (_c.r * this.added[ing.id]) / total;
      mix.g += (_c.g * this.added[ing.id]) / total;
      mix.b += (_c.b * this.added[ing.id]) / total;
    }
    const k = Math.min(1, this.stirred / TURNS);
    // Wet laterite mud: a deep red-brown.
    mix.lerp(_c.setHex(0x8a3b22), k);
    this.surface.material.color.copy(mix);
    this.streak.material.opacity = this.hasAll() ? 0.75 * (1 - k * 0.7) : 0;
  }

  private finish(): void {
    this.ready = true;
    this.stick.visible = false;
    this.paint();
    Sfx.chime();
    this.app.toast('The mud is ready. Pull the white spire up to raise your walls.', 3.2);
    this.app.mudChanged();
  }

  /** How far along the mix is, 0–1 (for hints and tests). */
  get progress(): number {
    const added = (Math.min(1, this.added.earth) + Math.min(1, this.added.sand) + Math.min(1, this.added.water)) / 3;
    return this.ready ? 1 : added * 0.5 + Math.min(1, this.stirred / TURNS) * 0.5;
  }

  /** What to do next at the pit. */
  hint(): string {
    if (!this.hasAll()) return 'Carry red earth, sand and water to the pit. Pinch a heap and drag.';
    return 'Pinch in the pit and stir in circles until the mud is ready.';
  }

  /** Start over with an empty pit, or mark the mud as already made. */
  reset(ready: boolean): void {
    this.ready = ready;
    this.stirred = 0;
    this.lastAngle = null;
    this.added.earth = this.added.sand = this.added.water = 0;
    this.stick.visible = false;
    this.scoop.visible = false;
    this.paint();
  }
}
