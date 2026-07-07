window.OAD = window.OAD || {};
OAD.Due = {};

// Status-filtered, demo-scoped, NOT pressure-scored. Safe to call from anywhere, including
// from inside OAD.pressure()'s own call chain via getDayLoad — never calls OAD.pressure(),
// so it can't recurse.
OAD.Due.activeThreadsRaw = function () {
  var q = new window.OAD.Models.QueueManager(OAD.getVisibleThreads() || [], []);
  return q.getActiveThreadsRaw();
};

// Pressure-scored + sorted convenience wrapper for surfaces that display/rank threads.
// NOT safe to call from within OAD.pressure() itself (see getDayLoad in engine.js) — this is
// the layer that must stay separate from activeThreadsRaw to avoid infinite recursion:
// OAD.pressure() (unsuppressed) calls OAD.getDayLoad(), which must not turn around and call
// this function, since this function calls OAD.pressure() on every thread.
OAD.Due.activeThreads = function () {
  var q = new window.OAD.Models.QueueManager(OAD.getVisibleThreads() || [], []);
  return q.getActiveThreads();
};

// The activeByUUID/childrenByParentUUID/computeSuppressedChildUUIDs block that used to be
// copy-pasted identically across renderTodayView/renderDailyView/renderMatrixView.
OAD.Due.suppressionContext = function (activeThreads, todayStr, focusUUID, horizonStr) {
  var q = new window.OAD.Models.QueueManager([], []);
  return q.getSuppressionContext(activeThreads, todayStr, focusUUID, horizonStr);
};

/**
 * Groups visible threads into mutually exclusive temporal buckets:
 * Overdue, Today, Week (up to 7 days out), and No Date.
 */
OAD.Due.buckets = function (visibleThreads, todayStr, in7Str) {
  var q = new window.OAD.Models.QueueManager([], []);
  return q.getBuckets(visibleThreads, todayStr, in7Str);
};

// Whether a cadence counts as "due" on a specific calendar day — not overdue (relative to
// actual today, not dateStr), its next_due matches dateStr exactly, and it hasn't already
// been completed for this period. This is the one true predicate for "does this cadence
// belong on day X" — cadenceBuckets below is just this applied to today/the week window, and
// any other per-day tally (e.g. This Week's Load's daily heatmap) must go through this too
// rather than re-deriving its own `next_due === dateStr` check, which silently double-counts
// already-completed cadences (confirmed bug: a cadence due today but already marked done
// today was still being tallied into that day's item count by a hand-rolled check that skipped
// this exclusion).
OAD.Due.isCadenceDueOn = function (cadence, dateStr) {
  var q = new window.OAD.Models.QueueManager([], []);
  return q.isCadenceDueOn(cadence, dateStr);
};

// Cadence overdue/today/week split — mirrors the cadence filter that used to be duplicated
// 3x in render.js.
OAD.Due.cadenceBuckets = function (cadences, todayStr, in7Str) {
  var q = new window.OAD.Models.QueueManager([], cadences);
  return q.getCadenceBuckets(todayStr, in7Str);
};

// One call for the full dashboard pipeline. Scores the active list exactly once — getFocusUUID
// and the suppression/bucket pipeline below all reuse this same scored array.
OAD.Due.dashboardData = function (todayStr, in7Str) {
  var q = new window.OAD.Models.QueueManager(OAD.getVisibleThreads() || [], []);
  return q.getDashboardData(todayStr, in7Str);
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
