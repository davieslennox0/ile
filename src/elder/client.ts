/**
 * Talks to the Elder. Sends the current design to POST /api/elder (Claude,
 * key held server-side), validates whatever comes back against the action
 * vocabulary, and falls back to the built-in rule-based Elder on any failure
 * — so a proposal always arrives.
 */

import { scoreDay, scoreDesign } from '../heat/score.ts';
import type { Design } from '../model/state.ts';
import { elderPayload, validateReply, type ElderReply } from './actions.ts';
import { localElder } from './local.ts';

const ENDPOINT: string =
  (import.meta.env.VITE_ELDER_URL as string | undefined)?.trim() || '/api/elder';
const TIMEOUT_MS = 9000;

export async function askElder(d: Design): Promise<ElderReply> {
  const payload = elderPayload(d, { now: scoreDesign(d), day: scoreDay(d) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`elder endpoint ${res.status}`);
    const reply = validateReply(await res.json(), d);
    if (!reply) throw new Error('elder reply failed validation');
    return { ...reply, source: 'claude' };
  } catch (err) {
    console.info('[ile] using the built-in elder:', (err as Error).message);
    return localElder(d);
  } finally {
    clearTimeout(timer);
  }
}
