window.OAD = window.OAD || {};

/**
 * Calculates and returns the pressure score for a given thread.
 * Delegates to the Thread domain object.
 */
OAD.pressure = function (thread, _suppressSideEffects, _visited) {
  if (!thread) return 0;
  if (typeof thread.getPressure === 'function') {
    return thread.getPressure(_suppressSideEffects, _visited);
  }
  return new window.OAD.Models.Thread(thread).getPressure(_suppressSideEffects, _visited);
};

OAD.getEisenhowerQuadrant = function (thread) {
  if (!thread) return 'Q4';
  if (typeof thread.getEisenhowerQuadrant === 'function') {
    return thread.getEisenhowerQuadrant();
  }
  return new window.OAD.Models.Thread(thread).getEisenhowerQuadrant();
};

OAD.suggestArea = function (title) {
  const lower = title.toLowerCase();
  for (const area in OAD.Config.areaKeywords) {
    const keywords = OAD.Config.areaKeywords[area];
    for (const keyword of keywords) {
      if (lower.indexOf(keyword.toLowerCase()) !== -1) {
        return area;
      }
    }
  }
  return OAD.Config.defaultArea || 'Personal Growth';
};

OAD.esc = function (str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

OAD.pressureClass = function (score) {
  var thresholds = (OAD.Config && OAD.Config.pressureThresholds) || { high: 60, mid: 30 };
  if (score >= thresholds.high) return 'p-high';
  if (score >= thresholds.mid)  return 'p-mid';
  return 'p-low';
};

OAD.daysUntil = function (dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target - today) / 86400000);
};

OAD.formatDate = function (dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

OAD.formatTime = function (timeStr) {
  if (!timeStr) return '';
  const d = new Date('2000-01-01T' + timeStr + ':00');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// Combines a date string with an optional 'HH:MM' time into a real Date. No time set defaults
// to 23:59:59 of that date — this is what makes date-only threads behave exactly as before
// (not overdue until the calendar rolls to the next day), while a thread with a specific time
// becomes overdue the moment that time passes today, not at midnight.
OAD._combineDateTime = function (dateStr, timeStr) {
  if (!dateStr) return null;
  var t = (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) ? timeStr + ':00' : '23:59:59';
  return new Date(dateStr + 'T' + t);
};

// Single source of truth for "is this thread's next action actually late right now" — replaces
// the next_action_date < todayStr string comparison duplicated across pressure(), the Daily
// View overdue buckets, and TOAT selection, so time-of-day awareness applies everywhere at once.
OAD.isActionOverdue = function (thread) {
  if (thread && typeof thread.isOverdue === 'function') {
    return thread.isOverdue();
  }
  var dt = OAD._combineDateTime(thread.next_action_date, thread.next_action_time);
  if (!dt) return false;
  return new window.OAD.Models.Thread(thread).isOverdue();
};

// Days-overdue equivalent, for pressure/label purposes. A thread with a specific time that's
// overdue same-day counts as at least 1 day overdue immediately — missing a hard-time
// commitment is already as serious as being "a day late," it shouldn't need to wait for the
// calendar to flip before pressure reflects that.
OAD.getOverdueDays = function (thread) {
  if (!thread) return 0;
  if (typeof thread.getDaysOverdue === 'function') {
    return thread.getDaysOverdue();
  }
  return new window.OAD.Models.Thread(thread).getDaysOverdue();
};

// "Has a hard external deadline, and it has passed" — deliberately distinct from
// isActionOverdue above (see Thread.isDeadlineOverdue()'s comment in js/models.js). Drives the
// "Overdue Tasks" bucket (OAD.Due.buckets) per ticket-overdue-filter-fix.md.
OAD.isDeadlineOverdue = function (thread) {
  if (thread && typeof thread.isDeadlineOverdue === 'function') {
    return thread.isDeadlineOverdue();
  }
  return new window.OAD.Models.Thread(thread).isDeadlineOverdue();
};

OAD.getDeadlineOverdueDays = function (thread) {
  if (!thread) return 0;
  if (typeof thread.getDeadlineDaysOverdue === 'function') {
    return thread.getDeadlineDaysOverdue();
  }
  return new window.OAD.Models.Thread(thread).getDeadlineDaysOverdue();
};

// Single source of truth for which children get nested under their parent's summary badge
// instead of listed flatly in the Overdue/Today/Week buckets.
//
// horizonStr (defaults to todayStr): a child is NEVER suppressed if it's overdue, or its
// next_action_date falls anywhere between today and horizonStr, inclusive. This used to be
// "overdue or due exactly today" only — which was a much worse bug than it looked: the This
// Week bucket's whole reason for existing is to surface things due in the next 7 days, so a
// child due in 2-6 days (not today, not overdue) was being suppressed out of the very list
// that exists to show it, with no compensating detail — the child-summary badge on the
// parent's row (below) shows only a subtask count + one "Next:" hint, and the parent itself
// often has no next_action_date of its own, so it may not render in This Week (or anywhere
// date-scoped) at all. Confirmed against real data: the two highest-pressure threads due that
// week (P85, P82) were both invisible in This Week this way. Callers pass their own bucket's
// horizon (e.g. the This Week bucket passes its own 7-days-out date) so "never suppress
// something this view exists to show" holds for whichever window is actually being rendered,
// while a child due well beyond that horizon (the original Bug 5 case) still safely nests
// under its parent's summary.
//
// focusUUID (optional): whatever OAD.getFocusUUID() currently returns is also never suppressed,
// for the same reason — Focus Now's selection functions don't consult this suppression rule at
// all, so without this exemption its own top pick could still slip past the horizon check in
// an edge case and be invisible in the very list it's supposedly summarized from.
OAD.computeSuppressedChildUUIDs = function (childrenByParentUUID, activeByUUID, todayStr, focusUUID, horizonStr) {
  var suppressed = new Set();
  var horizon = horizonStr || todayStr;
  Object.keys(childrenByParentUUID || {}).forEach(function (puuid) {
    var parent = activeByUUID[puuid];
    if (parent && parent.life_area === 'Patient') return;
    childrenByParentUUID[puuid].forEach(function (c) {
      if (OAD.isActionOverdue(c)) return;
      // A child whose own hard deadline has passed must stay individually visible for the
      // same reason an action-overdue child does — otherwise the deadline-based "Overdue
      // Tasks" bucket (OAD.Due.buckets, per ticket-overdue-filter-fix.md) could silently fold
      // a genuinely-overdue-by-deadline child into its parent's summary badge, reproducing the
      // exact Bug 4/5 failure mode this exemption list already exists to prevent — just for a
      // due-signal this function didn't know about yet.
      if (OAD.isDeadlineOverdue(c)) return;
      if (c.next_action_date && c.next_action_date <= horizon) return;
      if (focusUUID && c.uuid === focusUUID) return;
      suppressed.add(c.uuid);
    });
  });
  return suppressed;
};

// The uuid of whatever thread Focus Now is currently showing — the primary due-now/overdue
// pick if one exists, otherwise the "get ahead" upcoming suggestion. Centralized so every
// caller (rendering AND suppression) agrees on what "the current focus" means.
OAD.getFocusUUID = function (activeThreads) {
  var t = OAD.selectFocusThread(activeThreads) || OAD.selectFutureFocusSuggestion(activeThreads);
  return t ? t.uuid : null;
};

OAD.deadlineState = function (thread) {
  if (!thread) return null;
  if (typeof thread.getDeadlineState === 'function') {
    return thread.getDeadlineState();
  }
  return new window.OAD.Models.Thread(thread).getDeadlineState();
};

// ── Runway Risk — convergence check ──────────────────────────────────
// Separate signal type from pressure/deadlineState: not "how urgent does this feel," but
// "given where things actually sit in the pipeline, is the trajectory even mathematically
// capable of landing before the deadline." Additive, read-only — never writes anything.

OAD._classifyRunwayBenchmark = function (title) {
  var t = (title || '').toLowerCase();
  if (t.indexOf('federal') !== -1) return 'federal';
  if (t.indexOf('commercial') !== -1) return 'commercial';
  return null;
};

OAD._earliestActiveStage = function (trackThread) {
  var track = new window.OAD.Models.Track(trackThread);
  return track.getEarliestActiveStage();
};

OAD._estimateRemainingWeeks = function (stageIndex, benchmark) {
  // Temporary track to borrow the function for testing
  var track = new window.OAD.Models.Track({});
  track.getEarliestActiveStage = function() { return { stageIndex: stageIndex }; };
  return track.estimateRemainingWeeks(benchmark);
};

OAD.calculateRunwayRisk = function (goalThreadId) {
  var goalThread = OAD.getThread(goalThreadId);
  if (!goalThread || !goalThread.deadline) return null;

  var goalCtx = OAD.getGraphContext(goalThread.id);
  var categories = (goalCtx.enables || []).map(function (e) { return e.thread; }).filter(Boolean);

  var tracks = [];
  categories.forEach(function (category) {
    var categoryCtx = OAD.getGraphContext(category.id);
    var trackThreads = (categoryCtx.enables || []).map(function (e) { return e.thread; }).filter(Boolean);

    trackThreads.forEach(function (trackObj) {
      if (trackObj.status === 'closed') return;
      var track = new window.OAD.Models.Track(trackObj);
      var result = track.calculateRunwayRisk(goalThread);
      if (result) {
        result.categoryTitle = category.title;
        tracks.push(result);
      }
    });
  });

  return {
    deadline: goalThread.deadline,
    tracks: tracks,
    anyAtRisk: tracks.some(function (t) { return t.atRisk; })
  };
};

OAD._DAY_NAMES = (OAD.Config && OAD.Config.dayNames) || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Today's date as a local-calendar-day string. Zeroes to local midnight before converting
// to ISO — plain `new Date().toISOString().slice(0,10)` converts the current instant
// straight to UTC, so once local time is late enough in the evening that UTC has already
// rolled to the next date, it silently returns tomorrow's date instead of today's. This bit
// Focus Now specifically (selectFocusThread/focusReason both did the unsafe conversion),
// while the dashboard/"This Week" views were already safe via this same zero-then-convert
// pattern — hence the same thread showing "due today" in one widget and its correct date in
// the other.
OAD.todayStr = function () {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

OAD.nextCadenceDue = function (recurrence, fromDate, daysOfWeek) {
  var suffix = (OAD.Config && OAD.Config.timeSuffix) || 'T00:00:00';

  const ref = fromDate ? new Date(fromDate + suffix) : new Date();
  ref.setHours(0, 0, 0, 0);
  const y = ref.getFullYear();
  const m = ref.getMonth();

  // Recurrence values are schema constants (OAD.RECURRENCES in data.js, the cadence form's
  // <select> options) not config — see the note on OAD.Config in config.js for why.
  if (recurrence === 'monthly-1st')  return new Date(y, m + 1, 1).toISOString().slice(0, 10);
  if (recurrence === 'monthly-15th') {
    const candidate = new Date(y, m, 15);
    return (candidate > ref ? candidate : new Date(y, m + 1, 15)).toISOString().slice(0, 10);
  }
  if (recurrence === 'monthly-last') return new Date(y, m + 2, 0).toISOString().slice(0, 10);
  if (recurrence === 'weekly') {
    const next = new Date(ref);
    next.setDate(next.getDate() + 7);
    return next.toISOString().slice(0, 10);
  }
  if (recurrence === 'weekly-days') {
    const days = (daysOfWeek || []).filter(function (d) { return d >= 0 && d <= 6; });
    if (!days.length) {
      const next = new Date(ref);
      next.setDate(next.getDate() + 7);
      return next.toISOString().slice(0, 10);
    }
    // Walk forward from the day after `ref` — next due is always strictly after fromDate.
    for (let i = 1; i <= 7; i++) {
      const candidate = new Date(ref);
      candidate.setDate(candidate.getDate() + i);
      if (days.indexOf(candidate.getDay()) !== -1) return candidate.toISOString().slice(0, 10);
    }
  }
  return null;
};

OAD.prevCadenceDue = function (recurrence, daysOfWeek) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  if (recurrence === 'monthly-1st')  return new Date(y, m, 1).toISOString().slice(0, 10);
  if (recurrence === 'monthly-15th') {
    return d >= 15
      ? new Date(y, m, 15).toISOString().slice(0, 10)
      : new Date(y, m - 1, 15).toISOString().slice(0, 10);
  }
  if (recurrence === 'monthly-last') return new Date(y, m, 0).toISOString().slice(0, 10);
  if (recurrence === 'weekly') {
    const prev = new Date(today);
    prev.setDate(prev.getDate() - 7);
    return prev.toISOString().slice(0, 10);
  }
  if (recurrence === 'weekly-days') {
    const days = (daysOfWeek || []).filter(function (dw) { return dw >= 0 && dw <= 6; });
    if (!days.length) return null;
    // Walk backward from today (inclusive) to find the most recent matching weekday.
    for (let i = 0; i <= 6; i++) {
      const candidate = new Date(today);
      candidate.setDate(candidate.getDate() - i);
      if (days.indexOf(candidate.getDay()) !== -1) return candidate.toISOString().slice(0, 10);
    }
  }
  return null;
};

// Human-readable recurrence label — expands weekly-days into the actual day names.
OAD.formatRecurrence = function (c) {
  if (c.recurrence === 'weekly-days' && (c.days_of_week || []).length) {
    const sorted = c.days_of_week.slice().sort(function (a, b) { return a - b; });
    return 'weekly-days (' + sorted.map(function (d) { return OAD._DAY_NAMES[d]; }).join(', ') + ')';
  }
  return c.recurrence;
};

// Returns bidirectional graph context for a thread.
// blocks[]   — threads this thread is blocking (outbound blocks edges)
// blockedBy[] — threads blocking this one (reverse lookup: other threads' blocks edges pointing here)
// enables[], relates[] — other outbound edge types
OAD.getGraphContext = function (threadId) {
  var thread = OAD.getThread(threadId);
  if (!thread) return { blocks: [], blockedBy: [], enables: [], relates: [] };
  if (typeof thread.getGraphContext === 'function') {
    return thread.getGraphContext();
  }
  return new window.OAD.Models.Thread(thread).getGraphContext();
};

// Returns life-area heat data: [{name, count, avgPressure, stalled}] sorted by avgPressure desc.
OAD.getLifeAreaHeat = function () {
  var collection = new window.OAD.Models.ThreadCollection(OAD.DB.threads || []);
  return collection.getLifeAreaHeat();
};

// Selects the single highest-priority actionable thread for the "Focus Now" card.
// Prefers threads with a next action set; falls back to highest pressure overall.
OAD.isBlocked = function (thread) {
  if (!thread) return false;
  if (typeof thread.isBlocked === 'function') {
    return thread.isBlocked();
  }
  return new window.OAD.Models.Thread(thread).isBlocked();
};

// Graph Views — pure predicate matching a thread against a saved view's field filters + optional edge rule.
OAD.matchesSavedView = function (thread, view) {
  if (!thread || !view) return false;
  if (view.statuses && view.statuses.length && view.statuses.indexOf(thread.status) === -1) return false;
  if (view.priorities && view.priorities.length && view.priorities.indexOf(thread.priority) === -1) return false;
  if (view.life_areas && view.life_areas.length && view.life_areas.indexOf(thread.life_area) === -1) return false;
  if (view.edge_rule && view.edge_rule.type) {
    var ctx = OAD.getGraphContext(thread.id);
    switch (view.edge_rule.type) {
      case 'blocked_by_open':
        // ctx.blockedBy holds raw Thread objects (unlike ctx.blocks/enables/relates, which are wrapped {label,uuid,thread}).
        if (!(ctx.blockedBy || []).some(function (b) { return b.status !== 'closed'; })) return false;
        break;
      case 'has_blocks':
        if (!(ctx.blocks || []).length) return false;
        break;
      case 'no_blockers':
        if ((ctx.blockedBy || []).length) return false;
        break;
    }
  }
  return true;
};

// Graph Views — filters threads against a saved view, then sorts by its sort_field/sort_dir.
OAD.applySavedView = function (threads, view) {
  var list = (threads || []).filter(function (t) { return OAD.matchesSavedView(t, view); });
  var field = (view && view.sort_field) || 'pressure';
  var dir = (view && view.sort_dir === 'asc') ? 1 : -1;
  list.sort(function (a, b) {
    var av, bv;
    if (field === 'pressure') { av = OAD.pressure(a); bv = OAD.pressure(b); }
    else if (field === 'deadline' || field === 'next_action_date') { av = a[field] || '9999-99-99'; bv = b[field] || '9999-99-99'; }
    else { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
  return list;
};

// activeThreads (optional): a precomputed, pressure-scored active-thread list (the shape
// OAD.Due.activeThreads() returns). Pass it when the caller already has one, so this doesn't
// trigger a second full pressure-scoring pass over every active thread; omit it to have this
// compute its own (behavior-identical to always omitting it).
OAD.selectFocusThread = function (activeThreads) {
  var todayStr = OAD.todayStr();
  var isWaitingActioned = function (t) { return t.status === 'waiting' && t.user_action_complete; };
  var allActive = activeThreads || OAD.Due.activeThreads();
  var byScoreDesc = function (a, b) { return b._score - a._score; };

  // Focus Now means "what should I work on right now" — scope to today + overdue first.
  // Previously this sorted the ENTIRE active backlog by raw pressure with no date filter at
  // all, so a thread due next week could outrank something due today just by having a higher
  // pressure score anywhere in the backlog.
  var dueNow = allActive.filter(function (t) { return t.next_action_date && t.next_action_date <= todayStr; });

  // Primary: not blocked, not waiting+actioned
  var candidates = dueNow
    .filter(function (t) { return !OAD.isBlocked(t) && !isWaitingActioned(t); })
    .slice()
    .sort(byScoreDesc);

  // Secondary: allow blocked threads (still excludes waiting+actioned)
  if (!candidates.length) {
    candidates = dueNow
      .filter(function (t) { return !isWaitingActioned(t); })
      .slice()
      .sort(byScoreDesc);
  }

  // Last resort: include waiting+actioned threads if nothing else qualifies
  if (!candidates.length) {
    candidates = dueNow.slice().sort(byScoreDesc);
  }

  if (!candidates.length) return null;
  var actionable = candidates.filter(function (t) { return t.next_action || t.next_action_date; });
  return actionable.length ? actionable[0] : candidates[0];
};

// When nothing is due today or overdue, Focus Now has nothing to actively recommend — but
// offers the nearest upcoming item as an optional "get ahead" suggestion, distinct from an
// actual recommendation. Nearest date first, tie-broken by pressure. Mirrors the spirit of
// TOAT's celebrate-when-empty pattern: an empty Focus Now is good news, not a dead end.
// activeThreads (optional): see OAD.selectFocusThread's header comment — same deduplication
// purpose.
OAD.selectFutureFocusSuggestion = function (activeThreads) {
  var todayStr = OAD.todayStr();
  var allActive = activeThreads || OAD.Due.activeThreads();
  var upcoming = allActive.filter(function (t) { return t.next_action_date && t.next_action_date > todayStr; });
  if (!upcoming.length) return null;
  upcoming = upcoming.slice().sort(function (a, b) {
    if (a.next_action_date !== b.next_action_date) return a.next_action_date < b.next_action_date ? -1 : 1;
    return b._score - a._score;
  });
  return upcoming[0];
};

// Builds a human-readable reason string explaining why a thread is the focus.
OAD.focusReason = function (t) {
  var todayStr = OAD.todayStr();
  var parts = [];
  var s = (OAD.Config && OAD.Config.focusReasonStrings) || {};
  
  if (t.status === 'stalled')  parts.push(s.stalled || 'stalled');
  if (t.status === 'waiting' && t.user_action_complete) parts.push(s.ballInCourt || 'ball in their court');
  else if (t.status === 'waiting') parts.push(s.waitingOnResponse || 'waiting on response');
  
  if (OAD.isActionOverdue(t)) {
    parts.push(OAD.getOverdueDays(t) + (s.overdueSuffix || 'd overdue'));
  } else if (OAD.TemporalStatus.isDueToday(t, new Date())) {
    parts.push((s.dueToday || 'due today') + (t.next_action_time ? (s.at || ' at ') + OAD.formatTime(t.next_action_time) : ''));
  }
  
  if (!t.assumption_verified && t.current_assumption) parts.push(s.unverifiedAssumption || 'unverified assumption');
  
  var ctx = OAD.getGraphContext(t.id);
  if (ctx.blocks.length)     parts.push((s.blockingPrefix || 'blocking ') + ctx.blocks.length + (ctx.blocks.length !== 1 ? (s.threadPlural || ' threads') : (s.threadSingular || ' thread')));
  if (ctx.blockedBy.length)  parts.push((s.blockedByPrefix || 'blocked by ') + ctx.blockedBy.length + (ctx.blockedBy.length !== 1 ? (s.threadPlural || ' threads') : (s.threadSingular || ' thread')));
  
  var ds = OAD.deadlineState(t);
  if (ds && !ds.onTrack)     parts.push(ds.behindBy + (ds.behindBy !== 1 ? (s.sessionPlural || ' sessions') : (s.sessionSingular || ' session')) + (s.behindDeadlineSuffix || ' behind deadline'));
  else if (ds && ds.daysRemaining <= 7) parts.push((s.deadlineInPrefix || 'deadline in ') + ds.daysRemaining + (s.daysSuffix || 'd'));
  
  if (window.OAD && OAD.Config && OAD.Config.demoMode && OAD._demoRole && OAD.isOffDay && t.next_action_date) {
    if (OAD.isOffDay(t.next_action_date, OAD._demoRole)) {
      parts.push(s.shiftCollision || '⚠ SHIFT COLLISION');
    }
  }
  
  return parts.join(s.separator || ' · ') || t.priority + (s.prioritySuffix || ' priority');
};

// Returns the sum of pressure scores for all active threads (demo-scoped, excluding
// dormant/inbox — same definition as everywhere else via OAD.Due.activeThreadsRaw) whose
// next_action_date matches dateStr. Uses pressure(t, true) — the _suppressSideEffects flag
// prevents getDayLoad from being called recursively, giving a stable base score for each peer
// thread. Must consume the RAW (unscored) active list, never OAD.Due.activeThreads() — that
// calls OAD.pressure() unsuppressed on every thread, which would call back into getDayLoad
// and recurse infinitely.
OAD.getDayLoad = function (dateStr) {
  var collection = new window.OAD.Models.ThreadCollection(OAD.DB.threads || []);
  return collection.getDayLoad(dateStr);
};

// Mechanical score for how far a tendency-evidence cluster sits past the minimum evidentiary bar
// (OAD.Config.personaPromotionThresholds) — NOT a calibrated probability the trait is true, and
// deliberately not named "confidence" for that reason. Computed entirely from ledger counts; the
// LLM never sees or produces this number, so a reader always knows this specific figure is real
// arithmetic over real data, not model interpretation.
//
// min(), not average, across the three dimensions: a cluster that's huge on occurrence_count and
// span_days but sits at exactly the floor on distinct_thread_count is precisely the "one hard
// thread, not a real tendency" case this whole design exists to catch. An average would let two
// strong dimensions paper over one weak one; min() means the weakest dimension always caps the
// score. Saturates at 2x each threshold (comfortably past the bar, not "more must mean truer") —
// exactly at the gate, every ratio is 0.5, so a cluster that just barely cleared reads 0.5, not
// some falsely precise 0.72.
OAD.tendencyEvidenceStrength = function (occurrenceCount, distinctThreadCount, spanDays, thresholds) {
  var t = thresholds || (OAD.Config && OAD.Config.personaPromotionThresholds) || { minOccurrences: 3, minDistinctThreads: 2, minSpanDays: 14 };
  function ratio(value, threshold) {
    if (!threshold) return 0;
    return Math.max(0, Math.min(1, value / (threshold * 2)));
  }
  return Math.min(
    ratio(occurrenceCount, t.minOccurrences),
    ratio(distinctThreadCount, t.minDistinctThreads),
    ratio(spanDays, t.minSpanDays)
  );
};

// Groups un-consumed tendency_evidence rows by life_area (the simplest deterministic grouping
// available on every thread already — no separate clustering inference of its own to introduce
// as a new drift surface) and returns only the clusters that clear ALL three
// personaPromotionThresholds. This is the statistical gate between "a signal happened" and "this
// is eligible to be proposed as a persona trait" — per the tendency-detection redesign, nothing
// downstream may skip this gate to go straight from one excuse to a persona write.
OAD.evaluateTendencyCandidates = function () {
  var thresholds = (OAD.Config && OAD.Config.personaPromotionThresholds) || { minOccurrences: 3, minDistinctThreads: 2, minSpanDays: 14 };
  var evidence = ((OAD.DB.persona && OAD.DB.persona.tendency_evidence) || []).filter(function (e) { return !e.consumed; });

  var byArea = {};
  evidence.forEach(function (e) {
    (byArea[e.life_area] = byArea[e.life_area] || []).push(e);
  });

  var candidates = [];
  Object.keys(byArea).forEach(function (area) {
    var rows = byArea[area];
    var occurrenceCount = rows.length;
    var distinctThreadCount = new Set(rows.map(function (r) { return r.thread_uuid; })).size;
    var dates = rows.map(function (r) { return new Date(r.date + 'T00:00:00').getTime(); });
    var spanDays = Math.round((Math.max.apply(null, dates) - Math.min.apply(null, dates)) / 86400000);

    if (occurrenceCount < thresholds.minOccurrences) return;
    if (distinctThreadCount < thresholds.minDistinctThreads) return;
    if (spanDays < thresholds.minSpanDays) return;

    candidates.push({
      life_area: area,
      occurrence_count: occurrenceCount,
      distinct_thread_count: distinctThreadCount,
      span_days: spanDays,
      evidence_row_ids: rows.map(function (r) { return r.id; }),
      evidence_thread_uuids: Array.from(new Set(rows.map(function (r) { return r.thread_uuid; }))),
      excuse_texts: rows.map(function (r) { return r.excuse_text; }).filter(Boolean),
      first_observed: rows.reduce(function (min, r) { return r.date < min ? r.date : min; }, rows[0].date),
      last_observed: rows.reduce(function (max, r) { return r.date > max ? r.date : max; }, rows[0].date),
      evidence_strength: OAD.tendencyEvidenceStrength(occurrenceCount, distinctThreadCount, spanDays, thresholds)
    });
  });

  return candidates;
};

// Composite "how will this day actually feel" score for the This Week's Load widget —
// distinct from getDayLoad() above, which is a pure pressure-sum feeding pressure()'s own
// cross-load multiplier and must stay that way to avoid a new feedback loop. This adds:
//   - edge-weight: total connection degree (in+out, all edge types) for threads due that
//     day — a proxy for coordination/complexity that's deliberately separate from urgency
//     (pressure already reflects urgency inherited through blocking chains; this captures
//     raw entanglement regardless of type, which pressure doesn't).
//   - cadence-weight: cadences have no pressure score of their own (binary done/overdue),
//     but a due cadence is still a real commitment, so it gets a flat configurable weight.
// Weights come from OAD.Config.weekLoadWeights — see js/config.js for the golden-rule note.
OAD.calculateDayLoadScore = function (dateStr) {
  if (!dateStr) return 0;
  var weights = (OAD.Config && OAD.Config.weekLoadWeights) || {};
  var edgeMultiplier = weights.edgeMultiplier != null ? weights.edgeMultiplier : 2;
  var cadenceWeight  = weights.cadenceWeight  != null ? weights.cadenceWeight  : 20;

  var pressureSum = OAD.getDayLoad(dateStr);

  var dayThreads = OAD.Due.activeThreadsRaw()
    .filter(function (t) { return OAD.TemporalStatus.isDueToday(t, new Date(dateStr + 'T12:00:00')); });
  var edgeSum = dayThreads.reduce(function (sum, t) {
    var ctx = OAD.getGraphContext(t.id);
    return sum + ctx.blocks.length + ctx.blockedBy.length + ctx.enables.length + ctx.relates.length;
  }, 0);

  var cadenceCount = (OAD.getVisibleCadences ? OAD.getVisibleCadences() : OAD.DB.cadences || [])
    .filter(function (c) { return OAD.Due.isCadenceDueOn(c, dateStr); }).length;

  return pressureSum + (edgeSum * edgeMultiplier) + (cadenceCount * cadenceWeight);
};

// Maps a composite score to the Clear/Busy/Heavy label — thresholds are configurable
// (OAD.Config.weekLoadWeights), never hardcoded in this function.
OAD.getDayLoadLabel = function (score) {
  var weights = (OAD.Config && OAD.Config.weekLoadWeights) || {};
  var busyThreshold  = weights.busyThreshold  != null ? weights.busyThreshold  : 50;
  var heavyThreshold = weights.heavyThreshold != null ? weights.heavyThreshold : 150;
  if (score >= heavyThreshold) return 'heavy';
  if (score >= busyThreshold) return 'busy';
  return 'clear';
};

OAD.cadenceOverdue = function (cadence) {
  if (!cadence) return false;
  if (typeof cadence.isOverdue === 'function') {
    return cadence.isOverdue();
  }
  return new window.OAD.Models.Cadence(cadence).isOverdue();
};

OAD.cadenceDoneThisPeriod = function (c) {
  if (!c) return false;
  if (typeof c.isDoneThisPeriod === 'function') {
    return c.isDoneThisPeriod();
  }
  return new window.OAD.Models.Cadence(c).isDoneThisPeriod();
};

OAD._cyclesCache = null;
OAD._cyclesCacheTime = 0;

OAD.detectCycles = function (force) {
  var graph = new window.OAD.Models.Graph(OAD.DB.threads || []);
  if (OAD._cyclesCache) {
    graph._cyclesCache = OAD._cyclesCache;
    graph._cyclesCacheTime = OAD._cyclesCacheTime;
  }
  var result = graph.detectCycles(force);
  OAD._cyclesCache = graph._cyclesCache;
  OAD._cyclesCacheTime = graph._cyclesCacheTime;
  return result;
};

OAD.calculateCriticalPath = function (threadId, visited) {
  var graph = new window.OAD.Models.Graph(OAD.DB.threads || []);
  return graph.calculateCriticalPath(threadId, visited);
};

// ── Auto-Dependency Engine (ADE) ──────────────────────────────────────
// Infers graph edges from thread data. Rules run in order; each checks
// the suppression list and skips duplicate edges before writing.

OAD._adeAddEdge = function (fromThread, toThread, edgeType, rule, confidence) {
  if (!fromThread || !toThread || fromThread.uuid === toThread.uuid) return false;
  var suppressions = OAD.DB.ade_suppressions || [];
  var suppressed = suppressions.some(function (s) {
    return s.from_uuid === fromThread.uuid && s.to_uuid === toThread.uuid && s.rule === rule;
  });
  if (suppressed) return false;
  fromThread.connections = fromThread.connections || [];
  // Deliberately matches on to_uuid ALONE, not (to_uuid, edgeType) — auto-generation exists to
  // fill gaps, not to assert a fact over one that's already there. The old (to_uuid, edgeType)
  // match meant that once a user (or a corrective import) reclassified an auto-generated edge to
  // a different, more accurate type, the next runADE() call would silently re-add a duplicate of
  // the original type right alongside it — the rule couldn't tell "no relationship exists yet"
  // apart from "a relationship exists, just not typed the way I'd have inferred." Found via a live
  // export review: a corrective import changed a `blocked_by` for `enables`, matching what the
  // thread's own next_action text already said, and runCHE()'s automatic post-import ADE pass
  // silently re-created the `enables` edge it had just been corrected away from. See CHE-011 below
  // for the permanent detection safety net for this class of bug.
  var exists = fromThread.connections.some(function (c) {
    return c.to_uuid === toThread.uuid;
  });
  if (exists) return false;
  fromThread.connections.push({
    uuid:              OAD._generateUUID(),
    to_uuid:           toThread.uuid,
    to_label:          toThread.title,
    edge_type:         edgeType,
    auto_generated:    true,
    rule:              rule,
    confidence:        confidence,
    confirmed_by_user: false,
    created_at:        new Date().toISOString()
  });
  return true;
};

// ADE-001: Sequential coursework — Week N blocks Week N+1; all weeks block Finals.
OAD._ade001_sequential = function () {
  var created = 0;
  var open = (OAD.DB.threads || []).filter(function (t) { return t.status !== 'closed'; });
  var weekPat  = /^(.*?)\bWeek\s+(\d+)\b/i;
  var finalPat = /\b(final exam|finals|final)\b/i;

  var groups = {};
  open.forEach(function (t) {
    if (!t.title) return;
    var m = t.title.match(weekPat);
    if (!m) return;
    var prefix = m[1].replace(/[-—:\s]+$/, '').trim().toLowerCase();
    if (!prefix) return;
    if (!groups[prefix]) groups[prefix] = { weeks: [], finals: [] };
    groups[prefix].weeks.push({ thread: t, n: parseInt(m[2], 10) });
  });
  open.forEach(function (t) {
    if (!t.title) return;
    if (!finalPat.test(t.title)) return;
    Object.keys(groups).forEach(function (prefix) {
      if (t.title.toLowerCase().indexOf(prefix) !== -1) {
        groups[prefix].finals.push(t);
      }
    });
  });

  // Rule ids and edge-type strings are schema constants (OAD.EDGE_TYPES in data.js,
  // getGraphContext's edge_type comparisons) not config — see the note on OAD.Config in
  // config.js for why.
  Object.keys(groups).forEach(function (prefix) {
    var g = groups[prefix];
    g.weeks.sort(function (a, b) { return a.n - b.n; });
    for (var i = 0; i < g.weeks.length - 1; i++) {
      if (g.weeks[i + 1].n === g.weeks[i].n + 1) {
        if (OAD._adeAddEdge(g.weeks[i].thread, g.weeks[i + 1].thread, 'blocks', 'ADE-001', 0.97)) created++;
      }
    }
    g.finals.forEach(function (f) {
      g.weeks.forEach(function (w) {
        if (OAD._adeAddEdge(w.thread, f, 'blocks', 'ADE-001', 0.97)) created++;
      });
    });
  });
  return created;
};

// ADE-002: parent_uuid → parent enables child (structural certainty).
OAD._ade002_parentChild = function () {
  var created = 0;
  (OAD.DB.threads || []).forEach(function (child) {
    if (!child.parent_uuid || child.status === 'closed') return;
    var parent = OAD.getThreadByUUID(child.parent_uuid);
    if (parent && parent.status !== 'closed') {
      if (OAD._adeAddEdge(parent, child, 'enables', 'ADE-002', 1.0)) created++;
    }
  });
  return created;
};

// ADE-003: Shared job/project identifier + prep→submit action word pattern.
OAD._ade003_sharedIdentifier = function () {
  var created = 0;
  var open = (OAD.DB.threads || []).filter(function (t) { return t.status !== 'closed'; });
  var ID_PAT    = /\b([A-Z]{2,5}[-\s][A-Z0-9]{2,}(?:-[A-Z0-9]+)*)\b/g;
  var PREP_PAT  = /\b(build|draft|prepare|review|create|write|complete)\b/i;
  var SUBM_PAT  = /\b(submit|apply|send|deliver|file|upload)\b/i;

  var byId = {};
  open.forEach(function (t) {
    if (!t.title) return;
    var re = new RegExp(ID_PAT.source, 'g'), m;
    while ((m = re.exec(t.title)) !== null) {
      var key = m[1].replace(/\s/g, '-').toUpperCase();
      if (!byId[key]) byId[key] = [];
      byId[key].push(t);
    }
  });

  Object.keys(byId).forEach(function (key) {
    var group = byId[key];
    if (group.length < 2) return;
    var preppers  = group.filter(function (t) { return PREP_PAT.test(t.title); });
    var submitters = group.filter(function (t) { return SUBM_PAT.test(t.title); });
    preppers.forEach(function (prep) {
      submitters.forEach(function (sub) {
        if (prep.uuid !== sub.uuid) {
          if (OAD._adeAddEdge(prep, sub, 'blocks', 'ADE-003', 0.92)) created++;
        }
      });
    });
  });
  return created;
};

OAD.runADE = function () {
  var created = 0;
  created += OAD._ade001_sequential();
  created += OAD._ade002_parentChild();
  created += OAD._ade003_sharedIdentifier();
  if (created > 0) OAD.saveDB();
  return created;
};

// ── Configuration Health Engine (CHE) ────────────────────────────────
// Detects thread misconfiguration silently undermining pressure/scheduling.
// Phase 1: detection only (no auto-fix). Auto-fix is Phase 2.

OAD._parseNaturalDate = function (str) {
  if (!str) return null;
  if (typeof OAD.Mailroom === 'undefined' || typeof OAD.Mailroom.parseText !== 'function') return null;
  var results = OAD.Mailroom.parseText(str);
  return (results.dates && results.dates[0]) || null;
};

OAD._cheLeadDays = function (thread) {
  if (thread.lead_time_days != null) return thread.lead_time_days;
  var leads = (OAD.Config && OAD.Config.cheLeadDays) || {};
  return leads[thread.life_area] || leads['Default'] || 3;
};

OAD._cheTitleSimilarity = function (a, b) {
  var normalize = function (s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean); };
  var wa = normalize(a), wb = normalize(b);
  var setA = {}, setB = {};
  wa.forEach(function (w) { setA[w] = true; });
  wb.forEach(function (w) { setB[w] = true; });
  var intersection = 0;
  Object.keys(setA).forEach(function (w) { if (setB[w]) intersection++; });
  var union = Object.keys(setA).length + Object.keys(setB).length - intersection;
  return union === 0 ? 1 : intersection / union;
};

OAD._makeHealthAlert = function (thread, severity, type, description, autoFixable, suggestedFix) {
  return {
    id:            OAD._generateUUID(),
    thread_uuid:   thread.uuid,
    thread_title:  thread.title,
    severity:      severity,
    type:          type,
    description:   description,
    detected_at:   new Date().toISOString(),
    auto_fixable:  !!autoFixable,
    suggested_fix: suggestedFix || null,
    dismissed:     false,
    dismissed_at:  null
  };
};

// CHE-001: Null deadline on thread whose closing_condition or title contains a parseable date.
OAD._che001_nullDeadline = function (thread) {
  if (thread.deadline || thread.status === 'closed') return null;
  var dateStr = OAD._parseNaturalDate(thread.closing_condition) || OAD._parseNaturalDate(thread.title);
  if (!dateStr) return null;
  return OAD._makeHealthAlert(
    thread, 'CRITICAL', 'CHE-001',
    'Deadline missing — "' + dateStr + '" was found in the thread but deadline is not set. The pressure algorithm is flying blind.',
    true,
    { uuid: thread.uuid, fields: { deadline: dateStr }, patch_source: 'CHE_AUTO_FIX', patch_rule: 'CHE-001', patch_applied_at: null }
  );
};

// CHE-002: next_action_date equals deadline — zero lead time.
OAD._che002_noLeadTime = function (thread) {
  if (!thread.deadline || thread.status === 'closed') return null;
  if (!thread.next_action_date) return null;
  if (thread.next_action_date !== thread.deadline) return null;
  var leadDays = OAD._cheLeadDays(thread);
  var dl = new Date(thread.deadline);
  dl.setDate(dl.getDate() - leadDays);
  var suggested = dl.toISOString().slice(0, 10);
  return OAD._makeHealthAlert(
    thread, 'CRITICAL', 'CHE-002',
    'No lead time — next action is set to the deadline itself (' + thread.deadline + '). Thread will surface the day it\'s due with zero working time.',
    true,
    { uuid: thread.uuid, fields: { next_action_date: suggested }, patch_source: 'CHE_AUTO_FIX', patch_rule: 'CHE-002', patch_applied_at: null }
  );
};

// CHE-006: Stale next_action_date on an open/waiting thread whose overall deadline status
// isn't already loudly visible elsewhere (Overdue Tasks). Unified with
// OAD.TemporalStatus.dataHygieneWarnings' 'drifted_next_action_masked_by_future_deadline' rule
// per ticket-flowqueue-temporal-and-schema.md — these were found to be two independent
// implementations of nearly the same signal (this one predates the new module and was missed on
// the first migration pass). Rather than force them into one identical trigger condition (a real
// investigation found they're legitimately different in scope — see below — not just
// accidentally different), this rule now composes from the same shared primitives instead of
// reimplementing its own date-string comparisons, so there's still only one real definition of
// "stale"/"overdue" underneath both:
//   - "stale" reuses OAD.TemporalStatus.isStalled, which also correctly excludes a waiting
//     thread that's ball-in-the-other-person's-court — CHE-006 previously excluded ALL waiting
//     threads outright (status !== 'open' bailed immediately), which was blunter than necessary
//     now that a more precise definition exists. This is a genuine, deliberate widening: a
//     waiting thread that's still actionable and has gone stale now gets flagged too.
//   - "already visible elsewhere" reuses OAD.TemporalStatus.isOverdue (deadline-based) — if the
//     thread is already surfacing prominently in Overdue Tasks, a second nudge here is noise,
//     not signal. This intentionally stays BROADER than dataHygieneWarnings' masking rule (which
//     only fires when a deadline is set and still comfortable) — CHE-006 also fires when there's
//     no deadline at all, since "stale with nothing else to catch it" is exactly the invisible
//     case this alert exists for, whether or not a deadline happens to be present.
OAD._che006_staleNextAction = function (thread, today) {
  if (thread.status !== 'open' && thread.status !== 'waiting') return null;
  if (!OAD.TemporalStatus.isStalled(thread, today)) return null;
  if (OAD.TemporalStatus.isOverdue(thread, today)) return null; // already loud via Overdue Tasks — CHE-003 territory
  var todayStr = OAD.todayStr();
  return OAD._makeHealthAlert(
    thread, 'WARNING', 'CHE-006',
    'Stale next action — "' + thread.next_action_date + '" is in the past. Thread shows as permanently overdue, eroding trust in the overdue signal.',
    true,
    { uuid: thread.uuid, fields: { next_action_date: todayStr }, patch_source: 'CHE_AUTO_FIX', patch_rule: 'CHE-006', patch_applied_at: null }
  );
};

// CHE-012: Next Action hasn't been touched since Current Assumption was last revised — the
// thread's stated next step may no longer reflect its own most recent reasoning. Requires BOTH
// timestamps to actually exist (legacy threads predating this tracking get null from
// OAD._normalizeDB, js/data.js) — silence, not a false positive, when either is unknown. Both
// stamped centrally by OAD.updateThread whenever the corresponding field's value actually
// changes, so this covers manual edits, the Pushback/Complete Action wizards, and import sync
// alike — no second stamping site to drift.
OAD._che012_staleNextActionVsAssumption = function (thread) {
  if (thread.status === 'closed') return null;
  if (!thread.next_action_updated_at || !thread.current_assumption_updated_at) return null;
  if (new Date(thread.next_action_updated_at) >= new Date(thread.current_assumption_updated_at)) return null;
  return OAD._makeHealthAlert(
    thread, 'WARNING', 'CHE-012',
    'Next action was last updated ' + thread.next_action_updated_at.slice(0, 10) + ', but Current Assumption changed more recently (' + thread.current_assumption_updated_at.slice(0, 10) + ') — the next step may no longer match the latest thinking.',
    false, null
  );
};

// CHE-013: closing_condition_type 'action' means the thread's own definition of "done" IS an
// action, not an external outcome — an empty or too-short next_action here means there's no real
// defined next step for a thread that specifically needs one to ever close.
OAD._che013_missingActionStep = function (thread) {
  if (thread.status === 'closed') return null;
  if (thread.closing_condition_type !== 'action') return null;
  var minLength = (OAD.Config && OAD.Config.cheMinNextActionLength) || 8;
  var text = (thread.next_action || '').trim();
  if (text.length >= minLength) return null;
  return OAD._makeHealthAlert(
    thread, 'WARNING', 'CHE-013',
    (text ? 'Next action ("' + text + '") is too short' : 'Next action is empty') + ' for a thread whose closing condition IS an action — there\'s no real defined next step for something that specifically needs one to ever close.',
    false, null
  );
};

// CHE-014: Next Action's own text mentions an explicit date that disagrees with the structured
// next_action_date/deadline actually driving the thread's scheduling — the text and the fields
// tell two different stories about when this happens. Reuses OAD._parseNaturalDate — the same
// date-in-text extraction CHE-001 already uses, not a new mechanism — so this only fires on an
// explicit date mentioned in the text. It deliberately does NOT attempt to detect vague urgency
// language ("ASAP", "...") with a keyword list; that's a semantic judgment call, a genuinely
// different mechanism (would need an LLM), not built here.
OAD._che014_urgencyContradiction = function (thread) {
  if (thread.status === 'closed') return null;
  var mentioned = OAD._parseNaturalDate(thread.next_action);
  if (!mentioned) return null;
  var minGapDays = (OAD.Config && OAD.Config.cheContradictionMinGapDays) || 14;
  var mentionedDt = new Date(mentioned + 'T00:00:00');

  var fields = [
    { label: 'next_action_date', value: thread.next_action_date },
    { label: 'deadline', value: thread.deadline }
  ];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (!f.value || f.value === mentioned) continue;
    var fieldDt = new Date(f.value + 'T00:00:00');
    var gapDays = Math.round((fieldDt - mentionedDt) / 86400000);
    if (gapDays >= minGapDays) {
      return OAD._makeHealthAlert(
        thread, 'WARNING', 'CHE-014',
        'Next action mentions ' + mentioned + ', but ' + f.label + ' is set to ' + f.value + ' (' + gapDays + ' days later) — the text and the field disagree about when this actually happens.',
        false, null
      );
    }
  }
  return null;
};

// CHE-010: Duplicate or near-duplicate open/waiting thread titles (>85% Jaccard similarity).
OAD._che010_duplicateTitles = function (threads) {
  var alerts = [];
  var active = threads.filter(function (t) { return t.status === 'open' || t.status === 'waiting'; });
  var seen = {};
  for (var i = 0; i < active.length; i++) {
    for (var j = i + 1; j < active.length; j++) {
      var a = active[i], b = active[j];
      if (!a.title || !b.title) continue;
      if (OAD._cheTitleSimilarity(a.title, b.title) >= 0.85) {
        var key = [a.uuid, b.uuid].sort().join('|');
        if (seen[key]) continue;
        seen[key] = true;
        alerts.push(OAD._makeHealthAlert(
          a, 'INFO', 'CHE-010',
          'Possible duplicate — "' + a.title + '" and "' + b.title + '" are ' +
            Math.round(OAD._cheTitleSimilarity(a.title, b.title) * 100) + '% similar. Review both: ' + b.uuid,
          false, null
        ));
      }
    }
  }
  return alerts;
};

// CHE-011: A thread has multiple connections to the same target with different edge types (e.g.
// both `blocked_by` and `enables` pointing at the same to_uuid) — the graph asserting two
// different relationships to the same thread at once. Permanent safety net for the class of bug
// fixed at the source in OAD._adeAddEdge above (an auto-generation rule re-asserting its own edge
// type after a user had already reclassified it) — this check doesn't depend on knowing which
// rule or code path caused the duplication, so it also catches anything already sitting in the
// data from before that fix landed, or any future path that makes the same mistake.
// Detection-only (auto_fixable: false), like CHE-010 — deciding which of several conflicting
// edges reflects the real relationship needs a human, not a field patch, and applyHealthAlertFix
// only knows how to assign fields, not remove connections.
OAD._che011_conflictingEdges = function (thread) {
  if (thread.status === 'closed') return [];
  var byTarget = {};
  (thread.connections || []).forEach(function (c) {
    (byTarget[c.to_uuid] = byTarget[c.to_uuid] || []).push(c);
  });
  var alerts = [];
  Object.keys(byTarget).forEach(function (toUuid) {
    var edges = byTarget[toUuid];
    var types = {};
    edges.forEach(function (c) { types[c.edge_type] = true; });
    if (Object.keys(types).length <= 1) return;
    var toLabel = edges[0].to_label || toUuid;
    alerts.push(OAD._makeHealthAlert(
      thread, 'WARNING', 'CHE-011',
      'Conflicting edges — "' + thread.title + '" has ' + edges.length + ' connections to "' + toLabel +
        '" with different types (' + Object.keys(types).sort().join(', ') + '). Review which one reflects the real relationship.',
      false, null
    ));
  });
  return alerts;
};

OAD.runCHE = function () {
  var threads = OAD.DB.threads || [];
  var today = new Date(); today.setHours(0, 0, 0, 0);

  // Keep existing dismissed alerts; replace non-dismissed ones fresh each run.
  var dismissed = (OAD.DB.health_alerts || []).filter(function (a) { return a.dismissed; });
  var fresh = [];

  threads.forEach(function (t) {
    var a;
    a = OAD._che001_nullDeadline(t);  if (a) fresh.push(a);
    a = OAD._che002_noLeadTime(t);    if (a) fresh.push(a);
    a = OAD._che006_staleNextAction(t, today); if (a) fresh.push(a);
    OAD._che011_conflictingEdges(t).forEach(function (a2) { fresh.push(a2); });
    a = OAD._che012_staleNextActionVsAssumption(t); if (a) fresh.push(a);
    a = OAD._che013_missingActionStep(t); if (a) fresh.push(a);
    a = OAD._che014_urgencyContradiction(t); if (a) fresh.push(a);
  });

  OAD._che010_duplicateTitles(threads).forEach(function (a) { fresh.push(a); });

  OAD.DB.health_alerts = dismissed.concat(fresh);
  OAD.saveDB();
  return fresh.length;
};

OAD.dismissHealthAlert = function (alertId) {
  var alert = (OAD.DB.health_alerts || []).find(function (a) { return a.id === alertId; });
  if (!alert) return;
  alert.dismissed = true;
  alert.dismissed_at = new Date().toISOString();
  OAD.saveDB();
};

OAD.applyHealthAlertFix = function (alertId) {
  var alert = (OAD.DB.health_alerts || []).find(function (a) { return a.id === alertId; });
  if (!alert || !alert.auto_fixable || !alert.suggested_fix) return false;
  var fix = alert.suggested_fix;
  var thread = OAD.DB.threads.find(function (t) { return t.uuid === fix.uuid; });
  if (!thread) return false;
  Object.assign(thread, fix.fields);
  fix.patch_applied_at = new Date().toISOString();
  OAD.addEvolution(thread.id, '[CHE auto-fix ' + alert.type + '] ' + alert.description);
  alert.dismissed = true;
  alert.dismissed_at = new Date().toISOString();
  OAD.saveDB();
  return true;
};

// Register per-thread CHE check on create/update
OAD._afterSaveCallbacks.push(function (thread) {
  if (typeof OAD.runCHE !== 'function') return;
  // Debounce: defer to next tick so bulk operations don't thrash
  clearTimeout(OAD._cheDebounce);
  OAD._cheDebounce = setTimeout(function () { OAD.runCHE(); OAD._updateCHEBadge(); }, 50);
});
