/**
 * The first five minutes. A short, skippable, event-driven walk through the
 * whole loop: pull a wall → see the heat → take the Elder's fix → step inside.
 * Every step also has a timeout, so nobody gets stuck; the whole thing runs
 * in well under four minutes.
 */

import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from '@iwsdk/core';
import type { App } from '../app.ts';
import { ELDER_GREETING } from '../elder/local.ts';
import { findEnclosedGap, type Design } from '../model/state.ts';
import { MINI_SCALE } from '../scene/table.ts';

type Step = 'greet' | 'pull' | 'heat' | 'elder' | 'accept' | 'inside' | 'return' | 'done';

interface StepDef {
  hint: string;
  /** Seconds before the step moves on by itself. */
  timeout: number;
  next: Step;
  /** App events that complete the step early. */
  until: string[];
}

const STEPS: Record<Exclude<Step, 'done'>, StepDef> = {
  greet: {
    hint: 'Welcome to Ilé. You only need your hands.',
    timeout: 6,
    next: 'pull',
    until: [],
  },
  pull: {
    hint: 'Pinch an orange grip and pull the wall.',
    timeout: 35,
    next: 'heat',
    until: ['edit:wall'],
  },
  heat: {
    hint: '3 PM: red rooms are baking, blue rooms are cool.',
    timeout: 7,
    next: 'elder',
    until: [],
  },
  elder: {
    hint: 'Pinch the Elder figure to ask for advice.',
    timeout: 12,
    next: 'accept',
    until: ['proposal'],
  },
  accept: {
    hint: 'Pinch \u2713 to accept the ghost, or swipe it away.',
    timeout: 30,
    next: 'inside',
    until: ['accepted', 'rejected'],
  },
  inside: {
    hint: 'Step inside: point at a room and pinch.',
    timeout: 45,
    next: 'return',
    until: ['inside'],
  },
  return: {
    hint: 'Feel the shade. Palm up, or pinch Table, to go back.',
    timeout: 40,
    next: 'done',
    until: ['table'],
  },
};

export const FREE_HINT = 'Sculpt freely. Hold a palm up for tools.';

/** The next thing to do when building a house from an empty plot. */
export function scratchHint(d: Design, mud?: { ready: boolean; hint(): string }): string {
  if (d.rooms.length === 0) return 'Pinch and drag on the plot to lay your first room.';
  if (d.wallHeight === 0) {
    if (d.rooms.length < 3) return 'Lay more rooms around an open middle.';
    if (!d.court && findEnclosedGap(d)) return 'Pinch the open middle to make it a courtyard.';
    if (mud && !mud.ready) return mud.hint();
    return 'Pinch the white spire and pull up to raise the walls.';
  }
  if (!d.roof) return 'Hold a palm up and choose Roof.';
  return FREE_HINT;
}

export class Onboarding {
  active = false;
  /** Ghost hand that demonstrates the first pinch-and-pull. */
  readonly hand = new Group();
  private readonly app: App;
  private step: Step = 'done';
  private t = 0;
  private clock = 0;

  constructor(app: App) {
    this.app = app;
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const palm = new Mesh(new SphereGeometry(0.022, 14, 10), mat);
    palm.scale.set(1, 0.75, 1.2);
    palm.position.set(0, 0.012, 0.03);
    const thumb = new Mesh(new SphereGeometry(0.008, 10, 8), mat);
    thumb.position.set(-0.006, 0, 0);
    const index = new Mesh(new SphereGeometry(0.008, 10, 8), mat);
    index.position.set(0.006, 0, 0);
    this.hand.add(palm, thumb, index);
    // Lives in building-local metres; drawn hand-sized at miniature scale.
    this.hand.scale.setScalar(1 / MINI_SCALE);
    this.hand.visible = false;
    this.hand.renderOrder = 30;
    app.view.group.add(this.hand);
    app.on((event) => this.onEvent(event));
  }

  start(): void {
    this.active = true;
    this.go('greet');
    this.app.say(ELDER_GREETING);
  }

  skip(silent = false): void {
    if (!this.active) return;
    this.finish();
    if (!silent) this.app.toast('Intro skipped');
  }

  private finish(): void {
    this.active = false;
    this.step = 'done';
    this.hand.visible = false;
    this.app.setHint(FREE_HINT);
    this.app.onboardingChanged();
  }

  private go(step: Step): void {
    if (step === 'done') {
      this.finish();
      return;
    }
    this.step = step;
    this.t = 0;
    this.app.setHint(STEPS[step].hint);
    this.hand.visible = step === 'pull';
    if (step === 'heat') {
      this.app.setHour(15);
      this.app.setHeat(true);
      this.app.say('The afternoon sun is here.');
    }
    // If the user is already where a step wants them, skip ahead.
    if (step === 'inside' && this.app.mode === 'inside') this.go('return');
    this.app.onboardingChanged();
  }

  private onEvent(event: string): void {
    if (!this.active || this.step === 'done') return;
    if (STEPS[this.step].until.includes(event)) this.go(STEPS[this.step].next);
  }

  update(delta: number): void {
    if (!this.active || this.step === 'done') return;
    this.clock += delta;
    // Do not let a step time out in the middle of a gesture or a transition.
    if (!this.app.gestures.dragging && this.app.mode !== 'shifting') this.t += delta;

    if (this.step === 'pull') {
      // Demonstrate on the easternmost wall line.
      const xs = this.app.handles.lineGrips.filter((g) => g.visible && g.userData.axis === 'x');
      if (xs.length === 0) return;
      const grip = xs.reduce((best, g) => (g.position.x > best.position.x ? g : best)).position;
      const pull = (this.clock % 2.2) / 2.2;
      const eased = pull < 0.25 ? 0 : Math.min(1, (pull - 0.25) / 0.55);
      this.hand.position.set(grip.x + eased * 2.5, grip.y, grip.z);
      this.hand.visible = this.app.mode === 'table';
    }

    const def = STEPS[this.step];
    if (this.t >= def.timeout) {
      if (this.step === 'elder') {
        // Nobody pinched the Elder: he speaks up by himself.
        this.t = 0;
        this.app.askElder();
        return;
      }
      this.go(def.next);
    }
  }
}
