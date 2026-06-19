window.OAD = window.OAD || {};

// _inBleedUp: true when called recursively for bleed-up, suppresses second-hop bleed-up
OAD.pressure = function (thread, _inBleedUp) {
  var score = 0;

  // Status
  if      (thread.status === 'stalled')  score += 30;
  else if (thread.status === 'waiting')  score += 15;

  // Unverified assumption
  if (!thread.assumption_verified && thread.current_assumption) score += 20;

  // Priority
  if      (thread.priority === 'critical') score += 30;
  else if (thread.priority === 'high')     score += 20;
  else if (thread.priority === 'medium')   score += 10;

  // One-hop bleed-up from blocking connections.
  // For each connection that blocks a resolvable thread: add 30% of that thread's pressure.
  // For unresolvable labels (no thread found): flat +10 fallback.
  // Capped at +20 total. _inBleedUp prevents recursing past one hop.
  if (!_inBleedUp) {
    var blockingConns = (thread.connections || []).filter(function (c) { return c.edge_type === 'blocks'; });
    var bleedUp = 0;
    blockingConns.forEach(function (c) {
      var blocked = null;
      if (c.to_uuid) {
        blocked = (OAD.DB.threads || []).find(function (t) { return t.uuid === c.to_uuid; }) || null;
      }
      bleedUp += blocked ? 0.3 * OAD.pressure(blocked, true) : 10;
    });
    score += Math.min(Math.round(bleedUp), 20);

    // Cycle Penalty: +25 if this node is part of a cycle
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

  // Day-load multiplier: +12 when this thread's date already carries > 150 pressure
  // from peer threads. Only applied at the top level — passing _inBleedUp=true into
  // getDayLoad's pressure() calls breaks the recursion at one hop.
  if (!_inBleedUp && thread.next_action_date) {
    if (OAD.getDayLoad(thread.next_action_date) > 150) score += 12;
  }

  return Math.min(score, 100);
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
    if (t.status === 'closed') return;
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

OAD.selectFocusThread = function () {
  var candidates = (OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed' && !OAD.isBlocked(t); })
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });
  if (!candidates.length) {
    candidates = (OAD.DB.threads || [])
      .filter(function (t) { return t.status !== 'closed'; })
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
  if (t.status === 'waiting')  parts.push('waiting on response');
  if (t.next_action_date && t.next_action_date < todayStr) {
    var daysOver = Math.round((new Date(todayStr) - new Date(t.next_action_date + 'T00:00:00')) / 86400000);
    parts.push(daysOver + 'd overdue');
  } else if (t.next_action_date === todayStr) {
    parts.push('due today');
  }
  if (!t.assumption_verified && t.current_assumption) parts.push('unverified assumption');
  var ctx = OAD.getGraphContext(t.id);
  if (ctx.blocks.length)     parts.push('blocking ' + ctx.blocks.length + ' thread' + (ctx.blocks.length !== 1 ? 's' : ''));
  if (ctx.blockedBy.length)  parts.push('blocked by ' + ctx.blockedBy.length + ' thread' + (ctx.blockedBy.length !== 1 ? 's' : ''));
  var ds = OAD.deadlineState(t);
  if (ds && !ds.onTrack)     parts.push(ds.behindBy + ' session' + (ds.behindBy !== 1 ? 's' : '') + ' behind deadline');
  else if (ds && ds.daysRemaining <= 7) parts.push('deadline in ' + ds.daysRemaining + 'd');
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
