window.OAD = window.OAD || {};

OAD.AI_PROVIDER = (window.OAD && OAD.Config && OAD.Config.aiConfig && OAD.Config.aiConfig.defaultProvider) || 'anthropic';
OAD.API_KEY = '';
OAD.GEMINI_API_KEY = '';
OAD.MODEL = (window.OAD && OAD.Config && OAD.Config.aiConfig && OAD.Config.aiConfig.defaultClaudeModel) || 'claude-3-5-sonnet-latest';
OAD.GEMINI_MODEL = (window.OAD && OAD.Config && OAD.Config.aiConfig && OAD.Config.aiConfig.defaultGeminiModel) || 'gemini-2.5-pro';

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
    if (gm) {
      const aiCfg = (window.OAD && OAD.Config && OAD.Config.aiConfig) || {};
      const depr = aiCfg.deprecatedGeminiModels || [];
      if (depr.indexOf(gm) !== -1) {
        OAD.GEMINI_MODEL = aiCfg.defaultGeminiModel || 'gemini-2.5-pro';
        try { localStorage.setItem('oad_gemini_model', OAD.GEMINI_MODEL); } catch(_) {}
      } else {
        OAD.GEMINI_MODEL = gm;
      }
    }
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
  if (!OAD.API_KEY) throw new Error(OAD.t('err_no_anthropic_key'));

  const aiCfg = (window.OAD && OAD.Config && OAD.Config.aiConfig) || {};
  const baseUrl = aiCfg.anthropicBaseUrl;
  const anthropicVersion = aiCfg.anthropicVersion;

  const res = await fetch(`${baseUrl}/${aiCfg.anthropicApiVersion}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': OAD.API_KEY,
      'anthropic-version': anthropicVersion,
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
    throw new Error(err?.error?.message || (OAD.t('err_api_status') + ' ' + res.status));
  }

  const data = await res.json();
  return data.content[0].text;
};


OAD._geminiCall = async function (messages, systemPrompt) {
  if (!OAD.GEMINI_API_KEY) throw new Error(OAD.t('err_no_gemini_key'));

  const aiCfg = (window.OAD && OAD.Config && OAD.Config.aiConfig) || {};
  const roleMap = aiCfg.geminiRoleMap || {};

  const body = {
    contents: messages.map(m => ({
      role: roleMap[m.role] || roleMap['default'],
      parts: [{ text: m.content }]
    }))
  };

  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const baseUrl = aiCfg.geminiBaseUrl;

  const res = await fetch(`${baseUrl}/${aiCfg.geminiApiVersion}/models/${OAD.GEMINI_MODEL}:generateContent?key=${OAD.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 404) {
      let names = OAD.t('err_failed_to_fetch_list');
      try {
        const listRes = await fetch(`${baseUrl}/${aiCfg.geminiApiVersion}/models?key=${OAD.GEMINI_API_KEY}`);
        const listData = await listRes.json();
        names = listData.models ? listData.models.map(m => m.name.replace('models/', '')).join(', ') : OAD.t('err_none');
      } catch (e) {}
      throw new Error(OAD.t('err_model_not_found_prefix') + ' ' + OAD.GEMINI_MODEL + ' ' + OAD.t('err_model_not_found_suffix') + ' ' + names);
    }
    throw new Error(err?.error?.message || (OAD.t('err_gemini_status') + ' ' + res.status));
  }

  const data = await res.json();
  try {
    return data.candidates[0].content.parts[0].text;
  } catch(e) {
    throw new Error(OAD.t('err_parse_gemini'));
  }
};

OAD.genInsight = async function (thread) {
  const persona = OAD.DB.persona;

  const promptTemplate = (window.OAD && OAD.Config && OAD.Config.prompts && OAD.Config.prompts.insight) || {};
  
  const systemPrompt = (promptTemplate.system || "")
    .replace('{{assumption_tendencies}}', JSON.stringify(persona.assumption_tendencies || []))
    .replace('{{working}}', JSON.stringify(persona.what_is_working || []))
    .replace('{{not_working}}', JSON.stringify(persona.what_is_not_working || []))
    .replace('{{pressure_level}}', persona.life_context?.pressure_level || 'moderate')
    .replace('{{hard_deadline}}', persona.life_context?.hard_deadline ? `${persona.life_context.hard_deadline} — ${persona.life_context.hard_deadline_context}` : 'none')
    .replace('{{challenge_tolerance}}', persona.tone_calibration?.challenge_tolerance || 'medium')
    .replace('{{current_mode}}', persona.tone_calibration?.current_mode || 'supportive')
    .replace('{{avoid_patterns}}', JSON.stringify(persona.tone_calibration?.avoid_patterns || []));

  const userMsg = (promptTemplate.user || "")
    .replace('{{title}}', thread.title || '')
    .replace('{{life_area}}', thread.life_area || '')
    .replace('{{status}}', thread.status || '')
    .replace('{{priority}}', thread.priority || '')
    .replace('{{closing_condition}}', thread.closing_condition || '')
    .replace('{{closing_condition_type}}', thread.closing_condition_type || '')
    .replace('{{closing_condition_met}}', thread.closing_condition_met || 'false')
    .replace('{{current_assumption}}', thread.current_assumption || '')
    .replace('{{assumption_verified}}', thread.assumption_verified || 'false')
    .replace('{{next_action}}', thread.next_action || '')
    .replace('{{next_action_date}}', thread.next_action_date || '')
    .replace('{{next_action_channel}}', thread.next_action_channel || '')
    .replace('{{next_action_contact}}', thread.next_action_contact || '')
    .replace('{{contingency_trigger_date}}', thread.contingency_trigger_date || '')
    .replace('{{contingency_action}}', thread.contingency_action || '')
    .replace('{{contingency_escalation}}', thread.contingency_escalation || '')
    .replace('{{connections}}', JSON.stringify(thread.connections || []))
    .replace('{{evolution_log}}', JSON.stringify((thread.evolution_log || []).slice(-5)))
    .replace('{{pressure}}', OAD.pressure(thread));

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (_) {
    parsed = { observation: raw, blind_spot: '', challenge: '', next_move: '', assumption_flag: '' };
  }

  parsed.date = OAD.todayStr();
  return parsed;
};

OAD.draftEmail = async function (tid) {
  const thread = OAD.getThread(tid);
  if (!thread) throw new Error(OAD.t('err_thread_not_found'));

  const promptTemplate = (window.OAD && OAD.Config && OAD.Config.prompts && OAD.Config.prompts.draftEmail) || {};
  
  const systemPrompt = promptTemplate.system || "";
  const userMsg = (promptTemplate.user || "")
    .replace('{{title}}', thread.title || '')
    .replace('{{next_action}}', thread.next_action || '')
    .replace('{{next_action_contact}}', thread.next_action_contact || '')
    .replace('{{next_action_channel}}', thread.next_action_channel || '')
    .replace('{{context}}', (thread.evolution_log || []).map(e => e.note).join(' | '))
    .replace('{{closing_condition}}', thread.closing_condition || '');

  return await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);
};

OAD.genProactiveCounsel = async function (feedbackStr, replaceUuid) {
  const persona = OAD.DB.persona;
  
  const heat = typeof OAD.getLifeAreaHeat === 'function' ? OAD.getLifeAreaHeat() : [];
  const stalledThreads = (OAD.DB.threads || [])
    .filter(function(t) { return t.status === 'stalled'; })
    .map(function(t) { return { title: t.title, area: t.life_area }; })
    .slice(0, 5);
  
  const promptTemplate = (window.OAD && OAD.Config && OAD.Config.prompts && OAD.Config.prompts.proactiveCounsel) || {};
  
  const systemPrompt = (promptTemplate.system || "")
    .replace('{{assumption_tendencies}}', JSON.stringify(persona?.assumption_tendencies || []))
    .replace('{{working}}', JSON.stringify(persona?.what_is_working || []))
    .replace('{{not_working}}', JSON.stringify(persona?.what_is_not_working || []));

  let userMsg = (promptTemplate.user || "")
    .replace('{{heat}}', JSON.stringify(heat))
    .replace('{{stalledThreads}}', JSON.stringify(stalledThreads));

  if (feedbackStr && replaceUuid) {
    const existing = (OAD.DB.proposals || []).find(p => p.uuid === replaceUuid);
    if (existing) {
      userMsg += `\n\nPREVIOUS PROPOSAL: ${JSON.stringify(existing)}`;
      userMsg += `\nUSER FEEDBACK: ${feedbackStr}`;
      userMsg += `\nGenerate a NEW proposal that directly addresses the feedback.`;
    }
  }

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch (_) {
    throw new Error(OAD.t('err_parse_counsel') + " " + raw);
  }
  
  persona.last_proactive_scan = OAD.todayStr();
  parsed.uuid = replaceUuid || OAD._generateUUID();
  parsed.date = persona.last_proactive_scan;
  
  OAD.DB.proposals = OAD.DB.proposals || [];
  if (replaceUuid) {
    const idx = OAD.DB.proposals.findIndex(p => p.uuid === replaceUuid);
    if (idx !== -1) OAD.DB.proposals[idx] = parsed;
    else OAD.DB.proposals.push(parsed);
  } else {
    OAD.DB.proposals.push(parsed);
  }
  OAD.saveDB();
  
  return parsed;
};

OAD.genDailyIntercept = async function () {
  const todayStr = OAD.todayStr();
  const persona = OAD.DB.persona || {};
  
  const loadScore = typeof OAD.getDayLoad === 'function' ? OAD.getDayLoad(todayStr) : 0;
  const overdueCadences = (OAD.DB.cadences || []).filter(c => OAD.cadenceOverdue(c)).map(c => c.title);
  const stalledThreads = (OAD.DB.threads || []).filter(t => t.status === 'stalled').map(t => t.title);
  
  // Feed the AI exactly what the user is staring at on their dashboard today
  const overdueThreads = (OAD.DB.threads || []).filter(t => OAD.isActionOverdue(t) && t.status !== 'closed' && t.status !== 'dormant');
  const todayThreads = (OAD.DB.threads || []).filter(t => t.next_action_date === todayStr && t.status !== 'closed' && !OAD.isActionOverdue(t));
  
  let agendaLines = [];
  if (overdueThreads.length > 0) {
    agendaLines.push("OVERDUE TASKS:");
    overdueThreads.forEach(t => agendaLines.push(`- [Pressure: ${OAD.pressure(t)}] ${t.title}`));
  }
  if (todayThreads.length > 0) {
    agendaLines.push("DUE TODAY:");
    todayThreads.forEach(t => agendaLines.push(`- [Pressure: ${OAD.pressure(t)}] ${t.title}`));
  }
  if (agendaLines.length === 0) {
    agendaLines.push("No tasks due today or overdue.");
  }
  
  // Also pass the absolute highest pressure looming task (if it's not already on today's agenda) to check for blind spots
  const highestLooming = (OAD.DB.threads || [])
    .filter(t => t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'waiting' && t.next_action_date !== todayStr && !OAD.isActionOverdue(t))
    .sort((a, b) => OAD.pressure(b) - OAD.pressure(a))[0];
  
  const promptTemplate = (window.OAD && OAD.Config && OAD.Config.prompts && OAD.Config.prompts.dailyIntercept) || {};
  
  const systemPrompt = (promptTemplate.system || "")
    .replace('{{working}}', JSON.stringify(persona.what_is_working || []))
    .replace('{{not_working}}', JSON.stringify(persona.what_is_not_working || []));

  const userMsg = (promptTemplate.user || "")
    .replace('{{loadScore}}', loadScore)
    .replace('{{overdueCadences}}', JSON.stringify(overdueCadences))
    .replace('{{stalledThreads}}', JSON.stringify(stalledThreads))
    .replace('{{agendaLines}}', agendaLines.join('\\n'))
    .replace('{{highestLooming}}', highestLooming ? `[Pressure: ${OAD.pressure(highestLooming)}] ${highestLooming.title}` : 'None');

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch (_) {
    throw new Error(OAD.t('err_parse_intercept'));
  }
};

OAD.extractPersonaLesson = async function (threadTitle, pushCount, userReason) {
  const persona = OAD.DB.persona || {};
  const promptTemplate = (window.OAD && OAD.Config && OAD.Config.prompts && OAD.Config.prompts.personaLesson) || {};
  
  const systemPrompt = (promptTemplate.system || "")
    .replace('{{pushCount}}', pushCount);

  const userMsg = (promptTemplate.user || "")
    .replace('{{title}}', threadTitle)
    .replace('{{pushCount}}', pushCount)
    .replace('{{userReason}}', userReason)
    .replace('{{assumption_tendencies}}', JSON.stringify(persona.assumption_tendencies || []))
    .replace('{{not_working}}', JSON.stringify(persona.what_is_not_working || []));

  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch (_) {
    return { warrants_update: false };
  }
};

OAD.refutePersonaLesson = async function (lesson, rebuttal) {
  const systemPrompt = `You are a proactive executive coach. You recently observed the user and proposed adding a behavioral trait to their persona. The user has pushed back with a rebuttal.
Analyze their rebuttal. If they are right (e.g. it's an external blocker they can't control, government bureaucracy, etc.), concede the point, validate their context, and withdraw the trait update (or suggest an alternative structural fix like 'Update the thread closing condition to reflect the external dependency'). If they are just making excuses, politely but firmly hold your ground and propose a modified trait.

Output strictly in JSON format:
{
  "conceded": true/false,
  "coach_response": "A direct, 1-2 sentence response to their rebuttal. Do not be condescending.",
  "warrants_update": true/false, // Set to true ONLY if you still want to push a revised trait. False if you are withdrawing it completely.
  "proposed_addition": "A revised trait to add, if applicable, otherwise empty string."
}`;

  const userMsg = `Original Coach Message: ${lesson.coach_message}\nOriginal Proposed Trait: ${lesson.proposed_addition}\nUser's Rebuttal: ${rebuttal}`;
  
  const raw = await OAD._llmCall([{ role: 'user', content: userMsg }], systemPrompt);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch (_) {
    return { conceded: false, coach_response: "I could not process the rebuttal.", warrants_update: false, proposed_addition: "" };
  }
};
