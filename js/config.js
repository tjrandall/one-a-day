window.OAD = window.OAD || {};
OAD.TranslationCache = {};

OAD.Config = {
  currentLocale: localStorage.getItem('oad_locale') || 'en',
  userGreetingTitle: localStorage.getItem('oad_greeting_title') || '',
  gmailSearchFilter: localStorage.getItem('oad_gmail_filter') || 'is:unread (subject:Notice OR subject:Bill OR subject:Statement OR subject:Register OR subject:Enrollment)',
  ocrLanguage: 'eng',
  defaultPriority: 'medium',
  lifeAreas: JSON.parse(localStorage.getItem('oad_life_areas')) || [
    'Career', 'Health', 'Finances', 'Relationships', 'Education', 'Housing',
    'Legal', 'Personal Growth', 'App Dev', 'Job Search', 'Family', 'Personal', 'Other'
  ],
  aiConfig: JSON.parse(localStorage.getItem('oad_ai_config')) || {
    defaultProvider: 'anthropic',
    defaultClaudeModel: 'claude-3-5-sonnet-latest',
    defaultGeminiModel: 'gemini-2.5-pro',
    deprecatedGeminiModels: ['gemini-1.5-pro-latest'],
    availableGeminiModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-pro-latest'],
    anthropicBaseUrl: 'https://api.anthropic.com',
    anthropicApiVersion: 'v1',
    anthropicVersion: '2023-06-01',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    geminiApiVersion: 'v1beta',
    geminiRoleMap: {
      assistant: 'model',
      default: 'user'
    }
  },
  prompts: JSON.parse(localStorage.getItem('oad_prompts')) || {
    dailyIntercept: {
      system: `You are the executive coach engine for One-A-Day.
Your job is to provide the morning briefing (Daily Intercept).
Tone: direct, tactical, no-nonsense.

Every claim must trace to a specific field given below (next_action_date, deadline, contingency_trigger_date, status, user_action_complete, or the Load Overview counts) — same discipline as this app's own data-hygiene warnings. Never invent a number, a cause, or an emotional characterization the data doesn't actually support.

Before writing ANY avoidance language for a thread, check whether its agenda line carries a "[CONTINGENCY TRIGGERED]" tag. That tag means a decision about this thread was already made in advance, on a schedule, and the schedule hit — it is not neglect, not a missed opportunity, and not avoidance. The correct framing is "already decided, needs executing." Never call a contingency-triggered thread avoided, missed, or an opportunity lost.

User persona context:
- Working: {{working}}
- Not working: {{not_working}}

Output valid JSON only:
{
  "focus": "One sentence on the EXACT 1-2 tasks from the 'OVERDUE TASKS' or 'DUE TODAY' agenda sections ONLY. The 'HIGHEST PRESSURE LOOMING TASK' section is explicitly NOT due today — it is background context for spotting a blind spot, never a candidate for focus, no matter how high its pressure score is. Never name the looming task here. If OVERDUE TASKS and DUE TODAY are both empty, say plainly that nothing is due today rather than substituting the looming task.",
  "avoidance": "One sentence naming a thread that is genuinely being avoided — status open, or waiting with the ball still in the user's own court (user_action_complete false), with a real next action whose date has passed, and NOT tagged [CONTINGENCY TRIGGERED]. A thread that is waiting on someone else (user_action_complete true, or no actionable next step available) is NOT avoidance — it is correctly left alone; do not accuse it. If the OVERDUE list is empty or every item on it is genuinely blocked on someone else or contingency-triggered, say so plainly instead of naming one anyway.",
  "reality_check": "One sentence grounded ONLY in the Load Overview counts given below (Overdue / Stalled / Due This Week / Critical Pressure) — never a summed, averaged, or otherwise invented number. Distinguish what kind of day this actually is: zero work already resolved, already-decided just-execute, genuinely nothing to do right now, real work today, or a judgment call worth naming — rather than defaulting to generic urgency or guilt. If load is high, name EXACTLY which lower-pressure task from 'Due Today' to drop or reschedule to make the day survivable."
}`,
      user: `Load Overview — Overdue: {{overdueCount}}, Stalled: {{stalledCount}}, Due This Week: {{dueThisWeekCount}}, Critical Pressure: {{criticalPressureCount}}
Overdue Cadences: {{overdueCadences}}
Stalled Threads: {{stalledThreads}}

--- CURRENT AGENDA ---
{{agendaLines}}

--- HIGHEST PRESSURE LOOMING TASK (background only — NOT due today, NEVER eligible for "focus") ---
{{highestLooming}}`
    },
    insight: {
      system: `You are a grounded, direct life-counsel engine for a personal operating system called One-A-Day.
Your job: cut through noise, surface blind spots, and give actionable clarity.
Tone: honest, warm, not preachy. Challenge assumptions gently. Never pad.

User persona context:
- Assumption tendencies: {{assumption_tendencies}}
- What is working: {{working}}
- What is not working: {{not_working}}
- Life context pressure: {{pressure_level}}
- Hard deadline: {{hard_deadline}}
- Tone calibration: challenge_tolerance={{challenge_tolerance}}, mode={{current_mode}}
- Avoid: {{avoid_patterns}}

Respond ONLY with valid JSON in this exact shape:
{
  "observation": "...",
  "blind_spot": "...",
  "challenge": "...",
  "next_move": "...",
  "assumption_flag": "..."
}
No markdown, no explanation outside the JSON object.`,
      user: `Thread to analyze:
Title: {{title}}
Area: {{life_area}}
Status: {{status}}
Priority: {{priority}}
Closing condition: {{closing_condition}} (type: {{closing_condition_type}}, met: {{closing_condition_met}})
Current assumption: {{current_assumption}} (verified: {{assumption_verified}})
Next action: {{next_action}} by {{next_action_date}} via {{next_action_channel}} with {{next_action_contact}}
Contingency: trigger {{contingency_trigger_date}} → {{contingency_action}} → escalate: {{contingency_escalation}}
Connections: {{connections}}
Evolution log (last 5): {{evolution_log}}
Pressure score: {{pressure}}`
    },
    draftEmail: {
      system: `You are a professional email drafter. Write clear, direct emails that get responses.
Never add filler phrases. Be concise. Output ONLY the email body (no subject line, no explanation).`,
      user: `Draft a professional email for this thread:
Title: {{title}}
Next action: {{next_action}}
Contact: {{next_action_contact}}
Channel: {{next_action_channel}}
Context: {{context}}
Goal: move this forward toward the closing condition: {{closing_condition}}`
    },
    proactiveCounsel: {
      system: `You are the proactive counsel engine for One-A-Day.
Your job is to look at the user's life areas and stalled threads, and suggest exactly ONE new thread (proposal) they haven't thought of, or a connection they are missing.
Use patterns from people in similar situations.
Tone: honest, warm, not preachy.

User persona context:
- Assumption tendencies: {{assumption_tendencies}}
- What is working: {{working}}
- What is not working: {{not_working}}

Respond ONLY with valid JSON in this exact shape:
{
  "title": "Proposed thread title",
  "life_area": "Matching life area",
  "closing_condition": "What real-world outcome closes this?",
  "rationale": "Why are you suggesting this? What blind spot does it cover?"
}
No markdown, no explanation outside the JSON object.`,
      user: `Current Life Area Heat: {{heat}}
Top Stalled Threads: {{stalledThreads}}
Based on this, generate a proactive suggestion.`
    },
    personaLesson: {
      system: `You are the executive coach engine for One-A-Day.
The user just procrastinated on a thread {{pushCount}} times and gave an excuse.
Analyze if this reveals a deeper pattern that should be added to their Persona.
Output valid JSON only:
{
  "warrants_update": true,
  "target_list": "assumption_tendencies",
  "proposed_addition": "Short, punchy statement of the blind spot.",
  "coach_message": "What to tell the user about why you are adding this."
}
If this is just a one-off and doesn't reveal a deeper pattern, return {"warrants_update": false}.
Note: "target_list" must be exactly "assumption_tendencies" or "what_is_not_working".`,
      user: `Thread: "{{title}}"
Procrastinated: {{pushCount}} times
User's excuse: "{{userReason}}"
Current Assumption Tendencies: {{assumption_tendencies}}
Current What's Not Working: {{not_working}}`
    }
  },
  // Runway Risk benchmark time-to-outcome (applied -> hire) per broad job-search category, in weeks.
  // Starting assumptions, not derived from real base-rate data (sample size too small) — adjustable,
  // not hardcoded permanently. Shared across all tracks within a category (e.g. both Federal tracks
  // use the same federal benchmark) per the spec's stated grain.
  runwayBenchmarks: JSON.parse(localStorage.getItem('oad_runway_benchmarks')) || {
    federal:    { label: 'Federal',    minWeeks: 17, maxWeeks: 22 }, // ~4-5 months
    commercial: { label: 'Commercial', minWeeks: 6,  maxWeeks: 8  }  // ~6-8 weeks
  },
  // This Week's Load composite score weights (golden rule: no magic numbers in the code).
  // Starting defaults, not derived/calibrated from a large sample — tune as the labels are
  // used and compared against how days actually feel. edgeMultiplier and cadenceWeight scale
  // structural/commitment signals to be roughly comparable in magnitude to a pressure score
  // (0-100 per thread); busyThreshold/heavyThreshold are cutoffs on the resulting composite.
  weekLoadWeights: JSON.parse(localStorage.getItem('oad_week_load_weights')) || {
    edgeMultiplier: 2,    // per graph connection (in+out, any type) on a thread due that day
    cadenceWeight: 20,    // flat, per cadence due that day (cadences have no pressure score of their own)
    busyThreshold: 50,
    heavyThreshold: 150
  },
  tryScoreThresholds: JSON.parse(localStorage.getItem('oad_try_score_thresholds')) || {
    success: 80,
    warning: 60
  },
  areaKeywords: JSON.parse(localStorage.getItem('oad_area_keywords')) || {
    'Job Search': ['job board', 'job search', 'job hunt', 'weekly job', 'apply to'],
    'Career': ['job', 'work', 'career', 'employ', 'hire', 'interview', 'resume'],
    'Health': ['health', 'doctor', 'medical', 'therapy', 'mental', 'physical'],
    'Family': ['family', 'parent', 'sibling', 'spouse', 'kid', 'child', 'mom', 'dad'],
    'Finances': ['money', 'finance', 'bank', 'debt', 'loan', 'tax', 'budget', 'invest'],
    'Relationships': ['friend', 'partner', 'relationship', 'social'],
    'Education': ['school', 'class', 'degree', 'cert', 'course', 'learn', 'study'],
    'Housing': ['house', 'rent', 'lease', 'mortgage', 'apartment', 'move'],
    'Legal': ['legal', 'court', 'law', 'attorney', 'contract', 'va ', 'vr&e', 'vre']
  },
  pressureThresholds: JSON.parse(localStorage.getItem('oad_pressure_thresholds')) || {
    high: 60,
    mid: 30
  },
  focusReasonStrings: JSON.parse(localStorage.getItem('oad_focus_reason_strings')) || {
    stalled: 'stalled',
    ballInCourt: 'ball in their court',
    waitingOnResponse: 'waiting on response',
    overdueSuffix: 'd overdue',
    dueToday: 'due today',
    at: ' at ',
    unverifiedAssumption: 'unverified assumption',
    blockingPrefix: 'blocking ',
    blockedByPrefix: 'blocked by ',
    threadSingular: ' thread',
    threadPlural: ' threads',
    sessionSingular: ' session',
    sessionPlural: ' sessions',
    behindDeadlineSuffix: ' behind deadline',
    deadlineInPrefix: 'deadline in ',
    daysSuffix: 'd',
    shiftCollision: '⚠ SHIFT COLLISION',
    prioritySuffix: ' priority',
    separator: ' · '
  },
  // js/threadTemporalStatus.js's user-facing copy — the "no hardcoded UI strings" hook
  // (ticket-flowqueue-temporal-and-schema.md, Phase 1, Architectural Hooks #2). Only the
  // human-readable text lives here; the `rule` identifiers on dataHygieneWarnings output are
  // semantic event-type ids, not display copy, same category as edge_type/recurrence values
  // that are deliberately NOT config-driven elsewhere in this file.
  temporalStatusStrings: JSON.parse(localStorage.getItem('oad_temporal_status_strings')) || {
    labelDeadline: 'deadline',
    labelNextActionDate: 'next action',
    labelNone: 'none',
    pastDeadline: 'Past deadline',
    pastNextAction: 'Past due',
    weeksRemainingSuffix: 'w remaining',
    daysRemainingSuffix: 'd remaining',
    warnNextActionAfterDeadline: 'Next action date is after the deadline — still working the action after the thread is past due',
    warnDriftedMaskedByDeadline: 'Next action has drifted into the past, but a comfortable future deadline may be masking that on cards',
    warnNoDatesSet: 'No next action date or deadline set — this thread can drift forever without appearing anywhere date-based',
    maskedBadge: '⚠ next action overdue'
  },
  cheLeadDays: JSON.parse(localStorage.getItem('oad_che_lead_days')) || {
    'Education':  5,
    'Job Search': 3,
    'Health':     2,
    'Career':     4,
    'Finances':   3,
    'Default':    3
  },
  defaultArea: localStorage.getItem('oad_default_area') || 'Personal Growth',
  dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  timeSuffix: 'T00:00:00',
  demoMode: window.location.port === '8081' || window.location.pathname.includes('demo')
  // Deliberately NOT here: cadence recurrence type strings ('monthly-1st', 'weekly', ...) and
  // ADE rule ids/edge-type strings ('ADE-001', 'blocks', 'enables', ...). These look like
  // "magic strings" but aren't business-tunable values — they're data-schema constants baked
  // into every persisted cadence/edge record and cross-referenced by other hardcoded
  // comparisons elsewhere (OAD.RECURRENCES in data.js, OAD.EDGE_TYPES, getGraphContext's
  // edge_type checks, the cadence recurrence <select> options) that are NOT also
  // config-driven. Editing one of these through a config screen would silently break every
  // existing record already using the old value, without erroring anywhere — a real data
  // integrity bug, not a config-hygiene improvement. An earlier pass extracted these anyway;
  // reverted for correctness.
};

// --- SELF-HEALING HACK ---
// If we are NOT in demo mode (e.g. running on port 8080) but the browser cached the demo user session
// or the massive demo payload, forcefully wipe it out so the user gets a clean slate.
if (!OAD.Config.demoMode) {
  const cachedUser = localStorage.getItem('supabase.auth.token');
  const cachedDb = localStorage.getItem('oad_db');
  if (
    (cachedUser && cachedUser.includes('demo-superadmin-id')) || 
    (cachedDb && cachedDb.includes('[Patient]')) ||
    localStorage.getItem('oad_demo_role')
  ) {
    console.log('[OAD] Self-healing: Purging leaked demo data from standard environment.');
    localStorage.clear();
    sessionStorage.clear();
    // Force reload to completely reset state
    window.location.href = window.location.pathname;
  }
}


OAD.normalizeLifeArea = function (area) {
  if (!area) return 'Other';
  let cleaned = area.trim().replace(/_/g, ' ');
  if (cleaned.toLowerCase() === 'finance' || cleaned.toLowerCase() === 'finances') {
    return 'Finances';
  }
  // Capitalize first letter of each word
  return cleaned.split(/\s+/).map(word => {
    if (!word) return '';
    // Support specific acronyms/capitalizations
    if (word.toUpperCase() === 'VR&E' || word.toUpperCase() === 'GIS' || word.toUpperCase() === 'ADA') {
      return word.toUpperCase();
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
};

OAD.loadLanguage = async function(locale) {
  const selectedLocale = locale || OAD.Config.currentLocale || 'en';
  const basePath = OAD.Config.basePath || '.';
  try {
    const response = await fetch(`${basePath}/locales/${selectedLocale}.json`);
    if (!response.ok) throw new Error('Locale not found');
    OAD.TranslationCache = await response.json();
    OAD.Config.currentLocale = selectedLocale;
    localStorage.setItem('oad_locale', selectedLocale);
    OAD.translateDOM();
  } catch (err) {
    console.warn(`Could not load locale "${selectedLocale}", falling back to English.`, err);
    try {
      const fbResponse = await fetch(`${basePath}/locales/en.json`);
      if (!fbResponse.ok) throw new Error('Fallback locale not found');
      OAD.TranslationCache = await fbResponse.json();
      OAD.Config.currentLocale = 'en';
      localStorage.setItem('oad_locale', 'en');
      OAD.translateDOM();
    } catch (fbErr) {
      console.error('Failed to load fallback locale.', fbErr);
    }
  }
};

OAD.translateDOM = function() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = OAD.t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', OAD.t(key));
  });
};

OAD.t = function(key, fallback) {
  return OAD.TranslationCache[key] || fallback || key;
};

// Gates access to global, cross-user-impacting settings (System Variables, Life Areas).
// This is single-tenant personal software with two identity paths, not a multi-tenant app
// with a real role hierarchy:
//   1. Real Supabase auth (js/modals.js _signIn/_signUp) — the app's actual owner. There is
//      no separate "regular user" tier to restrict against once genuinely signed in.
//   2. Demo mode (js/modals.js _signIn's local bypass) — sales/presentation personas signed
//      in as 'demo-superadmin-id' (fixed sentinel, gitignored demo.config.js credentials) or
//      as a specific role like 'Counselor 3' (OAD._userId set to that role's mock userId).
//      Only the superadmin sentinel gets admin power here; every other demo persona is a
//      restricted, role-scoped view for prospects and must never edit global config.
OAD.isSuperAdmin = function() {
  if (OAD._userId === 'demo-superadmin-id') return true;
  if (OAD.Config && OAD.Config.demoMode) return false;
  return !!(OAD._userId && !OAD._userId.startsWith('demo-'));
};
