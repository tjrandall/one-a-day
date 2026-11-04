// FlowQueue Email Sync — stateless cross-referencing edge function.
// ticket-flowqueue-email-sync.md. Receives { email_text, thread_manifest, provider }, calls the
// requested LLM provider server-side (the API key never touches the client — this is the whole
// reason this is an edge function instead of a browser call like every other AI feature in this
// app), and returns the proposed_thread_updates / proposed_new_threads contract. Writes nothing
// to Supabase itself; the caller (email-integration/fetch_emails.py) turns the response into an
// importable JSON file per FlowQueue's existing import format.
//
// Provider-agnostic by design, mirroring the client's own OAD._llmCall / OAD._claudeCall /
// OAD._geminiCall split (js/api.js) — this app has never been locked to a single AI vendor, and
// an edge function that only spoke Anthropic would be a real regression from that, not just an
// oversight. Set whichever secret(s) you actually have a funded key for; `provider` picks which
// one a given call uses (defaults to Gemini, since that's what the original fetch_emails.py used
// successfully before this rewrite).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-3-5-sonnet-latest";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-pro";
const DEFAULT_PROVIDER = Deno.env.get("EMAIL_SYNC_DEFAULT_PROVIDER") || "gemini";

const SYSTEM_PROMPT = `You are acting as T.J.'s Chief of Staff, cross-referencing a new piece of
correspondence against his active FlowQueue threads.

You will receive:
1. EMAIL_TEXT — a pasted email or thread
2. THREAD_MANIFEST — his current open threads (uuid, title, status, life_area,
   current_assumption, next_action, next_action_date)

Your job, in order:
1. Identify which existing thread(s), if any, this email is evidence for.
   Reference threads ONLY by the uuid values given to you in THREAD_MANIFEST.
   Never invent, guess, or construct a uuid.
2. For each matched thread, determine: does this email invalidate the
   current_assumption, complete the next_action, or change the
   next_action_date? Propose the change, do not assert it happened.
3. Identify whether this email introduces a new commitment, contact, or
   opportunity that isn't covered by any existing thread. If so, draft a
   proposed new thread.
4. If an email only weakly implies something (one data point, no
   corroboration), say so in your confidence field rather than presenting
   it as settled. Evidence Ledger discipline applies: a single email is
   one signal, not confirmation.

Hard rules:
- NEVER set assumption_verified or user_action_complete to true. Those
  fields require T.J.'s explicit confirmation and are out of scope for
  this pipeline entirely. Propose the change; a human accepts it.
- NEVER propose a next_action_date equal to a deadline. Apply the same
  buffer logic FlowQueue already uses (3+ days routine, 5+ days for
  interviews/tests/high-stakes commitments).
- If nothing in the email is thread-relevant, return empty arrays. Do not
  force a match.

Return ONLY valid JSON matching this exact shape, no prose, no markdown fences:
{
  "proposed_thread_updates": [
    {
      "uuid": "<uuid from THREAD_MANIFEST — never invented>",
      "pending_ai_update": {
        "confidence": "high | medium | low",
        "source_excerpt": "short quote from the email supporting this",
        "proposed_changes": { "<field>": "<new value>" },
        "rationale": "why this change is being proposed"
      }
    }
  ],
  "proposed_new_threads": [
    {
      "title": "...",
      "life_area": "...",
      "priority": "high | medium | low",
      "closing_condition": "...",
      "next_action": "...",
      "next_action_date": "YYYY-MM-DD",
      "rationale": "why this is being proposed, prefixed with confidence, e.g. '[Confidence: high] ...'"
    }
  ]
}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function extractJson(rawText: string): unknown {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callAnthropic(userMessage: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set on the server");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text ?? "";
}

async function callGemini(userMessage: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set on the server");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: {
    email_text?: string;
    thread_manifest?: { threads?: { uuid: string }[] };
    provider?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { email_text, thread_manifest } = body;
  const provider = (body.provider || DEFAULT_PROVIDER).toLowerCase();
  if (!email_text || !thread_manifest) {
    return jsonResponse({ error: "email_text and thread_manifest are both required" }, 400);
  }
  if (provider !== "anthropic" && provider !== "gemini") {
    return jsonResponse({ error: `Unknown provider '${provider}' — expected 'anthropic' or 'gemini'` }, 400);
  }

  const userMessage = `EMAIL_TEXT:\n${email_text}\n\nTHREAD_MANIFEST:\n${JSON.stringify(thread_manifest)}`;

  let rawText: string;
  try {
    rawText = provider === "gemini" ? await callGemini(userMessage) : await callAnthropic(userMessage);
  } catch (e) {
    return jsonResponse({ error: `${provider} call failed`, detail: String(e) }, 502);
  }

  let parsed: {
    proposed_thread_updates?: { uuid: string; pending_ai_update: unknown }[];
    proposed_new_threads?: unknown[];
  };
  try {
    parsed = extractJson(rawText) as typeof parsed;
  } catch {
    return jsonResponse({ error: "Model did not return valid JSON", raw: rawText }, 502);
  }

  // Server-side backstop for "never invent a uuid" — a prompt instruction alone isn't
  // enforcement. Anything referencing a uuid not actually present in the manifest we sent is
  // dropped rather than trusted.
  const validUuids = new Set((thread_manifest.threads || []).map((t) => t.uuid));
  parsed.proposed_thread_updates = (parsed.proposed_thread_updates || []).filter((u) =>
    validUuids.has(u.uuid)
  );
  parsed.proposed_new_threads = parsed.proposed_new_threads || [];

  return jsonResponse(parsed, 200);
});
