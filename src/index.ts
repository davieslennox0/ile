/**
 * Ilé — world bootstrap. IWSDK creates the XR world from iwsdk.config.json
 * (VR, hand tracking, gaze for the Meta VR Glasses); one system owns the app.
 */

import { World, createSystem } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { App } from './app.ts';

class IleSystem extends createSystem({}) {
  private app!: App;

  init(): void {
    this.app = new App(this.world);
    // Handy for debugging from the browser console and the IWSDK CLI.
    (globalThis as Record<string, unknown>).ile = this.app;
  }

  update(delta: number, time: number): void {
    this.app.update(delta, time);
  }
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(IleSystem);
});
