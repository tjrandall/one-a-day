window.OAD = window.OAD || {};

OAD._DB_KEY = 'oad_db';

OAD.DB = {
  threads: [],
  cadences: [],
  habits: [],
  ideas: [],
  proposals: [],
  toat: [],
  ade_suppressions: [],
  health_alerts: [],
  saved_views: [],

  persona: {
    last_proactive_scan: null,
    assumption_tendencies: [],
    // Structured, cross-thread, mechanically-scored evidence for tendency detection — separate
    // from evolution_log (a mixed-event, single-thread audit trail) and from current_assumption
    // (live per-thread working state). One row per raw signal (a pushback, a detected stall),
    // never itself an inference. See OAD.evaluateTendencyCandidates (js/engine.js) for how rows
    // get grouped and gated before anything is ever proposed as a persona trait.
    tendency_evidence: [],
    counsel_history: [],
    what_is_working: [],
    what_is_not_working: [],
    life_context: {
      pressure_level: 'moderate',
      hard_deadline: null,
      hard_deadline_context: ''
    },
    tone_calibration: {
      challenge_tolerance: 'medium',
      current_mode: 'problem-solving',
      avoid_patterns: []
    }
  }
};

OAD.LIFE_AREAS = OAD.Config.lifeAreas;

OAD.RECURRENCES = [
  'monthly-1st', 'monthly-15th', 'monthly-last', 'weekly', 'weekly-days', 'custom'
];

// 'stalled' was removed from this list per ticket-stalled-metric-fix.md — no thread across the
// entire real dataset had ever used it (no automated path ever set it either), and it's now
// superseded by the live-computed OAD.Due.stalledThreads() drift view. The List view's own
// status-filter dropdown still offers a "Stalled" option (js/render.js, filterListTab) — that's
// a computed filter preset now, same category as "not-closed," not a literal settable status,
// so it's intentionally not sourced from this array.
OAD.STATUSES   = ['inbox', 'open', 'waiting', 'dormant', 'closed'];

// Multi-tenancy hook (ticket-flowqueue-temporal-and-schema.md, Phase 1, Architectural Hooks #1)
// — NOT redundant with Supabase's account-level RLS, which is a different, already-solved
// boundary (one whole OAD.DB blob per authenticated user). This is a placeholder for a future
// INTRA-account scope (e.g. a shared team workspace holding multiple owners' threads in one
// DB), which doesn't exist yet — every real thread today has this single default value, and
// every function that accepts it treats "no ownerId passed" as "no scoping," so nothing about
// current single-tenant behavior changes until a second real value ever exists.
OAD.DEFAULT_OWNER_ID = 'default-owner';
OAD.PRIORITIES = ['critical', 'high', 'medium', 'low'];
OAD.EDGE_TYPES = ['blocks', 'blocked_by', 'enables', 'relates'];

OAD.CLOSING_TYPES = ['outcome', 'action'];

// Job-application pipeline stage — optional, only meaningful on leaf application threads
// (identified by having a stage set at all, not a separate thread-type field). Ordered
// ascending = closer to converting. 'rejected' is a separate terminal value, deliberately
// NOT in this ordered list — it's excluded from "earliest active stage" calculations
// (Runway Risk), same way 'closed' threads are excluded from pressure-sorted views.
OAD.APPLICATION_STAGES = ['applied', 'screening', 'interview', 'offer'];
OAD.APPLICATION_TERMINAL_STAGES = ['rejected'];

OAD._generateUUID = function () {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

OAD.nextId = function () {
  const ids = OAD.DB.threads.map(t => t.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
};

OAD.getThread = function (id) {
  return OAD.DB.threads.find(t => t.id === id) || null;
};

OAD.getThreadByUUID = function (uuid) {
  return OAD.DB.threads.find(t => t.uuid === uuid) || null;
};

OAD.formatDisplayTitle = function (title) {
  if (!title) return '';
  let display = title;
  
  if (window.OAD && OAD.Config && OAD.Config.demoMode) {
    if (display.startsWith('[Patient] ')) {
      display = display.substring(10);
    } else if (OAD._demoRole) {
      const roleName = OAD._demoRole.replace(/[0-9 ]/g, '').trim();
      const rolePrefix = `[${roleName}] `;
      if (display.startsWith(rolePrefix)) {
        display = display.substring(rolePrefix.length);
      }
    }
    
    // Format as <clientName> | <threadTitle>
    const parts = display.split(' - ');
    if (parts.length > 1) {
      const clientName = parts.pop().trim();
      display = `${clientName} | ${parts.join(' - ').trim()}`;
    }
  }
  
  return display;
};

OAD._demoRole = localStorage.getItem('oad_demo_role') || 'CCO';

// Role-based visibility is a module concern, not a core one — core has no business knowing
// that "Counselor"/"Director"/"RA" are real role names. Any module (currently only fq-demo)
// registers a filter function here; core just runs whatever's registered, in order, once
// demoMode + a role are active. A module registering nothing means core shows everything,
// same as real (non-demo) usage always has. See modules/demo/roles.js for the actual
// clinical-role visibility rules this app ships with today.
OAD._threadVisibilityFilters = [];
OAD._cadenceVisibilityFilters = [];
OAD.registerThreadVisibilityFilter = function (fn) { OAD._threadVisibilityFilters.push(fn); };
OAD.registerCadenceVisibilityFilter = function (fn) { OAD._cadenceVisibilityFilters.push(fn); };

OAD.getVisibleThreads = function() {
  let threads = OAD.DB.threads || [];
  if (OAD.Config && OAD.Config.demoMode && OAD._demoRole) {
    OAD._threadVisibilityFilters.forEach(function (fn) {
      threads = fn(threads, OAD._demoRole);
    });
  }
  return threads;
};

// Single source of truth for "what's in the inbox" — every surface that needs this count or
// list (the inbox alert banner, the sentinel thread sweep) must call this, not write its own
// filter, so the two can never independently disagree the way This Week's Load once did (two
// separately-written date calculations silently drifting apart).
OAD.getInboxThreads = function() {
  return (OAD.getVisibleThreads() || []).filter(function (t) { return t.status === 'inbox'; });
};

// Single source of truth for Habit/Idea threads (thread_kind discriminator, ARCHITECTURE_RULES.md
// Rule 1) — every panel/listing must call these, not filter OAD.DB.threads independently, same
// rationale as OAD.getInboxThreads above.
OAD.getHabitThreads = function() {
  return (OAD.getVisibleThreads() || []).filter(function (t) { return t.thread_kind === 'habit'; });
};

OAD.getIdeaThreads = function() {
  return (OAD.getVisibleThreads() || []).filter(function (t) { return t.thread_kind === 'idea'; });
};

// Proposals use status:'proposed' as the discriminator (not thread_kind — see OAD.getProposal's
// comment, above OAD.acceptProposal in this file, for why).
OAD.getProposalThreads = function() {
  return (OAD.getVisibleThreads() || []).filter(function (t) { return t.status === 'proposed'; });
};

OAD.getCadenceThreads = function() {
  return (OAD.getVisibleThreads() || []).filter(function (t) { return t.thread_kind === 'cadence'; });
};

OAD.getVisibleCadences = function() {
  let cadences = OAD.getCadenceThreads();
  if (OAD.Config && OAD.Config.demoMode && OAD._demoRole) {
    OAD._cadenceVisibilityFilters.forEach(function (fn) {
      cadences = fn(cadences, OAD._demoRole);
    });
  }
  return cadences;
};

OAD._afterSaveCallbacks = [];

OAD._runAfterSave = function (thread) {
  OAD._afterSaveCallbacks.forEach(function (cb) { try { cb(thread); } catch (e) { console.warn('_afterSave callback error:', e); } });
};

OAD.addThread = function (thread) {
  thread.id = OAD.nextId();
  thread.evolution_log  = thread.evolution_log  || [];
  thread.ai_insights    = thread.ai_insights    || [];
  thread.connections    = thread.connections    || [];
  OAD.DB.threads.push(thread);
  OAD.saveDB();
  OAD._runAfterSave(thread);
  return thread;
};

// Quick Add — zero-friction capture. Raw text only, no synthesis, no LLM call, instant save.
// Creates a minimal thread with status "inbox" so it stays out of pressure-sorted views,
// Focus Now, and Daily View until reviewed. Returns null on empty/whitespace-only input.
OAD.quickAddThread = function (rawText) {
  var title = (rawText || '').trim();
  if (!title) return null;
  var thread = OAD.addThread(OAD.makeThread({ title: title, status: 'inbox' }));
  OAD.addEvolution(thread.id, 'Captured via Quick Add.');
  return thread;
};

// Stamps next_action_updated_at/current_assumption_updated_at whenever the corresponding field's
// VALUE actually changes — centralized here, the one function every edit path already routes
// through (edit modal, Coach Pushback wizard, Complete Action wizard, and import sync's
// patch-only-actually-changed-fields loop, js/data.js applyImport), so this doesn't need a
// second stamping call site added to each of them individually. These two timestamps are what
// CHE-012 (js/engine.js) compares to detect a next_action that's older than the current
// assumption it should be reflecting.
OAD.updateThread = function (id, patch) {
  const t = OAD.getThread(id);
  if (!t) return null;
  const now = new Date().toISOString();
  if (patch.next_action !== undefined && patch.next_action !== t.next_action) {
    patch.next_action_updated_at = now;
  }
  if (patch.current_assumption !== undefined && patch.current_assumption !== t.current_assumption) {
    patch.current_assumption_updated_at = now;
  }
  // A thread can't stay status:inbox once it gets a parent — attaching a parent is itself an
  // act of triage. Only forces this when the patch doesn't already say what status should be,
  // so an explicit status in the same patch is never silently overridden. Mirrors the same
  // correction in OAD._normalizeDB, which self-heals legacy data that predates this rule.
  if (patch.parent_uuid && patch.status === undefined && t.status === 'inbox') {
    patch.status = 'open';
  }
  Object.assign(t, patch);
  OAD.saveDB();
  OAD._runAfterSave(t);
  return t;
};

// Runway Risk acknowledge — snoozes one track's at-risk banner/card entry for a week, not
// forever. The underlying math keeps running; if the track is still at-risk once the snooze
// expires, it re-presents automatically as the deadline keeps approaching. Deliberately not
// a permanent dismiss — repeated pushing of a deadline-critical signal is itself information.
OAD._RUNWAY_REPRESENT_DAYS = 7;

OAD.acknowledgeRunwayRisk = function (trackUuid) {
  const track = OAD.getThreadByUUID(trackUuid);
  if (!track) return null;
  // setHours(0,0,0,0) BEFORE the date-string extraction — the established safe pattern
  // (OAD.todayStr) — found broken here (missing the reset) while investigating a real test
  // failure during ticket-dev-diagnostic-export.md work: without it, acknowledging a Runway
  // Risk warning in the evening (roughly after 8pm Eastern) computes a snooze date that's
  // already a UTC day ahead of local reality, silently shortening the real snooze window.
  const reprompt = new Date(); reprompt.setHours(0, 0, 0, 0);
  reprompt.setDate(reprompt.getDate() + OAD._RUNWAY_REPRESENT_DAYS);
  track.runway_ack_until = reprompt.toISOString().slice(0, 10);
  OAD.addEvolution(track.id, 'Runway Risk acknowledged — will re-present around ' + OAD.formatDate(track.runway_ack_until) + ' if still at-risk.');
  OAD.saveDB();
  return track;
};

OAD.deleteThread = function (id) {
  const idx = OAD.DB.threads.findIndex(t => t.id === id);
  if (idx === -1) return false;
  OAD.DB.threads.splice(idx, 1);
  OAD.saveDB();
  return true;
};

OAD.isOffDay = function(dateStr, role) {
  if (!role || !dateStr) return false;
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  if (role.includes('Counselor')) {
    return dow === 5 || dow === 6; // Off Friday, Saturday
  } else if (role.includes('Director') || role.includes('Case Manager')) {
    return dow === 0 || dow === 6; // Off Sunday, Saturday
  }
  return false;
};

OAD.addEvolution = function (id, note) {
  const t = OAD.getThread(id);
  if (!t) return;
  t.evolution_log.push({ date: OAD.todayStr(), note });
  OAD.saveDB();
};

// Mechanical evidence log — one row per raw signal (a pushback, a detected stall), never itself
// an inference about the person. 'stalled' rows are only ever written by
// OAD.sweepStalledTendencyEvidence below, which calls OAD.TemporalStatus.isStalled — the same
// consolidated function every other stall-aware surface already uses; this is not a second
// definition. 'pushback' rows are written from the one real pushback call site
// (js/modals.js OAD._confirmPushback) using the user's own "Real Blocking Reason" text as
// excuse_text — the first real structured, cross-thread home that text has ever had.
// `consumed` marks whether this row has already contributed to a promoted trait (see
// OAD.evaluateTendencyCandidates, js/engine.js) — excluded from future candidate evaluation once
// true, so a cluster that already surfaced doesn't re-propose on every subsequent pushback.
OAD.logTendencyEvidence = function (threadUuid, eventType, excuseText) {
  if (eventType !== 'stalled' && eventType !== 'pushback') {
    throw new Error('OAD.logTendencyEvidence: eventType must be "stalled" or "pushback", got ' + JSON.stringify(eventType));
  }
  var t = OAD.getThreadByUUID(threadUuid);
  if (!t) return null;

  if (!OAD.DB.persona) OAD.DB.persona = {};
  if (!Array.isArray(OAD.DB.persona.tendency_evidence)) OAD.DB.persona.tendency_evidence = [];

  var row = {
    id: OAD._generateUUID(),
    thread_uuid: threadUuid,
    life_area: t.life_area,
    event_type: eventType,
    date: OAD.todayStr(),
    excuse_text: excuseText || '',
    consumed: false
  };
  OAD.DB.persona.tendency_evidence.push(row);
  OAD.saveDB();
  return row;
};

// A thread that stays stalled for a month shouldn't write 30 near-duplicate rows — that would
// inflate occurrence_count with the same ongoing fact repeated, not new evidence. One row per
// thread per cooldown window.
OAD._STALLED_EVIDENCE_COOLDOWN_DAYS = 7;

// Reads the display text of a persona tendency entry regardless of shape — a plain string
// (pre-redesign, or manually added) or a structured object (auto-promoted, carries
// evidence_strength/evidence_thread_uuids/source/etc.). Every consumer of
// assumption_tendencies/what_is_not_working must go through this rather than assume a shape, so
// legacy entries and new structured ones can coexist without a one-time destructive migration.
OAD.personaTendencyText = function (entry) {
  return typeof entry === 'string' ? entry : (entry && entry.text) || '';
};

// Reconciles a hand-edited textarea (the Persona settings modal, one entry per line) against the
// existing array WITHOUT discarding structured metadata on any entry whose text is unchanged. The
// previous behavior — replace the whole array with freshly split textarea lines — would silently
// flatten every auto-promoted trait's evidence_strength/evidence_thread_uuids/source back to a
// bare string the instant the user saved Persona settings for any unrelated reason (e.g. just
// changing Pressure Level). A line with no matching existing entry becomes a new
// source:'manual' entry; an existing entry whose text no longer appears in the textarea is
// dropped (an intentional deletion, not data loss).
OAD.reconcilePersonaTendencyList = function (existingList, rawTextareaValue) {
  var existing = existingList || [];
  var lines = (rawTextareaValue || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var byText = {};
  existing.forEach(function (entry) {
    byText[OAD.personaTendencyText(entry)] = entry;
  });
  return lines.map(function (line) {
    return byText[line] || { text: line, source: 'manual', added: OAD.todayStr() };
  });
};

OAD.sweepStalledTendencyEvidence = function () {
  var now = new Date();
  var cooldownMs = OAD._STALLED_EVIDENCE_COOLDOWN_DAYS * 86400000;
  var evidence = (OAD.DB.persona && OAD.DB.persona.tendency_evidence) || [];
  (OAD.getVisibleThreads() || []).forEach(function (t) {
    if (!OAD.TemporalStatus.isStalled(t, now)) return;
    var recentRow = evidence.some(function (e) {
      return e.thread_uuid === t.uuid && e.event_type === 'stalled' &&
        (now - new Date(e.date + 'T00:00:00')) < cooldownMs;
    });
    if (recentRow) return;
    OAD.logTendencyEvidence(t.uuid, 'stalled', '');
  });
};

// Fixed, well-known uuid (matching the existing life-area-bollard convention, e.g.
// 'abigail-life-area-2026-06-15') rather than title-text matching — the title changes with the
// live count every sweep, so matching on it would be fragile.
OAD._INBOX_SENTINEL_UUID = 'system-inbox-sentinel';

// Makes "the inbox has unsorted items" impossible to miss by keeping one always-on, real Thread
// (unlike OAD.renderInboxAlertBanner, js/render.js, which is display-only) whose priority
// escalates with how long the OLDEST item has actually sat untriaged — not the sentinel's own
// age, which would let clearing-and-immediately-refilling the inbox look identical to genuinely
// ignoring it for days. oldest_unresolved_age is therefore always recomputed fresh from the
// live inbox set on every call, never carried forward as state on the sentinel thread itself —
// same principle as the Eisenhower quadrant view: compute at sweep time from current fields,
// don't let a persistent object accumulate drifting history that can desync from reality.
//
// Per-item capture date falls back created_at -> evolution_log[0].date -> "just captured" (no
// signal at all). created_at (js/data.js OAD.makeThread) is null for any thread that predates
// the field being added — confirmed against real live data (see ticket-flowqueue-inbox-triage.md)
// that every current real inbox item has a null created_at, so evolution_log is the load-bearing
// signal today, not just a defensive fallback.
//
// Reentrancy: an existing sentinel's fields are mutated directly + OAD.saveDB() called
// directly, NEVER through OAD.updateThread — routing through updateThread would re-fire
// OAD._runAfterSave, which re-triggers this same sweep (registered below), looping. Only the
// one-time creation path uses OAD.addThread, matching the same direct-mutation pattern already
// used by the CHE auto-fix code (OAD.applyHealthAlertFix, js/engine.js).
OAD.sweepInboxSentinel = function () {
  var inbox = OAD.getInboxThreads();
  var sentinel = OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID);

  if (inbox.length === 0) {
    if (sentinel && sentinel.status !== 'closed') {
      sentinel.status = 'closed';
      sentinel.closing_condition_met = true;
      sentinel.evolution_log.push({ date: OAD.todayStr(), note: 'Inbox cleared, sentinel auto-closed.' });
      OAD.saveDB();
    }
    return;
  }

  var today = new Date();
  var oldestAge = 0;
  inbox.forEach(function (t) {
    var capturedStr = t.created_at ? t.created_at.slice(0, 10) :
      ((t.evolution_log && t.evolution_log[0] && t.evolution_log[0].date) || null);
    if (!capturedStr) return;
    var ageDays = Math.floor((today - new Date(capturedStr + 'T00:00:00')) / 86400000);
    if (ageDays > oldestAge) oldestAge = ageDays;
  });

  var th = OAD.Config.inboxSentinelThresholds;
  var priority = oldestAge >= th.criticalMinDays ? 'critical' : oldestAge >= th.overdueMinDays ? 'high' : 'medium';
  var title = 'Inbox needs triage (' + inbox.length + ' item' + (inbox.length === 1 ? '' : 's') + ')';
  var nextActionDate = OAD.todayStr();
  var nextAction = 'Open Inbox and sort each item into a real thread with a closing condition and a next action date, or archive it.';

  if (!sentinel) {
    OAD.addThread(OAD.makeThread({
      uuid: OAD._INBOX_SENTINEL_UUID,
      title: title,
      life_area: 'System',
      status: 'open',
      priority: priority,
      parent_uuid: null,
      next_action: nextAction,
      next_action_date: nextActionDate
    }));
    return;
  }

  if (sentinel.status === 'closed') {
    sentinel.status = 'open';
    sentinel.closing_condition_met = false;
  }
  sentinel.title = title;
  sentinel.priority = priority;
  sentinel.next_action_date = nextActionDate;
  OAD.saveDB();
};

// "Picks up count changes mid-day" (Quick Add, edits, import), not just on the next boot's
// sweep — same debounced _afterSaveCallbacks pattern already used for CHE (js/engine.js), so a
// bulk import doesn't thrash this on every row.
OAD._afterSaveCallbacks.push(function () {
  if (typeof OAD.sweepInboxSentinel !== 'function') return;
  clearTimeout(OAD._inboxSentinelDebounce);
  OAD._inboxSentinelDebounce = setTimeout(function () { OAD.sweepInboxSentinel(); }, 50);
});

// source: 'manual' (the thread-detail Insight button, js/render.js OAD.generateInsight) or
// 'auto' (silently fired after a non-closing edit-modal save, js/modals.js). Before this, both
// paths called this function identically with no way to tell them apart afterward — every
// insight looked the same in ai_insights/counsel_history regardless of whether a person actually
// asked for it. Required, not defaulted: a missing/unrecognized source is a bug at the call site,
// not something to paper over with a silent guess.
OAD.addInsight = function (id, insight, source) {
  if (source !== 'manual' && source !== 'auto') throw new Error('OAD.addInsight: source must be "manual" or "auto", got ' + JSON.stringify(source));
  const t = OAD.getThread(id);
  if (!t) return;

  if (!t.ai_insights) t.ai_insights = [];
  t.ai_insights.push(Object.assign({}, insight, { source: source }));

  if (!OAD.DB.persona) OAD.DB.persona = {};
  if (!OAD.DB.persona.counsel_history) OAD.DB.persona.counsel_history = [];

  OAD.DB.persona.counsel_history.push({
    thread_id: id,
    thread_title: t.title,
    insight,
    source: source,
    date: OAD.todayStr()
  });
  OAD.saveDB();
};

OAD.makeThread = function (overrides) {
  var data = Object.assign({
    uuid: OAD._generateUUID(), // stable identifier — used for export/import matching
    id: null,
    owner_id: OAD.DEFAULT_OWNER_ID, // multi-tenancy hook — see OAD.DEFAULT_OWNER_ID's comment
    created_at: new Date().toISOString(),
    title: '',
    life_area: 'Other',
    status: 'open',
    priority: 'medium',
    closing_condition: '',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: '',
    current_assumption_updated_at: null,
    assumption_verified: false,
    next_action: '',
    next_action_updated_at: null,
    next_action_date: '',
    next_action_time: null, // optional 'HH:MM' (24h) — null means date-only, no specific time
    next_action_channel: '',
    next_action_contact: '',
    contingency_trigger_date: '',
    contingency_action: '',
    contingency_escalation: '',
    deadline: null,
    deadline_time: null, // optional 'HH:MM' (24h) — null means date-only, no specific time
    effortEstimate: null,
    weeklyCommitment: null,
    effortLogged: 0,
    lead_time_days: null,
    connections: [],
    parent_uuid: null,
    evolution_log: [],
    ai_insights: [],
    date_push_count: 0,
    dormant_trigger: '',
    user_action_complete: false,
    stage: null, // job-application pipeline stage; null unless this is a leaf application thread
    runway_ack_until: null, // Runway Risk snooze — ISO date; suppressed from banner/card until this date passes
    deadline_check_skipped: false, // Quick Add's deadline classifier fired and T.J. skipped answering — see OAD.TemporalStatus.dataHygieneWarnings' 'quick_capture_deadline_skipped' rule
    // thread_kind: null (an ordinary thread) | 'habit' | 'idea' — discriminator per
    // ARCHITECTURE_RULES.md Rule 1, same pattern as `stage` for job-application threads
    // (see Track extends Thread, js/models.js). Habits and Ideas used to be separate top-level
    // OAD.DB arrays with their own empty model classes (zero computed behavior — nothing a
    // discriminator + fields couldn't carry); migrated here per
    // ticket-flowqueue-data-model-migration.md Step 2. The fields below are only meaningful
    // when thread_kind is set to the matching kind; every other thread just carries them at
    // their neutral default, same as `stage`/`dormant_trigger` already do for threads that
    // aren't job applications.
    thread_kind: null,
    // Habit fields (thread_kind === 'habit') — field names preserved exactly from the old
    // OAD.makeHabit() schema so existing UI reads (js/render.js) needed only a source repoint,
    // not a field rename.
    frequency: null,            // daily | weekly | every-other-day | custom
    time_of_day: null,          // morning | evening | flexible
    current_streak: 0,
    longest_streak: 0,
    last_checked_in: null,      // ISO date string
    last_check_in_done: null,   // boolean — true=yes, false=no
    last_check_in_note: '',
    phase: null,                // active | check-in | dormant
    why: '',
    // Idea fields (thread_kind === 'idea') — same preserved-field-names rationale as Habit above.
    notes: '',
    source: '',
    added_date: null,
    last_surfaced: null,
    type: null,                 // book | article | creative | project-seed | other
    energy_required: null,      // low | medium | high
    tags: [],
    // Proposal field (status === 'proposed') — why the AI is suggesting this / what blind spot
    // it covers. Migrated per ticket-flowqueue-data-model-migration.md Step 3: proposals used to
    // be a separate top-level array with no factory function at all (whatever JSON shape the LLM
    // happened to return, pushed raw) — now status:'proposed' Threads, same pattern as Habit/Idea.
    rationale: '',
    // Cadence fields (thread_kind === 'cadence') — migrated per
    // ticket-flowqueue-data-model-migration.md Step 4. Real computed behavior to preserve here
    // (unlike Habit/Idea): isOverdue()/isDoneThisPeriod(), now on RecurringThread extends Thread
    // (js/models.js), mirroring the existing Track extends Thread precedent for job-application
    // threads. `notes` is shared with Idea above — same generic meaning, no collision.
    recurrence: null,      // monthly-1st | monthly-15th | monthly-last | weekly | weekly-days | custom
    days_of_week: [],
    last_completed: null,
    next_due: null,
    consequences: ''
  }, overrides);
  return (window.OAD.Models && window.OAD.Models.Thread) ? new window.OAD.Models.Thread(data) : data;
};

// Cadences are Threads with thread_kind:'cadence' (ARCHITECTURE_RULES.md Rule 1, migrated per
// ticket-flowqueue-data-model-migration.md Step 4). Function names/signatures preserved so
// existing call sites needed only a source-of-truth repoint. life_area normalization is done
// explicitly here (not left to the next _normalizeDB() pass) to preserve the original
// immediate-consistency guarantee — OAD.addThread/updateThread don't normalize life_area
// themselves, only _normalizeDB's backfill loop does.
OAD.makeCadence = function (overrides) {
  return OAD.makeThread(Object.assign({
    thread_kind: 'cadence',
    life_area: 'finances',
    recurrence: 'monthly-1st'
  }, overrides));
};

OAD.addCadence = function (cadence) {
  cadence.life_area = OAD.normalizeLifeArea(cadence.life_area);
  return OAD.addThread(cadence);
};

OAD.getCadence = function (id) {
  var t = OAD.getThread(id);
  return (t && t.thread_kind === 'cadence') ? t : null;
};

OAD.updateCadence = function (id, patch) {
  if (!OAD.getCadence(id)) return null;
  if (patch.life_area !== undefined) patch.life_area = OAD.normalizeLifeArea(patch.life_area);
  return OAD.updateThread(id, patch);
};

OAD.deleteCadence = function (id) {
  return OAD.getCadence(id) ? OAD.deleteThread(id) : false;
};

// Saved Views — named, persisted filter+sort predicates over the thread list.
OAD.nextSavedViewId = function () {
  const ids = OAD.DB.saved_views.map(function (v) { return v.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.makeSavedView = function (overrides) {
  return Object.assign({
    id: null,
    name: '',
    statuses: [],
    priorities: [],
    life_areas: [],
    edge_rule: null,
    sort_field: 'pressure',
    sort_dir: 'desc',
    created_at: new Date().toISOString()
  }, overrides);
};

OAD.addSavedView = function (view) {
  view.id = OAD.nextSavedViewId();
  OAD.DB.saved_views.push(view);
  OAD.saveDB();
  return view;
};

OAD.getSavedView = function (id) {
  return OAD.DB.saved_views.find(function (v) { return v.id === id; }) || null;
};

OAD.updateSavedView = function (id, patch) {
  const v = OAD.getSavedView(id);
  if (!v) return null;
  Object.assign(v, patch);
  OAD.saveDB();
  return v;
};

OAD.deleteSavedView = function (id) {
  const idx = OAD.DB.saved_views.findIndex(function (v) { return v.id === id; });
  if (idx === -1) return false;
  OAD.DB.saved_views.splice(idx, 1);
  OAD.saveDB();
  return true;
};

// Maps the camelCase JSON seed schema to the snake_case thread model.
// Accepts "task" as a closing_condition_type alias for "action".
// Skips any row whose title already exists (any status) to prevent duplicates on re-import.
OAD.bulkImport = function (arr) {
  var CLOSING_TYPE = { task: 'action', outcome: 'outcome', action: 'action' };
  var count = 0;
  arr.forEach(function (r) {
    var title = r.title || '';
    if (!title) return;
    if (OAD.DB.threads.some(function (t) { return t.title === title; })) return;
    OAD.addThread(OAD.makeThread({
      title:                    title,
      life_area:               (r.lifeArea             || r.life_area            || 'Other').toLowerCase(),
      status:                   r.status               || 'open',
      priority:                 r.priority             || 'medium',
      closing_condition:        r.closingCondition     || r.closing_condition    || '',
      closing_condition_type:   CLOSING_TYPE[r.closingType || r.closing_condition_type] || 'outcome',
      current_assumption:       r.currentAssumption    || r.current_assumption   || '',
      next_action:              r.nextAction           || r.next_action          || '',
      next_action_date:         r.byDate               || r.next_action_date     || '',
      next_action_channel:      r.channel              || r.next_action_channel  || '',
      next_action_contact:      r.contact              || r.next_action_contact  || '',
      contingency_trigger_date: r.contingencyTriggerDate || r.contingency_trigger_date || '',
      contingency_action:       r.contingencyAction    || r.contingency_action   || '',
      contingency_escalation:   r.escalation           || r.contingency_escalation || ''
    }));
    count++;
  });
  return count;
};

// ── Habit data model ─────────────────────────────────────────────────

// Habits are Threads with thread_kind:'habit' (ARCHITECTURE_RULES.md Rule 1 — migrated per
// ticket-flowqueue-data-model-migration.md Step 2; OAD.Models.Habit used to be a fully empty
// class, zero computed behavior to preserve). These functions keep their original names and
// signatures so every existing call site (js/render.js) needed only a source-of-truth repoint,
// not a rename.
OAD.makeHabit = function (overrides) {
  return OAD.makeThread(Object.assign({
    thread_kind: 'habit',
    life_area: 'Personal Growth',
    frequency: 'daily',       // daily | weekly | every-other-day | custom
    time_of_day: 'morning',   // morning | evening | flexible
    phase: 'active'           // active | check-in | dormant
  }, overrides));
};

OAD.addHabit = function (habit) {
  return OAD.addThread(habit);
};

OAD.getHabit = function (id) {
  var t = OAD.getThread(id);
  return (t && t.thread_kind === 'habit') ? t : null;
};

OAD.updateHabit = function (id, patch) {
  return OAD.getHabit(id) ? OAD.updateThread(id, patch) : null;
};

OAD.checkInHabit = function (id, done, note) {
  const h = OAD.getHabit(id);
  if (!h) return null;
  const today     = OAD.todayStr();
  const yesterdayDt = new Date(); yesterdayDt.setHours(0, 0, 0, 0); yesterdayDt.setDate(yesterdayDt.getDate() - 1);
  const yesterday = yesterdayDt.toISOString().slice(0, 10);
  const alreadyToday = h.last_checked_in === today;

  var currentStreak = h.current_streak || 0;
  var longestStreak = h.longest_streak || 0;

  if (done) {
    if (!alreadyToday) {
      if (h.last_checked_in === yesterday && h.last_check_in_done) {
        currentStreak = currentStreak + 1;
      } else {
        currentStreak = 1;
      }
    } else if (!h.last_check_in_done) {
      // Was no today, flipping to yes — restart from 1
      currentStreak = 1;
    }
    // Already yes today → streak unchanged
    longestStreak = Math.max(longestStreak, currentStreak);
  } else {
    if (alreadyToday && h.last_check_in_done) {
      // Flipping yes→no today — undo the increment
      currentStreak = Math.max(0, currentStreak - 1);
    } else if (!alreadyToday) {
      currentStreak = 0;
    }
    // Already no today → no change
  }

  return OAD.updateThread(id, {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_checked_in: today,
    last_check_in_done: done,
    last_check_in_note: note != null ? note : ''
  });
};

// ── Export ────────────────────────────────────────────────────────────
// Includes thread data and full graph edges. Deliberately excludes:
//   evolution_log — history audit trail
//   current_assumption — live assumption text
//   ai_insights[] — counsel engine history
//   persona data — behavioral profile
// In a multi-user system this must be scoped to the authenticated user —
// the exported_by field makes ownership explicit for that future.

// ── Import ────────────────────────────────────────────────────────────
// Accepts the moat-safe export JSON format.
// Matching priority:
//   1. UUID match — row.uuid finds an existing thread → update
//   2. Title fallback — row.uuid absent/null AND exactly one non-closed thread
//      shares the title → update (prevents duplicate creation from AI-generated
//      patches and older export formats that omit UUIDs)
//   3. Neither matches → create
// Evolution log is always appended — never overwritten.

OAD.parseImportFile = function (jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    const rows = Array.isArray(parsed) ? parsed : (parsed.threads || []);
    if (!Array.isArray(rows)) return { error: 'Invalid format: expected a threads array.' };
    const deletedUuids       = Array.isArray(parsed.deleted_uuids)         ? parsed.deleted_uuids         : [];
    const deletedEdgeUuids   = Array.isArray(parsed.deleted_edge_uuids)    ? parsed.deleted_edge_uuids    : [];
    const importEdges        = Array.isArray(parsed.edges)                 ? parsed.edges                 : [];
    const results = { create: [], update: [], close: [], invalid: [], edges: importEdges, deletedEdgeUuids: deletedEdgeUuids };

    // Cadences used to match on `id` via a separate parsed.cadences array (cadences had no uuid
    // field). Per ARCHITECTURE_RULES.md Rule 1 (ticket-flowqueue-data-model-migration.md Step 4)
    // they're just Threads now — a cadence-shaped row in `rows` below is matched by uuid exactly
    // like any other thread, no separate diffing path. Cadences are deletion-flagged the same
    // way as any other thread via deleted_uuids — OAD.applyImport branches to a real delete
    // rather than a close for thread_kind:'cadence' specifically, preserving the original "no
    // reopen a deleted cadence" semantic without needing a second deletion mechanism.
    // Collect threads to close (or, for cadences, hard-delete) from deleted_uuids
    deletedUuids.forEach(function (uuid) {
      const existing = OAD.getThreadByUUID(uuid);
      if (existing && existing.status !== 'closed') results.close.push(existing);
    });
    rows.forEach(function (row) {
      if (!row.title || typeof row.title !== 'string') {
        results.invalid.push(row);
        return;
      }
      // 1. UUID match
      var existing = row.uuid ? OAD.getThreadByUUID(row.uuid) : null;
      // 2. Title fallback — only when UUID absent AND exactly one open match exists
      if (!existing && !row.uuid) {
        var titleMatches = OAD.DB.threads.filter(function (t) {
          return t.title === row.title && t.status !== 'closed';
        });
        if (titleMatches.length === 1) existing = titleMatches[0];
      }
      if (existing) {
        results.update.push({ incoming: row, existing: existing });
      } else {
        results.create.push(row);
      }
    });
    return results;
  } catch (e) {
    return { error: 'Could not parse JSON: ' + e.message };
  }
};

// Fields synced on import (all fields Claude can see and update in the web UI)
OAD._IMPORT_FIELDS = [
  'title',
  'status', 'priority', 'life_area', 'owner_id',
  'closing_condition', 'closing_condition_type', 'closing_condition_met',
  'current_assumption', 'assumption_verified',
  'next_action', 'next_action_date', 'next_action_time', 'next_action_channel', 'next_action_contact',
  'contingency_trigger_date', 'contingency_action', 'contingency_escalation',
  'deadline', 'deadline_time', 'effortEstimate', 'weeklyCommitment', 'effortLogged',
  'lead_time_days', 'connections', 'parent_uuid', 'date_push_count', 'metadata',
  'dormant_trigger', 'user_action_complete',
  // thread_kind + Habit/Idea fields — ARCHITECTURE_RULES.md Rule 4.
  'thread_kind', 'frequency', 'time_of_day', 'current_streak', 'longest_streak',
  'last_checked_in', 'last_check_in_done', 'last_check_in_note', 'phase', 'why',
  'notes', 'source', 'added_date', 'last_surfaced', 'type', 'energy_required', 'tags',
  // Proposal field — ARCHITECTURE_RULES.md Rule 4.
  'rationale',
  // Cadence fields — ARCHITECTURE_RULES.md Rule 4. Per ticket-flowqueue-data-model-migration.md
  // Step 4, a cadence-shaped row is now just a thread row matched by uuid like any other — no
  // more separate OAD._CADENCE_IMPORT_FIELDS/id-matched diffing path.
  'recurrence', 'days_of_week', 'last_completed', 'next_due', 'consequences'
];

OAD.applyImport = function (results, confirmedUpdates, confirmedDeleteIds) {
  var created = 0, updated = 0, closed = 0, deleted = 0;

  // Close threads flagged in deleted_uuids — cadences (thread_kind:'cadence') hard-delete
  // instead of closing, preserving the original cadence-specific semantic (no "reopen a deleted
  // cadence" concept, unlike a real thread which can always be reopened from closed) now that
  // both flow through the same deleted_uuids mechanism per
  // ticket-flowqueue-data-model-migration.md Step 4. Deletion is destructive, so — same rigor
  // the old cadence-delete-only flow had — it only happens for ids the caller explicitly
  // confirmed (js/modals.js's "cannot be undone" checkboxes); a regular thread close is
  // reversible (can be reopened later) and always auto-applies, matching its original behavior
  // of having no confirmation step at all.
  (results.close || []).forEach(function (existing) {
    if (existing.thread_kind === 'cadence') {
      if ((confirmedDeleteIds || []).indexOf(existing.id) === -1) return;
      OAD.deleteThread(existing.id);
      deleted++;
    } else {
      OAD.updateThread(existing.id, { status: 'closed', closing_condition_met: true });
      OAD.addEvolution(existing.id, 'Closed via import sync.');
      closed++;
    }
  });

  (results.create || []).forEach(function (row) {
    const t = OAD.makeThread({
      uuid:                     row.uuid || OAD._generateUUID(),
      title:                    row.title,
      owner_id:                 row.owner_id                 || OAD.DEFAULT_OWNER_ID,
      status:                   row.status                   || 'open',
      priority:                 row.priority                 || 'medium',
      life_area:                row.life_area                || 'Other',
      parent_uuid:              row.parent_uuid              || null,
      closing_condition:        row.closing_condition        || '',
      closing_condition_type:   row.closing_condition_type   || 'outcome',
      closing_condition_met:    row.closing_condition_met    || false,
      current_assumption:       row.current_assumption       || '',
      assumption_verified:      row.assumption_verified      || false,
      next_action:              row.next_action              || '',
      next_action_date:         row.next_action_date         || '',
      next_action_time:         row.next_action_time         || null,
      next_action_channel:      row.next_action_channel      || '',
      next_action_contact:      row.next_action_contact      || '',
      contingency_trigger_date: row.contingency_trigger_date || '',
      contingency_action:       row.contingency_action       || '',
      contingency_escalation:   row.contingency_escalation   || '',
      deadline:                 row.deadline                 || null,
      deadline_time:            row.deadline_time             || null,
      effortEstimate:           row.effortEstimate           || null,
      weeklyCommitment:         row.weeklyCommitment         || null,
      effortLogged:             row.effortLogged             || 0,
      date_push_count:          row.date_push_count          || 0,
      metadata:                 row.metadata                 || {},
      connections:              row.connections              || [],
      dormant_trigger:          row.dormant_trigger          || '',
      user_action_complete:     row.user_action_complete     || false,
      // thread_kind + Habit/Idea fields — ARCHITECTURE_RULES.md Rule 4.
      thread_kind:              row.thread_kind              || null,
      frequency:                row.frequency                || null,
      time_of_day:              row.time_of_day              || null,
      current_streak:           row.current_streak           || 0,
      longest_streak:           row.longest_streak           || 0,
      last_checked_in:          row.last_checked_in          || null,
      last_check_in_done:       row.last_check_in_done       != null ? row.last_check_in_done : null,
      last_check_in_note:       row.last_check_in_note       || '',
      phase:                    row.phase                    || null,
      why:                      row.why                      || '',
      notes:                    row.notes                    || '',
      source:                   row.source                   || '',
      added_date:               row.added_date               || null,
      last_surfaced:            row.last_surfaced            || null,
      type:                     row.type                     || null,
      energy_required:          row.energy_required          || null,
      tags:                     row.tags                     || [],
      rationale:                row.rationale                || '',
      // Cadence fields — ARCHITECTURE_RULES.md Rule 4.
      recurrence:               row.recurrence               || null,
      days_of_week:             row.days_of_week             || [],
      last_completed:           row.last_completed           || null,
      next_due:                 row.next_due                 || null,
      consequences:             row.consequences              || ''
    });
    const added = OAD.addThread(t);
    (row.evolution_log || []).forEach(function (e) {
      if (e.date && e.note) added.evolution_log.push({ date: e.date, note: e.note });
    });
    OAD.addEvolution(added.id, 'Created via import sync.');
    created++;
  });

  (confirmedUpdates || []).forEach(function (item) {
    // Re-lookup at apply time so we never operate on a stale reference
    const existing = OAD.getThreadByUUID(item.incoming.uuid) || item.existing;
    const row      = item.incoming;
    const patch    = {};
    OAD._IMPORT_FIELDS.forEach(function (field) {
      if (row[field] !== undefined && JSON.stringify(row[field]) !== JSON.stringify(existing[field])) {
        patch[field] = row[field];
      }
    });
    if (Object.keys(patch).length) OAD.updateThread(existing.id, patch);
    // Append only new evolution entries (dedupe by date+note)
    const existingKeys = new Set(
      (existing.evolution_log || []).map(function (e) { return e.date + '|' + e.note; })
    );
    (row.evolution_log || []).forEach(function (e) {
      if (e.date && e.note && !existingKeys.has(e.date + '|' + e.note)) {
        existing.evolution_log.push({ date: e.date, note: e.note });
      }
    });
    OAD.addEvolution(existing.id, 'Updated via import sync.');
    updated++;
  });

  // Remove edges flagged for deletion
  (results.deletedEdgeUuids || []).forEach(function (edgeUuid) {
    (OAD.DB.threads || []).forEach(function (t) {
      if (t.connections) {
        t.connections = t.connections.filter(function (c) { return c.uuid !== edgeUuid; });
      }
    });
  });

  // Merge top-level edges — skips duplicates (matched by edge UUID, or by to_uuid alone).
  // Every OAD.exportThreads() output carries a full flattened `edges` array mirroring every
  // thread's connections (see below, "Derive flat top-level edges array for ADE-aware
  // consumers") — so ANY re-import of a previously-exported file, even one where only a couple
  // of thread fields changed, round-trips this array. If that file predates a later edge-type
  // correction (e.g. someone re-imports an older cached export, or two sessions work off
  // different snapshots), matching on (to_uuid, edge_type) alone can't tell "this edge never
  // existed" apart from "this pair's relationship was already established, just re-typed since
  // this snapshot was taken" — so a stale `enables` edge gets silently re-merged in right
  // alongside an already-corrected `blocked_by` edge to the same target. Same class of bug as
  // OAD._adeAddEdge (js/engine.js) and the same fix: defer to whatever relationship already
  // exists for this exact pair, regardless of type, rather than layering a stale one on top.
  var edgesMerged = 0;
  (results.edges || []).forEach(function (edge) {
    if (!edge.from_uuid || !edge.to_uuid) return;
    var fromThread = OAD.getThreadByUUID(edge.from_uuid);
    if (!fromThread) return;
    fromThread.connections = fromThread.connections || [];
    var alreadyExists = fromThread.connections.some(function (c) {
      return (c.uuid && c.uuid === edge.id) || c.to_uuid === edge.to_uuid;
    });
    if (!alreadyExists) {
      fromThread.connections.push({
        uuid:              edge.id || OAD._generateUUID(),
        to_uuid:           edge.to_uuid,
        to_label:          edge.to_label || '',
        edge_type:         edge.label,
        auto_generated:    edge.auto_generated    || false,
        rule:              edge.rule              || null,
        confidence:        edge.confidence        != null ? edge.confidence : 1.0,
        confirmed_by_user: edge.confirmed_by_user !== false,
        created_at:        edge.created_at        || null
      });
      edgesMerged++;
    }
  });

  // No separate cadence create/update/delete block anymore — per
  // ticket-flowqueue-data-model-migration.md Step 4, a cadence-shaped row already flowed through
  // results.create/confirmedUpdates above (matched by uuid like any other thread), and deletion
  // is handled in the results.close loop above (branches to a real delete for thread_kind:
  // 'cadence').

  OAD.saveDB();
  return {
    created: created, updated: updated, closed: closed, deleted: deleted, edges_merged: edgesMerged
  };
};

// Migrated to OAD.TemporalStatus.isStalled (js/threadTemporalStatus.js) per
// ticket-flowqueue-temporal-and-schema.md Phase 1 — isStalled already bakes in the
// waiting+user_action_complete ("ball in their court") exclusion that tier 3's selection filter
// applied inline but isFriction's "is my already-picked sticky TOAT still valid" recheck below
// did NOT, a real pre-existing inconsistency between the two (a thread that became ball-in-court
// mid-day could incorrectly stay "sticky" as TOAT). Both now agree, closing that gap.
OAD.getDailyToat = function () {
  const todayStr = OAD.todayStr();
  OAD.DB.toat = OAD.DB.toat || [];

  function isFriction(t) {
    if (!t || t.status !== 'open' && t.status !== 'waiting') return false;
    return OAD.TemporalStatus.isStalled(t, new Date());
  }

  const todayEntry = OAD.DB.toat.find(e => e.date === todayStr);
  if (todayEntry) {
    const t = OAD.getThread(todayEntry.threadId);
    if (t && isFriction(t)) {
      const allVisible = OAD.getVisibleThreads() || [];
      if (allVisible.some(vt => vt.id === t.id)) {
        return t;
      }
    }
  }

  const allThreads = OAD.getVisibleThreads() || [];
  const now = new Date();

  const overdueWaiting = allThreads.filter(t => {
    return t.status === 'waiting' && OAD.TemporalStatus.isStalled(t, now);
  });
  const overdueOpen = allThreads.filter(t => {
    return t.status === 'open' && OAD.TemporalStatus.isStalled(t, now);
  });

  let selected = null;
  if (overdueOpen.length > 0) {
    overdueOpen.sort((a, b) => a.id - b.id);
    selected = overdueOpen[0];
  } else if (overdueWaiting.length > 0) {
    overdueWaiting.sort((a, b) => a.id - b.id);
    selected = overdueWaiting[0];
  }

  if (selected) {
    OAD.DB.toat = OAD.DB.toat.filter(e => e.date !== todayStr);
    OAD.DB.toat.push({ date: todayStr, threadId: selected.id });
    OAD.saveDB();
    return selected;
  }

  if (todayEntry) {
    OAD.DB.toat = OAD.DB.toat.filter(e => e.date !== todayStr);
    OAD.saveDB();
  }
  return null;
};

OAD.exportThreads = function () {
  OAD._normalizeDB(); // ensures all connection UUIDs are backfilled
  OAD.saveDB();

  const threads = (OAD.DB.threads || []).map(function (t) {
    return {
      uuid:                     t.uuid,
      parent_uuid:              t.parent_uuid || null,
      owner_id:                 t.owner_id || OAD.DEFAULT_OWNER_ID,
      title:                    t.title,
      status:                   t.status,
      priority:                 t.priority,
      life_area:                t.life_area,
      pressure:                 OAD.pressure(t),
      closing_condition:        t.closing_condition        || '',
      closing_condition_type:   t.closing_condition_type   || 'outcome',
      closing_condition_met:    t.closing_condition_met    || false,
      // current_assumption is deliberately NOT exported here — confirmed via an existing test
      // ('moat-safe export strips proprietary attributes') that current_assumption,
      // contingency_action, contingency_escalation, evolution_log, and ai_insights are all
      // intentionally excluded from this format alongside it, reading as a coherent boundary
      // ("operational state" vs. "internal reasoning trail"), not an oversight — this was
      // initially miscategorized as a bug during the Phase 2 schema audit and reverted once the
      // existing test was found. Flagged explicitly in the Phase 2 report: this genuinely
      // conflicts with Phase 2's own "confirm export round-trips with the new fields present"
      // requirement for this specific field, and needs a decision, not a silent pick either way.
      assumption_verified:      t.assumption_verified      || false,
      next_action:              t.next_action              || '',
      // current_assumption_updated_at is excluded here for the same reason current_assumption
      // itself is (see the comment above) — its sibling, next_action_updated_at, IS exported,
      // matching next_action's own export status.
      next_action_updated_at:   t.next_action_updated_at   || null,
      next_action_date:         t.next_action_date         || '',
      next_action_time:         t.next_action_time         || null,
      next_action_channel:      t.next_action_channel      || '',
      next_action_contact:      t.next_action_contact      || '',
      contingency_trigger_date: t.contingency_trigger_date || '',
      deadline:                 t.deadline                 || null,
      deadline_time:            t.deadline_time             || null,
      effortEstimate:           t.effortEstimate           || null,
      weeklyCommitment:         t.weeklyCommitment         || null,
      effortLogged:             t.effortLogged             || 0,
      date_push_count:          t.date_push_count          || 0,
      metadata:                 t.metadata                 || {},
      // thread_kind + Habit/Idea fields — ARCHITECTURE_RULES.md Rule 4: a migrated model must
      // be included in export/import in the same change that introduces it. Only meaningful
      // when thread_kind is set; every other thread just carries its neutral default.
      thread_kind:              t.thread_kind              || null,
      frequency:                t.frequency                || null,
      time_of_day:              t.time_of_day              || null,
      current_streak:           t.current_streak           || 0,
      longest_streak:           t.longest_streak           || 0,
      last_checked_in:          t.last_checked_in          || null,
      last_check_in_done:       t.last_check_in_done       != null ? t.last_check_in_done : null,
      last_check_in_note:       t.last_check_in_note       || '',
      phase:                    t.phase                    || null,
      why:                      t.why                      || '',
      notes:                    t.notes                    || '',
      source:                   t.source                   || '',
      added_date:               t.added_date               || null,
      last_surfaced:            t.last_surfaced            || null,
      type:                     t.type                     || null,
      energy_required:          t.energy_required          || null,
      tags:                     t.tags                     || [],
      rationale:                t.rationale                || '',
      // Cadence fields — ARCHITECTURE_RULES.md Rule 4. notes (above) is shared with Idea.
      recurrence:               t.recurrence               || null,
      days_of_week:             t.days_of_week             || [],
      last_completed:           t.last_completed           || null,
      next_due:                 t.next_due                 || null,
      consequences:             t.consequences             || '',
      connections:              (t.connections || []).map(function (c) {
        return {
          uuid:              c.uuid,
          to_uuid:           c.to_uuid,
          to_label:          c.to_label || '',
          edge_type:         c.edge_type,
          auto_generated:    c.auto_generated    || false,
          rule:              c.rule              || null,
          confidence:        c.confidence        != null ? c.confidence : 1.0,
          confirmed_by_user: c.confirmed_by_user !== false,
          created_at:        c.created_at        || null
        };
      })
    };
  });

  // Derive flat top-level edges array for ADE-aware consumers
  const edges = [];
  (OAD.DB.threads || []).forEach(function (t) {
    (t.connections || []).forEach(function (c) {
      if (!c.to_uuid) return;
      edges.push({
        id:                c.uuid,
        from_uuid:         t.uuid,
        to_uuid:           c.to_uuid,
        label:             c.edge_type,
        to_label:          c.to_label || '',
        auto_generated:    c.auto_generated    || false,
        rule:              c.rule              || null,
        confidence:        c.confidence        != null ? c.confidence : 1.0,
        confirmed_by_user: c.confirmed_by_user !== false,
        created_at:        c.created_at        || null
      });
    });
  });

  // Cadences used to be a separate array exported here — per ARCHITECTURE_RULES.md Rule 1
  // (ticket-flowqueue-data-model-migration.md Step 4) they're just Threads now (thread_kind:
  // 'cadence'), already present in `threads` above with their recurrence/days_of_week/etc.
  // fields, so there is no separate cadence export section to build anymore.

  return JSON.stringify({
    exported_at:        new Date().toISOString(),
    exported_by:        OAD._userId || 'local',
    thread_count:       threads.length,
    edge_count:         edges.length,
    note:               'Export includes thread data and graph edges. Evolution history, AI insights, and persona data are omitted.',
    threads:            threads,
    edges:              edges,
    deleted_edge_uuids: []
  }, null, 2);
};

// ── DEV-only diagnostic export ──────────────────────────────────────────
// Per ticket-dev-diagnostic-export.md: this is an internal QA tool, explicitly NOT the future
// real user-facing export. The moat-safe exclusions in OAD.exportThreads() above (no
// current_assumption/evolution_log/ai_insights) are correct THERE and deliberately NOT
// preserved here — those fields exist specifically so this export can be used to verify Phase 2
// backfill work and thread history without guessing. When there's ever a real second user, build
// the separate, deliberately narrow, moat-protecting export from the Product Vision Document at
// that point — this function is not a draft of that, and must not be reused for it.
//
// Everything below is computed fresh at export time (same principle as OAD.TemporalStatus
// itself: pure computation over current state, never a new persisted flag) using the exact same
// `now` moment and the exact same production functions the live UI calls — never a hand-rolled
// reimplementation, which is the entire reason this ticket exists (today's verification loop
// kept requiring external Python reimplementations of app logic instead of reading the app's
// actual output).

// TOAT candidate detail — tier 2 (overdueOpen) and tier 3 (overdueWaiting), each sorted by
// thread id (TOAT's real tie-break, confirmed in ticket-stalled-metric-fix.md — NOT
// next_action_date, despite an earlier brief's incorrect claim that it was), with a `won` flag
// on whichever one OAD.getDailyToat() actually picked. Does not call OAD.getDailyToat() to
// build the candidate list itself (that function has a "sticky today" persistence side effect
// via OAD.DB.toat) — only to identify the real winner, so the diagnostic reflects what the UI
// is actually showing right now without also mutating state as a side effect of exporting.
OAD._toatDiagnostic = function () {
  var now = new Date();
  var allThreads = OAD.getVisibleThreads() || [];
  var winner = OAD.getDailyToat();

  var tier2 = allThreads.filter(function (t) { return t.status === 'open' && OAD.TemporalStatus.isStalled(t, now); })
    .slice().sort(function (a, b) { return a.id - b.id; });
  var tier3 = allThreads.filter(function (t) { return t.status === 'waiting' && OAD.TemporalStatus.isStalled(t, now); })
    .slice().sort(function (a, b) { return a.id - b.id; });

  function toCandidate(t, tier, rank) {
    return { uuid: t.uuid, title: t.title, tier: tier, rank_in_tier: rank, won: !!winner && winner.uuid === t.uuid };
  }

  var candidates = tier2.map(function (t, i) { return toCandidate(t, 2, i + 1); })
    .concat(tier3.map(function (t, i) { return toCandidate(t, 3, i + 1); }));

  return {
    winner: winner ? { uuid: winner.uuid, title: winner.title, tier: tier2.some(function (t) { return t.uuid === winner.uuid; }) ? 2 : (tier3.some(function (t) { return t.uuid === winner.uuid; }) ? 3 : null) } : null,
    candidates: candidates
  };
};

// Focus Now candidate detail — the real winner (via OAD.selectFocusThread(), zero
// reimplementation of its 3-tier blocked/waiting-actioned fallback logic) plus the top 5 of the
// exact same dueNow candidate pool it draws from, by pressure — so a pick can be sanity-checked
// as "genuinely highest among what was actually eligible," not just "highest in the whole
// backlog" (which would include threads not even due yet).
OAD._focusNowDiagnostic = function () {
  var todayStr = OAD.todayStr();
  var active = OAD.Due.activeThreads();
  var winner = OAD.selectFocusThread(active);
  var dueNow = active.filter(function (t) { return t.next_action_date && t.next_action_date <= todayStr; })
    .slice().sort(function (a, b) { return b._score - a._score; });

  return {
    winner: winner ? { uuid: winner.uuid, title: winner.title, pressure: winner._score != null ? winner._score : OAD.pressure(winner) } : null,
    top5: dueNow.slice(0, 5).map(function (t) { return { uuid: t.uuid, title: t.title, pressure: t._score }; })
  };
};

// This Week — plain-text definition (confirmed, never previously written down anywhere,
// per ticket-flowqueue-temporal-and-schema.md Phase 1's unresolved flag) plus actual live
// membership, both from the real OAD.Due.dashboardData() call the Daily/Today/Matrix views use.
OAD._thisWeekDiagnostic = function () {
  var todayStr = OAD.todayStr();
  var in7Dt = new Date(); in7Dt.setHours(0, 0, 0, 0); in7Dt.setDate(in7Dt.getDate() + 7);
  var in7Str = in7Dt.toISOString().slice(0, 10);
  var due = OAD.Due.dashboardData(todayStr, in7Str);

  return {
    definition: 'next_action_date > today AND next_action_date <= today+7 days (OAD.Due.buckets().week, js/due.js) — deliberately keyed on next_action_date only, never deadline. Applied to the suppression-adjusted active-thread list (parent/child folding rules apply), not the raw thread table.',
    member_uuids: due.week.map(function (t) { return t.uuid; })
  };
};

// Any closed thread that still has an outbound edge (any type, not just 'blocks' — the ticket's
// own wording says "or other") pointing at a thread that is not closed. A closed thread
// "blocking" active work is a real graph-integrity inconsistency, not just visual noise — either
// the block should have been resolved when the thread closed, or the relationship shouldn't have
// existed in the first place. Real, currently-live example this catches: apex-sweep-cadence-2026
// ("APEX Guidance → Weekly M/W/F Sweep Cadence," closed) still blocking 3 open/waiting threads.
OAD._staleClosedEdges = function () {
  var byUUID = {};
  (OAD.DB.threads || []).forEach(function (t) { byUUID[t.uuid] = t; });
  var stale = [];
  (OAD.DB.threads || []).forEach(function (t) {
    if (t.status !== 'closed') return;
    (t.connections || []).forEach(function (c) {
      if (!c.to_uuid) return;
      var target = byUUID[c.to_uuid];
      if (target && target.status !== 'closed') {
        stale.push({
          thread_uuid: t.uuid, thread_title: t.title,
          edge_type: c.edge_type,
          to_uuid: c.to_uuid, to_title: target.title, to_status: target.status
        });
      }
    });
  });
  return stale;
};

OAD.exportDevDiagnostic = function () {
  var base = JSON.parse(OAD.exportThreads());
  var now = new Date();

  // CHE alerts — run fresh (computed, not stale/stored), across every CHE-XXX rule, not just 006.
  OAD.runCHE();
  var cheAlerts = (OAD.DB.health_alerts || []).filter(function (a) { return !a.dismissed; })
    .map(function (a) {
      return { code: a.type, thread_uuid: a.thread_uuid || null, severity: a.severity, message: a.description };
    });

  var threadsByUUID = {};
  (OAD.DB.threads || []).forEach(function (t) { threadsByUUID[t.uuid] = t; });

  base.dev_export = true;
  base.note = 'DEV-ONLY DIAGNOSTIC EXPORT — internal QA tool. Not the real user-facing export; not the future moat-protecting minimal export described in the Product Vision Document. Includes current_assumption/evolution_log/ai_insights/contingency_action/contingency_escalation/dormant_trigger/user_action_complete/stage and computed application state (temporal status, hygiene warnings, CHE alerts, TOAT/Focus Now candidate detail, This Week membership, stale-edge detection) that the real export deliberately omits.';

  base.threads.forEach(function (row) {
    var real = threadsByUUID[row.uuid];
    if (!real) return;
    row.current_assumption = real.current_assumption || '';
    row.current_assumption_updated_at = real.current_assumption_updated_at || null;
    row.evolution_log = real.evolution_log || [];
    row.ai_insights = real.ai_insights || [];
    // Added for field-adoption analysis — these five are real, live fields (edit-modal inputs,
    // rendered in detail view, some feeding pressure/Runway Risk logic directly — see the
    // conversation this export change came out of for the full per-field trace) that
    // OAD.exportThreads() omits either deliberately (contingency_action/escalation, alongside
    // current_assumption/evolution_log, per the moat-safe boundary comment above) or just never
    // added (dormant_trigger, user_action_complete, stage — no export-exclusion rationale for
    // these three, they simply weren't in the original field list).
    row.contingency_action = real.contingency_action || '';
    row.contingency_escalation = real.contingency_escalation || '';
    row.dormant_trigger = real.dormant_trigger || '';
    row.user_action_complete = real.user_action_complete || false;
    row.stage = real.stage || null;
    row.computed_status = {
      is_overdue: OAD.TemporalStatus.isOverdue(real, now),
      is_due_today: OAD.TemporalStatus.isDueToday(real, now),
      is_stalled: OAD.TemporalStatus.isStalled(real, now),
      days_until_deadline: OAD.TemporalStatus.daysUntilDeadline(real, now),
      days_since_next_action: OAD.TemporalStatus.daysSinceNextActionDate(real, now),
      card_date_label: OAD.TemporalStatus.cardDateLabel(real, now)
    };
  });

  base.data_hygiene_warnings = (OAD.DB.threads || [])
    .reduce(function (all, t) { return all.concat(OAD.TemporalStatus.dataHygieneWarnings(t, now)); }, []);
  base.che_alerts = cheAlerts;
  base.toat_diagnostic = OAD._toatDiagnostic();
  base.focus_now_diagnostic = OAD._focusNowDiagnostic();
  base.this_week_diagnostic = OAD._thisWeekDiagnostic();
  base.stale_closed_edges = OAD._staleClosedEdges();

  // Per ticket-enterprise-mode-and-load-overview.md Part 3: every one of these was already a real
  // function, only reachable by hand-typing it into devtools — the actual problem tonight wasn't
  // that the numbers were wrong, it was that "what does this dashboard number actually mean" had
  // no answer without a live console session. Now answerable from an export file alone.
  base.pressure_distribution = OAD.Due.pressureDistribution();
  base.active_threads_by_score = OAD.Due.activeThreads().map(function (t) {
    return { uuid: t.uuid, title: t.title, score: t._score };
  });
  base.load_overview = OAD.Due.loadOverview();

  return JSON.stringify(base, null, 2);
};

// ── Idea data model ───────────────────────────────────────────────────
// Ideas are Threads with thread_kind:'idea' (ARCHITECTURE_RULES.md Rule 1 — migrated per
// ticket-flowqueue-data-model-migration.md Step 2; OAD.Models.Idea used to be a fully empty
// class, zero computed behavior to preserve). Function names/signatures preserved so existing
// call sites (js/render.js) needed only a source-of-truth repoint.

OAD.makeIdea = function (overrides) {
  return OAD.makeThread(Object.assign({
    thread_kind: 'idea',
    added_date: OAD.todayStr(),
    type: 'other',            // book | article | creative | project-seed | other
    energy_required: 'medium' // low | medium | high
  }, overrides));
};

OAD.addIdea = function (idea) {
  return OAD.addThread(idea);
};

OAD.getIdea = function (id) {
  var t = OAD.getThread(id);
  return (t && t.thread_kind === 'idea') ? t : null;
};

OAD.updateIdea = function (id, patch) {
  return OAD.getIdea(id) ? OAD.updateThread(id, patch) : null;
};

OAD.deleteIdea = function (id) {
  return OAD.getIdea(id) ? OAD.deleteThread(id) : false;
};
// Proposals are Threads with status:'proposed' (ARCHITECTURE_RULES.md Rule 1, migrated per
// ticket-flowqueue-data-model-migration.md Step 3). A proposal is a Thread in a specific
// lifecycle stage, not a permanently different kind of thing — status is the right discriminator
// here (matching inbox/waiting/dormant/closed), not thread_kind, which is reserved for Habit/Idea.
// 'proposed' is deliberately excluded everywhere pressure/Due/Active-count treat inbox/dormant as
// "not real work yet" (js/models.js getPressure/getLifeAreaHeat/getDayLoad, js/due.js
// activeThreadsRaw, js/api.js genDailyIntercept's highestLooming, js/render.js Active counts) —
// see those call sites for the specific exclusions.
OAD.getProposal = function (uuid) {
  var t = OAD.getThreadByUUID(uuid);
  return (t && t.status === 'proposed') ? t : null;
};

OAD.acceptProposal = function (uuid) {
  const p = OAD.getProposal(uuid);
  if (!p) return null;
  const thread = OAD.updateThread(p.id, { status: 'open', priority: 'medium' });
  OAD.addEvolution(p.id, 'Accepted from AI Proposal: ' + p.rationale);
  return thread;
};

OAD.rejectProposal = function (uuid) {
  const p = OAD.getProposal(uuid);
  if (!p) return;
  OAD.deleteThread(p.id);
};


// Returns the same idea all week, cycling through the list week-over-week.
OAD.ideaOfTheWeek = function () {
  const ideas = OAD.getIdeaThreads();
  if (!ideas.length) return null;
  const weekIndex = Math.floor(Date.now() / (7 * 86400000));
  return ideas[weekIndex % ideas.length];
};

// Ensures all expected arrays exist and all threads have UUIDs.
// Called after loading from localStorage or Supabase.
OAD._normalizeDB = function () {
  OAD.DB.threads          = OAD.DB.threads          || [];
  OAD.DB.cadences         = OAD.DB.cadences         || [];
  OAD.DB.habits           = OAD.DB.habits           || [];
  OAD.DB.ideas            = OAD.DB.ideas            || [];
  OAD.DB.proposals        = OAD.DB.proposals        || [];
  OAD.DB.ade_suppressions = OAD.DB.ade_suppressions || [];
  OAD.DB.health_alerts    = OAD.DB.health_alerts    || [];
  OAD.DB.saved_views      = OAD.DB.saved_views      || [];
  OAD.DB.persona          = OAD.DB.persona          || {};
  OAD.DB.persona.life_context = OAD.DB.persona.life_context || {};
  if (!Array.isArray(OAD.DB.persona.what_is_not_working)) OAD.DB.persona.what_is_not_working = [];
  if (!Array.isArray(OAD.DB.persona.tendency_evidence)) OAD.DB.persona.tendency_evidence = [];
  if (!OAD.DB.persona.tone_calibration) OAD.DB.persona.tone_calibration = {};

  // Hydrate every persisted record into its real domain-model class. Records loaded from
  // localStorage or Supabase arrive as plain JSON objects — without this, only entities
  // created fresh this session (via makeThread/makeCadence/...) are real class instances,
  // and everything actually loaded from storage silently falls back to the old procedural
  // OAD.* functions via the `typeof x.getPressure === 'function'` guards scattered through
  // the domain layer, instead of ever using their own methods.
  //
  // Upgrades objects IN PLACE via prototype swap rather than constructing new instances and
  // replacing them in the array. Constructing new instances would silently orphan any code
  // holding a reference to the original object across a _normalizeDB() call (it happened
  // immediately — a test asserting on a captured thread reference after normalize broke,
  // because the backfill loop below was then mutating a *different* new object, not the one
  // the caller was holding). Object.setPrototypeOf preserves identity: same object, same
  // reference everywhere it's already held, now with the class's methods available.
  OAD._hydrate = function (list, Klass) {
    if (!Klass) return list;
    list.forEach(function (item) {
      if (item && !(item instanceof Klass)) Object.setPrototypeOf(item, Klass.prototype);
    });
    return list;
  };
  if (OAD.Models) {
    OAD._hydrate(OAD.DB.threads,  OAD.Models.Thread);
    // No hydrate for Habit/Idea/Cadence — all migrated to Threads below (ARCHITECTURE_RULES.md
    // Rule 1, ticket-flowqueue-data-model-migration.md Steps 2 & 4); OAD.DB.habits/ideas/cadences
    // are always empty after this runs once, so there's never anything left in them to hydrate.
    // A cadence-shaped thread gets wrapped into RecurringThread on demand where its
    // isOverdue()/isDoneThisPeriod() are actually needed (OAD.cadenceOverdue/
    // cadenceDoneThisPeriod, js/engine.js) — same lazy-wrap pattern Track already uses, not a
    // second global hydration pass.
  }

  // Habits and Ideas migration: both used to be separate top-level arrays with fully empty
  // model classes (OAD.Models.Habit/Idea — zero computed behavior to lose). Converts anything
  // still sitting in the old arrays into a real Thread with the matching thread_kind
  // discriminator, then empties the old arrays. id is forced to null so the "Backfill UUIDs"
  // loop just below assigns each one a fresh id in the shared Thread id space — habits/ideas
  // used their own independent nextHabitId()/nextIdeaId() sequences before, so reusing their
  // old numeric id here could silently collide with an existing thread id. Self-terminating: once
  // migrated, the old arrays stay empty forever, so this is a no-op on every subsequent load —
  // no separate "done" flag needed, unlike OAD._runJune16DedupV2 below.
  (OAD.DB.habits || []).forEach(function (h) {
    OAD.DB.threads.push(OAD.makeThread(Object.assign({}, h, { id: null, thread_kind: 'habit' })));
  });
  OAD.DB.habits = [];
  (OAD.DB.ideas || []).forEach(function (i) {
    OAD.DB.threads.push(OAD.makeThread(Object.assign({}, i, { id: null, thread_kind: 'idea' })));
  });
  OAD.DB.ideas = [];

  // Cadences migration (Step 4): same self-terminating pattern, thread_kind:'cadence' as the
  // discriminator (real computed behavior — isOverdue()/isDoneThisPeriod() — now lives on
  // RecurringThread extends Thread, js/models.js, mirroring Track). Cadences never had a uuid
  // (Rule 3 violation being fixed here), so like Habits/Ideas, none is carried forward — a
  // fresh one comes from OAD.makeThread's own default.
  (OAD.DB.cadences || []).forEach(function (c) {
    OAD.DB.threads.push(OAD.makeThread(Object.assign({}, c, { id: null, thread_kind: 'cadence' })));
  });
  OAD.DB.cadences = [];

  // Proposals migration (Step 3): same self-terminating pattern as Habits/Ideas above, but
  // status:'proposed' is the discriminator here, not thread_kind — a proposal is a Thread in a
  // specific lifecycle stage (matching inbox/waiting/dormant/closed), not a permanently
  // different kind of thing. Proposals already had a real uuid (stamped in the old
  // genProactiveCounsel), so it's preserved rather than regenerated — id is still forced to null,
  // same collision-avoidance reasoning as Habits/Ideas.
  (OAD.DB.proposals || []).forEach(function (p) {
    OAD.DB.threads.push(OAD.makeThread(Object.assign({}, p, { id: null, status: 'proposed' })));
  });
  OAD.DB.proposals = [];

  let _maxId = 0;
  OAD.DB.threads.forEach(function(t) { if (t.id && t.id > _maxId) _maxId = t.id; });
  
  // Backfill UUIDs, parent_uuid, date_push_count, connection UUIDs, life area, null titles
  OAD.DB.threads.forEach(function (t) {
    if (!t.id) { _maxId++; t.id = _maxId; }
    if (!t.uuid) t.uuid = OAD._generateUUID();
    if (!t.title) t.title = '';
    if (!Object.prototype.hasOwnProperty.call(t, 'owner_id') || t.owner_id == null) t.owner_id = OAD.DEFAULT_OWNER_ID;
    if (!Array.isArray(t.evolution_log)) t.evolution_log = [];
    if (!Array.isArray(t.ai_insights)) t.ai_insights = [];
    if (!Object.prototype.hasOwnProperty.call(t, 'parent_uuid')) t.parent_uuid = null;
    if (t.date_push_count == null) t.date_push_count = 0;
    if (!Object.prototype.hasOwnProperty.call(t, 'dormant_trigger')) t.dormant_trigger = '';
    if (!Object.prototype.hasOwnProperty.call(t, 'user_action_complete')) t.user_action_complete = false;
    // Legacy threads predate created_at — backfill to null (unknown) rather than fabricate a date.
    if (!Object.prototype.hasOwnProperty.call(t, 'created_at')) t.created_at = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'stage')) t.stage = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'runway_ack_until')) t.runway_ack_until = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'deadline_check_skipped')) t.deadline_check_skipped = false;
    if (!Object.prototype.hasOwnProperty.call(t, 'next_action_time')) t.next_action_time = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'deadline_time')) t.deadline_time = null;
    // Legacy threads predate this tracking — backfill to null (unknown), not a fabricated "just
    // now." CHE-012 (js/engine.js) treats null as "can't tell, don't flag" rather than guessing.
    if (!Object.prototype.hasOwnProperty.call(t, 'next_action_updated_at')) t.next_action_updated_at = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'current_assumption_updated_at')) t.current_assumption_updated_at = null;
    // A thread with a parent can't still be status:inbox — attaching a parent is itself an act
    // of triage. Self-heals legacy data every load (real case: Abigail-Nelnet and Abby-Mainstay
    // docs both got attached to the Abigail bollard on 7/14 without their status ever updating),
    // not just a one-time migration — see the matching enforcement in OAD.updateThread for the
    // moment-of-attachment case going forward.
    if (t.parent_uuid && t.status === 'inbox') {
      t.status = 'open';
      t.evolution_log.push({ date: OAD.todayStr(), note: 'Status auto-corrected from inbox to open: thread has a parent, attaching is itself an act of triage.' });
    }
    t.life_area = OAD.normalizeLifeArea(t.life_area);
    // Backfill days_of_week for cadences created before weekly-days support existed. Harmless
    // for non-cadence threads — same neutral empty-array default OAD.makeThread already gives
    // every thread. life_area normalization above already covers cadences too now that they're
    // just threads (used to be a second, easy-to-miss normalizeLifeArea call here specifically
    // for OAD.DB.cadences, which let 'Finance'/'finances' diverge into apparent duplicates).
    if (!Array.isArray(t.days_of_week)) t.days_of_week = [];
    (t.connections || []).forEach(function (c) {
      if (!c.uuid) c.uuid = OAD._generateUUID();
    });
  });
};

// For threads where the closing condition IS the action (closing_condition_type === 'action'),
// next_action_date is the effective deadline. Backfill deadline from next_action_date for open
// action-type threads with no explicit deadline. Outcome-type threads are left alone — their
// deadline requires explicit user input.
OAD._migrateActionDeadlines = function () {
  var changed = 0;
  (OAD.DB.threads || []).forEach(function (t) {
    if (t.status !== 'closed' &&
        t.deadline == null &&
        t.closing_condition_type === 'action' &&
        t.next_action_date) {
      t.deadline = t.next_action_date;
      changed++;
    }
  });
  return changed;
};

// One-time dedup + status update pass — June 16, 2026 bad import.
// V1 had two bugs: exact title matching (missed several threads) and the
// guard flag was never saved to Supabase because the function returned 0.
// V2 uses fragment-based contains matching, user-specified keep criteria
// (by next_action_date or status), and calls saveDB() unconditionally so
// the guard always persists.
OAD._runJune16DedupV2 = function () {
  if (OAD.DB.persona && OAD.DB.persona._june16DedupV2Done) return 0;

  var deleted = 0, updated = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────
  // Find non-closed threads whose title contains ALL fragments, oldest→newest.
  function find(fragments) {
    return (OAD.DB.threads || [])
      .filter(function (t) {
        return t.status !== 'closed' &&
          fragments.every(function (f) { return t.title && t.title.indexOf(f) !== -1; });
      })
      .sort(function (a, b) { return a.id - b.id; });
  }
  // Same but includes closed threads.
  function findAll(fragments) {
    return (OAD.DB.threads || [])
      .filter(function (t) {
        return fragments.every(function (f) { return t.title && t.title.indexOf(f) !== -1; });
      })
      .sort(function (a, b) { return a.id - b.id; });
  }
  function hardDelete(ids) {
    OAD.DB.threads = (OAD.DB.threads || [])
      .filter(function (t) { return ids.indexOf(t.id) === -1; });
    deleted += ids.length;
  }
  function closeThread(t, note) {
    OAD.updateThread(t.id, { status: 'closed', closing_condition_met: true });
    if (note) OAD.addEvolution(t.id, note);
    updated++;
  }
  function updateThread(t, fields, note) {
    OAD.updateThread(t.id, fields);
    if (note) OAD.addEvolution(t.id, note);
    updated++;
  }
  // Among `matches`, pick keeper by preferred next_action_date, then by
  // preferred status, then fall back to the most recently created (highest id).
  function pickKeeper(matches, prefDate, prefStatus) {
    return matches.find(function (t) { return t.next_action_date === prefDate; }) ||
           matches.find(function (t) { return t.status === prefStatus; }) ||
           matches[matches.length - 1];
  }
  // Keep one thread from `matches`, hard-delete the others.
  function dedupeKeep(matches, keeper) {
    if (!keeper || matches.length <= 1) return;
    hardDelete(matches.filter(function (t) { return t.id !== keeper.id; })
                      .map(function (t) { return t.id; }));
  }

  // ── Tonight's bad import clusters ───────────────────────────────────────

  // SDVOSB Consulting Track: keep the one with next_action_date 2026-06-19
  (function () {
    var m = find(['SDVOSB', 'Consulting Track']);
    var keeper = pickKeeper(m, '2026-06-19', 'open');
    dedupeKeep(m, keeper);
  }());

  // IRS IT Specialist: keep [waiting] one, hard-delete the [open] old draft
  (function () {
    var m = find(['IRS IT Specialist', 'Hyannis']);
    var keeper = pickKeeper(m, '2026-06-17', 'waiting');
    dedupeKeep(m, keeper);
  }());

  // USA Hire Assessment (full title includes IRS thread name):
  // keep the one dated 2026-06-17
  (function () {
    var m = find(['USA Hire Assessment']);
    var keeper = pickKeeper(m, '2026-06-17', 'waiting');
    dedupeKeep(m, keeper);
  }());

  // VR&E Equipment: keep 2026-06-17; update with follow-up note
  (function () {
    var m = find(['VR&E Equipment', 'Amanda']);
    var keeper = pickKeeper(m, '2026-06-17', 'open');
    dedupeKeep(m, keeper);
    if (keeper) {
      var t = (OAD.DB.threads || []).find(function (x) { return x.id === keeper.id; });
      if (t) updateThread(t, { next_action_date: '2026-06-17' },
        'Call Northboro 508-393-1774 June 17 morning if no tracking received.');
    }
  }());

  // Weekly Job Application Cadence: keep 2026-06-17
  (function () {
    var m = find(['Weekly Job Application Cadence']);
    var keeper = pickKeeper(m, '2026-06-17', 'open');
    dedupeKeep(m, keeper);
  }());

  // CSS NOAA: keep the one dated 2026-07-13 and add completion note
  (function () {
    var m = find(['CSS NOAA']);
    var keeper = pickKeeper(m, '2026-07-13', 'open');
    dedupeKeep(m, keeper);
    if (keeper) {
      var t = (OAD.DB.threads || []).find(function (x) { return x.id === keeper.id; });
      if (t) updateThread(t, {},
        'Additional information form completed June 16 ✅. Contingent on contract award. Monitor.');
    }
  }());

  // M/W/F Board Sweep — Job Search: close it (moved to weekly-days cadence)
  (function () {
    find(['M/W/F']).forEach(function (t) {
      closeThread(t, 'Closed — recurring board sweep moved to weekly-days cadence.');
    });
  }());

  // SAM.gov: close any remaining open ones with resolution note
  (function () {
    find(['SAM.gov', 'Legal Business Name']).forEach(function (t) {
      closeThread(t,
        'RESOLVED — SAM.gov ACTIVE June 16, 2026. CAGE 21CK0. UEI H1X6FZB1YFZ2. Renewal June 3, 2027. No further action needed.');
    });
  }());

  // SDVOSB Consulting Track status update (SAM active note)
  (function () {
    var matches = find(['SDVOSB', 'Consulting Track']);
    if (matches.length === 1) {
      updateThread(matches[0], { status: 'open', next_action_date: '2026-06-19' },
        'SAM active ✅ CAGE 21CK0 ✅ CoGS in hand ✅. SBA VetCert started June 16 — blocked on SAM sync delay. Retry Thursday June 19. APEX kickoff June 25.');
    }
  }());

  // ── Pre-existing duplicate clusters ─────────────────────────────────────

  // Jackie (Financial Advisor) — Action Items: keep 1 open, delete others
  (function () {
    var m = find(['Jackie']);
    if (m.length > 1) {
      var keeper = m[m.length - 1]; // newest open
      dedupeKeep(m, keeper);
    }
  }());

  // Plymouth Price Drop cluster: keep newest open "Price Drop" (not the $841K thread)
  // and also keep "Price Drop to $841K" as a separate legitimate thread.
  (function () {
    var cluster = findAll(['Plymouth', 'Price Drop'])
      .filter(function (t) { return t.title && t.title.indexOf('841K') === -1; });
    var open = cluster.filter(function (t) { return t.status !== 'closed'; });
    var closed = cluster.filter(function (t) { return t.status === 'closed'; });
    // Keep newest open; delete older open duplicates
    if (open.length > 1) {
      hardDelete(open.slice(0, open.length - 1).map(function (t) { return t.id; }));
    }
    // Keep only the newest closed copy; delete older closed duplicates
    if (closed.length > 1) {
      hardDelete(closed.slice(0, closed.length - 1).map(function (t) { return t.id; }));
    }
  }());

  // Orpheus Ocean — Cold Outreach to Jake Russell: keep [waiting] next: 2026-06-22
  (function () {
    var m = find(['Orpheus Ocean']);
    var keeper = pickKeeper(m, '2026-06-22', 'waiting');
    dedupeKeep(m, keeper);
  }());

  // Northeastern GIS cluster: keep [open] GIS Graduate Certificate AND
  // [waiting] Northeastern GIS Deferral Resolution; close everything else.
  (function () {
    // Collect all threads in this cluster (open only — closed ones stay closed)
    var seen = {};
    var cluster = find(['Northeastern']).concat(find(['GIS Graduate Certificate']))
      .filter(function (t) {
        if (seen[t.id]) return false;
        seen[t.id] = true;
        return true;
      });

    var keepIds = cluster
      .filter(function (t) {
        return (t.title && (t.title.indexOf('Deferral') !== -1 ||
                            t.title.indexOf('Certificate') !== -1));
      })
      .map(function (t) { return t.id; });

    cluster.forEach(function (t) {
      if (keepIds.indexOf(t.id) === -1) {
        closeThread(t, 'Closed — duplicate, June 16 2026 dedup pass.');
      }
    });
  }());

  // ── Guard: set flag and ALWAYS save so it persists across reloads ────────
  if (OAD.DB.persona) OAD.DB.persona._june16DedupV2Done = true;
  OAD.saveDB(); // writes localStorage + triggers async cloud save
  return deleted + updated;
};

// Two targeted fixes applied after the June 16 dedup pass.
OAD._runJune16PatchV1 = function () {
  if (OAD.DB.persona && OAD.DB.persona._june16PatchV1Done) return;

  // 1. IRS thread: clean up title, set to waiting, add real next action.
  var irsThread = (OAD.DB.threads || []).find(function (t) {
    return t.title && t.title.indexOf('IRS IT Specialist') !== -1 &&
           t.title.indexOf('APPLICATION STARTED') !== -1;
  });
  if (irsThread) {
    OAD.updateThread(irsThread.id, {
      title:            'IRS IT Specialist GS-2210-14 — Hyannis MA',
      status:           'waiting',
      next_action:      'Take USA Hire assessment June 17. Hard deadline June 19 11:59pm ET. Application submitted June 11. Separate USA Hire Assessment thread tracks the assessment itself.',
      next_action_date: '2026-06-17'
    });
    OAD.addEvolution(irsThread.id, 'Title cleaned up June 16 (removed draft bracket). Status → waiting. Application submitted June 11.');
  }

  // 2. SBA VetCert SDVOSB Application: close — rolled into SDVOSB Consulting Track.
  var vetcertThread = (OAD.DB.threads || []).find(function (t) {
    return t.title && t.title.indexOf('SBA VetCert SDVOSB Application') !== -1 &&
           t.status !== 'closed';
  });
  if (vetcertThread) {
    OAD.updateThread(vetcertThread.id, { status: 'closed', closing_condition_met: true });
    OAD.addEvolution(vetcertThread.id, 'Rolled up into SDVOSB Consulting Track — APEX Accelerator + SBA VetCert thread. See that thread for all VetCert status.');
  }

  if (OAD.DB.persona) OAD.DB.persona._june16PatchV1Done = true;
  OAD.saveDB();
};

// July 2 fix: 22 CAC102 assignment/quiz/discussion threads hold a connection back to the
// course completion thread with edge_type missing (null) — invisible to pressure propagation,
// Graph Views, and ADE. Backfills edge_type: 'blocks' (each item blocks the course from being
// considered complete), matched by the connection's own uuid to avoid touching unrelated edges.
// Source: ~/Downloads/cac102_edge_type_fix.json (from the pressure propagation audit).
OAD._CAC102_EDGE_TYPE_FIXES = [
  { edge_uuid: '110f88a3-3f10-4a24-948b-17b30c70fb0a', from_uuid: 'cac102-a01', edge_type: 'blocks' },
  { edge_uuid: '88f2563e-8fd1-4f16-a3f3-b1c539617a95', from_uuid: 'cac102-a02', edge_type: 'blocks' },
  { edge_uuid: '7301a2b5-c2a8-4815-8605-ff819d27ae07', from_uuid: 'cac102-a03', edge_type: 'blocks' },
  { edge_uuid: 'd307b5b4-a535-4d93-9a84-fae0af998ea9', from_uuid: 'cac102-a04', edge_type: 'blocks' },
  { edge_uuid: '7095f3bb-1e7d-4a60-8d44-d00eb4263392', from_uuid: 'cac102-a05', edge_type: 'blocks' },
  { edge_uuid: 'e19b1eb7-6a11-4eaa-a3a0-a6e6debe677c', from_uuid: 'cac102-a06', edge_type: 'blocks' },
  { edge_uuid: '9c87c59d-1594-4ed9-b06b-f9a86bb9bffc', from_uuid: 'cac102-a07', edge_type: 'blocks' },
  { edge_uuid: '04b795b0-5529-4885-9a52-3f188aa9d1a7', from_uuid: 'cac102-a08', edge_type: 'blocks' },
  { edge_uuid: '22179cf0-4bea-44d7-be52-c75f34d24d30', from_uuid: 'cac102-a09', edge_type: 'blocks' },
  { edge_uuid: '4fd19863-9edb-4965-bc65-b5d75cff1d35', from_uuid: 'cac102-a10', edge_type: 'blocks' },
  { edge_uuid: '3c468616-aed2-41a8-aba2-ff3eec20a0d3', from_uuid: 'cac102-a11', edge_type: 'blocks' },
  { edge_uuid: 'eb81fb21-546d-4031-859b-56954cbf6095', from_uuid: 'cac102-a12', edge_type: 'blocks' },
  { edge_uuid: 'ee25e750-fbe0-48a1-9672-db0748c3d818', from_uuid: 'cac102-a13', edge_type: 'blocks' },
  { edge_uuid: 'b6dc960f-51d2-4005-ac94-0dd162ea2cf9', from_uuid: 'cac102-a14', edge_type: 'blocks' },
  { edge_uuid: '5b576d02-d595-4b0a-aa11-d5053eb41eef', from_uuid: 'cac102-disc-01', edge_type: 'blocks' },
  { edge_uuid: '34cfe744-ee7b-4ca6-8425-2d1c3525e287', from_uuid: 'cac102-q01', edge_type: 'blocks' },
  { edge_uuid: '4b85402f-ee75-494f-a720-2251f7af79e9', from_uuid: 'cac102-q02', edge_type: 'blocks' },
  { edge_uuid: '3b8470fa-9e0c-43e0-82c7-2bb9c5d17f42', from_uuid: 'cac102-q03', edge_type: 'blocks' },
  { edge_uuid: '7c225274-795e-4e1b-8e50-da64627211f4', from_uuid: 'cac102-q04', edge_type: 'blocks' },
  { edge_uuid: 'eb00450e-5e67-417b-8ee6-df4c9bc09cfb', from_uuid: 'cac102-q05', edge_type: 'blocks' },
  { edge_uuid: '2c7b9f23-0678-4079-8b9e-6a48643295a9', from_uuid: 'cac102-q06', edge_type: 'blocks' },
  { edge_uuid: '0ac2086f-3737-437c-884a-befc427d94c1', from_uuid: 'cac102-q07', edge_type: 'blocks' }
];

OAD._runJuly2Cac102EdgeTypeFixV1 = function () {
  if (OAD.DB.persona && OAD.DB.persona._july2Cac102EdgeTypeFixV1Done) return 0;

  var fixed = 0;
  OAD._CAC102_EDGE_TYPE_FIXES.forEach(function (fix) {
    var fromThread = (OAD.DB.threads || []).find(function (t) { return t.uuid === fix.from_uuid; });
    if (!fromThread) return;
    var conn = (fromThread.connections || []).find(function (c) { return c.uuid === fix.edge_uuid; });
    if (conn && !conn.edge_type) {
      conn.edge_type = fix.edge_type;
      fixed++;
    }
  });

  if (OAD.DB.persona) OAD.DB.persona._july2Cac102EdgeTypeFixV1Done = true;
  OAD.saveDB();
  return fixed;
};

OAD._DB_PERSIST = false; // set true by _initApp after tests pass; keeps test suite writes out of localStorage
OAD._userId     = null;  // set on successful Supabase sign-in

// ── localStorage (sync, used by tests and as local cache) ──────────────

OAD.isEnterpriseMode = function () {
  const isDemo = window.OAD && window.OAD.Config && window.OAD.Config.demoMode;
  return isDemo || localStorage.getItem('oad_enterprise_mode') === 'true';
};

OAD.saveDB = function () {
  if (!OAD._DB_PERSIST) return Promise.resolve();
  try {
    if (!OAD.isEnterpriseMode()) {
      localStorage.setItem(OAD._DB_KEY, JSON.stringify(OAD.DB));
    } else {
      localStorage.removeItem(OAD._DB_KEY); // Instantly wipe PHI from browser cache
    }
  } catch (e) {
    console.warn('[OAD] saveDB failed:', e);
  }
  // Push to Supabase when authenticated, and return that promise instead of firing-and-forgetting
  // it — per ticket-enterprise-mode-and-load-overview.md Part 4. Existing call sites that don't
  // await this are unaffected (an un-awaited async call behaves exactly as fire-and-forget did);
  // this just lets "done" mean "persisted" for anything that actually needs that guarantee. See
  // _saveToCloud's pending-save tracking below for how a hard refresh under Enterprise Mode (no
  // synchronous local-cache fallback to land on) is protected against racing ahead of this.
  if (OAD.supabase && OAD._userId) return OAD._saveToCloud();
  return Promise.resolve();
};

OAD.loadDB = function () {
  if (OAD.isEnterpriseMode()) {
    if (window.OAD_DEMO_DATA) {
      OAD.DB = window.OAD_DEMO_DATA;
      OAD._normalizeDB();
      return true;
    }
    return false; // Force re-hydration from secure source
  }
  try {
    var raw = localStorage.getItem(OAD._DB_KEY);
    var data = null;
    if (raw) {
      data = JSON.parse(raw);
    } else if (window.OAD_DEMO_DATA) {
      data = window.OAD_DEMO_DATA;
      OAD.DB = data;
      OAD._normalizeDB();
      OAD.saveDB(); // save to localStorage for next time
    }
    if (!data || !Array.isArray(data.threads)) return false;
    OAD.DB = data;
    OAD._normalizeDB();
    return true;
  } catch (e) {
    console.warn('[OAD] loadDB failed:', e);
    return null; // null = corrupt data present (distinct from false = no data)
  }
};

OAD.clearDB = function () {
  localStorage.removeItem(OAD._DB_KEY);
};

// ── Supabase cloud persistence ──────────────────────────────────────────

// Counts cloud saves that haven't resolved yet. Enterprise Mode wipes the local cache on every
// save instead of keeping a synchronous fallback (by design — that's the actual HIPAA protection,
// not a bug to route around), which means a hard refresh has nothing to land on but whatever's
// already committed to Supabase. Before this counter existed, saveDB's cloud push was pure
// fire-and-forget, so a refresh that happened to land mid-save could read back older data than
// what was just on screen, with no signal anything was still in flight. Per
// ticket-enterprise-mode-and-load-overview.md Part 4: a JS await inside this app can't stop a real
// browser reload keystroke, so the actual enforcement point is the beforeunload guard just below —
// turning a silent, undetectable race into a choice the user gets to make.
OAD._pendingCloudSaves = 0;

window.addEventListener('beforeunload', function (e) {
  if (OAD._pendingCloudSaves > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

OAD._saveToCloud = async function () {
  if (OAD._userId && OAD._userId.startsWith('demo-')) return; // bypass mock demo users
  OAD._pendingCloudSaves++;
  try {
    var { error } = await OAD.supabase
      .from('user_data')
      .upsert({ user_id: OAD._userId, db: OAD.DB });
    if (error) console.warn('[OAD] cloud save failed:', error.message);
  } catch (e) {
    console.warn('[OAD] cloud save error:', e);
  } finally {
    OAD._pendingCloudSaves--;
  }
};

OAD._loadFromCloud = async function () {
  if (OAD._userId && OAD._userId.startsWith('demo-')) return false; // bypass mock demo users
  try {
    var { data, error } = await OAD.supabase
      .from('user_data')
      .select('db')
      .eq('user_id', OAD._userId)
      .single();
    if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
      console.warn('[OAD] cloud load failed:', error.message);
      return false;
    }
    if (data && data.db && Array.isArray(data.db.threads)) {
      if (window.OAD && window.OAD.Config && window.OAD.Config.demoMode && data.db.threads.length === 0) {
        console.log('[OAD] Cloud data is empty in demo mode. Forcing re-seed...');
        return false;
      }
      OAD.DB = data.db;
      OAD.DB.lastError = 'LOADED_FROM_CLOUD';
      OAD._normalizeDB();
      // Keep localStorage in sync as local cache
      OAD.saveDB();
      return true;
    }
    return false; // no cloud data yet
  } catch (e) {
    console.warn('[OAD] cloud load error:', e);
    return false;
  }
};

OAD.confirmEdge = function (threadId, edgeUuid) {
  var t = OAD.getThread(threadId);
  if (!t) return;
  var conn = (t.connections || []).find(function (c) { return c.uuid === edgeUuid; });
  if (conn) { conn.confirmed_by_user = true; OAD.saveDB(); }
};

OAD.rejectEdge = function (threadId, edgeUuid) {
  var t = OAD.getThread(threadId);
  if (!t) return;
  var conn = (t.connections || []).find(function (c) { return c.uuid === edgeUuid; });
  if (!conn) return;
  OAD.DB.ade_suppressions = OAD.DB.ade_suppressions || [];
  OAD.DB.ade_suppressions.push({ from_uuid: t.uuid, to_uuid: conn.to_uuid, rule: conn.rule || null });
  t.connections = t.connections.filter(function (c) { return c.uuid !== edgeUuid; });
  OAD.saveDB();
};

// Fetches both course seed files and loads them. Call from console: OAD.importCourseData()
OAD.importCourseData = function () {
  return Promise.all([
    fetch('data/ecornell_cac101_thread_seeds.json').then(function (r) { return r.json(); }),
    fetch('data/env118_thread_seeds.json').then(function (r) { return r.json(); })
  ]).then(function (files) {
    var total = files.reduce(function (sum, arr) { return sum + OAD.bulkImport(arr); }, 0);
    if (typeof OAD.renderList === 'function') OAD.renderList();
    console.log('[OAD] Imported ' + total + ' threads.');
    return total;
  });
};
