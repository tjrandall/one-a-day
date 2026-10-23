window.OAD = window.OAD || {};
OAD.Bulk = {};

// ── Bulk update, Catch Up, and Park/Reactivate Bollard ───────────────────────────────────────
// Origin: T.J., Oct 23 2026: "once I get behind, the task/thread list is overwhelming" - the
// failure mode of every TODO app he has abandoned. Three tools, all operating on existing Thread
// fields only (ARCHITECTURE_RULES.md Rule 1, no new top-level model):
//
//   1. OAD.Bulk.apply(uuids, op)   - one change across many threads, guarded by the buffer and
//                                    bollard rules, logged per thread, undoable once.
//   2. OAD.Bulk.catchUpQueue(now)  - the threads that are genuinely behind, worked one at a time
//                                    (Done / New date / Park / Drop) instead of as a wall.
//   3. OAD.Bulk.parkBollard / reactivateBollard - a life shift ("RAG is on hold") parks a whole
//                                    parent thread and its open descendants in one step, and
//                                    brings back exactly those threads later, nothing else.
//
// Park state lives in fields that already exist and already round-trip through export/import
// (_IMPORT_FIELDS includes status, dormant_trigger, metadata):
//   bollard:  metadata.parked_bollard = true, metadata.parked_prior_status, metadata.parked_prior_dormant_trigger
//   children: metadata.parked_by = <bollard uuid>, metadata.parked_prior_status, metadata.parked_prior_dormant_trigger
//
// Undo is in-memory for the session only (OAD.Bulk._lastBatch). Persisting it would need a new
// top-level array, which Rule 2 says needs written justification; a one-step session undo does not.
//
// Writes go straight to the thread objects with ONE saveDB() at the end of a batch, not one
// OAD.updateThread() per thread: updateThread saves the whole DB (localStorage + cloud upsert) on
// every call, so a 40-thread batch would fire 40 full cloud writes. The only thing updateThread
// adds that matters here is _runAfterSave, which is still called per thread. Its other side
// effects (next_action_updated_at / current_assumption_updated_at stamping, inbox->open on
// reparent) are for fields this module never writes.

OAD.Bulk._lastBatch = null;

OAD.Bulk._SNAPSHOT_FIELDS = [
  'status', 'next_action_date', 'priority', 'dormant_trigger',
  'date_push_count', 'closing_condition_met', 'user_action_complete'
];

OAD.Bulk._addDays = function (dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

OAD.Bulk._snapshot = function (t) {
  var snap = {};
  OAD.Bulk._SNAPSHOT_FIELDS.forEach(function (f) { snap[f] = t[f]; });
  snap.metadata = JSON.parse(JSON.stringify(t.metadata || {}));
  return snap;
};

OAD.Bulk._log = function (t, note) {
  t.evolution_log = t.evolution_log || [];
  t.evolution_log.push({ date: OAD.todayStr(), note: note });
};

OAD.Bulk._openChildren = function (t) {
  return (OAD.DB.threads || []).filter(function (x) {
    return x.parent_uuid === t.uuid && x.status !== 'closed';
  });
};

// All descendants via parent_uuid, any depth. Cycle-safe (a bad parent_uuid loop in imported
// data must not hang the UI).
OAD.Bulk.descendants = function (uuid) {
  var out = [];
  var seen = {}; seen[uuid] = true;
  var frontier = [uuid];
  while (frontier.length) {
    var next = [];
    (OAD.DB.threads || []).forEach(function (x) {
      if (x.parent_uuid && frontier.indexOf(x.parent_uuid) !== -1 && !seen[x.uuid]) {
        seen[x.uuid] = true;
        out.push(x);
        next.push(x.uuid);
      }
    });
    frontier = next;
  }
  return out;
};

// Clears park markers whenever a thread's status is changed by hand, so a later bollard
// reactivation can never resurrect a thread the user has since closed or reopened on purpose.
OAD.Bulk._clearParkMarkers = function (t) {
  if (!t.metadata) return;
  delete t.metadata.parked_by;
  delete t.metadata.parked_prior_status;
  delete t.metadata.parked_prior_dormant_trigger;
  delete t.metadata.parked_bollard;
};

OAD.Bulk._setStatus = function (t, status) {
  if (t.status === 'waiting' && status !== 'waiting') t.user_action_complete = false;
  t.status = status;
};

// ── "Start window" ──────────────────────────────────────────────────────────────────────────
// A thread whose next_action_date has passed but whose deadline is still within its lead time
// (OAD._cheLeadDays, the same per-life-area lead time CHE-002 already uses, not a second
// definition) is not behind. The buffer rule put the start date there on purpose; reaching the
// buffer is the plan working. Cards show "start now" for these instead of "next action overdue",
// and Catch Up leaves them out.
OAD.Bulk.isInStartWindow = function (t, now) {
  if (!t || !t.deadline || !t.next_action_date) return false;
  if (t.status === 'closed' || t.status === 'dormant') return false;
  var daysLeft = OAD.TemporalStatus.daysUntilDeadline(t, now);
  if (daysLeft == null || daysLeft < 0) return false;
  if (!OAD.TemporalStatus.isStalled(t, now)) return false;
  return daysLeft <= OAD._cheLeadDays(t);
};

// ── Validation ──────────────────────────────────────────────────────────────────────────────
// Returns null when the op is allowed for this thread, or a human-readable reason it was skipped.
OAD.Bulk._newDateFor = function (t, op) {
  if (op.type === 'setDate') return op.date;
  if (op.type === 'shift') return OAD.Bulk._addDays(t.next_action_date || OAD.todayStr(), op.days);
  return null;
};

OAD.Bulk.validate = function (t, op) {
  if (!t) return 'Thread not found';
  if (op.type === 'shift' || op.type === 'setDate') {
    if (t.status === 'closed') return 'Closed threads keep their dates';
    var newDate = OAD.Bulk._newDateFor(t, op);
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return 'No valid date given';
    if (OAD.Bulk._openChildren(t).length) {
      return 'Bollard rule: a parent thread with open children does not carry its own next action date';
    }
    if (t.deadline && newDate >= t.deadline) {
      return 'Buffer rule: next action date must stay before the deadline (' + t.deadline + ')';
    }
    return null;
  }
  if (op.type === 'status') {
    if (OAD.STATUSES.indexOf(op.status) === -1) return 'Unknown status';
    if (op.status === 'closed') return OAD.Bulk._closeBlocker(t);
    return null;
  }
  if (op.type === 'done' || op.type === 'drop') return OAD.Bulk._closeBlocker(t);
  if (op.type === 'park') return t.status === 'closed' ? 'Thread is already closed' : null;
  if (op.type === 'priority') {
    return ['critical', 'high', 'medium', 'low'].indexOf(op.priority) === -1 ? 'Unknown priority' : null;
  }
  return 'Unknown operation';
};

// Closing a thread with open sub-threads or live connections has real decisions attached
// (cascade, reparent, break edges) - that is what the Closure Wizard exists for. Bulk close
// never makes those decisions silently; it skips the thread and says why.
OAD.Bulk._closeBlocker = function (t) {
  if (t.status === 'closed') return 'Already closed';
  if (typeof OAD.needsClosureWizard === 'function' && OAD.needsClosureWizard(t.id)) {
    return 'Has open sub-threads or active connections; close it from the thread itself so the Closure Wizard can handle them';
  }
  return null;
};

// ── Apply ───────────────────────────────────────────────────────────────────────────────────
// op shapes:
//   { type: 'status', status }          { type: 'priority', priority }
//   { type: 'shift', days }             { type: 'setDate', date }
//   { type: 'done' }   closed + closing_condition_met (the click IS the user's confirmation)
//   { type: 'drop' }   closed, closing condition NOT asserted as met
//   { type: 'park', trigger }           dormant with a re-engagement trigger
// Returns { changed: [uuid], skipped: [{ uuid, title, reason }] }.
OAD.Bulk.apply = function (uuids, op, label) {
  var changed = [];
  var skipped = [];
  var entries = [];

  (uuids || []).forEach(function (uuid) {
    var t = OAD.getThreadByUUID(uuid);
    var reason = OAD.Bulk.validate(t, op);
    if (reason) {
      skipped.push({ uuid: uuid, title: t ? t.title : uuid, reason: reason });
      return;
    }
    var before = OAD.Bulk._snapshot(t);
    var note = OAD.Bulk._applyOne(t, op);
    if (note === null) return; // no-op (value already set)
    OAD.Bulk._log(t, note);
    entries.push({ uuid: uuid, before: before });
    changed.push(uuid);
  });

  if (entries.length) {
    OAD.Bulk._lastBatch = { label: label || OAD.Bulk.describe(op), entries: entries };
    OAD.saveDB();
    entries.forEach(function (e) { OAD._runAfterSave(OAD.getThreadByUUID(e.uuid)); });
  }
  return { changed: changed, skipped: skipped };
};

// Mutates one thread; returns the evolution_log note, or null if nothing actually changed.
OAD.Bulk._applyOne = function (t, op) {
  var prefix = 'Bulk update: ';
  if (op.type === 'shift' || op.type === 'setDate') {
    var from = t.next_action_date;
    var to = OAD.Bulk._newDateFor(t, op);
    if (from === to) return null;
    if (from && to > from) t.date_push_count = (t.date_push_count || 0) + 1;
    t.next_action_date = to;
    return prefix + 'next action date ' + (from || 'none') + ' -> ' + to;
  }
  if (op.type === 'priority') {
    if (t.priority === op.priority) return null;
    var p = t.priority;
    t.priority = op.priority;
    return prefix + 'priority ' + p + ' -> ' + op.priority;
  }
  if (op.type === 'status') {
    if (t.status === op.status) return null;
    var s = t.status;
    OAD.Bulk._setStatus(t, op.status);
    OAD.Bulk._clearParkMarkers(t);
    return prefix + 'status ' + s + ' -> ' + op.status;
  }
  if (op.type === 'done') {
    OAD.Bulk._setStatus(t, 'closed');
    t.closing_condition_met = true;
    OAD.Bulk._clearParkMarkers(t);
    return 'Catch Up: marked done (confirmed by user).';
  }
  if (op.type === 'drop') {
    OAD.Bulk._setStatus(t, 'closed');
    OAD.Bulk._clearParkMarkers(t);
    return 'Catch Up: dropped. No longer pursuing; closing condition not met.';
  }
  if (op.type === 'park') {
    var prev = t.status;
    OAD.Bulk._setStatus(t, 'dormant');
    OAD.Bulk._clearParkMarkers(t);
    t.dormant_trigger = (op.trigger && op.trigger.trim()) || t.dormant_trigger || 'Parked during Catch Up. Revisit when it matters again.';
    return 'Catch Up: parked (' + prev + ' -> dormant). Trigger: ' + t.dormant_trigger;
  }
  return null;
};

OAD.Bulk.describe = function (op) {
  if (op.type === 'shift') return 'Push next action ' + op.days + ' day' + (Math.abs(op.days) === 1 ? '' : 's');
  if (op.type === 'setDate') return 'Set next action date to ' + op.date;
  if (op.type === 'status') return 'Set status to ' + op.status;
  if (op.type === 'priority') return 'Set priority to ' + op.priority;
  if (op.type === 'done') return 'Mark done';
  if (op.type === 'drop') return 'Drop';
  if (op.type === 'park') return 'Park';
  return op.type;
};

// One-step undo of the last batch (bulk apply, a Catch Up action, or a park/reactivate).
// Restores the snapshotted fields; the evolution log is append-only, so the undo is logged
// rather than the original entries being removed.
OAD.Bulk.undo = function () {
  var batch = OAD.Bulk._lastBatch;
  if (!batch) return 0;
  var n = 0;
  batch.entries.forEach(function (e) {
    var t = OAD.getThreadByUUID(e.uuid);
    if (!t) return;
    OAD.Bulk._SNAPSHOT_FIELDS.forEach(function (f) { t[f] = e.before[f]; });
    t.metadata = e.before.metadata;
    OAD.Bulk._log(t, 'Undone: ' + batch.label + '.');
    n++;
  });
  OAD.Bulk._lastBatch = null;
  OAD.saveDB();
  batch.entries.forEach(function (e) { var t = OAD.getThreadByUUID(e.uuid); if (t) OAD._runAfterSave(t); });
  return n;
};

// ── Catch Up ────────────────────────────────────────────────────────────────────────────────
// Genuinely behind = past its deadline, or its next action has drifted into the past and it is
// NOT just sitting in its planned start window (see isInStartWindow). Built on the shared
// OAD.TemporalStatus definitions, not a new definition of overdue/stalled. Past-deadline first,
// then oldest drift first.
OAD.Bulk.catchUpQueue = function (now) {
  now = now || new Date();
  var threads = typeof OAD.getVisibleThreads === 'function' ? OAD.getVisibleThreads() : (OAD.DB.threads || []);
  var items = [];
  threads.forEach(function (t) {
    if (t.status === 'closed' || t.status === 'dormant') return;
    if (OAD.TemporalStatus.isOverdue(t, now)) {
      items.push({ thread: t, reason: 'past_deadline' });
    } else if (OAD.TemporalStatus.isStalled(t, now) && !OAD.Bulk.isInStartWindow(t, now)) {
      items.push({ thread: t, reason: 'drifted' });
    }
  });
  items.sort(function (a, b) {
    if (a.reason !== b.reason) return a.reason === 'past_deadline' ? -1 : 1;
    var ka = a.reason === 'past_deadline' ? a.thread.deadline : a.thread.next_action_date;
    var kb = b.reason === 'past_deadline' ? b.thread.deadline : b.thread.next_action_date;
    return (ka || '').localeCompare(kb || '');
  });
  return items;
};

// ── Park / Reactivate Bollard ───────────────────────────────────────────────────────────────
OAD.Bulk.parkPreview = function (bollardUuid) {
  var b = OAD.getThreadByUUID(bollardUuid);
  if (!b) return null;
  return {
    bollard: b,
    candidates: OAD.Bulk.descendants(bollardUuid).filter(function (x) {
      return x.status !== 'closed' && x.status !== 'dormant';
    })
  };
};

OAD.Bulk.isParkedBollard = function (t) {
  return !!(t && t.status === 'dormant' && t.metadata && t.metadata.parked_bollard);
};

// opts.keepActive: uuids of descendants to leave as they are (e.g. a legal obligation that
// keeps running while the rest of the area is on hold). opts.reason: the bollard's own trigger.
OAD.Bulk.parkBollard = function (bollardUuid, opts) {
  opts = opts || {};
  var preview = OAD.Bulk.parkPreview(bollardUuid);
  if (!preview) return { ok: false, reason: 'Thread not found' };
  var b = preview.bollard;
  if (b.status === 'closed' || b.status === 'dormant') {
    return { ok: false, reason: 'Only an active thread can be parked (this one is ' + b.status + ')' };
  }
  var keep = opts.keepActive || [];
  var entries = [];
  var parked = [];

  entries.push({ uuid: b.uuid, before: OAD.Bulk._snapshot(b) });
  b.metadata = b.metadata || {};
  b.metadata.parked_bollard = true;
  b.metadata.parked_prior_status = b.status;
  b.metadata.parked_prior_dormant_trigger = b.dormant_trigger || '';
  OAD.Bulk._setStatus(b, 'dormant');
  b.dormant_trigger = (opts.reason && opts.reason.trim()) || 'Life shift: parked. Reactivate this bollard to bring its threads back.';

  preview.candidates.forEach(function (x) {
    if (keep.indexOf(x.uuid) !== -1) return;
    entries.push({ uuid: x.uuid, before: OAD.Bulk._snapshot(x) });
    x.metadata = x.metadata || {};
    x.metadata.parked_by = b.uuid;
    x.metadata.parked_prior_status = x.status;
    x.metadata.parked_prior_dormant_trigger = x.dormant_trigger || '';
    OAD.Bulk._setStatus(x, 'dormant');
    x.dormant_trigger = 'Parked with bollard "' + b.title + '". Comes back when that bollard is reactivated.';
    OAD.Bulk._log(x, 'Parked with bollard "' + b.title + '" (was ' + x.metadata.parked_prior_status + ').');
    parked.push(x.uuid);
  });

  var keptCount = preview.candidates.length - parked.length;
  OAD.Bulk._log(b, 'Bollard parked: ' + parked.length + ' open thread' + (parked.length === 1 ? '' : 's') + ' parked with it' +
    (keptCount ? ', ' + keptCount + ' kept active' : '') + '. Reason: ' + b.dormant_trigger);

  OAD.Bulk._lastBatch = { label: 'Park bollard "' + b.title + '"', entries: entries };
  OAD.saveDB();
  entries.forEach(function (e) { OAD._runAfterSave(OAD.getThreadByUUID(e.uuid)); });
  return { ok: true, parked: parked, kept: keptCount };
};

// Restores the bollard and exactly the threads it parked. A thread parked with this bollard but
// changed by hand since (reopened, closed) had its markers cleared at that moment and is not
// touched. Threads that were already dormant before the park were never marked and stay parked.
OAD.Bulk.reactivateBollard = function (bollardUuid) {
  var b = OAD.getThreadByUUID(bollardUuid);
  if (!OAD.Bulk.isParkedBollard(b)) return { ok: false, reason: 'This thread is not a parked bollard' };
  var entries = [{ uuid: b.uuid, before: OAD.Bulk._snapshot(b) }];
  var restored = [];

  (OAD.DB.threads || []).forEach(function (x) {
    if (!x.metadata || x.metadata.parked_by !== b.uuid || x.status !== 'dormant') return;
    entries.push({ uuid: x.uuid, before: OAD.Bulk._snapshot(x) });
    OAD.Bulk._setStatus(x, x.metadata.parked_prior_status || 'open');
    x.dormant_trigger = x.metadata.parked_prior_dormant_trigger || '';
    OAD.Bulk._clearParkMarkers(x);
    OAD.Bulk._log(x, 'Reactivated with bollard "' + b.title + '".');
    restored.push(x.uuid);
  });

  OAD.Bulk._setStatus(b, b.metadata.parked_prior_status || 'open');
  b.dormant_trigger = b.metadata.parked_prior_dormant_trigger || '';
  OAD.Bulk._clearParkMarkers(b);
  OAD.Bulk._log(b, 'Bollard reactivated: ' + restored.length + ' thread' + (restored.length === 1 ? '' : 's') + ' restored.');

  OAD.Bulk._lastBatch = { label: 'Reactivate bollard "' + b.title + '"', entries: entries };
  OAD.saveDB();
  entries.forEach(function (e) { OAD._runAfterSave(OAD.getThreadByUUID(e.uuid)); });

  var now = new Date();
  var behind = restored.filter(function (u) {
    var t = OAD.getThreadByUUID(u);
    return OAD.TemporalStatus.isOverdue(t, now) || (OAD.TemporalStatus.isStalled(t, now) && !OAD.Bulk.isInStartWindow(t, now));
  }).length;
  return { ok: true, restored: restored, behind: behind };
};
