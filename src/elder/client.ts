/**
 * Talks to the Elder. Sends the current design to POST /api/elder (a language
 * model, key held server-side), validates whatever comes back against the action
 * vocabulary, and falls back to the built-in rule-based Elder on any failure
 * — so a proposal always arrives.
 */

import { scoreDay, scoreDesign, type ComfortContext } from '../heat/score.ts';
import type { Design } from '../model/state.ts';
import { elderPayload, validateReply, type ElderReply } from './actions.ts';
import { localElder } from './local.ts';

const ENDPOINT: string =
  (import.meta.env.VITE_ELDER_URL as string | undefined)?.trim() || '/api/elder';
const TIMEOUT_MS = 9000;

export async function askElder(d: Design, ctx: ComfortContext = {}): Promise<ElderReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Same comfort context (fans, power) as the HUD, so Baba sees what the player sees.
    const payload = elderPayload(d, { now: scoreDesign(d, d.hour, ctx), day: scoreDay(d, ctx) });
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`elder endpoint ${res.status}`);
    const reply = validateReply(await res.json(), d);
    if (!reply) throw new Error('elder reply failed validation');
    return { ...reply, source: 'model' };
  } catch (err) {
    console.info('[ile] using the built-in elder:', (err as Error).message);
    try {
      return localElder(d, ctx);
    } catch {
      return { say: 'Let the house breathe: deep eaves, open windows, an open courtyard.', actions: [], source: 'local' };
    }
  } finally {
    clearTimeout(timer);
  }
}
