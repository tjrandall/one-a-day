window.OAD = window.OAD || {};
OAD.Due = {};

// Status-filtered, demo-scoped, NOT pressure-scored. Safe to call from anywhere, including
// from inside OAD.pressure()'s own call chain via getDayLoad — never calls OAD.pressure(),
// so it can't recurse.
OAD.Due.activeThreadsRaw = function () {
  return (OAD.getVisibleThreads() || [])
    .filter(function (t) { return t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox'; });
};

// Pressure-scored + sorted convenience wrapper for surfaces that display/rank threads.
// NOT safe to call from within OAD.pressure() itself (see getDayLoad in engine.js) — this is
// the layer that must stay separate from activeThreadsRaw to avoid infinite recursion:
// OAD.pressure() (unsuppressed) calls OAD.getDayLoad(), which must not turn around and call
// this function, since this function calls OAD.pressure() on every thread.
OAD.Due.activeThreads = function () {
  return OAD.Due.activeThreadsRaw()
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });
};

// The activeByUUID/childrenByParentUUID/computeSuppressedChildUUIDs block that used to be
// copy-pasted identically across renderTodayView/renderDailyView/renderMatrixView.
OAD.Due.suppressionContext = function (activeThreads, todayStr, focusUUID, horizonStr) {
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
};

// The Overdue / Today / Week / No-Date split (renderDailyView's shape). Mirrors current
// behavior exactly: "today" does NOT exclude threads also caught by "overdue" (a thread due
// today with a passed next_action_time is both) — existing behavior, not changed here.
OAD.Due.buckets = function (visibleThreads, todayStr, in7Str) {
  return {
    overdue: visibleThreads.filter(OAD.isActionOverdue),
    today:   visibleThreads.filter(function (t) { return t.next_action_date === todayStr; }),
    week:    visibleThreads.filter(function (t) { return t.next_action_date > todayStr && t.next_action_date <= in7Str; })
               .sort(function (a, b) { return a.next_action_date.localeCompare(b.next_action_date); }),
    noDate:  visibleThreads.filter(function (t) { return !t.next_action_date; })
  };
};

// Cadence overdue/today/week split — mirrors the cadence filter that used to be duplicated
// 3x in render.js.
OAD.Due.cadenceBuckets = function (cadences, todayStr, in7Str) {
  return {
    overdue: cadences.filter(OAD.cadenceOverdue),
    today:   cadences.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr && !OAD.cadenceDoneThisPeriod(c); }),
    week:    cadences.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str && !OAD.cadenceDoneThisPeriod(c); })
               .sort(function (a, b) { return a.next_due.localeCompare(b.next_due); })
  };
};

// One call for the full dashboard pipeline. Scores the active list exactly once — getFocusUUID
// and the suppression/bucket pipeline below all reuse this same scored array.
OAD.Due.dashboardData = function (todayStr, in7Str) {
  var active = OAD.Due.activeThreads();
  var focusUUID = OAD.getFocusUUID(active);
  var ctx = OAD.Due.suppressionContext(active, todayStr, focusUUID, in7Str);
  var buckets = OAD.Due.buckets(ctx.visibleThreads, todayStr, in7Str);
  return Object.assign({ active: active, focusUUID: focusUUID }, ctx, buckets);
};

// Self-diagnostic, callable from the console (OAD.Due.selfCheck()) against live data. Checks
// invariants rather than diffing parallel implementations:
//   A. No suppressed child is orphaned — its parent must actually be visible in the active
//      set, so the child-summary badge is reachable. A parent with no next_action_date
//      renders in no date bucket, so a suppressed child under it would otherwise vanish with
//      zero trace.
//   B. Focus Now's current pick is never in the suppressed set.
//   C. Every overdue-or-due-today thread is never in the suppressed set.
OAD.Due.selfCheck = function () {
  var todayStr = OAD.todayStr();
  var in7Dt = new Date(); in7Dt.setHours(0, 0, 0, 0); in7Dt.setDate(in7Dt.getDate() + 7);
  var in7Str = in7Dt.toISOString().slice(0, 10);
  var data = OAD.Due.dashboardData(todayStr, in7Str);
  var issues = [];

  data.suppressedUUIDs.forEach(function (uuid) {
    var child = data.activeByUUID[uuid];
    if (!child) return;
    var parent = data.activeByUUID[child.parent_uuid];
    var parentVisible = parent && !data.suppressedUUIDs.has(parent.uuid);
    if (!parentVisible) {
      issues.push({ type: 'orphaned_suppression', child: child.title, childUUID: child.uuid, parent: parent ? parent.title : '(missing)' });
    }
    if (OAD.isActionOverdue(child) || child.next_action_date === todayStr) {
      issues.push({ type: 'overdue_or_today_suppressed', child: child.title, childUUID: child.uuid });
    }
  });

  if (data.focusUUID && data.suppressedUUIDs.has(data.focusUUID)) {
    issues.push({ type: 'focus_pick_suppressed', uuid: data.focusUUID });
  }

  return { ok: issues.length === 0, issues: issues };
};
