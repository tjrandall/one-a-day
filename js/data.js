window.OAD = window.OAD || {};

OAD.DB = {
  threads: [],
  cadences: [],
  habits: [],
  ideas: [],
  proposals: [],

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

OAD.LIFE_AREAS = [
  'Career', 'Health', 'Finance', 'Relationships',
  'Education', 'Housing', 'Legal', 'Personal Growth', 'App Dev', 'Other'
];

OAD.RECURRENCES = [
  'monthly-1st', 'monthly-15th', 'monthly-last', 'weekly', 'weekly-days', 'custom'
];

OAD.STATUSES   = ['open', 'waiting', 'stalled', 'closed'];
OAD.PRIORITIES = ['critical', 'high', 'medium', 'low'];
OAD.EDGE_TYPES = ['blocks', 'enables', 'relates'];

OAD.CLOSING_TYPES = ['outcome', 'action'];

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

OAD.addThread = function (thread) {
  thread.id = OAD.nextId();
  thread.evolution_log  = thread.evolution_log  || [];
  thread.ai_insights    = thread.ai_insights    || [];
  thread.connections    = thread.connections    || [];
  OAD.DB.threads.push(thread);
  OAD.saveDB();
  return thread;
};

OAD.updateThread = function (id, patch) {
  const t = OAD.getThread(id);
  if (!t) return null;
  Object.assign(t, patch);
  OAD.saveDB();
  return t;
};

OAD.deleteThread = function (id) {
  const idx = OAD.DB.threads.findIndex(t => t.id === id);
  if (idx === -1) return false;
  OAD.DB.threads.splice(idx, 1);
  OAD.saveDB();
  return true;
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
    next_action_channel: '',
    next_action_contact: '',
    contingency_trigger_date: '',
    contingency_action: '',
    contingency_escalation: '',
    deadline: null,
    effortEstimate: null,
    weeklyCommitment: null,
    effortLogged: 0,
    connections: [],
    parent_uuid: null,
    evolution_log: [],
    ai_insights: []
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

// Maps the camelCase JSON seed schema to the snake_case thread model.
// Accepts "task" as a closing_condition_type alias for "action".
OAD.bulkImport = function (arr) {
  var CLOSING_TYPE = { task: 'action', outcome: 'outcome', action: 'action' };
  var count = 0;
  arr.forEach(function (r) {
    OAD.addThread(OAD.makeThread({
      title:                    r.title                || r.title                || '',
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

// ── Moat-safe export ─────────────────────────────────────────────────
// Exports surface-level thread data only. Deliberately excludes:
//   connections[] — the dependency graph is the product moat
//   current_assumption / assumption_verified — assumption audit trail
//   ai_insights[] — counsel engine history
//   persona data — behavioral profile
// Safe to share without leaking proprietary architecture.
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
    const deletedUuids = Array.isArray(parsed.deleted_uuids) ? parsed.deleted_uuids : [];
    const results = { create: [], update: [], close: [], invalid: [] };
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
  'next_action', 'next_action_date', 'next_action_channel', 'next_action_contact',
  'contingency_trigger_date', 'contingency_action', 'contingency_escalation',
  'deadline', 'effortEstimate', 'weeklyCommitment', 'effortLogged',
  'connections', 'parent_uuid'
];

OAD.applyImport = function (results, confirmedUpdates) {
  var created = 0, updated = 0, closed = 0;

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
      next_action_channel:      row.next_action_channel      || '',
      next_action_contact:      row.next_action_contact      || '',
      contingency_trigger_date: row.contingency_trigger_date || '',
      contingency_action:       row.contingency_action       || '',
      contingency_escalation:   row.contingency_escalation   || '',
      deadline:                 row.deadline                 || null,
      effortEstimate:           row.effortEstimate           || null,
      weeklyCommitment:         row.weeklyCommitment         || null,
      effortLogged:             row.effortLogged             || 0,
      connections:              row.connections              || []
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

  OAD.saveDB();
  return { created: created, updated: updated, closed: closed };
};

OAD.exportThreads = function () {
  // Ensure UUIDs and parent_uuid are assigned before building the export.
  OAD._normalizeDB();
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
      current_assumption:       t.current_assumption       || '',
      assumption_verified:      t.assumption_verified      || false,
      next_action:              t.next_action              || '',
      next_action_date:         t.next_action_date         || '',
      next_action_channel:      t.next_action_channel      || '',
      next_action_contact:      t.next_action_contact      || '',
      contingency_trigger_date: t.contingency_trigger_date || '',
      contingency_action:       t.contingency_action       || '',
      contingency_escalation:   t.contingency_escalation   || '',
      deadline:                 t.deadline                 || null,
      effortEstimate:           t.effortEstimate           || null,
      weeklyCommitment:         t.weeklyCommitment         || null,
      effortLogged:             t.effortLogged             || 0,
      connections:              (t.connections || []).map(function (c) {
        return { to_uuid: c.to_uuid || null, to_label: c.to_label || '', edge_type: c.edge_type, is_suggested: c.is_suggested || false };
      }),
      evolution_log:            (t.evolution_log || []).map(function (e) {
        return { date: e.date, note: e.note };
      })
    };
  });

  return JSON.stringify({
    exported_at:   new Date().toISOString(),
    exported_by:   OAD._userId || 'local',
    thread_count:  threads.length,
    note:          'Full export: includes graph edges, assumptions, and deadline data. AI insights and persona excluded.',
    threads:       threads
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
  OAD.DB.threads  = OAD.DB.threads  || [];
  OAD.DB.cadences = OAD.DB.cadences || [];
  OAD.DB.habits   = OAD.DB.habits   || [];
  OAD.DB.ideas    = OAD.DB.ideas    || [];
  OAD.DB.proposals = OAD.DB.proposals || [];
  // Backfill UUIDs and parent_uuid for threads created before these fields existed
  OAD.DB.threads.forEach(function (t) {
    if (!t.uuid) t.uuid = OAD._generateUUID();
    if (!Object.prototype.hasOwnProperty.call(t, 'parent_uuid')) t.parent_uuid = null;
  });
  // Backfill days_of_week for cadences created before weekly-days support existed
  OAD.DB.cadences.forEach(function (c) {
    if (!Array.isArray(c.days_of_week)) c.days_of_week = [];
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

// One-time dedup + status update pass for the June 16, 2026 bad import.
// A broken import (rows with no UUID) created duplicates for ~14 threads.
// Guard: OAD.DB.persona._june16DedupDone prevents re-running.
// Returns the number of threads deleted + updated.
OAD._runJune16Dedup = function () {
  if (OAD.DB.persona && OAD.DB.persona._june16DedupDone) return 0;

  var deleted = 0, updated = 0;

  // ── Helpers ───────────────────────────────────────────────────────────
  // Return all threads with an exact title match, sorted oldest → newest (by id).
  function allByTitle(title) {
    return (OAD.DB.threads || [])
      .filter(function (t) { return t.title === title; })
      .sort(function (a, b) { return a.id - b.id; });
  }
  // Return only non-closed threads with exact title match, oldest → newest.
  function openByTitle(title) {
    return allByTitle(title).filter(function (t) { return t.status !== 'closed'; });
  }
  // Hard-delete threads by id list.
  function deleteIds(ids) {
    OAD.DB.threads = (OAD.DB.threads || []).filter(function (t) {
      return ids.indexOf(t.id) === -1;
    });
    deleted += ids.length;
  }
  // Close a thread and add an evolution note.
  function closeThread(thread, note) {
    OAD.updateThread(thread.id, { status: 'closed', closing_condition_met: true });
    OAD.addEvolution(thread.id, note);
    updated++;
  }
  // Update fields and add an evolution note.
  function updateThread(thread, fields, note) {
    OAD.updateThread(thread.id, fields);
    if (note) OAD.addEvolution(thread.id, note);
    updated++;
  }

  // ── Tonight's bad import: keep OLDEST open thread, delete newer duplicates ──

  var keepOldestTitles = [
    'Weekly Job Application Cadence — 3/Week Unemployment Compliance',
    'Plymouth 18 Remington Ln — Price Drop',
    'IRS IT Specialist GS-2210-14 — Hyannis',
    'USA Hire Assessment',
  ];
  keepOldestTitles.forEach(function (title) {
    var dupes = openByTitle(title);
    if (dupes.length > 1) {
      deleteIds(dupes.slice(1).map(function (t) { return t.id; }));
    }
  });

  // M/W/F — keep oldest open, delete newer, then close it (moved to Cadence)
  (function () {
    var title = 'M/W/F Job Board Sweep — Master Company List';
    var dupes = openByTitle(title);
    if (dupes.length > 1) deleteIds(dupes.slice(1).map(function (t) { return t.id; }));
    var t = openByTitle(title)[0] || allByTitle(title)[0];
    if (t && t.status !== 'closed') {
      closeThread(t, 'Moved to Cadence — weekly-days Mon/Wed/Fri.');
    }
  }());

  // VR&E Equipment — keep oldest open, delete newer, then update
  (function () {
    var title = 'VR&E Equipment (Amanda)';
    var dupes = openByTitle(title);
    if (dupes.length > 1) deleteIds(dupes.slice(1).map(function (t) { return t.id; }));
    var t = openByTitle(title)[0];
    if (t) {
      updateThread(t,
        { next_action_date: '2026-06-17' },
        'Call Northboro 508-393-1774 June 17 morning if no tracking received.'
      );
    }
  }());

  // CSS NOAA — keep oldest open, delete newer, then add note
  (function () {
    var title = 'CSS NOAA Coastal Management Specialist';
    var dupes = openByTitle(title);
    if (dupes.length > 1) deleteIds(dupes.slice(1).map(function (t) { return t.id; }));
    var t = openByTitle(title)[0];
    if (t) {
      updateThread(t, {},
        'Additional information form completed June 16 ✅. Contingent on contract award. Monitor.'
      );
    }
  }());

  // SAM.gov — CLOSE the OLD open thread; the newer closed one from tonight's import is correct.
  (function () {
    var title = 'SAM.gov Legal Business Name Correction';
    var openThreads = openByTitle(title);
    openThreads.forEach(function (t) {
      closeThread(t,
        'RESOLVED — SAM.gov ACTIVE June 16, 2026. CAGE 21CK0. UEI H1X6FZB1YFZ2. Renewal June 3, 2027. No further action needed.'
      );
    });
  }());

  // IRS IT Specialist — update to waiting + USA Hire note
  (function () {
    var title = 'IRS IT Specialist GS-2210-14 — Hyannis';
    var t = openByTitle(title)[0];
    if (t) {
      updateThread(t,
        { status: 'waiting' },
        'SUBMITTED June 11. USA Hire: practice tests done June 16 (Reasoning/Judgment/Reading/Interaction). Take real assessment June 17. HARD DEADLINE June 19 11:59pm ET.'
      );
    }
  }());

  // SDVOSB Consulting Track — status update
  (function () {
    var matches = (OAD.DB.threads || []).filter(function (t) {
      return t.title && t.title.indexOf('SDVOSB') !== -1 && t.title.indexOf('Consulting Track') !== -1 && t.status !== 'closed';
    });
    if (matches.length) {
      updateThread(matches[0],
        { status: 'open', next_action_date: '2026-06-19' },
        'SAM active ✅ CAGE 21CK0 ✅ CoGS in hand ✅. SBA VetCert started June 16 — blocked on SAM sync delay. Retry Thursday June 19. APEX kickoff June 25.'
      );
    }
  }());

  // ── Pre-existing duplicate clusters: keep most-recent open, delete the rest ──

  var dedupeByNewest = [
    'Jackie',                // partial — matches any thread title containing "Jackie"
    'Northeastern GIS',
    'Orpheus Ocean',
  ];
  dedupeByNewest.forEach(function (fragment) {
    // Group all threads whose titles contain this fragment, open ones only
    var matches = (OAD.DB.threads || [])
      .filter(function (t) { return t.title && t.title.indexOf(fragment) !== -1 && t.status !== 'closed'; })
      .sort(function (a, b) { return b.id - a.id; }); // newest first
    if (matches.length > 1) {
      // Keep newest (highest id), delete the rest
      deleteIds(matches.slice(1).map(function (t) { return t.id; }));
    }
  });

  // Plymouth Price Drop — already partially handled above (keepOldest), but pre-existing
  // cluster may have many closed copies too. Delete all closed duplicates, keep one open.
  (function () {
    var fragment = 'Plymouth';
    var all = (OAD.DB.threads || [])
      .filter(function (t) { return t.title && t.title.indexOf(fragment) !== -1 && t.title.indexOf('Price Drop') !== -1; })
      .sort(function (a, b) { return b.id - a.id; });
    var open = all.filter(function (t) { return t.status !== 'closed'; });
    var closed = all.filter(function (t) { return t.status === 'closed'; });
    // Keep newest open (already done above), and keep only the newest closed copy
    if (open.length > 1) deleteIds(open.slice(1).map(function (t) { return t.id; }));
    if (closed.length > 1) deleteIds(closed.slice(1).map(function (t) { return t.id; }));
  }());

  // Mark done and save
  if (OAD.DB.persona) OAD.DB.persona._june16DedupDone = true;
  return deleted + updated;
};
OAD._DB_PERSIST = false; // set true by _initApp after tests pass; keeps test suite writes out of localStorage
OAD._userId     = null;  // set on successful Supabase sign-in

// ── localStorage (sync, used by tests and as local cache) ──────────────

OAD.saveDB = function () {
  if (!OAD._DB_PERSIST) return;
  try {
    localStorage.setItem(OAD._DB_KEY, JSON.stringify(OAD.DB));
  } catch (e) {
    console.warn('[OAD] saveDB failed:', e);
  }
  // Also push to Supabase when authenticated (fire and forget)
  if (OAD.supabase && OAD._userId) OAD._saveToCloud();
};

OAD.loadDB = function () {
  try {
    var raw = localStorage.getItem(OAD._DB_KEY);
    if (!raw) return false;
    var data = JSON.parse(raw);
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
      OAD.DB = data.db;
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
