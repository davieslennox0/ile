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
const ROOMS = ['parlour', 'gate', 'bed1', 'bed2', 'kitchen', 'store', 'bed3', 'bed4'];

const SYSTEM = `You are the Elder, a master builder of Yoruba courtyard compounds (agbo ilé), advising someone who is shaping a house on a plot in Lagos with their hands in VR.

You receive the design as JSON: orientation, wall material, wall height, roof overhang per side, courtyard size, the hour of day, and for every room its comfort score (0-100, higher is cooler), the temperature it feels like, its breeze, which outside wall takes the most sun, and its openings.

Reply with:
- "say": two or three short sentences, spoken aloud. Name the hottest problem plainly, then say what our builders did about it. Warm, grounded, unhurried. Plain words a guest would understand.
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
- A room can only have openings on the sides listed for it in the state.
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
            room: { type: 'string', enum: ROOMS },
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function POST(request: Request): Promise<Response> {
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
    return json({ say: reply.say, actions: reply.actions.slice(0, 2) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return json({ error: timedOut ? 'elder timed out' : 'elder failed' }, timedOut ? 504 : 500);
  } finally {
    clearTimeout(timer);
  }
}
