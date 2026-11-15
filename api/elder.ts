/**
 * POST /api/elder — the Elder architect.
 *
 * Receives the current design state from the headset and asks a language
 * model (OpenAI gpt-oss on Cerebras, for near-instant replies) for one short
 * explanation of the hottest problem plus one or two concrete fixes as
 * structured actions. The API key lives only here, on the server.
 *
 * The client validates every action again and falls back to its built-in
 * rule-based Elder on any error, so this endpoint may fail safely.
 */

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const MODEL = process.env.ELDER_MODEL || 'gpt-oss-120b';
const MAX_BODY = 8_000;
const TIMEOUT_MS = 8_000;

const SIDES = ['north', 'east', 'south', 'west'];

const SYSTEM = `You are the Elder, a master builder of Yoruba courtyard compounds (agbo ilé), advising someone who is shaping a house on a plot in Lagos with their hands in VR.

You receive the design as JSON: orientation, wall material, wall height, roof overhang per side, courtyard size, the hour of day, and for every room its comfort score (0-100, higher is cooler), the temperature it feels like, its breeze, which outside wall takes the most sun, and its openings.

Reply with:
- "say": two short sentences, spoken aloud, each under 80 characters. Name the hottest problem plainly, then say what our builders would do about it. Warm, grounded, unhurried. Plain words a guest would understand. Advise; do not speak as if the change is already made.
- "actions": one or two concrete fixes for that problem, chosen from the allowed action types.

What you know, and may draw on:
- Deep eaves keep the sun off a wall. The low afternoon sun from the west is the hardest to shade.
- Thick earth walls take in heat slowly and give it back at night; sandcrete block passes heat faster; zinc sheet passes it fastest.
- Air must cross a room: an opening on one side and another on the opposite side, or onto the courtyard.
- The courtyard shades its rooms and draws warm air up and out. A larger courtyard helps every room that opens onto it.
- Long walls should face north and south, so only the short ends meet the rising and setting sun.
- Higher walls let warm air gather above head height.

Rules:
- Only propose changes that differ from the current design. Do not open an opening that is already open.
- Refer to a room by its "id" in actions and by its "name" when speaking. A room can only have openings on the sides listed for it in the state.
- If "courtyard" is null there is no courtyard, so do not resize it.
- Overhang is 0 to 2 metres. Wall height is 2.4 to 4.5 metres. Courtyard width and depth are in metres, 2 to 15. Rotation is a compass bearing in degrees, in steps of 15.
- Speak only from the principles above and the numbers in the state. Never quote statistics, studies, percentages or temperatures that are not in the state.
- English only. No lists, no markdown, no emoji.`;

const action = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        anyOf: [
          action({
            type: { type: 'string', enum: ['set_overhang'] },
            side: { type: 'string', enum: [...SIDES, 'all'] },
            value: { type: 'number' },
          }),
          action({
            type: { type: 'string', enum: ['add_opening', 'remove_opening'] },
            room: { type: 'string' },
            side: { type: 'string', enum: SIDES },
          }),
          action({
            type: { type: 'string', enum: ['set_rotation', 'set_wall_height'] },
            value: { type: 'number' },
          }),
          action({
            type: { type: 'string', enum: ['resize_courtyard'] },
            width: { type: 'number' },
            depth: { type: 'number' },
          }),
          action({
            type: { type: 'string', enum: ['set_material'] },
            value: { type: 'string', enum: ['earth', 'block', 'zinc'] },
          }),
        ],
      },
    },
  },
  required: ['say', 'actions'],
  additionalProperties: false,
};

/** The local dev server may call the deployed Elder (for capture and testing). */
const DEV_ORIGINS = ['https://localhost:8081', 'http://localhost:8081'];
const cors = (request: Request): Record<string, string> => {
  const origin = request.headers.get('origin') ?? '';
  return DEV_ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', vary: 'origin' }
    : {};
};

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: { ...cors(request), 'access-control-allow-methods': 'POST' } });
}

/** Best-effort limit per client address (per warm instance). */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();
function limited(request: Request): boolean {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

/** Keep only short, plain strings and numbers from the client's state. */
function clean(v: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') return v.replace(/[^\p{L}\p{N} .,'()-]/gu, '').slice(0, 40);
  if (Array.isArray(v)) return v.slice(0, 24).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 24)) out[k.slice(0, 24)] = clean(x, depth + 1);
    return out;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(request) },
    });
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'state too large' }, 413);
  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (!state || typeof state !== 'object' || !Array.isArray((state as { rooms?: unknown }).rooms)) {
    return json({ error: 'expected a design state' }, 400);
  }

  if (limited(request)) return json({ error: 'elder is resting, try again in a minute' }, 429);
  state = clean(state);
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) return json({ error: 'elder is not configured (CEREBRAS_API_KEY)' }, 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 2000,
        temperature: 0.4,
        reasoning_effort: 'medium',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'elder_reply', strict: true, schema: SCHEMA },
        },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Here is my house right now:\n${JSON.stringify(state)}` },
        ],
      }),
    });
    if (upstream.status === 429) return json({ error: 'elder is busy' }, 429);
    if (!upstream.ok) return json({ error: `elder upstream error ${upstream.status}` }, 502);
    const data = (await upstream.json()) as {
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
    };
    const choice = data.choices?.[0];
    if (!choice?.message?.content || choice.finish_reason !== 'stop') {
      return json({ error: `elder stopped: ${choice?.finish_reason ?? 'no reply'}` }, 502);
    }
    const reply = JSON.parse(choice.message.content) as { say?: unknown; actions?: unknown };
    if (typeof reply.say !== 'string' || !Array.isArray(reply.actions)) {
      return json({ error: 'malformed reply' }, 502);
    }
    return json({ say: reply.say, actions: reply.actions.slice(0, 6) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json({ error: timedOut ? 'elder timed out' : 'elder failed' }, timedOut ? 504 : 500);
  } finally {
    clearTimeout(timer);
  }
}
