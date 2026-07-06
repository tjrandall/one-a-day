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

OAD.STATUSES   = ['inbox', 'open', 'waiting', 'dormant', 'stalled', 'closed'];
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
OAD.getVisibleThreads = function() {
  let threads = OAD.DB.threads || [];
  if (OAD.Config && OAD.Config.demoMode && OAD._demoRole) {
    if (OAD._demoRole.startsWith('Counselor')) {
      const validPatientUuids = threads
        .filter(t => t.life_area === 'Patient' && t.metadata && t.metadata.counselor === OAD._demoRole)
        .map(t => t.uuid);
      
      threads = threads.filter(t => {
        if (t.life_area === 'Counselor' && t.metadata && t.metadata.counselor === OAD._demoRole) return true;
        if (t.parent_uuid && validPatientUuids.includes(t.parent_uuid) && t.life_area === 'Counselor') return true;
        return false;
      });
    } else if (OAD._demoRole.includes('Director')) {
      const clinicalAreas = ['Director', 'Counselor', 'Patient', 'Case Manager', 'Medical', 'RA', 'Transportation'];
      threads = threads.filter(t => clinicalAreas.includes(t.life_area));
    } else if (OAD._demoRole === 'RA') {
      threads = threads.filter(t => t.life_area === 'RA');
    } else if (OAD._demoRole === 'Case Manager') {
      threads = threads.filter(t => t.life_area === 'Case Manager');
    } else if (OAD._demoRole === 'Medical') {
      threads = threads.filter(t => t.life_area === 'Medical');
    }
  }
  return threads;
};

OAD.getVisibleCadences = function() {
  let cadences = OAD.DB.cadences || [];
  if (OAD.Config && OAD.Config.demoMode && OAD._demoRole) {
    if (OAD._demoRole.startsWith('Counselor')) {
      cadences = cadences.filter(c => c.metadata && c.metadata.counselor === OAD._demoRole);
    } else if (OAD._demoRole === 'Director Alpha') {
      cadences = cadences.filter(c => c.metadata && ['Counselor 1','Counselor 2','Counselor 3','Counselor 4','Counselor 5','Counselor 6','Counselor 7','Counselor 8','Counselor 9','Counselor 10'].includes(c.metadata.counselor));
    }
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

OAD.updateThread = function (id, patch) {
  const t = OAD.getThread(id);
  if (!t) return null;
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
  const reprompt = new Date();
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
  t.evolution_log.push({ date: new Date().toISOString().slice(0, 10), note });
  OAD.saveDB();
};

OAD.addInsight = function (id, insight) {
  const t = OAD.getThread(id);
  if (!t) return;
  t.ai_insights.push(insight);
  OAD.DB.persona.counsel_history.push({
    thread_id: id,
    thread_title: t.title,
    insight,
    date: new Date().toISOString().slice(0, 10)
  });
  OAD.saveDB();
};

OAD.makeThread = function (overrides) {
  return Object.assign({
    uuid: OAD._generateUUID(), // stable identifier — used for export/import matching
    id: null,
    created_at: new Date().toISOString(),
    title: '',
    life_area: 'Other',
    status: 'open',
    priority: 'medium',
    closing_condition: '',
    closing_condition_type: 'outcome',
    closing_condition_met: false,
    current_assumption: '',
    assumption_verified: false,
    next_action: '',
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
    runway_ack_until: null // Runway Risk snooze — ISO date; suppressed from banner/card until this date passes
  }, overrides);
};

OAD.nextCadenceId = function () {
  const ids = OAD.DB.cadences.map(function (c) { return c.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.makeCadence = function (overrides) {
  return Object.assign({
    id: null,
    title: '',
    life_area: 'finances',
    recurrence: 'monthly-1st',
    days_of_week: [],
    last_completed: null,
    next_due: null,
    notes: '',
    consequences: ''
  }, overrides);
};

OAD.addCadence = function (cadence) {
  cadence.id = OAD.nextCadenceId();
  cadence.life_area = OAD.normalizeLifeArea(cadence.life_area);
  OAD.DB.cadences.push(cadence);
  OAD.saveDB();
  return cadence;
};

OAD.getCadence = function (id) {
  return OAD.DB.cadences.find(function (c) { return c.id === id; }) || null;
};

OAD.updateCadence = function (id, patch) {
  const c = OAD.getCadence(id);
  if (!c) return null;
  Object.assign(c, patch);
  c.life_area = OAD.normalizeLifeArea(c.life_area);
  OAD.saveDB();
  return c;
};

OAD.deleteCadence = function (id) {
  const idx = OAD.DB.cadences.findIndex(function (c) { return c.id === id; });
  if (idx === -1) return false;
  OAD.DB.cadences.splice(idx, 1);
  OAD.saveDB();
  return true;
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

OAD.makeHabit = function (overrides) {
  return Object.assign({
    id: null,
    title: '',
    life_area: 'Personal Growth',
    frequency: 'daily',       // daily | weekly | every-other-day | custom
    time_of_day: 'morning',   // morning | evening | flexible
    current_streak: 0,
    longest_streak: 0,
    last_checked_in: null,    // ISO date string
    last_check_in_done: null, // boolean — true=yes, false=no
    last_check_in_note: '',
    phase: 'active',          // active | check-in | dormant
    why: ''
  }, overrides);
};

OAD.nextHabitId = function () {
  const ids = OAD.DB.habits.map(function (h) { return h.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.addHabit = function (habit) {
  habit.id = OAD.nextHabitId();
  OAD.DB.habits.push(habit);
  OAD.saveDB();
  return habit;
};

OAD.getHabit = function (id) {
  return OAD.DB.habits.find(function (h) { return h.id === id; }) || null;
};

OAD.updateHabit = function (id, patch) {
  const h = OAD.getHabit(id);
  if (!h) return null;
  Object.assign(h, patch);
  OAD.saveDB();
  return h;
};

OAD.checkInHabit = function (id, done, note) {
  const h = OAD.getHabit(id);
  if (!h) return null;
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const alreadyToday = h.last_checked_in === today;

  if (done) {
    if (!alreadyToday) {
      if (h.last_checked_in === yesterday && h.last_check_in_done) {
        h.current_streak = (h.current_streak || 0) + 1;
      } else {
        h.current_streak = 1;
      }
    } else if (!h.last_check_in_done) {
      // Was no today, flipping to yes — restart from 1
      h.current_streak = 1;
    }
    // Already yes today → streak unchanged
    h.longest_streak = Math.max(h.longest_streak || 0, h.current_streak);
  } else {
    if (alreadyToday && h.last_check_in_done) {
      // Flipping yes→no today — undo the increment
      h.current_streak = Math.max(0, (h.current_streak || 0) - 1);
    } else if (!alreadyToday) {
      h.current_streak = 0;
    }
    // Already no today → no change
  }

  h.last_checked_in    = today;
  h.last_check_in_done = done;
  h.last_check_in_note = note != null ? note : '';
  OAD.saveDB();
  return h;
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
    const cadenceRows        = Array.isArray(parsed.cadences)              ? parsed.cadences              : [];
    const deletedCadenceIds  = Array.isArray(parsed.deleted_cadence_ids)   ? parsed.deleted_cadence_ids   : [];
    const results = { create: [], update: [], close: [], invalid: [], edges: importEdges, deletedEdgeUuids: deletedEdgeUuids };

    // Cadences match on `id` — their real, stable identifier (cadences have no uuid field,
    // unlike threads). A row with no id (or an id not found locally) is a new cadence, same
    // rule as threads: never fabricate an identity that isn't already real.
    const cadences = { create: [], update: [], invalid: [], delete: [] };
    cadenceRows.forEach(function (row) {
      if (!row.title || typeof row.title !== 'string') {
        cadences.invalid.push(row);
        return;
      }
      var existingCadence = (row.id != null) ? OAD.getCadence(row.id) : null;
      if (existingCadence) {
        cadences.update.push({ incoming: row, existing: existingCadence });
      } else {
        cadences.create.push(row);
      }
    });
    // Cadences are permanently removed (spliced), unlike threads which are closed —
    // there's no "reopen a deleted cadence" concept — so this is a real deletion,
    // and the preview step requires explicit per-row confirmation same as updates.
    deletedCadenceIds.forEach(function (id) {
      const existing = OAD.getCadence(id);
      if (existing) cadences.delete.push(existing);
    });
    results.cadences = cadences;
    // Collect threads to close from deleted_uuids
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
  'status', 'priority', 'life_area',
  'closing_condition', 'closing_condition_type', 'closing_condition_met',
  'current_assumption', 'assumption_verified',
  'next_action', 'next_action_date', 'next_action_time', 'next_action_channel', 'next_action_contact',
  'contingency_trigger_date', 'contingency_action', 'contingency_escalation',
  'deadline', 'deadline_time', 'effortEstimate', 'weeklyCommitment', 'effortLogged',
  'lead_time_days', 'connections', 'parent_uuid', 'date_push_count', 'metadata',
  'dormant_trigger', 'user_action_complete'
];

// Fields synced on cadence import — mirrors makeCadence's full shape (data.js:280-292)
OAD._CADENCE_IMPORT_FIELDS = [
  'title', 'life_area', 'recurrence', 'days_of_week', 'last_completed', 'next_due', 'notes', 'consequences'
];

OAD.applyImport = function (results, confirmedUpdates, confirmedCadenceUpdates, confirmedCadenceDeletes) {
  var created = 0, updated = 0, closed = 0;
  var cadencesCreated = 0, cadencesUpdated = 0, cadencesDeleted = 0;

  // Close threads flagged in deleted_uuids
  (results.close || []).forEach(function (existing) {
    OAD.updateThread(existing.id, { status: 'closed', closing_condition_met: true });
    OAD.addEvolution(existing.id, 'Closed via import sync.');
    closed++;
  });

  (results.create || []).forEach(function (row) {
    const t = OAD.makeThread({
      uuid:                     row.uuid || OAD._generateUUID(),
      title:                    row.title,
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
      user_action_complete:     row.user_action_complete     || false
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

  // Merge top-level edges — skips duplicates (matched by edge UUID or same from/to/type)
  var edgesMerged = 0;
  (results.edges || []).forEach(function (edge) {
    if (!edge.from_uuid || !edge.to_uuid) return;
    var fromThread = OAD.getThreadByUUID(edge.from_uuid);
    if (!fromThread) return;
    fromThread.connections = fromThread.connections || [];
    var alreadyExists = fromThread.connections.some(function (c) {
      return (c.uuid && c.uuid === edge.id) ||
             (c.to_uuid === edge.to_uuid && c.edge_type === edge.label);
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

  ((results.cadences && results.cadences.create) || []).forEach(function (row) {
    OAD.addCadence(OAD.makeCadence({
      title:          row.title,
      life_area:      row.life_area      || 'finances',
      recurrence:     row.recurrence     || 'monthly-1st',
      days_of_week:   row.days_of_week   || [],
      last_completed: row.last_completed || null,
      next_due:       row.next_due       || null,
      notes:          row.notes          || '',
      consequences:   row.consequences   || ''
    }));
    cadencesCreated++;
  });

  (confirmedCadenceUpdates || []).forEach(function (item) {
    const existing = OAD.getCadence(item.incoming.id) || item.existing;
    const row      = item.incoming;
    const patch    = {};
    OAD._CADENCE_IMPORT_FIELDS.forEach(function (field) {
      if (row[field] !== undefined && JSON.stringify(row[field]) !== JSON.stringify(existing[field])) {
        patch[field] = row[field];
      }
    });
    if (Object.keys(patch).length) OAD.updateCadence(existing.id, patch);
    cadencesUpdated++;
  });

  (confirmedCadenceDeletes || []).forEach(function (existing) {
    if (OAD.getCadence(existing.id)) {
      OAD.deleteCadence(existing.id);
      cadencesDeleted++;
    }
  });

  OAD.saveDB();
  return {
    created: created, updated: updated, closed: closed, edges_merged: edgesMerged,
    cadences_created: cadencesCreated, cadences_updated: cadencesUpdated, cadences_deleted: cadencesDeleted
  };
};

OAD.getDailyToat = function () {
  const todayStr = new Date().toISOString().slice(0, 10);
  OAD.DB.toat = OAD.DB.toat || [];

  function isFriction(t) {
    if (!t || t.status === 'closed' || t.status === 'dormant') return false;
    if (t.status === 'stalled') return true;
    if (t.status === 'waiting' && OAD.isActionOverdue(t)) return true;
    if (t.status === 'open' && OAD.isActionOverdue(t)) return true;
    return false;
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
  
  const stalled = allThreads.filter(t => t.status === 'stalled');
  const overdueWaiting = allThreads.filter(t => {
    return t.status === 'waiting' && !t.user_action_complete && OAD.isActionOverdue(t);
  });
  const overdueOpen = allThreads.filter(t => {
    return t.status === 'open' && OAD.isActionOverdue(t);
  });

  let selected = null;
  if (stalled.length > 0) {
    stalled.sort((a, b) => a.id - b.id);
    selected = stalled[0];
  } else if (overdueOpen.length > 0) {
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
      title:                    t.title,
      status:                   t.status,
      priority:                 t.priority,
      life_area:                t.life_area,
      pressure:                 OAD.pressure(t),
      closing_condition:        t.closing_condition        || '',
      closing_condition_type:   t.closing_condition_type   || 'outcome',
      closing_condition_met:    t.closing_condition_met    || false,
      assumption_verified:      t.assumption_verified      || false,
      next_action:              t.next_action              || '',
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

  // Cadences are a function of threads, not a parallel system — Export/Import's "ground
  // truth for all threads, no exceptions" promise has to actually cover them too.
  const cadences = (OAD.DB.cadences || []).map(function (c) {
    return {
      id:             c.id,
      title:          c.title,
      life_area:      c.life_area,
      recurrence:     c.recurrence,
      days_of_week:   c.days_of_week   || [],
      last_completed: c.last_completed || null,
      next_due:       c.next_due       || null,
      notes:          c.notes          || '',
      consequences:   c.consequences   || ''
    };
  });

  return JSON.stringify({
    exported_at:        new Date().toISOString(),
    exported_by:        OAD._userId || 'local',
    thread_count:       threads.length,
    edge_count:         edges.length,
    cadence_count:      cadences.length,
    note:               'Export includes thread data, graph edges, and cadences. Evolution history, AI insights, and persona data are omitted.',
    threads:            threads,
    edges:              edges,
    cadences:           cadences,
    deleted_edge_uuids: []
  }, null, 2);
};

// ── Idea data model ───────────────────────────────────────────────────

OAD.makeIdea = function (overrides) {
  return Object.assign({
    id:             null,
    title:          '',
    notes:          '',
    source:         '',
    added_date:     new Date().toISOString().slice(0, 10),
    last_surfaced:  null,
    type:           'other',   // book | article | creative | project-seed | other
    energy_required: 'medium', // low | medium | high
    tags:           []
  }, overrides);
};

OAD.nextIdeaId = function () {
  const ids = OAD.DB.ideas.map(function (i) { return i.id; });
  return ids.length ? Math.max.apply(null, ids) + 1 : 1;
};

OAD.addIdea = function (idea) {
  idea.id = OAD.nextIdeaId();
  OAD.DB.ideas.push(idea);
  OAD.saveDB();
  return idea;
};

OAD.getIdea = function (id) {
  return OAD.DB.ideas.find(function (i) { return i.id === id; }) || null;
};

OAD.updateIdea = function (id, patch) {
  const idea = OAD.getIdea(id);
  if (!idea) return null;
  Object.assign(idea, patch);
  OAD.saveDB();
  return idea;
};

OAD.deleteIdea = function (id) {
  const idx = OAD.DB.ideas.findIndex(function (i) { return i.id === id; });
  if (idx === -1) return false;
  OAD.DB.ideas.splice(idx, 1);
  OAD.saveDB();
  return true;
};
OAD.getProposal = function (uuid) {
  return OAD.DB.proposals.find(function (p) { return p.uuid === uuid; }) || null;
};

OAD.acceptProposal = function (uuid) {
  const p = OAD.getProposal(uuid);
  if (!p) return null;
  OAD.DB.proposals = OAD.DB.proposals.filter(function (x) { return x.uuid !== uuid; });
  const thread = OAD.addThread(OAD.makeThread({
    title: p.title,
    life_area: p.life_area,
    closing_condition: p.closing_condition,
    priority: 'medium',
    status: 'open'
  }));
  OAD.addEvolution(thread.id, 'Created from AI Proposal: ' + p.rationale);
  OAD.saveDB();
  return thread;
};

OAD.rejectProposal = function (uuid) {
  OAD.DB.proposals = OAD.DB.proposals.filter(function (x) { return x.uuid !== uuid; });
  OAD.saveDB();
};


// Returns the same idea all week, cycling through the list week-over-week.
OAD.ideaOfTheWeek = function () {
  const ideas = OAD.DB.ideas || [];
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
  let _maxId = 0;
  OAD.DB.threads.forEach(function(t) { if (t.id && t.id > _maxId) _maxId = t.id; });
  // Backfill UUIDs, parent_uuid, date_push_count, connection UUIDs, life area, null titles
  OAD.DB.threads.forEach(function (t) {
    if (!t.id) { _maxId++; t.id = _maxId; }
    if (!t.uuid) t.uuid = OAD._generateUUID();
    if (!t.title) t.title = '';
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
    if (!Object.prototype.hasOwnProperty.call(t, 'next_action_time')) t.next_action_time = null;
    if (!Object.prototype.hasOwnProperty.call(t, 'deadline_time')) t.deadline_time = null;
    t.life_area = OAD.normalizeLifeArea(t.life_area);
    (t.connections || []).forEach(function (c) {
      if (!c.uuid) c.uuid = OAD._generateUUID();
    });
  });
  // Backfill days_of_week for cadences created before weekly-days support existed,
  // and normalize life_area the same way threads already do (cadences were missed
  // originally, which let 'Finance'/'finances' diverge into apparent duplicates).
  OAD.DB.cadences.forEach(function (c) {
    if (!Array.isArray(c.days_of_week)) c.days_of_week = [];
    c.life_area = OAD.normalizeLifeArea(c.life_area);
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
  if (!OAD._DB_PERSIST) return;
  try {
    if (!OAD.isEnterpriseMode()) {
      localStorage.setItem(OAD._DB_KEY, JSON.stringify(OAD.DB));
    } else {
      localStorage.removeItem(OAD._DB_KEY); // Instantly wipe PHI from browser cache
    }
  } catch (e) {
    console.warn('[OAD] saveDB failed:', e);
  }
  // Also push to Supabase when authenticated (fire and forget)
  if (OAD.supabase && OAD._userId) OAD._saveToCloud();
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

OAD._saveToCloud = async function () {
  if (OAD._userId && OAD._userId.startsWith('demo-')) return; // bypass mock demo users
  try {
    var { error } = await OAD.supabase
      .from('user_data')
      .upsert({ user_id: OAD._userId, db: OAD.DB });
    if (error) console.warn('[OAD] cloud save failed:', error.message);
  } catch (e) {
    console.warn('[OAD] cloud save error:', e);
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
