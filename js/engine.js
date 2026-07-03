window.OAD = window.OAD || {};

// _suppressSideEffects: true on calls from getDayLoad()/calculateCriticalPath() — skips
// the day-load multiplier and cycle penalty (so they're only ever applied once, for the
// top-level thread being displayed) and skips transitive blocker resolution, so those two
// callers get this thread's own local weight, not a blocker-boosted one.
// _visited: internal — a plain object of visited uuids, threaded through pressure()'s own
// recursive blocker lookups (see the transitive block below) purely as a cycle guard. Those
// recursive calls deliberately do NOT set _suppressSideEffects — a blocker's day-load and
// cycle penalty should count too, so the thread it blocks inherits that blocker's real,
// full pressure (matching what the blocker would show anywhere else in the UI), not a
// truncated version of it.
OAD.pressure = function (thread, _suppressSideEffects, _visited) {
  if (thread.status === 'dormant') return 0;
  if (thread.status === 'inbox') return 0; // uncaptured/unreviewed — not yet real work, stays out of pressure-sorted views

  var score = 0;

  // Status
  if      (thread.status === 'stalled')  score += 30;
  else if (thread.status === 'waiting')  score += 15;

  // Unverified assumption
  if (!thread.assumption_verified && thread.current_assumption) score += 20;

  // Priority
  if      (thread.priority && thread.priority.toLowerCase() === 'critical') score += 30;
  else if (thread.priority && thread.priority.toLowerCase() === 'high')     score += 20;
  else if (thread.priority && thread.priority.toLowerCase() === 'medium')   score += 10;

  // Cycle Penalty: +25 if this node is part of a cycle
  if (!_suppressSideEffects) {
    var cycles = OAD.detectCycles();
    var inCycle = cycles.some(function(cycle) { return cycle.indexOf(thread.id) !== -1; });
    if (inCycle) {
      score += 25;
    }
  }

  // Contingency proximity — quadratic over 14-day window.
  // Produces a smooth 0→25 curve as the date approaches instead of step thresholds.
  if (thread.contingency_trigger_date) {
    var ctgToday = new Date();
    ctgToday.setHours(0, 0, 0, 0);
    var ctg = new Date(thread.contingency_trigger_date + 'T00:00:00');
    var ctgDays = Math.ceil((ctg - ctgToday) / 86400000);
    var ctgRatio = Math.max(0, Math.min(1, 1 - ctgDays / 14));
    score += Math.round(ctgRatio * ctgRatio * 25);
  }

  // Deadline proximity — quadratic continuous slope.
  // urgencyRatio² × 40 base, amplified ×1.5 when off-track, +10 when behind by 2+ sessions.
  // totalDays is effort-derived (sessions/week → weeks) or falls back to a 90-day window.
  if (thread.deadline) {
    var ds = OAD.deadlineState(thread);
    if (ds) {
      var totalDays = 90;
      if (thread.effortEstimate && thread.weeklyCommitment) {
        totalDays = Math.round((thread.effortEstimate / thread.weeklyCommitment) * 7);
      }
      totalDays = Math.max(totalDays, 1);
      var dlRatio = Math.max(0, Math.min(1, 1 - ds.daysRemaining / totalDays));
      var dp = dlRatio * dlRatio * 40;
      if (!ds.onTrack) dp *= 1.5;
      if (ds.behindBy >= 2) dp += 10;
      score += Math.round(dp);
    }
  }

  // Day-load multiplier
  if (!_suppressSideEffects && thread.next_action_date) {
    if (OAD.getDayLoad(thread.next_action_date) > 150) score += 12;
  }

  // Overdue next_action_date — time-aware via isActionOverdue/getOverdueDays (see above)
  if (OAD.isActionOverdue(thread)) {
    score += Math.min(40, OAD.getOverdueDays(thread) * 5); // +5 per day-equivalent overdue, max 40
  }

  // Escalation: Shift Collision
  if (thread.next_action_date && window.OAD && OAD.Config && OAD.Config.demoMode && OAD._demoRole && OAD.isOffDay) {
    if (OAD.isOffDay(thread.next_action_date, OAD._demoRole)) {
      score += 40;
    }
  }

  // Escalation: CIC Discharge Readiness (-5d rule)
  if (window.OAD && window.OAD.CIC && window.OAD.CIC.checkDischargeReadiness) {
    var cicScore = window.OAD.CIC.checkDischargeReadiness(thread);
    if (cicScore > 0) {
      score += cicScore;
      if (!thread.focusReason) thread.focusReason = '⚠ MISSING DISCHARGE LOC';
      else thread.focusReason += ' · ⚠ MISSING DISCHARGE LOC';
    }
  }

  var capped = Math.min(score, 100);
  if (thread.status === 'waiting' && thread.user_action_complete) {
    capped = Math.round(capped * 0.35);
  }

  // Transitive blocking propagation: a thread's effective pressure is at least as high
  // as the most urgent thing currently blocking it — walks the full blockedBy closure
  // (not just one hop), since real blocking chains run several edges deep. _visited
  // guards against cycles (detectCycles() already penalizes cycles separately above;
  // this just has to not infinite-loop through one). Runs on normal top-level calls
  // (_suppressSideEffects falsy) AND on our own recursive blocker lookups, which are
  // identifiable by a truthy _visited even though they pass _suppressSideEffects=false;
  // skipped only for getDayLoad/calculateCriticalPath's internal calls, which pass
  // _suppressSideEffects=true with no _visited.
  if (!_suppressSideEffects || _visited) {
    var visited = _visited || {};
    visited[thread.uuid] = true;
    var ctx = OAD.getGraphContext(thread.id);
    var maxBlockerPressure = 0;
    (ctx.blockedBy || []).forEach(function (blocker) {
      if (visited[blocker.uuid]) return; // cycle guard — don't recurse back through a visited node
      var bp = OAD.pressure(blocker, false, visited); // full pressure, not suppressed — see header comment
      if (bp > maxBlockerPressure) maxBlockerPressure = bp;
    });
    if (maxBlockerPressure > capped) capped = maxBlockerPressure;
  }

  return capped;
};

OAD.getEisenhowerQuadrant = function (thread) {
  const isImportant = thread.priority === 'critical' || thread.priority === 'high';
  let isUrgent = false;

  const todayStr = new Date().toISOString().slice(0, 10);
  if (thread.next_action_date && thread.next_action_date <= todayStr) {
    isUrgent = true;
  }

  if (!isUrgent && thread.deadline) {
    const ds = OAD.deadlineState(thread);
    if (ds && (!ds.onTrack || ds.daysRemaining <= 7)) {
      isUrgent = true;
    }
  }

  if (!isUrgent && OAD.pressure(thread) >= 60) {
    isUrgent = true;
  }

  if (isImportant && isUrgent) return 'Q1';
  if (isImportant && !isUrgent) return 'Q2';
  if (!isImportant && isUrgent) return 'Q3';
  return 'Q4';
};

OAD.suggestArea = function (title) {
  const lower = title.toLowerCase();
  if (/job board|job search|job hunt|weekly job|apply to/.test(lower)) return 'Job Search';
  if (/job|work|career|employ|hire|interview|resume/.test(lower)) return 'Career';
  if (/health|doctor|medical|therapy|mental|physical/.test(lower)) return 'Health';
  if (/\bfamily\b|parent|sibling|spouse|\bkid\b|child|\bmom\b|\bdad\b/.test(lower)) return 'Family';
  if (/money|finance|bank|debt|loan|tax|budget|invest/.test(lower)) return 'Finances';
  if (/friend|partner|relationship|social/.test(lower)) return 'Relationships';
  if (/school|class|degree|cert|course|learn|study/.test(lower)) return 'Education';
  if (/house|rent|lease|mortgage|apartment|move/.test(lower)) return 'Housing';
  if (/legal|court|law|attorney|contract|va |vr&e|vre/.test(lower)) return 'Legal';
  return 'Personal Growth';
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
  if (score >= 60) return 'p-high';
  if (score >= 30) return 'p-mid';
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
  var dt = OAD._combineDateTime(thread.next_action_date, thread.next_action_time);
  if (!dt) return false;
  return dt < new Date();
};

// Days-overdue equivalent, for pressure/label purposes. A thread with a specific time that's
// overdue same-day counts as at least 1 day overdue immediately — missing a hard-time
// commitment is already as serious as being "a day late," it shouldn't need to wait for the
// calendar to flip before pressure reflects that.
OAD.getOverdueDays = function (thread) {
  var dt = OAD._combineDateTime(thread.next_action_date, thread.next_action_time);
  if (!dt || dt >= new Date()) return 0;
  var hoursOverdue = (new Date() - dt) / 3600000;
  return Math.max(1, Math.ceil(hoursOverdue / 24));
};

OAD.deadlineState = function (thread) {
  if (!thread.deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(thread.deadline + 'T00:00:00');
  const daysRemaining = Math.ceil((dl - today) / 86400000);
  const weeksRemaining = Math.floor(Math.max(0, daysRemaining) / 7);

  const effortEstimate   = thread.effortEstimate;
  const effortLogged     = thread.effortLogged     || 0;
  const weeklyCommitment = thread.weeklyCommitment || 1;

  if (effortEstimate == null) {
    return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: null, onTrack: true, behindBy: 0 };
  }

  const sessionsRemaining = Math.max(0, effortEstimate - effortLogged);
  const capacity = weeksRemaining * weeklyCommitment;
  const onTrack  = sessionsRemaining <= capacity;
  const behindBy = onTrack ? 0 : sessionsRemaining - capacity;

  return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: sessionsRemaining, onTrack: onTrack, behindBy: behindBy };
};

// ── Runway Risk — convergence check ──────────────────────────────────
// Separate signal type from pressure/deadlineState: not "how urgent does this feel," but
// "given where things actually sit in the pipeline, is the trajectory even mathematically
// capable of landing before the deadline." Additive, read-only — never writes anything.

// Maps a category thread's title to a runway benchmark key. Same keyword-matching style as
// OAD.suggestArea() elsewhere in this file — simple, not graph-aware, easy to extend.
OAD._classifyRunwayBenchmark = function (title) {
  var t = (title || '').toLowerCase();
  if (t.indexOf('federal') !== -1) return 'federal';
  if (t.indexOf('commercial') !== -1) return 'commercial';
  return null;
};

// For one track thread, finds the earliest-active-stage among its leaf application threads
// (children reached via 'enables'). Threads with no stage set are treated as 'applied' — they
// exist as tracked applications, so they're at least that far in, per the spec's own framing
// ("zero applications past Applied = worst case, still at stage 1"). Closed and rejected
// threads are excluded — they're no longer part of the active pipeline math.
OAD._earliestActiveStage = function (trackThread) {
  var ctx = OAD.getGraphContext(trackThread.id);
  var applications = (ctx.enables || [])
    .map(function (e) { return e.thread; })
    .filter(function (t) { return t && t.status !== 'closed' && t.stage !== 'rejected'; });

  if (!applications.length) {
    // No applications at all is the same worst case as "all applications still at applied" —
    // the spec draws no distinction between the two for calculation purposes.
    return { stage: 'applied', stageIndex: 0, applicationCount: 0 };
  }

  var earliest = null;
  applications.forEach(function (app) {
    var stage = app.stage || 'applied';
    var idx = OAD.APPLICATION_STAGES.indexOf(stage);
    if (idx === -1) idx = 0; // unrecognized/legacy value — treat as earliest, don't crash
    if (earliest === null || idx < earliest.stageIndex) {
      earliest = { stage: stage, stageIndex: idx };
    }
  });
  return { stage: earliest.stage, stageIndex: earliest.stageIndex, applicationCount: applications.length };
};

// Estimates remaining weeks to outcome from the earliest-active stage, linearly discounting
// the benchmark range by how far through the (applied -> screening -> interview -> offer)
// pipeline that stage sits. A simplification, not a real distribution — matches the spec's
// own "conceptual, not final formula" framing. Uses the benchmark's max (slower) estimate for
// the at-risk trigger itself, since this is a warning signal — better to flag early.
OAD._estimateRemainingWeeks = function (stageIndex, benchmark) {
  var totalStages = OAD.APPLICATION_STAGES.length;
  var remainingFraction = (totalStages - stageIndex) / totalStages;
  return {
    minWeeks: Math.round(benchmark.minWeeks * remainingFraction),
    maxWeeks: Math.round(benchmark.maxWeeks * remainingFraction)
  };
};

// Walks Full-Time Employment goal thread -> category threads (Federal/Commercial Job
// Applications) -> track threads -> leaf application threads, using the same graph
// (getGraphContext/'enables') the rest of the app already relies on — no new grouping field.
// Returns null if the goal thread doesn't exist or has no deadline to converge against.
OAD.calculateRunwayRisk = function (goalThreadId) {
  var goalThread = OAD.getThread(goalThreadId);
  if (!goalThread || !goalThread.deadline) return null;

  var todayStr = new Date().toISOString().slice(0, 10);
  var deadline = new Date(goalThread.deadline + 'T00:00:00');
  var benchmarks = (OAD.Config && OAD.Config.runwayBenchmarks) || {};

  var goalCtx = OAD.getGraphContext(goalThread.id);
  var categories = (goalCtx.enables || []).map(function (e) { return e.thread; }).filter(Boolean);

  var tracks = [];
  categories.forEach(function (category) {
    var benchmarkKey = OAD._classifyRunwayBenchmark(category.title);
    var benchmark = benchmarkKey ? benchmarks[benchmarkKey] : null;
    if (!benchmark) return; // unclassifiable category — nothing to compare against, skip rather than guess

    var categoryCtx = OAD.getGraphContext(category.id);
    var trackThreads = (categoryCtx.enables || []).map(function (e) { return e.thread; }).filter(Boolean);

    trackThreads.forEach(function (track) {
      if (track.status === 'closed') return;
      var earliest = OAD._earliestActiveStage(track);
      var remaining = OAD._estimateRemainingWeeks(earliest.stageIndex, benchmark);

      var projected = new Date(todayStr + 'T00:00:00');
      projected.setDate(projected.getDate() + remaining.maxWeeks * 7);
      var atRisk = projected >= deadline;

      var deadlineLabel = OAD.formatDate ? OAD.formatDate(goalThread.deadline) : goalThread.deadline;
      var sentence = atRisk
        ? 'At current pipeline stage (' + earliest.applicationCount + ' application' + (earliest.applicationCount !== 1 ? 's' : '') +
          ', earliest at ' + earliest.stage + ') and known ' + benchmark.label + ' timelines (~' +
          remaining.minWeeks + '-' + remaining.maxWeeks + ' weeks remaining), "' + track.title +
          '" cannot realistically convert before ' + deadlineLabel + ' without acceleration.'
        : track.title + ' is mathematically on track to convert before ' + deadlineLabel + ' at current pace.';

      tracks.push({
        categoryTitle: category.title,
        trackTitle: track.title,
        trackUuid: track.uuid,
        benchmarkKey: benchmarkKey,
        stage: earliest.stage,
        applicationCount: earliest.applicationCount,
        minWeeksRemaining: remaining.minWeeks,
        maxWeeksRemaining: remaining.maxWeeks,
        atRisk: atRisk,
        sentence: sentence
      });
    });
  });

  return {
    deadline: goalThread.deadline,
    tracks: tracks,
    anyAtRisk: tracks.some(function (t) { return t.atRisk; })
  };
};

OAD._DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  var threads = OAD.DB.threads || [];

  function resolveEdge(c) {
    var target = null;
    if (c.to_uuid) target = threads.find(function (t) { return t.uuid === c.to_uuid; }) || null;
    return { label: c.to_label || '', uuid: c.to_uuid || null, thread: target };
  }

  var conns = thread.connections || [];
  
  var outboundBlocks = conns.filter(function (c) { return c.edge_type === 'blocks'; }).map(resolveEdge);
  var inboundBlockedBy = threads.filter(function (t) {
    if (t.id === threadId || t.status === 'closed') return false;
    return (t.connections || []).some(function (c) {
      return c.edge_type === 'blocked_by' && c.to_uuid === thread.uuid;
    });
  }).map(function (t) {
    return { label: t.title, uuid: t.uuid, thread: t };
  });

  var outboundEnables = conns.filter(function (c) { return c.edge_type === 'enables'; }).map(resolveEdge);
  var outboundRelates = conns.filter(function (c) { return c.edge_type === 'relates'; }).map(resolveEdge);

  var outboundBlockedBy = conns.filter(function (c) { return c.edge_type === 'blocked_by'; })
    .map(function (c) {
      return threads.find(function (t) { return t.uuid === c.to_uuid; });
    })
    .filter(Boolean);

  var inboundBlocks = threads.filter(function (t) {
    if (t.id === threadId || t.status === 'closed') return false;
    return (t.connections || []).some(function (c) {
      return c.edge_type === 'blocks' && c.to_uuid === thread.uuid;
    });
  });

  var blocksMap = {};
  outboundBlocks.concat(inboundBlockedBy).forEach(function (e) {
    if (e.uuid) blocksMap[e.uuid] = e;
  });
  
  var blockedByMap = {};
  outboundBlockedBy.concat(inboundBlocks).forEach(function (t) {
    if (t.id) blockedByMap[t.id] = t;
  });

  return {
    blocks:    Object.values(blocksMap),
    enables:   outboundEnables,
    relates:   outboundRelates,
    blockedBy: Object.values(blockedByMap)
  };
};

// Returns life-area heat data: [{name, count, avgPressure, stalled}] sorted by avgPressure desc.
OAD.getLifeAreaHeat = function () {
  var map = {};
  (OAD.DB.threads || []).forEach(function (t) {
    if (t.status === 'closed' || t.status === 'dormant' || t.status === 'inbox') return;
    var a = t.life_area || 'Other';
    if (!map[a]) map[a] = { count: 0, total: 0, stalled: 0 };
    map[a].count++;
    map[a].total += OAD.pressure(t);
    if (t.status === 'stalled') map[a].stalled++;
  });
  return Object.keys(map).map(function (name) {
    var d = map[name];
    return { name: name, count: d.count, avgPressure: d.count ? Math.round(d.total / d.count) : 0, stalled: d.stalled };
  }).sort(function (a, b) { return b.avgPressure - a.avgPressure; });
};

// Selects the single highest-priority actionable thread for the "Focus Now" card.
// Prefers threads with a next action set; falls back to highest pressure overall.
OAD.isBlocked = function (thread) {
  if (!thread) return false;
  var ctx = OAD.getGraphContext(thread.id);
  return ctx.blockedBy.length > 0;
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

OAD.selectFocusThread = function () {
  var isWaitingActioned = function (t) { return t.status === 'waiting' && t.user_action_complete; };
  var allActive = (OAD.getVisibleThreads ? OAD.getVisibleThreads() : OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox'; });

  // Primary: not blocked, not waiting+actioned
  var candidates = allActive
    .filter(function (t) { return !OAD.isBlocked(t) && !isWaitingActioned(t); })
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });

  // Secondary: allow blocked threads (still excludes waiting+actioned)
  if (!candidates.length) {
    candidates = allActive
      .filter(function (t) { return !isWaitingActioned(t); })
      .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
      .sort(function (a, b) { return b._score - a._score; });
  }

  // Last resort: include waiting+actioned threads if nothing else qualifies
  if (!candidates.length) {
    candidates = allActive
      .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
      .sort(function (a, b) { return b._score - a._score; });
  }

  if (!candidates.length) return null;
  var actionable = candidates.filter(function (t) { return t.next_action || t.next_action_date; });
  return actionable.length ? actionable[0] : candidates[0];
};

// Builds a human-readable reason string explaining why a thread is the focus.
OAD.focusReason = function (t) {
  var todayStr = new Date().toISOString().slice(0, 10);
  var parts = [];
  if (t.status === 'stalled')  parts.push('stalled');
  if (t.status === 'waiting' && t.user_action_complete) parts.push('ball in their court');
  else if (t.status === 'waiting') parts.push('waiting on response');
  if (OAD.isActionOverdue(t)) {
    parts.push(OAD.getOverdueDays(t) + 'd overdue');
  } else if (t.next_action_date === todayStr) {
    parts.push('due today' + (t.next_action_time ? ' at ' + OAD.formatTime(t.next_action_time) : ''));
  }
  if (!t.assumption_verified && t.current_assumption) parts.push('unverified assumption');
  var ctx = OAD.getGraphContext(t.id);
  if (ctx.blocks.length)     parts.push('blocking ' + ctx.blocks.length + ' thread' + (ctx.blocks.length !== 1 ? 's' : ''));
  if (ctx.blockedBy.length)  parts.push('blocked by ' + ctx.blockedBy.length + ' thread' + (ctx.blockedBy.length !== 1 ? 's' : ''));
  var ds = OAD.deadlineState(t);
  if (ds && !ds.onTrack)     parts.push(ds.behindBy + ' session' + (ds.behindBy !== 1 ? 's' : '') + ' behind deadline');
  else if (ds && ds.daysRemaining <= 7) parts.push('deadline in ' + ds.daysRemaining + 'd');
  
  if (window.OAD && OAD.Config && OAD.Config.demoMode && OAD._demoRole && OAD.isOffDay && t.next_action_date) {
    if (OAD.isOffDay(t.next_action_date, OAD._demoRole)) {
      parts.push('⚠ SHIFT COLLISION');
    }
  }
  
  return parts.join(' · ') || t.priority + ' priority';
};

// Returns the sum of pressure scores for all non-closed threads whose next_action_date
// matches dateStr. Uses pressure(t, true) — the _inBleedUp flag prevents getDayLoad
// from being called recursively, giving a stable base score for each peer thread.
OAD.getDayLoad = function (dateStr) {
  if (!dateStr) return 0;
  return (OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed' && t.next_action_date === dateStr; })
    .reduce(function (sum, t) { return sum + OAD.pressure(t, true); }, 0);
};

OAD.cadenceOverdue = function (cadence) {
  if (!cadence.next_due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(cadence.next_due + 'T00:00:00');
  return due < today;
};

OAD.cadenceDoneThisPeriod = function (c) {
  if (!c) return false;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = OAD.cadenceOverdue(c);
  if (overdue) return false;
  
  const dueToday = c.next_due === today;
  if (dueToday && c.last_completed === today) return true;

  const prevDue = OAD.prevCadenceDue(c.recurrence, c.days_of_week);
  return !!(c.last_completed && prevDue && c.last_completed >= prevDue);
};

OAD._cyclesCache = null;
OAD._cyclesCacheTime = 0;

OAD.detectCycles = function (force) {
  var now = Date.now();
  if (!force && OAD._cyclesCache && (now - OAD._cyclesCacheTime < 100)) {
    return OAD._cyclesCache;
  }

  var threads = OAD.DB.threads || [];
  var openThreads = threads.filter(function(t) { return t.status !== 'closed'; });
  var cycles = [];
  var visited = new Set();
  var stack = new Set();
  var path = [];

  function resolveTarget(c, sourceThread) {
    if (c.to_uuid) return openThreads.find(function(t) { return t.uuid === c.to_uuid; }) || null;
    if (c.to_label) {
      var lbl = c.to_label.toLowerCase();
      return openThreads.find(function(t) { return t.id !== sourceThread.id && (t.title || '').toLowerCase() === lbl; }) || null;
    }
    return null;
  }

  function dfs(node) {
    if (stack.has(node.id)) {
      var cycleStart = path.indexOf(node.id);
      if (cycleStart !== -1) cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(node.id)) return;

    visited.add(node.id);
    stack.add(node.id);
    path.push(node.id);

    var blocking = (node.connections || []).filter(function(c) { return c.edge_type === 'blocks'; });
    blocking.forEach(function(c) {
      var target = resolveTarget(c, node);
      if (target) dfs(target);
    });

    path.pop();
    stack.delete(node.id);
  }

  openThreads.forEach(function(t) {
    if (!visited.has(t.id)) dfs(t);
  });

  var uniqueCycles = [];
  var seenSignatures = new Set();
  cycles.forEach(function(cycle) {
    var sorted = cycle.slice().sort().join(',');
    if (!seenSignatures.has(sorted)) {
      seenSignatures.add(sorted);
      uniqueCycles.push(cycle);
    }
  });

  OAD._cyclesCache = uniqueCycles;
  OAD._cyclesCacheTime = now;
  return uniqueCycles;
};

OAD.calculateCriticalPath = function (threadId, visited) {
  visited = visited || new Set();
  var thread = OAD.getThread(threadId);
  if (!thread || thread.status === 'closed') return { weight: 0, path: [] };
  
  if (visited.has(threadId)) return { weight: 0, path: [] };
  visited.add(threadId);

  var threads = OAD.DB.threads || [];
  
  function resolveTarget(c, sourceThread) {
    if (c.to_uuid) return threads.find(function(t) { return t.uuid === c.to_uuid && t.status !== 'closed'; }) || null;
    if (c.to_label) {
      var lbl = c.to_label.toLowerCase();
      return threads.find(function(t) { return t.id !== sourceThread.id && (t.title || '').toLowerCase() === lbl && t.status !== 'closed'; }) || null;
    }
    return null;
  }

  var blocking = (thread.connections || []).filter(function(c) { return c.edge_type === 'blocks'; });
  var targets = [];
  blocking.forEach(function(c) {
    var t = resolveTarget(c, thread);
    if (t) targets.push(t);
  });

  var weight = OAD.pressure(thread, true);
  var maxPathWeight = 0;
  var maxPath = [];

  targets.forEach(function(t) {
    var sub = OAD.calculateCriticalPath(t.id, new Set(visited));
    if (sub.weight > maxPathWeight) {
      maxPathWeight = sub.weight;
      maxPath = sub.path;
    }
  });

  return {
    weight: weight + maxPathWeight,
    path: [threadId].concat(maxPath)
  };
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

OAD.CHE_LEAD_DAYS = {
  'Education':  5,
  'Job Search': 3,
  'Health':     2,
  'Career':     4,
  'Finances':   3
};

OAD._parseNaturalDate = function (str) {
  if (!str) return null;
  if (typeof OAD.Mailroom === 'undefined' || typeof OAD.Mailroom.parseText !== 'function') return null;
  var results = OAD.Mailroom.parseText(str);
  return (results.dates && results.dates[0]) || null;
};

OAD._cheLeadDays = function (thread) {
  if (thread.lead_time_days != null) return thread.lead_time_days;
  return OAD.CHE_LEAD_DAYS[thread.life_area] || 3;
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
