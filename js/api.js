window.OAD = window.OAD || {};

OAD.AI_PROVIDER = 'anthropic';
OAD.API_KEY = '';
OAD.GEMINI_API_KEY = '';
OAD.MODEL = 'claude-3-5-sonnet-latest';
OAD.GEMINI_MODEL = 'gemini-3.1-pro-preview';

OAD.setAiSettings = function (provider, claudeKey, geminiKey, geminiModel) {
  OAD.AI_PROVIDER = provider;
  OAD.API_KEY = claudeKey;
  OAD.GEMINI_API_KEY = geminiKey;
  if (geminiModel) OAD.GEMINI_MODEL = geminiModel;
  try {
    localStorage.setItem('oad_ai_provider', provider);
    localStorage.setItem('oad_api_key', claudeKey);
    localStorage.setItem('oad_gemini_api_key', geminiKey);
    if (geminiModel) localStorage.setItem('oad_gemini_model', geminiModel);
  } catch (_) { }
};

OAD.loadApiKey = function () {
  try {
    const p = localStorage.getItem('oad_ai_provider');
    if (p) OAD.AI_PROVIDER = p;
    const ck = localStorage.getItem('oad_api_key');
    if (ck) OAD.API_KEY = ck;
    const gk = localStorage.getItem('oad_gemini_api_key');
    if (gk) OAD.GEMINI_API_KEY = gk;
    const gm = localStorage.getItem('oad_gemini_model');
    if (gm) OAD.GEMINI_MODEL = gm;
  } catch (_) { }
};

OAD._llmCall = async function (messages, systemPrompt) {
  if (OAD.AI_PROVIDER === 'gemini') {
    return await OAD._geminiCall(messages, systemPrompt);
  } else {
    return await OAD._claudeCall(messages, systemPrompt);
  }
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


OAD._geminiCall = async function (messages, systemPrompt) {
  if (!OAD.GEMINI_API_KEY) throw new Error('No API key set. Open Settings to add your Gemini API key.');

  const body = {
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  };

  if (systemPrompt) {
    body.system_instruction = { parts: { text: systemPrompt } };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${OAD.GEMINI_MODEL}:generateContent?key=${OAD.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) {
      let names = 'failed to fetch list';
      try {
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${OAD.GEMINI_API_KEY}`);
        const listData = await listRes.json();
        names = listData.models ? listData.models.map(m => m.name.replace('models/', '')).join(', ') : 'none';
      } catch (e) {}
      throw new Error(`Model ${OAD.GEMINI_MODEL} not found. Available models on your API key: ${names}`);
    }
    throw new Error(err?.error?.message || `Gemini API error ${res.status}`);
  }

  const data = await res.json();
  try {
    return data.candidates[0].content.parts[0].text;
  } catch(e) {
    throw new Error("Failed to parse Gemini response");
  }
};

OAD.genInsight = async function (thread) {
  const persona = OAD.DB.persona;

  const systemPrompt = `You are a grounded, direct life - counsel engine for a personal operating system called One - A - Day.
Your job: cut through noise, surface blind spots, and give actionable clarity.
      Tone: honest, warm, not preachy.Challenge assumptions gently.Never pad.

User persona context:
    - Assumption tendencies: ${ JSON.stringify(persona.assumption_tendencies) }
    - What is working: ${ JSON.stringify(persona.what_is_working) }
    - What is not working: ${ JSON.stringify(persona.what_is_not_working) }
    - Life context pressure: ${ persona.life_context.pressure_level }
    - Hard deadline: ${ persona.life_context.hard_deadline || 'none' } — ${ persona.life_context.hard_deadline_context }
    - Tone calibration: challenge_tolerance = ${ persona.tone_calibration.challenge_tolerance }, mode = ${ persona.tone_calibration.current_mode }
    - Avoid: ${ JSON.stringify(persona.tone_calibration.avoid_patterns) }

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
    Title: ${ thread.title }
    Area: ${ thread.life_area }
    Status: ${ thread.status }
    Priority: ${ thread.priority }
Closing condition: ${ thread.closing_condition } (type: ${ thread.closing_condition_type }, met: ${ thread.closing_condition_met })
Current assumption: ${ thread.current_assumption } (verified: ${ thread.assumption_verified })
Next action: ${ thread.next_action } by ${ thread.next_action_date } via ${ thread.next_action_channel } with ${ thread.next_action_contact }
    Contingency: trigger ${ thread.contingency_trigger_date } → ${ thread.contingency_action } → escalate: ${ thread.contingency_escalation }
    Connections: ${ JSON.stringify(thread.connections) }
Evolution log(last 5): ${ JSON.stringify((thread.evolution_log || []).slice(-5)) }
Pressure score: ${ OAD.pressure(thread) } `;

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

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

  const systemPrompt = `You are a professional email drafter.Write clear, direct emails that get responses.
Never add filler phrases.Be concise.Output ONLY the email body(no subject line, no explanation).`;

  const userMsg = `Draft a professional email for this thread:
      Title: ${ thread.title }
Next action: ${ thread.next_action }
    Contact: ${ thread.next_action_contact }
    Channel: ${ thread.next_action_channel }
    Context: ${ (thread.evolution_log || []).map(e => e.note).join(' | ') }
    Goal: move this forward toward the closing condition: ${ thread.closing_condition } `;

  return await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);
};

OAD.genProactiveCounsel = async function () {
  const persona = OAD.DB.persona;
  
  const heat = typeof OAD.getLifeAreaHeat === 'function' ? OAD.getLifeAreaHeat() : [];
  const stalledThreads = (OAD.DB.threads || [])
    .filter(function(t) { return t.status === 'stalled'; })
    .map(function(t) { return { title: t.title, area: t.life_area }; })
    .slice(0, 5);
  
  const systemPrompt = `You are the proactive counsel engine for One - A - Day.
Your job is to look at the user's life areas and stalled threads, and suggest exactly ONE new thread (proposal) they haven't thought of, or a connection they are missing.
Use patterns from people in similar situations.
      Tone: honest, warm, not preachy.

User persona context:
    - Assumption tendencies: ${ JSON.stringify(persona.assumption_tendencies) }
    - What is working: ${ JSON.stringify(persona.what_is_working) }
    - What is not working: ${ JSON.stringify(persona.what_is_not_working) }

Respond ONLY with valid JSON in this exact shape:
    {
      "title": "Proposed thread title",
        "life_area": "Matching life area",
          "closing_condition": "What real-world outcome closes this?",
            "rationale": "Why are you suggesting this? What blind spot does it cover?"
    }
No markdown, no explanation outside the JSON object.`;

  const userMsg = `Current Life Area Heat: ${ JSON.stringify(heat) }
Top Stalled Threads: ${ JSON.stringify(stalledThreads) }
Based on this, generate a proactive suggestion.`;

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

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

OAD.genDailyIntercept = async function () {
  const todayStr = new Date().toISOString().slice(0, 10);
  const persona = OAD.DB.persona || {};
  
  const loadScore = typeof OAD.getDayLoad === 'function' ? OAD.getDayLoad(todayStr) : 0;
  const overdueCadences = (OAD.DB.cadences || []).filter(c => OAD.cadenceOverdue(c)).map(c => c.title);
  const stalledThreads = (OAD.DB.threads || []).filter(t => t.status === 'stalled').map(t => t.title);
  const criticalThreads = (OAD.DB.threads || []).filter(t => t.priority === 'critical' && t.status !== 'closed').map(t => t.title);
  
  const systemPrompt = `You are the executive coach engine for One - A - Day.
Your job is to provide the morning briefing(Daily Intercept).
      Tone: direct, tactical, no - nonsense.

User persona context:
    - Working: ${ JSON.stringify(persona.what_is_working) }
    - Not working: ${ JSON.stringify(persona.what_is_not_working) }

Output valid JSON only:
    {
      "focus": "One sentence on what must be crushed today.",
        "avoidance": "One sentence calling out what they are avoiding (based on stalled/overdue).",
          "reality_check": "One sentence challenging their capacity or assumptions today."
    } `;

  const userMsg = `Day Load Score: ${ loadScore }
Overdue Cadences: ${ JSON.stringify(overdueCadences) }
Stalled Threads: ${ JSON.stringify(stalledThreads) }
Critical Threads: ${ JSON.stringify(criticalThreads) } `;

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch (_) {
    throw new Error("Failed to parse Daily Intercept.");
  }
};

OAD.extractPersonaLesson = async function (threadTitle, pushCount, userReason) {
  const persona = OAD.DB.persona || {};
  const systemPrompt = `You are the executive coach engine for One - A - Day.
The user just procrastinated on a thread ${ pushCount } times and gave an excuse.
Analyze if this reveals a deeper pattern that should be added to their Persona.
Output valid JSON only:
    {
      "warrants_update": true,
        "target_list": "assumption_tendencies",
          "proposed_addition": "Short, punchy statement of the blind spot.",
            "coach_message": "What to tell the user about why you are adding this."
    }
If this is just a one - off and doesn't reveal a deeper pattern, return {"warrants_update": false}.
    Note: "target_list" must be exactly "assumption_tendencies" or "what_is_not_working".`;

  const userMsg = `Thread: "${threadTitle}"
    Procrastinated: ${ pushCount } times
User's excuse: "${userReason}"
Current Assumption Tendencies: ${ JSON.stringify(persona.assumption_tendencies) }
Current What's Not Working: ${JSON.stringify(persona.what_is_not_working)}`;

    const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(match ? match[0] : raw);
    } catch (_) {
      return { warrants_update: false };
    }
  };
