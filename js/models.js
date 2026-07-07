window.OAD = window.OAD || {};
OAD.Models = OAD.Models || {};

class Thread {
  constructor(data) {
    Object.assign(this, data);
  }

  isOverdue() {
    var dt = OAD._combineDateTime(this.next_action_date, this.next_action_time);
    if (!dt) return false;
    return dt < new Date();
  }

  getDaysOverdue() {
    var dt = OAD._combineDateTime(this.next_action_date, this.next_action_time);
    if (!dt || dt >= new Date()) return 0;
    var hoursOverdue = (new Date() - dt) / 3600000;
    return Math.max(1, Math.ceil(hoursOverdue / 24));
  }

  getDeadlineState() {
    if (!this.deadline) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dl = new Date(this.deadline + 'T00:00:00');
    const daysRemaining = Math.ceil((dl - today) / 86400000);
    const weeksRemaining = Math.floor(Math.max(0, daysRemaining) / 7);

    const effortEstimate   = this.effortEstimate;
    const effortLogged     = this.effortLogged     || 0;
    const weeklyCommitment = this.weeklyCommitment || 1;

    if (effortEstimate == null) {
      return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: null, onTrack: true, behindBy: 0 };
    }

    const sessionsRemaining = Math.max(0, effortEstimate - effortLogged);
    const capacity = weeksRemaining * weeklyCommitment;
    const onTrack  = sessionsRemaining <= capacity;
    const behindBy = onTrack ? 0 : sessionsRemaining - capacity;

    return { daysRemaining: daysRemaining, weeksRemaining: weeksRemaining, sessionsRemaining: sessionsRemaining, onTrack: onTrack, behindBy: behindBy };
  }

  getEisenhowerQuadrant() {
    const isImportant = this.priority === 'critical' || this.priority === 'high';
    let isUrgent = false;

    const todayStr = OAD.todayStr();
    if (this.next_action_date && this.next_action_date <= todayStr) {
      isUrgent = true;
    }

    if (!isUrgent && this.deadline) {
      const ds = this.getDeadlineState();
      if (ds && (!ds.onTrack || ds.daysRemaining <= 7)) {
        isUrgent = true;
      }
    }

    if (!isUrgent && this.getPressure() >= 60) {
      isUrgent = true;
    }

    if (isImportant && isUrgent) return 'Q1';
    if (isImportant && !isUrgent) return 'Q2';
    if (!isImportant && isUrgent) return 'Q3';
    return 'Q4';
  }

  getPressure(_suppressSideEffects, _visited) {
    if (this.status === 'dormant') return 0;
    if (this.status === 'inbox') return 0;

    var score = 0;

    // Status
    if      (this.status === 'stalled')  score += 30;
    else if (this.status === 'waiting')  score += 15;

    // Unverified assumption
    if (!this.assumption_verified && this.current_assumption) score += 20;

    // Priority
    if      (this.priority && this.priority.toLowerCase() === 'critical') score += 30;
    else if (this.priority && this.priority.toLowerCase() === 'high')     score += 20;
    else if (this.priority && this.priority.toLowerCase() === 'medium')   score += 10;

    // Cycle Penalty
    if (!_suppressSideEffects) {
      var cycles = OAD.detectCycles();
      var inCycle = cycles.some(cycle => cycle.indexOf(this.id) !== -1);
      if (inCycle) {
        score += 25;
      }
    }

    // Contingency proximity
    if (this.contingency_trigger_date) {
      var ctgToday = new Date();
      ctgToday.setHours(0, 0, 0, 0);
      var ctg = new Date(this.contingency_trigger_date + 'T00:00:00');
      var ctgDays = Math.ceil((ctg - ctgToday) / 86400000);
      var ctgRatio = Math.max(0, Math.min(1, 1 - ctgDays / 14));
      score += Math.round(ctgRatio * ctgRatio * 25);
    }

    // Deadline proximity
    if (this.deadline) {
      var ds = this.getDeadlineState();
      if (ds) {
        var totalDays = 90;
        if (this.effortEstimate && this.weeklyCommitment) {
          totalDays = Math.round((this.effortEstimate / this.weeklyCommitment) * 7);
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
    if (!_suppressSideEffects && this.next_action_date) {
      if (OAD.getDayLoad(this.next_action_date) > 150) score += 12;
    }

    // Overdue next_action_date
    if (this.isOverdue()) {
      score += Math.min(40, this.getDaysOverdue() * 5);
    }

    // Escalation: Shift Collision
    if (this.next_action_date && window.OAD && OAD.Config && OAD.Config.demoMode && OAD._demoRole && OAD.isOffDay) {
      if (OAD.isOffDay(this.next_action_date, OAD._demoRole)) {
        score += 40;
      }
    }

    // Escalation: CIC Discharge Readiness
    if (window.OAD && window.OAD.CIC && window.OAD.CIC.checkDischargeReadiness) {
      var cicScore = window.OAD.CIC.checkDischargeReadiness(this);
      if (cicScore > 0) {
        score += cicScore;
        if (!this.focusReason) this.focusReason = '⚠ MISSING DISCHARGE LOC';
        else this.focusReason += ' · ⚠ MISSING DISCHARGE LOC';
      }
    }

    var capped = Math.min(score, 100);
    if (this.status === 'waiting' && this.user_action_complete) {
      capped = Math.round(capped * 0.35);
    }

    // Transitive blocking propagation
    if (!_suppressSideEffects || _visited) {
      var visited = _visited || {};
      visited[this.uuid] = true;
      var ctx = this.getGraphContext();
      var maxBlockerPressure = 0;
      (ctx.blockedBy || []).forEach(function (blocker) {
        if (visited[blocker.uuid]) return;
        var bp = typeof blocker.getPressure === 'function' 
                 ? blocker.getPressure(false, visited) 
                 : OAD.pressure(blocker, false, visited);
        if (bp > maxBlockerPressure) maxBlockerPressure = bp;
      });
      if (maxBlockerPressure > capped) capped = maxBlockerPressure;
    }

    return capped;
  }

  isBlocked() {
    var ctx = this.getGraphContext();
    return ctx.blockedBy.length > 0;
  }

  getGraphContext() {
    var threadId = this.id;
    var thread = this;
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
  }
}

class Track extends Thread {
  constructor(data) {
    super(data);
  }

  getEarliestActiveStage() {
    var ctx = this.getGraphContext();
    var applications = (ctx.enables || [])
      .map(function (e) { return e.thread; })
      .filter(function (t) { return t && t.status !== 'closed' && t.stage !== 'rejected'; });

    if (!applications.length) {
      return { stage: 'applied', stageIndex: 0, applicationCount: 0 };
    }

    var earliest = null;
    var stages = window.OAD.APPLICATION_STAGES || ['applied', 'screening', 'interview', 'offer'];
    applications.forEach(function (app) {
      var stage = app.stage || 'applied';
      var idx = stages.indexOf(stage);
      if (idx === -1) idx = 0;
      if (earliest === null || idx < earliest.stageIndex) {
        earliest = { stage: stage, stageIndex: idx };
      }
    });
    return { stage: earliest.stage, stageIndex: earliest.stageIndex, applicationCount: applications.length };
  }

  estimateRemainingWeeks(benchmark) {
    var earliest = this.getEarliestActiveStage();
    var stages = window.OAD.APPLICATION_STAGES || ['applied', 'screening', 'interview', 'offer'];
    var totalStages = stages.length;
    var remainingFraction = (totalStages - earliest.stageIndex) / totalStages;
    return {
      minWeeks: Math.round(benchmark.minWeeks * remainingFraction),
      maxWeeks: Math.round(benchmark.maxWeeks * remainingFraction)
    };
  }

  calculateRunwayRisk(goalThread) {
    if (!goalThread || !goalThread.deadline) return null;

    var todayStr = OAD.todayStr ? OAD.todayStr() : new Date().toISOString().slice(0, 10);
    var deadline = new Date(goalThread.deadline + 'T00:00:00');
    var benchmarks = (OAD.Config && OAD.Config.runwayBenchmarks) || {};

    var t = (this.title || '').toLowerCase();
    var benchmarkKey = null;
    if (t.indexOf('federal') !== -1) benchmarkKey = 'federal';
    else if (t.indexOf('commercial') !== -1) benchmarkKey = 'commercial';

    var benchmark = benchmarkKey ? benchmarks[benchmarkKey] : null;
    if (!benchmark) return null;

    var earliest = this.getEarliestActiveStage();
    var remaining = this.estimateRemainingWeeks(benchmark);

    var projected = new Date(todayStr + 'T00:00:00');
    projected.setDate(projected.getDate() + remaining.maxWeeks * 7);
    var atRisk = projected >= deadline;

    var deadlineLabel = OAD.formatDate ? OAD.formatDate(goalThread.deadline) : goalThread.deadline;
    var s = (OAD.Config && OAD.Config.runwayRiskStrings) || {
      atRiskTemplate: 'At current pipeline stage ({count} application(s), earliest at {stage}) and known {label} timelines (~{min}-{max} weeks remaining), "{track}" cannot realistically convert before {deadline} without acceleration.',
      onTrackTemplate: '"{track}" is mathematically on track to convert before {deadline} at current pace.'
    };

    var sentence = atRisk
      ? s.atRiskTemplate
          .replace('{count}', earliest.applicationCount)
          .replace('{stage}', earliest.stage)
          .replace('{label}', benchmark.label)
          .replace('{min}', remaining.minWeeks)
          .replace('{max}', remaining.maxWeeks)
          .replace('{track}', this.title)
          .replace('{deadline}', deadlineLabel)
      : s.onTrackTemplate
          .replace('{track}', this.title)
          .replace('{deadline}', deadlineLabel);

    return {
      trackTitle: this.title,
      trackUuid: this.uuid,
      benchmarkKey: benchmarkKey,
      stage: earliest.stage,
      applicationCount: earliest.applicationCount,
      estimatedMinWeeks: remaining.minWeeks,
      estimatedMaxWeeks: remaining.maxWeeks,
      atRisk: atRisk,
      sentence: sentence
    };
  }
}

class Cadence {
  constructor(data) {
    Object.assign(this, data);
  }

  isOverdue() {
    if (!this.next_due) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(this.next_due + 'T00:00:00');
    return due < today;
  }

  isDoneThisPeriod() {
    const today = OAD.todayStr();
    const overdue = this.isOverdue();
    if (overdue) return false;
    
    const dueToday = this.next_due === today;
    if (dueToday && this.last_completed === today) return true;

    const prevDue = OAD.prevCadenceDue(this.recurrence, this.days_of_week);
    return !!(this.last_completed && prevDue && this.last_completed >= prevDue);
  }
}

class Habit {
  constructor(data) {
    Object.assign(this, data);
  }
}

class Idea {
  constructor(data) {
    Object.assign(this, data);
  }
}

class ThreadCollection {
  constructor(threads) {
    this.threads = threads || [];
  }

  getLifeAreaHeat() {
    var map = {};
    (this.threads || []).forEach(function (t) {
      if (t.status === 'closed' || t.status === 'dormant' || t.status === 'inbox') return;
      var a = t.life_area || 'Other';
      if (!map[a]) map[a] = { count: 0, total: 0, stalled: 0 };
      map[a].count++;
      map[a].total += typeof t.getPressure === 'function' ? t.getPressure() : OAD.pressure(t);
      if (t.status === 'stalled') map[a].stalled++;
    });
    return Object.keys(map).map(function (name) {
      var d = map[name];
      return { name: name, count: d.count, avgPressure: d.count ? Math.round(d.total / d.count) : 0, stalled: d.stalled };
    }).sort(function (a, b) { return b.avgPressure - a.avgPressure; });
  }

  getDayLoad(dateStr) {
    if (!dateStr) return 0;
    return this.threads
      .filter(function (t) {
        return t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox' && t.next_action_date === dateStr;
      })
      .reduce(function (sum, t) { 
        return sum + (typeof t.getPressure === 'function' ? t.getPressure(true) : OAD.pressure(t, true)); 
      }, 0);
  }

  getFocusUUID() {
    return OAD.getFocusUUID(this.threads);
  }
}

class QueueManager {
  constructor(threads, cadences) {
    this.threads = threads || [];
    this.cadences = cadences || [];
  }

  getActiveThreadsRaw() {
    return this.threads.filter(function (t) {
      return t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox';
    });
  }

  getActiveThreads() {
    return this.getActiveThreadsRaw()
      .map(function (t) { return Object.assign({}, t, { _score: typeof t.getPressure === 'function' ? t.getPressure() : OAD.pressure(t) }); })
      .sort(function (a, b) { return b._score - a._score; });
  }

  getSuppressionContext(activeThreads, todayStr, focusUUID, horizonStr) {
    var activeByUUID = {};
    activeThreads.forEach(function (t) { activeByUUID[t.uuid] = t; });

    var childrenByParentUUID = {};
    activeThreads.forEach(function (t) {
      if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
        (childrenByParentUUID[t.parent_uuid] = childrenByParentUUID[t.parent_uuid] || []).push(t);
      }
    });

    var suppressedUUIDs = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, focusUUID, horizonStr);
    var visibleThreads = activeThreads.filter(function (t) { return !suppressedUUIDs.has(t.uuid); });

    return { activeByUUID: activeByUUID, childrenByParentUUID: childrenByParentUUID, suppressedUUIDs: suppressedUUIDs, visibleThreads: visibleThreads };
  }

  getBuckets(visibleThreads, todayStr, in7Str) {
    return {
      overdue: visibleThreads.filter(function(t) { return typeof t.isActionOverdue === 'function' ? t.isActionOverdue() : OAD.isActionOverdue(t); }),
      today:   visibleThreads.filter(function (t) { return t.next_action_date === todayStr && !(typeof t.isActionOverdue === 'function' ? t.isActionOverdue() : OAD.isActionOverdue(t)); }),
      week:    visibleThreads.filter(function (t) { return t.next_action_date > todayStr && t.next_action_date <= in7Str && !(typeof t.isActionOverdue === 'function' ? t.isActionOverdue() : OAD.isActionOverdue(t)); })
                 .sort(function (a, b) { return a.next_action_date.localeCompare(b.next_action_date); }),
      noDate:  visibleThreads.filter(function (t) { return !t.next_action_date || t.next_action_date > in7Str; })
    };
  }

  isCadenceDueOn(cadence, dateStr) {
    var overdue = typeof cadence.isOverdue === 'function' ? cadence.isOverdue() : OAD.cadenceOverdue(cadence);
    var done = typeof cadence.isDoneThisPeriod === 'function' ? cadence.isDoneThisPeriod() : OAD.cadenceDoneThisPeriod(cadence);
    return !overdue && cadence.next_due === dateStr && !done;
  }

  getCadenceBuckets(todayStr, in7Str) {
    var self = this;
    return {
      overdue: this.cadences.filter(function(c) { return typeof c.isOverdue === 'function' ? c.isOverdue() : OAD.cadenceOverdue(c); }),
      today:   this.cadences.filter(function (c) { return self.isCadenceDueOn(c, todayStr); }),
      week:    this.cadences.filter(function (c) {
                 var overdue = typeof c.isOverdue === 'function' ? c.isOverdue() : OAD.cadenceOverdue(c);
                 var done = typeof c.isDoneThisPeriod === 'function' ? c.isDoneThisPeriod() : OAD.cadenceDoneThisPeriod(c);
                 return !overdue && c.next_due > todayStr && c.next_due <= in7Str && !done;
               }).sort(function (a, b) { return a.next_due.localeCompare(b.next_due); })
    };
  }

  getDashboardData(todayStr, in7Str) {
    var active = this.getActiveThreads();
    var focusUUID = OAD.getFocusUUID(active);
    var ctx = this.getSuppressionContext(active, todayStr, focusUUID, in7Str);
    var buckets = this.getBuckets(ctx.visibleThreads, todayStr, in7Str);
    return Object.assign({ active: active, focusUUID: focusUUID }, ctx, buckets);
  }
}

class Graph {
  constructor(threads) {
    this.threads = threads || [];
  }

  detectCycles(force) {
    var now = Date.now();
    if (!force && this._cyclesCache && (now - this._cyclesCacheTime < 100)) {
      return this._cyclesCache;
    }

    var openThreads = this.threads.filter(function(t) { return t.status !== 'closed'; });
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

    this._cyclesCache = uniqueCycles;
    this._cyclesCacheTime = now;
    return uniqueCycles;
  }

  calculateCriticalPath(threadId, visited) {
    visited = visited || new Set();
    var thread = this.threads.find(function(t) { return t.id === threadId; });
    if (!thread || thread.status === 'closed') return { weight: 0, path: [] };
    
    if (visited.has(threadId)) return { weight: 0, path: [] };
    visited.add(threadId);

    var threads = this.threads;
    
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

    var weight = thread.getPressure ? thread.getPressure(true) : 0;
    var maxPathWeight = 0;
    var maxPath = [];

    targets.forEach((t) => {
      var sub = this.calculateCriticalPath(t.id, new Set(visited));
      if (sub.weight > maxPathWeight) {
        maxPathWeight = sub.weight;
        maxPath = sub.path;
      }
    });

    return {
      weight: weight + maxPathWeight,
      path: [threadId].concat(maxPath)
    };
  }
}

OAD.Models.Thread = Thread;
OAD.Models.Cadence = Cadence;
OAD.Models.Habit = Habit;
OAD.Models.Idea = Idea;
OAD.Models.ThreadCollection = ThreadCollection;
OAD.Models.Graph = Graph;
OAD.Models.Track = Track;
OAD.Models.QueueManager = QueueManager;
