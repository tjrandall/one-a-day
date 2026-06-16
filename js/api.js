window.OAD = window.OAD || {};

OAD.API_KEY = '';
OAD.MODEL   = 'claude-sonnet-4-20250514';

OAD.setApiKey = function (key) {
  OAD.API_KEY = key;
  try { localStorage.setItem('oad_api_key', key); } catch (_) {}
};

OAD.loadApiKey = function () {
  try {
    const k = localStorage.getItem('oad_api_key');
    if (k) OAD.API_KEY = k;
  } catch (_) {}
};

OAD._claudeCall = async function (messages, systemPrompt) {
  if (!OAD.API_KEY) throw new Error('No API key set. Open Settings to add your Anthropic API key.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': OAD.API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: OAD.MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
};

OAD.genInsight = async function (thread) {
  const persona = OAD.DB.persona;

  const systemPrompt = `You are a grounded, direct life-counsel engine for a personal operating system called One-A-Day.
Your job: cut through noise, surface blind spots, and give actionable clarity.
Tone: honest, warm, not preachy. Challenge assumptions gently. Never pad.

User persona context:
- Assumption tendencies: ${JSON.stringify(persona.assumption_tendencies)}
- What is working: ${JSON.stringify(persona.what_is_working)}
- What is not working: ${JSON.stringify(persona.what_is_not_working)}
- Life context pressure: ${persona.life_context.pressure_level}
- Hard deadline: ${persona.life_context.hard_deadline || 'none'} — ${persona.life_context.hard_deadline_context}
- Tone calibration: challenge_tolerance=${persona.tone_calibration.challenge_tolerance}, mode=${persona.tone_calibration.current_mode}
- Avoid: ${JSON.stringify(persona.tone_calibration.avoid_patterns)}

Respond ONLY with valid JSON in this exact shape:
{
  "observation": "...",
  "blind_spot": "...",
  "challenge": "...",
  "next_move": "...",
  "assumption_flag": "..."
}
No markdown, no explanation outside the JSON object.`;

  const userMsg = `Thread to analyze:
Title: ${thread.title}
Area: ${thread.life_area}
Status: ${thread.status}
Priority: ${thread.priority}
Closing condition: ${thread.closing_condition} (type: ${thread.closing_condition_type}, met: ${thread.closing_condition_met})
Current assumption: ${thread.current_assumption} (verified: ${thread.assumption_verified})
Next action: ${thread.next_action} by ${thread.next_action_date} via ${thread.next_action_channel} with ${thread.next_action_contact}
Contingency: trigger ${thread.contingency_trigger_date} → ${thread.contingency_action} → escalate: ${thread.contingency_escalation}
Connections: ${JSON.stringify(thread.connections)}
Evolution log (last 5): ${JSON.stringify((thread.evolution_log || []).slice(-5))}
Pressure score: ${OAD.pressure(thread)}`;

  const raw = await OAD._claudeCall([{ role: 'user', content: userMsg }], systemPrompt);

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (_) {
    parsed = { observation: raw, blind_spot: '', challenge: '', next_move: '', assumption_flag: '' };
  }

  parsed.date = new Date().toISOString().slice(0, 10);
  return parsed;
};

OAD.draftEmail = async function (tid) {
  const thread = OAD.getThread(tid);
  if (!thread) throw new Error('Thread not found');

  const systemPrompt = `You are a professional email drafter. Write clear, direct emails that get responses.
Never add filler phrases. Be concise. Output ONLY the email body (no subject line, no explanation).`;

  const userMsg = `Draft a professional email for this thread:
Title: ${thread.title}
Next action: ${thread.next_action}
Contact: ${thread.next_action_contact}
Channel: ${thread.next_action_channel}
Context: ${(thread.evolution_log || []).map(e => e.note).join(' | ')}
Goal: move this forward toward the closing condition: ${thread.closing_condition}`;

  return await OAD._claudeCall([{ role: 'user', content: userMsg }], systemPrompt);
};

OAD.genProactiveCounsel = async function () {
  const persona = OAD.DB.persona;
  
  const heat = typeof OAD.getLifeAreaHeat === 'function' ? OAD.getLifeAreaHeat() : [];
  const stalledThreads = (OAD.DB.threads || [])
    .filter(function(t) { return t.status === 'stalled'; })
    .map(function(t) { return { title: t.title, area: t.life_area }; })
    .slice(0, 5);
  
  const systemPrompt = `You are the proactive counsel engine for One-A-Day.
Your job is to look at the user's life areas and stalled threads, and suggest exactly ONE new thread (proposal) they haven't thought of, or a connection they are missing.
Use patterns from people in similar situations.
Tone: honest, warm, not preachy.

User persona context:
- Assumption tendencies: ${JSON.stringify(persona.assumption_tendencies)}
- What is working: ${JSON.stringify(persona.what_is_working)}
- What is not working: ${JSON.stringify(persona.what_is_not_working)}

Respond ONLY with valid JSON in this exact shape:
{
  "title": "Proposed thread title",
  "life_area": "Matching life area",
  "closing_condition": "What real-world outcome closes this?",
  "rationale": "Why are you suggesting this? What blind spot does it cover?"
}
No markdown, no explanation outside the JSON object.`;

  const userMsg = `Current Life Area Heat: ${JSON.stringify(heat)}
Top Stalled Threads: ${JSON.stringify(stalledThreads)}
Based on this, generate a proactive suggestion.`;

  const raw = await OAD._claudeCall([{ role: 'user', content: userMsg }], systemPrompt);

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (_) {
    throw new Error("Failed to parse proactive counsel response: " + raw);
  }
  
  persona.last_proactive_scan = new Date().toISOString().slice(0, 10);
  parsed.uuid = OAD._generateUUID();
  parsed.date = persona.last_proactive_scan;
  
  OAD.DB.proposals = OAD.DB.proposals || [];
  OAD.DB.proposals.push(parsed);
  OAD.saveDB();
  
  return parsed;
};
