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

OAD._DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  const ref = fromDate ? new Date(fromDate + 'T00:00:00') : new Date();
  ref.setHours(0, 0, 0, 0);
  const y = ref.getFullYear();
  const m = ref.getMonth();

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
  } else if (t.next_action_date === todayStr) {
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
    .filter(function (t) { return t.next_action_date === dateStr; });
  var edgeSum = dayThreads.reduce(function (sum, t) {
    var ctx = OAD.getGraphContext(t.id);
    return sum + ctx.blocks.length + ctx.blockedBy.length + ctx.enables.length + ctx.relates.length;
  }, 0);

  var cadenceCount = (OAD.getVisibleCadences ? OAD.getVisibleCadences() : OAD.DB.cadences || [])
    .filter(function (c) { return c.next_due === dateStr; }).length;

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
  var exists = fromThread.connections.some(function (c) {
    return c.to_uuid === toThread.uuid && c.edge_type === edgeType;
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

// CHE-006: Stale next_action_date — past date on open thread that still has a future deadline.
OAD._che006_staleNextAction = function (thread, todayStr) {
  if (thread.status !== 'open') return null;
  if (!thread.next_action_date) return null;
  if (thread.next_action_date >= todayStr) return null;
  if (thread.deadline && thread.deadline < todayStr) return null; // CHE-003 territory
  return OAD._makeHealthAlert(
    thread, 'WARNING', 'CHE-006',
    'Stale next action — "' + thread.next_action_date + '" is in the past. Thread shows as permanently overdue, eroding trust in the overdue signal.',
    true,
    { uuid: thread.uuid, fields: { next_action_date: todayStr }, patch_source: 'CHE_AUTO_FIX', patch_rule: 'CHE-006', patch_applied_at: null }
  );
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

OAD.runCHE = function () {
  var threads = OAD.DB.threads || [];
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var todayStr = today.toISOString().slice(0, 10);

  // Keep existing dismissed alerts; replace non-dismissed ones fresh each run.
  var dismissed = (OAD.DB.health_alerts || []).filter(function (a) { return a.dismissed; });
  var fresh = [];

  threads.forEach(function (t) {
    var a;
    a = OAD._che001_nullDeadline(t);  if (a) fresh.push(a);
    a = OAD._che002_noLeadTime(t);    if (a) fresh.push(a);
    a = OAD._che006_staleNextAction(t, todayStr); if (a) fresh.push(a);
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
