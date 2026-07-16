window.OAD = window.OAD || {};

OAD._tests = [];
OAD._testResults = [];

OAD.test = function (name, fn) {
  OAD._tests.push({ name, fn });
};

OAD._runTests = async function () {
  OAD._testResults = [];
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of OAD._tests) {
    try {
      await fn();
      OAD._testResults.push({ name, ok: true });
      passed++;
    } catch (err) {
      OAD._testResults.push({ name, ok: false, error: err.message });
      failed++;
    }
  }

  return { passed, failed, total: passed + failed };
};

OAD._assert = function (condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
};

OAD._assertEqual = function (a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};

// ── Tests: engine.js ──────────────────────────────────────────────────

OAD.test('pressure: stalled adds 30', function () {
  const t = OAD.makeThread({ status: 'stalled', priority: 'low', connections: [] });
  const s = OAD.pressure(t);
  OAD._assert(s >= 30, `Expected >= 30, got ${s}`);
});

OAD.test('pressure: waiting adds 15', function () {
  const t = OAD.makeThread({ status: 'waiting', priority: 'low', connections: [] });
  const s = OAD.pressure(t);
  OAD._assert(s >= 15, `Expected >= 15, got ${s}`);
});

OAD.test('pressure: unverified assumption adds 20', function () {
  const t = OAD.makeThread({ status: 'open', priority: 'low', current_assumption: 'something', assumption_verified: false, connections: [] });
  const s = OAD.pressure(t);
  OAD._assert(s >= 20, `Expected >= 20, got ${s}`);
});

OAD.test('pressure: verified assumption does not add 20', function () {
  const t = OAD.makeThread({ status: 'open', priority: 'low', current_assumption: 'something', assumption_verified: true, connections: [] });
  const s = OAD.pressure(t);
  OAD._assert(s < 20, `Expected < 20, got ${s}`);
});

OAD.test('pressure: critical adds 30', function () {
  const t = OAD.makeThread({ status: 'open', priority: 'critical', connections: [] });
  const s = OAD.pressure(t);
  OAD._assert(s >= 30, `Expected >= 30, got ${s}`);
});

OAD.test('pressure: unresolvable blocking connections (no to_uuid) add nothing', function () {
  // Ghost targets (to_label only, no real thread to resolve) can never appear in anyone's
  // blockedBy, so they must not inflate pressure — replaces the old flat +10-per-edge fallback.
  const t = OAD.makeThread({ status: 'open', priority: 'low', connections: [
    { to_label: 'A', edge_type: 'blocks' },
    { to_label: 'B', edge_type: 'blocks' }
  ]});
  const t0 = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  OAD._assertEqual(OAD.pressure(t), OAD.pressure(t0), 'unresolvable blocks edges on THIS thread should not change its own pressure');
});

OAD.test('pressure: propagates from a real blocker up to the blocked thread (not the reverse)', function () {
  const originalThreads = OAD.DB.threads;
  try {
    // SDVOSB holds the outbound 'blocks' edge pointing at Federal Contracting — matches the
    // real edge-creation convention (_adeAddEdge: the prerequisite holds the edge).
    const fedContracting = { id: 601, uuid: 'pt-fc', title: 'Federal Contracting', status: 'open', priority: 'medium', connections: [] };
    const sdvosb = { id: 602, uuid: 'pt-sdvosb', title: 'SDVOSB', status: 'stalled', priority: 'critical',
      connections: [{ to_uuid: 'pt-fc', to_label: 'Federal Contracting', edge_type: 'blocks' }] };
    OAD.DB.threads = [fedContracting, sdvosb];

    const fcPressure = OAD.pressure(fedContracting);
    const sdvosbPressure = OAD.pressure(sdvosb);
    OAD._assertEqual(fcPressure, sdvosbPressure, 'blocked parent should rise to match its blocker\'s pressure');
    OAD._assert(fcPressure > 10, 'parent pressure should reflect the urgent blocker, not just its own low baseline');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: transitive propagation walks multiple hops, not just one', function () {
  const originalThreads = OAD.DB.threads;
  try {
    // root -> blocks -> mid -> blocks -> leaf (root is the real bottleneck, two hops from leaf)
    const leaf = { id: 611, uuid: 'pt-leaf', title: 'Leaf', status: 'open', priority: 'low', connections: [] };
    const mid  = { id: 612, uuid: 'pt-mid', title: 'Mid', status: 'open', priority: 'low',
      connections: [{ to_uuid: 'pt-leaf', to_label: 'Leaf', edge_type: 'blocks' }] };
    const root = { id: 613, uuid: 'pt-root', title: 'Root', status: 'stalled', priority: 'critical',
      connections: [{ to_uuid: 'pt-mid', to_label: 'Mid', edge_type: 'blocks' }] };
    OAD.DB.threads = [leaf, mid, root];

    const rootPressure = OAD.pressure(root);
    const leafPressure = OAD.pressure(leaf);
    OAD._assertEqual(leafPressure, rootPressure, 'leaf should inherit the root blocker\'s pressure two hops away');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: transitive propagation is cycle-safe (does not infinite-loop or throw)', function () {
  const originalThreads = OAD.DB.threads;
  try {
    // a -> blocks -> b -> blocks -> a (a genuine cycle)
    const a = { id: 621, uuid: 'pt-a', title: 'A', status: 'open', priority: 'low',
      connections: [{ to_uuid: 'pt-b', to_label: 'B', edge_type: 'blocks' }] };
    const b = { id: 622, uuid: 'pt-b', title: 'B', status: 'open', priority: 'low',
      connections: [{ to_uuid: 'pt-a', to_label: 'A', edge_type: 'blocks' }] };
    OAD.DB.threads = [a, b];

    let result;
    OAD._assert((function () { try { result = OAD.pressure(a); return true; } catch (e) { return false; } })(),
      'pressure() must not throw on a cyclic blocking graph');
    OAD._assert(typeof result === 'number' && result >= 0 && result <= 100, 'pressure on a cycle member should still be a valid 0-100 score');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: enables connection does not add pressure', function () {
  const t1 = OAD.makeThread({ status: 'open', priority: 'low', connections: [{ to_label: 'A', edge_type: 'enables' }] });
  const t2 = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  OAD._assertEqual(OAD.pressure(t1), OAD.pressure(t2), 'enables should not change pressure');
});

// ── Tests: dormant pass-through in pressure propagation ──────────────
// Per ticket-pressure-propagation-and-critical-load.md: a dormant blocker's own getPressure()
// short-circuits to 0 before the transitive walk ever runs, so it previously acted as a full
// propagation dead end — real, confirmed example: VR&E Coordination -> CAC102 (dormant) ->
// Federal/Commercial tracks was silently understated. A dormant thread must keep showing 0 for
// its OWN pressure (a separate, pre-existing, deliberate invariant), but must not block
// propagation from reaching whatever it's blocked by.

OAD.test('pressure: propagation walks THROUGH a dormant blocker to reach its own blocker, instead of stopping dead', function () {
  const originalThreads = OAD.DB.threads;
  try {
    // real, dormant -> blocks -> target
    const realBlocker = { id: 701, uuid: 'pt-real', title: 'Real high-pressure blocker', status: 'open', priority: 'critical',
      connections: [{ to_uuid: 'pt-dormant', to_label: 'Dormant middleman', edge_type: 'blocks' }] };
    const dormantMiddleman = { id: 702, uuid: 'pt-dormant', title: 'Dormant middleman', status: 'dormant', priority: 'low',
      connections: [{ to_uuid: 'pt-target', to_label: 'Target', edge_type: 'blocks' }] };
    const target = { id: 703, uuid: 'pt-target', title: 'Target', status: 'open', priority: 'low', connections: [] };
    OAD.DB.threads = [realBlocker, dormantMiddleman, target];

    OAD._assertEqual(OAD.pressure(dormantMiddleman), 0, 'the dormant middleman must still show 0 for its own pressure — unchanged invariant');
    OAD._assertEqual(OAD.pressure(target), OAD.pressure(realBlocker), 'the target must inherit the REAL blocker\'s pressure through the dormant middleman, not stop at 0');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: dormant pass-through works through inbox blockers too, and through multiple consecutive dormant/inbox links', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const realBlocker = { id: 711, uuid: 'pt2-real', title: 'Real blocker', status: 'open', priority: 'critical',
      connections: [{ to_uuid: 'pt2-dormant1', to_label: 'Dormant 1', edge_type: 'blocks' }] };
    const dormant1 = { id: 712, uuid: 'pt2-dormant1', title: 'Dormant 1', status: 'dormant', priority: 'low',
      connections: [{ to_uuid: 'pt2-inbox', to_label: 'Inbox link', edge_type: 'blocks' }] };
    const inboxLink = { id: 713, uuid: 'pt2-inbox', title: 'Inbox link', status: 'inbox', priority: 'low',
      connections: [{ to_uuid: 'pt2-target', to_label: 'Target', edge_type: 'blocks' }] };
    const target = { id: 714, uuid: 'pt2-target', title: 'Target', status: 'open', priority: 'low', connections: [] };
    OAD.DB.threads = [realBlocker, dormant1, inboxLink, target];

    OAD._assertEqual(OAD.pressure(target), OAD.pressure(realBlocker), 'pass-through must chain through consecutive dormant AND inbox links to reach the real blocker');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: dormant pass-through does not fire when the dormant blocker has no real blocker of its own', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const dormantDeadEnd = { id: 721, uuid: 'pt3-dormant', title: 'Genuinely dead end', status: 'dormant', priority: 'critical', connections: [] };
    const target = { id: 722, uuid: 'pt3-target', title: 'Target', status: 'open', priority: 'low',
      connections: [{ to_uuid: 'pt3-dormant', to_label: 'Genuinely dead end', edge_type: 'blocked_by' }] };
    OAD.DB.threads = [dormantDeadEnd, target];

    const targetOwnScore = OAD.pressure(Object.assign({}, target, { connections: [] }));
    OAD._assertEqual(OAD.pressure(target), targetOwnScore, 'a dormant blocker with nothing behind it must not inflate the target\'s pressure at all — priority alone (critical, on the dormant thread) must never leak through');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('pressure: dormant pass-through is cycle-safe (a cycle running through a dormant node does not infinite-loop)', function () {
  const originalThreads = OAD.DB.threads;
  try {
    // a (open) -> blocks -> b (dormant) -> blocks -> a (a genuine cycle through a dormant node)
    const a = { id: 731, uuid: 'pt4-a', title: 'A', status: 'open', priority: 'low',
      connections: [{ to_uuid: 'pt4-b', to_label: 'B', edge_type: 'blocks' }] };
    const b = { id: 732, uuid: 'pt4-b', title: 'B', status: 'dormant', priority: 'low',
      connections: [{ to_uuid: 'pt4-a', to_label: 'A', edge_type: 'blocks' }] };
    OAD.DB.threads = [a, b];

    let result;
    OAD._assert((function () { try { result = OAD.pressure(a); return true; } catch (e) { return false; } })(),
      'pressure() must not throw on a cyclic graph that passes through a dormant node');
    OAD._assert(typeof result === 'number' && result >= 0 && result <= 100, 'pressure on a cycle member (through a dormant pass-through) must still be a valid 0-100 score');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

// ── Tests: _runJuly2Cac102EdgeTypeFixV1 ──────────────────────────────

OAD.test('_runJuly2Cac102EdgeTypeFixV1: backfills null edge_type matched by connection uuid, and unblocks propagation', function () {
  const originalThreads = OAD.DB.threads;
  const originalPersona = OAD.DB.persona;
  try {
    OAD.DB.persona = Object.assign({}, originalPersona, { _july2Cac102EdgeTypeFixV1Done: false });

    const fixUuid = OAD._CAC102_EDGE_TYPE_FIXES[0].edge_uuid;
    const fixFromUuid = OAD._CAC102_EDGE_TYPE_FIXES[0].from_uuid;

    const assignment = {
      id: 641, uuid: fixFromUuid, title: 'CAC102 Assignment fixture', status: 'stalled', priority: 'critical',
      connections: [{ uuid: fixUuid, to_uuid: 'cac102-completion-2026', to_label: 'eCornell CAC102', edge_type: null }]
    };
    const completion = { id: 642, uuid: 'cac102-completion-2026', title: 'eCornell CAC102', status: 'open', priority: 'low', connections: [] };
    OAD.DB.threads = [assignment, completion];

    // Before the fix: null edge_type means blockedBy resolution can't see this relationship at all.
    OAD._assertEqual(OAD.getGraphContext(completion.id).blockedBy.length, 0, 'before fix: completion thread sees no blockers');

    const fixedCount = OAD._runJuly2Cac102EdgeTypeFixV1();
    OAD._assertEqual(fixedCount, 1, 'only the one fixture thread present should be fixed; other 21 patch entries have no matching thread in this isolated DB');
    OAD._assertEqual(assignment.connections[0].edge_type, 'blocks', 'edge_type backfilled to blocks');

    // After the fix: the (stalled/critical) assignment now blocks completion, and pressure propagates.
    const ctx = OAD.getGraphContext(completion.id);
    OAD._assertEqual(ctx.blockedBy.length, 1, 'after fix: completion thread sees exactly one blocker');
    OAD._assertEqual(OAD.pressure(completion), OAD.pressure(assignment), 'completion pressure should now match its (higher) blocker');

    OAD._assert(OAD.DB.persona._july2Cac102EdgeTypeFixV1Done, 'guard flag set after running');
    const secondRunCount = OAD._runJuly2Cac102EdgeTypeFixV1();
    OAD._assertEqual(secondRunCount, 0, 'guarded — second run is a no-op');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.DB.persona = originalPersona;
  }
});

OAD.test('pressure: capped at 100', function () {
  const past = new Date(); past.setDate(past.getDate() - 30);
  const t = OAD.makeThread({
    status: 'stalled',
    priority: 'critical',
    current_assumption: 'x',
    assumption_verified: false,
    next_action_date: _localDateStr(past),
    connections: []
  });
  OAD._assertEqual(OAD.pressure(t), 100, 'pressure should cap at 100');
});

OAD.test('pressure: contingency adds more pressure when closer (quadratic curve)', function () {
  const d = function (offset) {
    const dt = new Date(); dt.setDate(dt.getDate() + offset);
    return _localDateStr(dt);
  };
  const base = { status: 'open', priority: 'low', connections: [] };
  const tNear = OAD.makeThread(Object.assign({}, base, { contingency_trigger_date: d(1) }));
  const tMid  = OAD.makeThread(Object.assign({}, base, { contingency_trigger_date: d(7) }));
  const tFar  = OAD.makeThread(Object.assign({}, base, { contingency_trigger_date: d(13) }));
  const sNear = OAD.pressure(tNear);
  const sMid  = OAD.pressure(tMid);
  const sFar  = OAD.pressure(tFar);
  OAD._assert(sNear > sMid,  'contingency tomorrow > contingency in 7 days');
  OAD._assert(sMid  > sFar,  'contingency in 7 days > contingency in 13 days');
  OAD._assert(sNear > 0,     'contingency tomorrow adds nonzero pressure');
});

// ── Tests: exportThreads ─────────────────────────────────────────────

OAD.test('exportThreads: includes full thread data, excludes ai_insights and persona', function () {
  const t = OAD.addThread(OAD.makeThread({
    title: 'Export subject',
    status: 'open', priority: 'high', life_area: 'Career',
    closing_condition: 'Offer letter signed',
    next_action: 'Send follow-up', next_action_date: '2026-07-01',
    connections: [{ to_uuid: 'abc-123', to_label: 'Blocker thread', edge_type: 'blocks' }],
    current_assumption: 'They will reply', assumption_verified: false,
    deadline: '2026-08-01', effortEstimate: 4, weeklyCommitment: 1,
    parent_uuid: null,
    ai_insights: [{ observation: 'Secret counsel' }]
  }));
  OAD.addEvolution(t.id, 'Did a thing');

  const parsed = JSON.parse(OAD.exportThreads());
  const row = parsed.threads.find(function (x) { return x.uuid === t.uuid; });

  OAD._assert(!!row,                                  'thread present in export (matched by uuid)');
  OAD._assert('uuid'                     in row,      'uuid included');
  OAD._assert('parent_uuid'              in row,      'parent_uuid included');
  OAD._assert('title'                    in row,      'title included');
  OAD._assert('status'                   in row,      'status included');
  OAD._assert('priority'                 in row,      'priority included');
  OAD._assert('life_area'                in row,      'life_area included');
  OAD._assert('pressure'                 in row,      'pressure included');
  OAD._assert('closing_condition'        in row,      'closing_condition included');
  OAD._assert(!('current_assumption' in row),         'current_assumption excluded');
  OAD._assert('assumption_verified'      in row,      'assumption_verified included');
  OAD._assert('next_action'              in row,      'next_action included');
  OAD._assert('next_action_date'         in row,      'next_action_date included');
  OAD._assert('deadline'                 in row,      'deadline included');
  OAD._assert('effortEstimate'           in row,      'effortEstimate included');
  OAD._assert('connections'            in row,        'connections included');
  OAD._assert(Array.isArray(row.connections),         'connections is array');
  OAD._assert(!('evolution_log' in row),              'evolution_log excluded');
  OAD._assert(!('ai_insights' in row),               'ai_insights excluded');
  OAD._assert('exported_at'   in parsed,             'export has timestamp');
  OAD._assert('thread_count'  in parsed,             'export has thread_count');
  OAD._assert('edges'         in parsed,             'export has top-level edges array');
  OAD._assert('edge_count'    in parsed,             'export has edge_count');
  OAD._assert('deleted_edge_uuids' in parsed,        'export has deleted_edge_uuids');
  OAD._assert(Array.isArray(parsed.edges),           'top-level edges is array');
});

// Per ARCHITECTURE_RULES.md Rule 1 (ticket-flowqueue-data-model-migration.md Step 4), cadences
// are Threads with thread_kind:'cadence' — there is no separate cadence export/import/diff
// pipeline anymore. A cadence-shaped row flows through the exact same threads/create/update
// path as any other thread, matched by uuid; deletion goes through the same deleted_uuids →
// results.close mechanism (js/data.js OAD.applyImport branches to a real delete for
// thread_kind:'cadence' specifically, preserving the original "no reopen" semantic).

OAD.test('exportThreads: a cadence-thread\'s recurrence fields are present on its row, no separate top-level cadences array', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    const c = OAD.addCadence(OAD.makeCadence({ title: 'Export cadence test', recurrence: 'monthly-1st', last_completed: '2026-06-01', next_due: '2026-07-01', notes: 'note text', consequences: 'consequence text' }));
    const parsed = JSON.parse(OAD.exportThreads());
    OAD._assert(!('cadences' in parsed), 'export must not have a separate top-level cadences array anymore');
    const row = parsed.threads.find(function (t) { return t.uuid === c.uuid; });
    OAD._assert(!!row, 'the cadence thread must be present in the main threads export');
    OAD._assertEqual(row.thread_kind, 'cadence', 'exported row must carry the cadence discriminator');
    OAD._assertEqual(row.recurrence, 'monthly-1st', 'recurrence round-trips');
    OAD._assertEqual(row.next_due, '2026-07-01', 'next_due round-trips');
    OAD._assertEqual(row.notes, 'note text', 'notes round-trips');
    OAD._assertEqual(row.consequences, 'consequence text', 'consequences round-trips');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('parseImportFile: a cadence-shaped thread row with no uuid goes to the same create list as any other thread', function () {
  const json = JSON.stringify({ threads: [{ title: 'New cadence via import', thread_kind: 'cadence', recurrence: 'weekly' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.create.length, 1, 'one thread queued for create');
  OAD._assertEqual(results.create[0].thread_kind, 'cadence', 'the queued row carries the cadence discriminator');
});

OAD.test('parseImportFile: a cadence-shaped thread row matching an existing uuid goes to the same update list as any other thread', function () {
  const origThreads = OAD.DB.threads;
  try {
    const existing = OAD.addCadence(OAD.makeCadence({ uuid: 'cad-uuid-5002', title: 'Existing cadence', recurrence: 'weekly', next_due: '2026-07-01' }));
    const json = JSON.stringify({ threads: [{ uuid: 'cad-uuid-5002', title: 'Existing cadence', thread_kind: 'cadence', next_due: '2026-07-15' }] });
    const results = OAD.parseImportFile(json);
    OAD._assertEqual(results.update.length, 1, 'one thread queued for update');
    OAD._assertEqual(results.create.length, 0, 'none queued for create');
    OAD._assertEqual(results.update[0].existing.uuid, 'cad-uuid-5002', 'correct cadence matched by uuid');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('applyImport: creates a new cadence-thread from import', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    const results = { create: [{ title: 'Imported cadence', thread_kind: 'cadence', recurrence: 'monthly-1st', next_due: '2026-08-01' }], update: [], close: [] };
    const result = OAD.applyImport(results, []);
    OAD._assertEqual(result.created, 1, 'one thread created');
    const cadences = OAD.getCadenceThreads();
    OAD._assertEqual(cadences.length, 1, 'cadence added to DB');
    OAD._assertEqual(cadences[0].title, 'Imported cadence', 'title set correctly');
    OAD._assertEqual(cadences[0].next_due, '2026-08-01', 'next_due set correctly');
    OAD._assert(cadences[0].id != null, 'new cadence gets a real assigned id, not a fabricated one from the import row');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('applyImport: updates an existing cadence-thread\'s next_due via import (Cadence Export/Import spec)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const existing = OAD.addCadence(OAD.makeCadence({ title: 'Cadence to update', recurrence: 'weekly', next_due: '2026-07-01' }));
    const incoming = { uuid: existing.uuid, title: 'Cadence to update', recurrence: 'weekly', next_due: '2026-07-22' };
    const result = OAD.applyImport({ create: [], update: [], close: [] }, [{ incoming: incoming, existing: existing }]);
    OAD._assertEqual(result.updated, 1, 'one thread updated');
    OAD._assertEqual(OAD.getCadence(existing.id).next_due, '2026-07-22', 'next_due patched via import');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('applyImport: cadence-thread update only patches actually-changed fields', function () {
  const origThreads = OAD.DB.threads;
  try {
    const existing = OAD.addCadence(OAD.makeCadence({ title: 'Unchanged title', recurrence: 'weekly', next_due: '2026-07-01', notes: 'keep me', consequences: '' }));
    const incoming = { uuid: existing.uuid, title: 'Unchanged title', recurrence: 'weekly', next_due: '2026-07-01', notes: 'keep me', consequences: 'now set' };
    OAD.applyImport({ create: [], update: [], close: [] }, [{ incoming: incoming, existing: existing }]);
    OAD._assertEqual(OAD.getCadence(existing.id).consequences, 'now set', 'changed field patched');
    OAD._assertEqual(OAD.getCadence(existing.id).notes, 'keep me', 'unchanged field left alone');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('parseImportFile: deleted_uuids queues a matching cadence-thread for close (results.close), ignores unknown uuids', function () {
  const origThreads = OAD.DB.threads;
  try {
    const c = OAD.addCadence(OAD.makeCadence({ title: 'Duplicate cadence to remove', recurrence: 'monthly-15th' }));
    const json = JSON.stringify({ threads: [], deleted_uuids: [c.uuid, 'not-a-real-uuid'] });
    const results = OAD.parseImportFile(json);
    OAD._assertEqual(results.close.length, 1, 'only the matching thread is queued for close');
    OAD._assertEqual(results.close[0].uuid, c.uuid, 'queued close is the correct cadence');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('applyImport: hard-deletes confirmed cadence-thread deletes, leaves unconfirmed ones alone (destructive, requires explicit confirmation)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const toDelete = OAD.addCadence(OAD.makeCadence({ title: 'Duplicate to delete', recurrence: 'monthly-15th' }));
    const toKeep   = OAD.addCadence(OAD.makeCadence({ title: 'Not confirmed, should survive', recurrence: 'monthly-15th' }));
    const result = OAD.applyImport({ create: [], update: [], close: [toDelete, toKeep] }, [], [toDelete.id]);
    OAD._assertEqual(result.deleted, 1, 'one cadence deleted');
    OAD._assert(!OAD.getCadence(toDelete.id), 'confirmed cadence is actually removed');
    OAD._assert(!!OAD.getCadence(toKeep.id), 'unconfirmed cadence is left untouched — deletion is destructive, so it requires explicit confirmation unlike a regular thread close');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('applyImport: a non-cadence thread flagged in results.close always auto-applies (soft close), matching its original no-confirmation-needed behavior', function () {
  const origThreads = OAD.DB.threads;
  try {
    const t = OAD.addThread(OAD.makeThread({ title: 'Regular thread to close', status: 'open' }));
    const result = OAD.applyImport({ create: [], update: [], close: [t] }, [], []); // no confirmedDeleteIds — must still close
    OAD._assertEqual(result.closed, 1, 'one thread closed');
    OAD._assertEqual(OAD.getThread(t.id).status, 'closed', 'a regular thread close needs no confirmation, unlike a cadence delete');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('makeThread: parent_uuid defaults to null', function () {
  const t = OAD.makeThread({ title: 'Child candidate' });
  OAD._assert(Object.prototype.hasOwnProperty.call(t, 'parent_uuid'), 'parent_uuid field exists');
  OAD._assertEqual(t.parent_uuid, null, 'parent_uuid defaults to null');
});

OAD.test('pressure: blockedBy resolution uses to_uuid when present, ignores stale title', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const blocked = { id: 631, uuid: 'pt-blocked', title: 'Stall target', status: 'open', priority: 'low', connections: [] };
    // Edge stores UUID of the blocked thread; to_label is intentionally wrong (stale title)
    const blocker = { id: 632, uuid: 'pt-blocker', title: 'Blocker', status: 'stalled', priority: 'critical',
      connections: [{ to_uuid: 'pt-blocked', to_label: 'WRONG STALE TITLE', edge_type: 'blocks' }] };
    OAD.DB.threads = [blocked, blocker];

    const blockedNoConn = { id: 633, uuid: 'pt-blocked-control', title: 'Unblocked control', status: 'open', priority: 'low', connections: [] };
    const controlPressure = (function () {
      OAD.DB.threads = [blockedNoConn];
      const p = OAD.pressure(blockedNoConn);
      OAD.DB.threads = [blocked, blocker];
      return p;
    })();

    OAD._assert(OAD.pressure(blocked) > controlPressure, 'UUID-resolved blockedBy should raise the blocked thread\'s pressure even with a stale to_label');
    OAD._assertEqual(OAD.pressure(blocked), OAD.pressure(blocker), 'blocked thread should match its blocker\'s pressure exactly (uuid-resolved, not label-resolved)');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('parseImportFile: deleted_uuids populates close list', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'To be closed' }));
  const json = JSON.stringify({ threads: [], deleted_uuids: [t.uuid] });
  const results = OAD.parseImportFile(json);
  OAD._assert(!results.error, 'no error');
  OAD._assertEqual(results.close.length, 1, 'one thread queued for close');
  OAD._assertEqual(results.close[0].id, t.id, 'correct thread identified');
});

OAD.test('applyImport: closes threads in deleted_uuids', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Close me via import', status: 'open' }));
  OAD.applyImport({ create: [], update: [], close: [t] }, []);
  OAD._assertEqual(OAD.getThread(t.id).status, 'closed', 'thread status set to closed');
  OAD._assert(OAD.getThread(t.id).closing_condition_met, 'closing_condition_met set true');
});

OAD.test('applyImport: syncs connections and parent_uuid on update', function () {
  const parent = OAD.addThread(OAD.makeThread({ title: 'Parent thread' }));
  const child  = OAD.addThread(OAD.makeThread({ title: 'Child thread', parent_uuid: null }));
  const newConn = [{ to_uuid: parent.uuid, to_label: 'Parent thread', edge_type: 'enables' }];
  const updateItem = {
    incoming: { uuid: child.uuid, title: child.title, status: 'open',
      parent_uuid: parent.uuid, connections: newConn },
    existing: child
  };
  OAD.applyImport({ create: [], update: [updateItem], close: [] }, [updateItem]);
  const updated = OAD.getThread(child.id);
  OAD._assertEqual(updated.parent_uuid, parent.uuid, 'parent_uuid synced from import');
  OAD._assertEqual(updated.connections.length, 1,    'connections synced from import');
  OAD._assertEqual(updated.connections[0].to_uuid, parent.uuid, 'connection to_uuid correct');
});

OAD.test('applyImport: top-level edges merge does not re-add a stale edge type to an already-connected target', function () {
  // Real-world regression: OAD.exportThreads() always includes a full flattened `edges` array
  // mirroring every connection (see js/data.js, "Derive flat top-level edges array for
  // ADE-aware consumers"), so re-importing ANY previously-exported file round-trips it. If that
  // file predates a later edge-type correction, the OLD dedup check here
  // ((to_uuid, edge_type) match) couldn't tell "no relationship yet" apart from "already
  // reclassified since this snapshot" -- so a stale `enables` edge from an older export got
  // silently merged in right alongside an already-corrected `blocked_by` edge to the same
  // target. Confirmed happening live: a full-export reimport recreated exactly this duplicate
  // on 4 separate edges in one pass, hours after OAD._adeAddEdge's own version of this bug had
  // already been fixed -- this is a second, independent occurrence of the same root cause.
  const parent = OAD.addThread(OAD.makeThread({ title: 'Merge-edge parent', status: 'open' }));
  const child  = OAD.addThread(OAD.makeThread({ title: 'Merge-edge child', status: 'open' }));
  parent.connections = [{
    uuid: 'edge-corrected', to_uuid: child.uuid, to_label: child.title, edge_type: 'blocked_by',
    auto_generated: true, rule: 'ADE-002', confidence: 1, confirmed_by_user: true,
    created_at: '2026-01-01T00:00:00.000Z'
  }];
  const staleTopLevelEdges = [{
    id: 'edge-stale-original', from_uuid: parent.uuid, to_uuid: child.uuid, label: 'enables',
    to_label: child.title, auto_generated: true, rule: 'ADE-002', confidence: 1,
    confirmed_by_user: false, created_at: '2025-12-01T00:00:00.000Z'
  }];
  const result = OAD.applyImport({ create: [], update: [], close: [], edges: staleTopLevelEdges }, []);
  OAD._assertEqual(result.edges_merged, 0, 'a stale differently-typed edge to an already-connected target must not be merged in');
  OAD._assertEqual((parent.connections || []).length, 1, 'no duplicate edge should exist on the parent');
  OAD._assertEqual(parent.connections[0].edge_type, 'blocked_by', 'the already-corrected edge type must survive the import untouched');
});

OAD.test('applyImport: top-level edges merge still restores a genuinely deleted edge to a target with no other connection', function () {
  // Sanity check the fix isn't overbroad: this merge path exists specifically to restore edges
  // that are otherwise missing entirely -- that must keep working for a target with zero
  // existing connections.
  const parent = OAD.addThread(OAD.makeThread({ title: 'Restore-edge parent', status: 'open' }));
  const child  = OAD.addThread(OAD.makeThread({ title: 'Restore-edge child', status: 'open' }));
  parent.connections = [];
  const edges = [{
    id: 'edge-to-restore', from_uuid: parent.uuid, to_uuid: child.uuid, label: 'blocks',
    to_label: child.title, auto_generated: false, rule: null, confidence: 1,
    confirmed_by_user: true, created_at: '2026-01-01T00:00:00.000Z'
  }];
  const result = OAD.applyImport({ create: [], update: [], close: [], edges: edges }, []);
  OAD._assertEqual(result.edges_merged, 1, 'a genuinely missing edge to an unconnected target must still be restored');
  OAD._assertEqual((parent.connections || []).length, 1, 'the restored edge should now exist');
});

// ── Tests: importThreads ─────────────────────────────────────────────

OAD.test('parseImportFile: row without uuid goes to create list', function () {
  const json = JSON.stringify({ threads: [{ title: 'Brand new thread', status: 'open' }] });
  const results = OAD.parseImportFile(json);
  OAD._assert(!results.error, 'no error');
  OAD._assertEqual(results.create.length, 1, 'no uuid → create');
  OAD._assertEqual(results.update.length, 0, 'nothing to update');
});

OAD.test('parseImportFile: row with uuid matching existing thread goes to update list', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'UUID match test' }));
  const json = JSON.stringify({ threads: [{ uuid: t.uuid, title: t.title, status: 'closed' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.update.length, 1, 'uuid match → update');
  OAD._assertEqual(results.update[0].existing.id, t.id, 'matched to correct thread');
  OAD._assertEqual(results.create.length, 0, 'nothing to create');
});

OAD.test('parseImportFile: row with unknown uuid goes to create list', function () {
  const json = JSON.stringify({ threads: [{ uuid: 'unknown-uuid-1234', title: 'Unknown UUID', status: 'open' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.create.length, 1, 'unknown uuid → create');
  OAD._assertEqual(results.update.length, 0, 'nothing to update');
});

OAD.test('getThreadByUUID: returns thread with matching uuid', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'UUID lookup' }));
  OAD._assertEqual(OAD.getThreadByUUID(t.uuid)?.id, t.id, 'lookup by uuid returns thread');
  OAD._assertEqual(OAD.getThreadByUUID('no-such-uuid'), null, 'unknown uuid returns null');
});

OAD.test('parseImportFile: returns error on invalid JSON', function () {
  const results = OAD.parseImportFile('not json {{{');
  OAD._assert(!!results.error, 'should return error');
});

OAD.test('applyImport: creates new thread with evolution log appended', function () {
  const before = OAD.DB.threads.length;
  const results = { create: [{ title: 'Imported new', status: 'open', priority: 'low',
    evolution_log: [{ date: '2026-01-01', note: 'From export' }] }], update: [] };
  OAD.applyImport(results, []);
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'one thread added');
  const created = OAD.DB.threads.find(function (t) { return t.title === 'Imported new'; });
  OAD._assert(!!created, 'thread found');
  OAD._assert(created.evolution_log.some(function (e) { return e.note === 'From export'; }),
    'imported evolution entry appended');
});

OAD.test('applyImport: updates thread matched by uuid, never overwrites evolution log', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Import no-overwrite test' }));
  OAD.addEvolution(t.id, 'Original entry');
  const updateItem = {
    incoming: { uuid: t.uuid, title: t.title, status: 'waiting',
      evolution_log: [{ date: '2026-06-01', note: 'Imported entry' }] },
    existing: t
  };
  OAD.applyImport({ create: [], update: [updateItem] }, [updateItem]);
  const updated = OAD.getThread(t.id);
  OAD._assertEqual(updated.status, 'waiting', 'status updated');
  OAD._assert(updated.evolution_log.some(function (e) { return e.note === 'Original entry'; }),
    'original evolution entry preserved');
  OAD._assert(updated.evolution_log.some(function (e) { return e.note === 'Imported entry'; }),
    'new evolution entry appended');
});

// ── Tests: Cadence CRUD ──────────────────────────────────────────────

OAD.test('updateCadence: merges patch fields', function () {
  const c = OAD.addCadence(OAD.makeCadence({ title: 'Test cadence', recurrence: 'monthly-1st' }));
  OAD.updateCadence(c.id, { title: 'Updated cadence', next_due: '2026-07-01' });
  const updated = OAD.getCadence(c.id);
  OAD._assertEqual(updated.title,    'Updated cadence', 'title updated');
  OAD._assertEqual(updated.next_due, '2026-07-01',      'next_due updated');
  OAD._assertEqual(updated.recurrence, 'monthly-1st',   'untouched field preserved');
});

OAD.test('deleteCadence: removes from DB', function () {
  const origThreads = OAD.DB.threads;
  try {
    const c = OAD.addCadence(OAD.makeCadence({ title: 'Delete me cadence' }));
    const before = OAD.getCadenceThreads().length;
    OAD.deleteCadence(c.id);
    OAD._assertEqual(OAD.getCadenceThreads().length, before - 1, 'count decreased');
    OAD._assertEqual(OAD.getCadence(c.id), null, 'not findable after delete');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

// ── Tests: Saved Views (Graph Views) ─────────────────────────────────

OAD.test('makeSavedView: defaults are valid', function () {
  const v = OAD.makeSavedView({});
  OAD._assertEqual(v.statuses.length, 0, 'statuses defaults to empty array');
  OAD._assertEqual(v.priorities.length, 0, 'priorities defaults to empty array');
  OAD._assertEqual(v.life_areas.length, 0, 'life_areas defaults to empty array');
  OAD._assertEqual(v.edge_rule, null, 'edge_rule defaults to null');
  OAD._assertEqual(v.sort_field, 'pressure', 'sort_field defaults to pressure');
  OAD._assertEqual(v.sort_dir, 'desc', 'sort_dir defaults to desc');
});

OAD.test('addSavedView: assigns id and appends to DB', function () {
  const before = OAD.DB.saved_views.length;
  const v = OAD.addSavedView(OAD.makeSavedView({ name: 'Test view' }));
  OAD._assert(v.id != null, 'id assigned');
  OAD._assertEqual(OAD.DB.saved_views.length, before + 1, 'count increased');
  OAD._assertEqual(OAD.getSavedView(v.id).name, 'Test view', 'findable by id');
});

OAD.test('updateSavedView: merges patch fields', function () {
  const v = OAD.addSavedView(OAD.makeSavedView({ name: 'Original name', sort_field: 'pressure' }));
  OAD.updateSavedView(v.id, { name: 'Updated name', sort_field: 'title' });
  const updated = OAD.getSavedView(v.id);
  OAD._assertEqual(updated.name, 'Updated name', 'name updated');
  OAD._assertEqual(updated.sort_field, 'title', 'sort_field updated');
});

OAD.test('deleteSavedView: removes from DB', function () {
  const v = OAD.addSavedView(OAD.makeSavedView({ name: 'Delete me view' }));
  const before = OAD.DB.saved_views.length;
  OAD.deleteSavedView(v.id);
  OAD._assertEqual(OAD.DB.saved_views.length, before - 1, 'count decreased');
  OAD._assertEqual(OAD.getSavedView(v.id), null, 'not findable after delete');
});

OAD.test('matchesSavedView: empty filters match everything', function () {
  const t = OAD.makeThread({ status: 'open', priority: 'low', life_area: 'Finances', connections: [] });
  const v = OAD.makeSavedView({});
  OAD._assert(OAD.matchesSavedView(t, v), 'empty-filter view should match any thread');
});

OAD.test('matchesSavedView: status include list excludes non-matching status', function () {
  const tOpen = OAD.makeThread({ status: 'open', connections: [] });
  const tClosed = OAD.makeThread({ status: 'closed', connections: [] });
  const v = OAD.makeSavedView({ statuses: ['open', 'stalled'] });
  OAD._assert(OAD.matchesSavedView(tOpen, v), 'open thread matches');
  OAD._assert(!OAD.matchesSavedView(tClosed, v), 'closed thread excluded');
});

OAD.test('matchesSavedView: priority include list excludes non-matching priority', function () {
  const tCrit = OAD.makeThread({ priority: 'critical', connections: [] });
  const tLow = OAD.makeThread({ priority: 'low', connections: [] });
  const v = OAD.makeSavedView({ priorities: ['critical', 'high'] });
  OAD._assert(OAD.matchesSavedView(tCrit, v), 'critical thread matches');
  OAD._assert(!OAD.matchesSavedView(tLow, v), 'low priority thread excluded');
});

OAD.test('matchesSavedView: life_area include list excludes non-matching area', function () {
  const tFin = OAD.makeThread({ life_area: 'Finances', connections: [] });
  const tHealth = OAD.makeThread({ life_area: 'Health', connections: [] });
  const v = OAD.makeSavedView({ life_areas: ['Finances'] });
  OAD._assert(OAD.matchesSavedView(tFin, v), 'Finances thread matches');
  OAD._assert(!OAD.matchesSavedView(tHealth, v), 'Health thread excluded');
});

OAD.test('matchesSavedView: edge_rule "blocked_by_open" true when blockedBy contains a non-closed thread', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const threadA = { id: 201, uuid: 'sv-uuid-a', title: 'Task A', status: 'open', priority: 'low', life_area: 'Work', connections: [{ to_uuid: 'sv-uuid-b', edge_type: 'blocked_by' }] };
    const threadB = { id: 202, uuid: 'sv-uuid-b', title: 'Task B', status: 'open', priority: 'low', life_area: 'Work', connections: [] };
    OAD.DB.threads = [threadA, threadB];
    const v = OAD.makeSavedView({ edge_rule: { type: 'blocked_by_open' } });
    OAD._assert(OAD.matchesSavedView(threadA, v), 'Task A is blocked by open Task B');
    OAD._assert(!OAD.matchesSavedView(threadB, v), 'Task B has no blockers');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('matchesSavedView: edge_rule "blocked_by_open" false when all blockers are closed', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const threadA = { id: 203, uuid: 'sv-uuid-c', title: 'Task C', status: 'open', priority: 'low', life_area: 'Work', connections: [{ to_uuid: 'sv-uuid-d', edge_type: 'blocked_by' }] };
    const threadB = { id: 204, uuid: 'sv-uuid-d', title: 'Task D', status: 'closed', priority: 'low', life_area: 'Work', connections: [] };
    OAD.DB.threads = [threadA, threadB];
    const v = OAD.makeSavedView({ edge_rule: { type: 'blocked_by_open' } });
    OAD._assert(!OAD.matchesSavedView(threadA, v), 'Task C only blocked by a closed thread, should not match');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('matchesSavedView: edge_rule "no_blockers" true when blockedBy is empty', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const threadA = { id: 205, uuid: 'sv-uuid-e', title: 'Task E', status: 'open', priority: 'low', life_area: 'Work', connections: [] };
    OAD.DB.threads = [threadA];
    const v = OAD.makeSavedView({ edge_rule: { type: 'no_blockers' } });
    OAD._assert(OAD.matchesSavedView(threadA, v), 'Task E has no blockers, should match no_blockers');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('applySavedView: sorts by pressure desc by default', function () {
  const low = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  const high = OAD.makeThread({ status: 'stalled', priority: 'critical', connections: [] });
  const v = OAD.makeSavedView({});
  const result = OAD.applySavedView([low, high], v);
  OAD._assert(OAD.pressure(result[0]) >= OAD.pressure(result[1]), 'higher pressure thread sorts first');
});

OAD.test('applySavedView: sort_dir "asc" reverses order', function () {
  const low = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  const high = OAD.makeThread({ status: 'stalled', priority: 'critical', connections: [] });
  const v = OAD.makeSavedView({ sort_field: 'pressure', sort_dir: 'asc' });
  const result = OAD.applySavedView([high, low], v);
  OAD._assert(OAD.pressure(result[0]) <= OAD.pressure(result[1]), 'lower pressure thread sorts first when asc');
});

OAD.test('applySavedView: sort_field "title" sorts alphabetically case-insensitively', function () {
  const zebra = OAD.makeThread({ title: 'Zebra task', connections: [] });
  const apple = OAD.makeThread({ title: 'apple task', connections: [] });
  const v = OAD.makeSavedView({ sort_field: 'title', sort_dir: 'asc' });
  const result = OAD.applySavedView([zebra, apple], v);
  OAD._assertEqual(result[0].title, 'apple task', 'case-insensitive alphabetical sort, apple first');
});

OAD.test('LIFE_AREAS: includes App Dev', function () {
  OAD._assert(OAD.LIFE_AREAS.includes('App Dev'), 'App Dev should be in LIFE_AREAS');
});

// ── Tests: Idea data model ────────────────────────────────────────────

OAD.test('makeIdea: defaults are valid', function () {
  const i = OAD.makeIdea({});
  OAD._assertEqual(i.type,             'other',   'default type');
  OAD._assertEqual(i.energy_required,  'medium',  'default energy');
  OAD._assert(Array.isArray(i.tags),             'tags is array');
  OAD._assert(i.added_date.length === 10,        'added_date is ISO date');
  OAD._assertEqual(i.last_surfaced,    null,      'last_surfaced null');
});

OAD.test('addIdea: assigns id and appends to DB as a Thread (thread_kind:\'idea\')', function () {
  const before = OAD.getIdeaThreads().length;
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Test idea' }));
  OAD._assert(idea.id > 0, 'id should be positive');
  OAD._assertEqual(idea.thread_kind, 'idea', 'must carry the idea discriminator');
  OAD._assertEqual(OAD.getIdeaThreads().length, before + 1, 'ideas count should increase');
  OAD._assertEqual(OAD.getIdea(idea.id).title, 'Test idea', 'should retrieve by id');
});

OAD.test('deleteIdea: removes from DB', function () {
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Delete me' }));
  const before = OAD.getIdeaThreads().length;
  OAD.deleteIdea(idea.id);
  OAD._assertEqual(OAD.getIdeaThreads().length, before - 1, 'count should decrease');
  OAD._assertEqual(OAD.getIdea(idea.id), null, 'should not be findable after delete');
});

OAD.test('ideaOfTheWeek: returns an idea when ideas exist', function () {
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Week idea' }));
  const result = OAD.ideaOfTheWeek();
  OAD._assert(result !== null, 'should return an idea');
  OAD._assert(OAD.getIdeaThreads().includes(result), 'returned idea should be in DB');
});

OAD.test('ideaOfTheWeek: returns null when no ideas', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = OAD.DB.threads.filter(function (t) { return t.thread_kind !== 'idea'; });
    OAD._assertEqual(OAD.ideaOfTheWeek(), null, 'null when no ideas');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

// ── Tests: Habit data model ───────────────────────────────────────────

OAD.test('makeHabit: defaults are valid', function () {
  const h = OAD.makeHabit({});
  OAD._assertEqual(h.frequency,        'daily',    'default frequency');
  OAD._assertEqual(h.time_of_day,      'morning',  'default time_of_day');
  OAD._assertEqual(h.current_streak,   0,          'default streak 0');
  OAD._assertEqual(h.last_checked_in,  null,       'default last_checked_in null');
  OAD._assertEqual(h.last_check_in_done, null,     'default done null');
  OAD._assertEqual(h.phase,            'active',   'default phase active');
});

OAD.test('addHabit: assigns id and appends to DB as a Thread (thread_kind:\'habit\')', function () {
  const before = OAD.getHabitThreads().length;
  const h = OAD.addHabit(OAD.makeHabit({ title: 'Test habit' }));
  OAD._assert(h.id > 0, 'id should be positive');
  OAD._assertEqual(h.thread_kind, 'habit', 'must carry the habit discriminator');
  OAD._assertEqual(OAD.getHabitThreads().length, before + 1, 'habit count should increase');
  OAD._assertEqual(OAD.getHabit(h.id).title, 'Test habit', 'should retrieve by id');
});

OAD.test('checkInHabit: first yes → streak 1', function () {
  const h = OAD.addHabit(OAD.makeHabit({ title: 'Streak start' }));
  OAD.checkInHabit(h.id, true, '');
  OAD._assertEqual(OAD.getHabit(h.id).current_streak, 1, 'first yes → streak 1');
  OAD._assertEqual(OAD.getHabit(h.id).longest_streak, 1, 'longest_streak updated');
});

OAD.test('checkInHabit: no → streak 0', function () {
  const h = OAD.addHabit(OAD.makeHabit({ title: 'No check' }));
  OAD.checkInHabit(h.id, false, '');
  OAD._assertEqual(OAD.getHabit(h.id).current_streak, 0, 'no → streak stays 0');
  OAD._assertEqual(OAD.getHabit(h.id).last_check_in_done, false, 'done=false saved');
});

OAD.test('checkInHabit: consecutive yes from yesterday increments streak', function () {
  const yd = new Date(); yd.setHours(0, 0, 0, 0); yd.setDate(yd.getDate() - 1);
  const yesterday = _localDateStr(yd);
  const h = OAD.addHabit(OAD.makeHabit({
    title: 'Streak continue',
    current_streak: 3, longest_streak: 3,
    last_checked_in: yesterday, last_check_in_done: true
  }));
  OAD.checkInHabit(h.id, true, '');
  OAD._assertEqual(OAD.getHabit(h.id).current_streak, 4, 'consecutive yes → streak 4');
  OAD._assertEqual(OAD.getHabit(h.id).longest_streak, 4, 'longest_streak updated');
});

OAD.test('checkInHabit: yes today twice does not double-count streak', function () {
  const h = OAD.addHabit(OAD.makeHabit({ title: 'Idempotent today' }));
  OAD.checkInHabit(h.id, true, 'first');
  OAD.checkInHabit(h.id, true, 'second');
  OAD._assertEqual(OAD.getHabit(h.id).current_streak, 1, 'checking yes twice today should not double streak');
  OAD._assertEqual(OAD.getHabit(h.id).last_check_in_note, 'second', 'note updated on re-checkin');
});

OAD.test('checkInHabit: flip yes→no today undoes streak increment', function () {
  const yd = new Date(); yd.setHours(0, 0, 0, 0); yd.setDate(yd.getDate() - 1);
  const yesterday = _localDateStr(yd);
  const h = OAD.addHabit(OAD.makeHabit({
    title: 'Flip yes to no',
    current_streak: 2, longest_streak: 2,
    last_checked_in: yesterday, last_check_in_done: true
  }));
  OAD.checkInHabit(h.id, true, '');   // yes today → streak 3
  OAD.checkInHabit(h.id, false, '');  // flip to no → undo → streak 2
  OAD._assertEqual(OAD.getHabit(h.id).current_streak, 2, 'flip yes→no undoes increment');
});

// ── Tests: deadlineState() ───────────────────────────────────────────

OAD.test('deadlineState: returns null when no deadline', function () {
  OAD._assertEqual(OAD.deadlineState(OAD.makeThread({})), null, 'no deadline → null');
});

OAD.test('deadlineState: onTrack true when sessions fit in remaining weeks', function () {
  const t = OAD.makeThread({ deadline: '2026-12-31', effortEstimate: 2, effortLogged: 0, weeklyCommitment: 1 });
  const ds = OAD.deadlineState(t);
  OAD._assert(ds !== null, 'should return state');
  OAD._assert(ds.onTrack, 'should be on track with plenty of time');
  OAD._assertEqual(ds.behindBy, 0, 'behindBy should be 0');
});

OAD.test('deadlineState: onTrack false and behindBy correct when behind', function () {
  const soon = new Date();
  soon.setDate(soon.getDate() + 7); // 1 week out
  const t = OAD.makeThread({ deadline: _localDateStr(soon), effortEstimate: 5, effortLogged: 0, weeklyCommitment: 1 });
  const ds = OAD.deadlineState(t);
  OAD._assert(!ds.onTrack, 'should not be on track');
  OAD._assert(ds.behindBy >= 4, 'should be behind by at least 4 sessions');
});

OAD.test('deadlineState: sessionsRemaining accounts for effortLogged', function () {
  const t = OAD.makeThread({ deadline: '2026-12-31', effortEstimate: 6, effortLogged: 2, weeklyCommitment: 1 });
  const ds = OAD.deadlineState(t);
  OAD._assertEqual(ds.sessionsRemaining, 4, 'sessionsRemaining = effortEstimate - effortLogged');
});

OAD.test('deadlineState: no effortEstimate → onTrack true, sessionsRemaining null', function () {
  const t = OAD.makeThread({ deadline: '2026-12-31', effortEstimate: null, effortLogged: 0, weeklyCommitment: 1 });
  const ds = OAD.deadlineState(t);
  OAD._assert(ds.onTrack, 'no estimate means on track by default');
  OAD._assertEqual(ds.sessionsRemaining, null, 'sessionsRemaining null when no estimate');
});

// ── Tests: Runway Risk (convergence check) ───────────────────────────

function _rrDate(weeksFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + weeksFromNow * 7);
  return _localDateStr(d);
}

OAD.test('OAD.APPLICATION_STAGES is ordered applied -> screening -> interview -> offer', function () {
  OAD._assertEqual(OAD.APPLICATION_STAGES.join(','), 'applied,screening,interview,offer', 'stage order should match the pipeline');
});

OAD.test('_classifyRunwayBenchmark: classifies Federal/Commercial by keyword, skips unrelated titles', function () {
  OAD._assertEqual(OAD._classifyRunwayBenchmark('Federal Job Applications'), 'federal', 'Federal keyword');
  OAD._assertEqual(OAD._classifyRunwayBenchmark('Commercial Job Applications'), 'commercial', 'Commercial keyword');
  OAD._assertEqual(OAD._classifyRunwayBenchmark('Divinum Officium — Weekly Health Check'), null, 'unrelated title should not be guessed at');
});

OAD.test('_earliestActiveStage: zero applications is the worst case (applied, count 0)', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const track = { id: 801, uuid: 'rr-empty-track', title: 'Empty Track', status: 'open', connections: [] };
    OAD.DB.threads = [track];
    const result = OAD._earliestActiveStage(track);
    OAD._assertEqual(result.stage, 'applied', 'zero applications treated as stage applied');
    OAD._assertEqual(result.stageIndex, 0, 'stageIndex 0');
    OAD._assertEqual(result.applicationCount, 0, 'application count is 0');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('_earliestActiveStage: picks the earliest stage among multiple applications, excludes closed/rejected', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const track = {
      id: 802, uuid: 'rr-track', title: 'Track', status: 'open',
      connections: [
        { to_uuid: 'rr-app-interview', edge_type: 'enables' },
        { to_uuid: 'rr-app-applied', edge_type: 'enables' },
        { to_uuid: 'rr-app-rejected', edge_type: 'enables' },
        { to_uuid: 'rr-app-closed', edge_type: 'enables' }
      ]
    };
    const appInterview = { id: 803, uuid: 'rr-app-interview', title: 'App at interview', status: 'waiting', stage: 'interview' };
    const appApplied    = { id: 804, uuid: 'rr-app-applied',   title: 'App at applied',   status: 'waiting', stage: null }; // unset defaults to applied
    const appRejected   = { id: 805, uuid: 'rr-app-rejected',  title: 'App rejected',     status: 'waiting', stage: 'rejected' };
    const appClosed     = { id: 806, uuid: 'rr-app-closed',    title: 'App closed',       status: 'closed',  stage: 'applied' };
    OAD.DB.threads = [track, appInterview, appApplied, appRejected, appClosed];

    const result = OAD._earliestActiveStage(track);
    OAD._assertEqual(result.stage, 'applied', 'earliest active stage should be applied, not interview');
    OAD._assertEqual(result.applicationCount, 2, 'only the 2 active (non-closed, non-rejected) applications count');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('_estimateRemainingWeeks: full benchmark at stage 0, quarter benchmark at the last stage', function () {
  const benchmark = { minWeeks: 16, maxWeeks: 20 };
  const atApplied = OAD._estimateRemainingWeeks(0, benchmark);
  OAD._assertEqual(atApplied.maxWeeks, 20, 'stage 0 (applied) should carry the full benchmark');
  const atOffer = OAD._estimateRemainingWeeks(3, benchmark); // last of 4 stages
  OAD._assertEqual(atOffer.maxWeeks, 5, 'stage 3 of 4 (offer) should carry 1/4 of the benchmark');
});

OAD.test('calculateRunwayRisk: returns null when the goal thread has no deadline', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const goal = { id: 810, uuid: 'rr-goal-nodl', title: 'Goal without deadline', status: 'open', deadline: null, connections: [] };
    OAD.DB.threads = [goal];
    OAD._assertEqual(OAD.calculateRunwayRisk(goal.id), null, 'no deadline means nothing to converge against');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('calculateRunwayRisk: full hierarchy — zero-application track near deadline is flagged at-risk', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const goal = {
      id: 811, uuid: 'rr-goal', title: 'Full-Time Employment (test)', status: 'open',
      deadline: _rrDate(4), // 4 weeks away — federal benchmark is 17-22 weeks, cannot possibly land
      connections: [{ to_uuid: 'rr-fed-cat', edge_type: 'enables' }]
    };
    const fedCategory = { id: 812, uuid: 'rr-fed-cat', title: 'Federal Job Applications', status: 'open',
      connections: [{ to_uuid: 'rr-fed-track', edge_type: 'enables' }] };
    const fedTrack = { id: 813, uuid: 'rr-fed-track', title: 'Federal — Test Track', status: 'open', connections: [] };
    OAD.DB.threads = [goal, fedCategory, fedTrack];

    const risk = OAD.calculateRunwayRisk(goal.id);
    OAD._assert(!!risk, 'should return a result');
    OAD._assertEqual(risk.tracks.length, 1, 'one track found');
    OAD._assert(risk.anyAtRisk, 'zero-application track this close to deadline must be at-risk');
    OAD._assertEqual(risk.tracks[0].applicationCount, 0, 'zero applications recorded');
    OAD._assert(risk.tracks[0].sentence.indexOf('Federal — Test Track') !== -1, 'sentence should name the track');
    OAD._assert(risk.tracks[0].sentence.indexOf('cannot realistically convert') !== -1, 'sentence should state the math does not work');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('calculateRunwayRisk: advanced-stage application with a comfortable deadline is not at-risk', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const goal = {
      id: 821, uuid: 'rr-goal-2', title: 'Full-Time Employment (test 2)', status: 'open',
      deadline: _rrDate(10), // 10 weeks away
      connections: [{ to_uuid: 'rr-fed-cat-2', edge_type: 'enables' }]
    };
    const fedCategory = { id: 822, uuid: 'rr-fed-cat-2', title: 'Federal Job Applications', status: 'open',
      connections: [{ to_uuid: 'rr-fed-track-2', edge_type: 'enables' }] };
    const fedTrack = { id: 823, uuid: 'rr-fed-track-2', title: 'Federal — Advanced Track', status: 'open',
      connections: [{ to_uuid: 'rr-app-offer', edge_type: 'enables' }] };
    const appOffer = { id: 824, uuid: 'rr-app-offer', title: 'App at offer stage', status: 'waiting', stage: 'offer' };
    OAD.DB.threads = [goal, fedCategory, fedTrack, appOffer];

    const risk = OAD.calculateRunwayRisk(goal.id);
    OAD._assertEqual(risk.tracks[0].stage, 'offer', 'earliest (only) stage is offer');
    OAD._assert(!risk.tracks[0].atRisk, 'an application at offer stage with 10 weeks left should not be flagged at-risk');
    OAD._assert(!risk.anyAtRisk, 'no track should be at-risk');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('calculateRunwayRisk: unclassifiable category is skipped rather than guessed at', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const goal = {
      id: 831, uuid: 'rr-goal-3', title: 'Goal (test 3)', status: 'open', deadline: _rrDate(4),
      connections: [{ to_uuid: 'rr-unrelated-cat', edge_type: 'enables' }]
    };
    const unrelated = { id: 832, uuid: 'rr-unrelated-cat', title: 'Unrelated Category', status: 'open',
      connections: [{ to_uuid: 'rr-unrelated-track', edge_type: 'enables' }] };
    const unrelatedTrack = { id: 833, uuid: 'rr-unrelated-track', title: 'Some Other Track', status: 'open', connections: [] };
    OAD.DB.threads = [goal, unrelated, unrelatedTrack];

    const risk = OAD.calculateRunwayRisk(goal.id);
    OAD._assertEqual(risk.tracks.length, 0, 'unclassifiable category should be skipped, not guessed at');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('acknowledgeRunwayRisk: sets a 7-day snooze and logs an evolution entry', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const track = OAD.makeThread({ id: 841, uuid: 'rr-ack-track', title: 'Ack Test Track', status: 'open' });
    OAD.DB.threads = [track];

    const before = new Date();
    const result = OAD.acknowledgeRunwayRisk('rr-ack-track');
    OAD._assert(!!result, 'should return the updated track');

    const expected = new Date(before);
    expected.setDate(expected.getDate() + OAD._RUNWAY_REPRESENT_DAYS);
    OAD._assertEqual(track.runway_ack_until, _localDateStr(expected), 'snooze should be exactly _RUNWAY_REPRESENT_DAYS out');
    OAD._assert(track.evolution_log.length > 0, 'should log an evolution entry');
    OAD._assert(track.evolution_log[track.evolution_log.length - 1].note.indexOf('Runway Risk acknowledged') !== -1, 'evolution note should mention acknowledgment');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('_isRunwayRiskSnoozed: true while ack_until is in the future, false once it passes or is unset', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const future = new Date(); future.setDate(future.getDate() + 3);
    const past = new Date(); past.setDate(past.getDate() - 3);

    const snoozed   = OAD.makeThread({ id: 851, uuid: 'rr-snoozed',   title: 'Snoozed',   runway_ack_until: _localDateStr(future) });
    const expired    = OAD.makeThread({ id: 852, uuid: 'rr-expired',   title: 'Expired',    runway_ack_until: _localDateStr(past) });
    const neverAcked = OAD.makeThread({ id: 853, uuid: 'rr-neveracked', title: 'Never acked', runway_ack_until: null });
    OAD.DB.threads = [snoozed, expired, neverAcked];

    OAD._assert(OAD._isRunwayRiskSnoozed('rr-snoozed'), 'still-future ack_until should be snoozed');
    OAD._assert(!OAD._isRunwayRiskSnoozed('rr-expired'), 'past ack_until should no longer be snoozed — re-presents');
    OAD._assert(!OAD._isRunwayRiskSnoozed('rr-neveracked'), 'no ack_until at all should not be snoozed');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('calculateRunwayRisk stays unaware of acknowledgment — snoozing is display-layer only', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const goal = {
      id: 861, uuid: 'rr-goal-ack', title: 'Goal (ack test)', status: 'open', deadline: _rrDate(4),
      connections: [{ to_uuid: 'rr-fed-cat-ack', edge_type: 'enables' }]
    };
    const fedCategory = { id: 862, uuid: 'rr-fed-cat-ack', title: 'Federal Job Applications', status: 'open',
      connections: [{ to_uuid: 'rr-fed-track-ack', edge_type: 'enables' }] };
    const future = new Date(); future.setDate(future.getDate() + 3);
    const fedTrack = OAD.makeThread({ id: 863, uuid: 'rr-fed-track-ack', title: 'Federal — Snoozed Track', status: 'open', runway_ack_until: _localDateStr(future) });
    OAD.DB.threads = [goal, fedCategory, fedTrack];

    const risk = OAD.calculateRunwayRisk(goal.id);
    OAD._assert(risk.tracks[0].atRisk, 'the underlying math should still report at-risk regardless of snooze');
    OAD._assert(OAD._isRunwayRiskSnoozed('rr-fed-track-ack'), 'but the track should read as currently snoozed for display purposes');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('renderInboxPanel: sets status filter to inbox and clears any active saved view', function () {
  const originalLastView = OAD._lastView;
  const originalListStatus = OAD._activeListStatus;
  const originalSavedViewId = OAD._activeSavedViewId;
  try {
    OAD._activeSavedViewId = 999; // simulate a saved view being active beforehand
    OAD.renderInboxPanel();
    OAD._assertEqual(OAD._activeListStatus, 'inbox', 'status filter should be set to inbox');
    OAD._assertEqual(OAD._activeSavedViewId, null, 'any active saved view should be cleared');
  } finally {
    // renderInboxPanel() calls the real renderListView(), which sets _lastView — restore all
    // three so this test doesn't change how later tests' goBackToLastView()/refreshActiveView() dispatch.
    OAD._lastView = originalLastView;
    OAD._activeListStatus = originalListStatus;
    OAD._activeSavedViewId = originalSavedViewId;
  }
});

// ── Tests: Time of Day (next_action_time / deadline_time) ────────────

// Local calendar date string (matches what <input type="date"> shows and what
// _combineDateTime/isActionOverdue actually parse against). Deliberately NOT
// toISOString().slice(0,10) — that's UTC-based and drifts a day ahead during evening
// hours in negative-UTC-offset zones, which would make these fixtures flaky.
function _localDateStr(date) {
  date = date || new Date();
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

OAD.test('formatTime: formats HH:MM as a readable 12-hour time', function () {
  OAD._assertEqual(OAD.formatTime('09:30'), '9:30 AM', 'morning time formatted correctly');
  OAD._assertEqual(OAD.formatTime('14:00'), '2:00 PM', 'afternoon time formatted correctly');
  OAD._assertEqual(OAD.formatTime(null), '', 'null returns empty string');
  OAD._assertEqual(OAD.formatTime(''), '', 'empty string returns empty string');
});

OAD.test('_combineDateTime: defaults to 23:59:59 when no time set, uses the given time otherwise', function () {
  OAD._assertEqual(OAD._combineDateTime(null, null), null, 'no date returns null');
  const withoutTime = OAD._combineDateTime('2026-07-10', null);
  OAD._assertEqual(withoutTime.getHours(), 23, 'defaults to hour 23 when no time given');
  OAD._assertEqual(withoutTime.getMinutes(), 59, 'defaults to minute 59 when no time given');
  const withTime = OAD._combineDateTime('2026-07-10', '09:30');
  OAD._assertEqual(withTime.getHours(), 9, 'uses the given hour');
  OAD._assertEqual(withTime.getMinutes(), 30, 'uses the given minute');
});

OAD.test('isActionOverdue: date-only thread due today is not overdue yet (unchanged prior behavior)', function () {
  const todayStr = _localDateStr();
  const t = OAD.makeThread({ next_action_date: todayStr, next_action_time: null, connections: [] });
  OAD._assert(!OAD.isActionOverdue(t), 'date-only "due today" should not be overdue until the day passes');
});

OAD.test('isActionOverdue: date-only thread from yesterday is overdue', function () {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const t = OAD.makeThread({ next_action_date: _localDateStr(yesterday), connections: [] });
  OAD._assert(OAD.isActionOverdue(t), 'a date-only thread from yesterday should be overdue');
});

OAD.test('isActionOverdue: no next_action_date at all is never overdue', function () {
  const t = OAD.makeThread({ next_action_date: '', connections: [] });
  OAD._assert(!OAD.isActionOverdue(t), 'a thread with no next_action_date has nothing to be overdue against');
});

OAD.test('isActionOverdue: a specific time earlier today that has passed IS overdue — TJ\'s "meet Amy at 09:30" case', function () {
  const todayStr = _localDateStr();
  const t = OAD.makeThread({ next_action_date: todayStr, next_action_time: '00:01', connections: [] });
  OAD._assert(OAD.isActionOverdue(t), 'a hard-time commitment earlier today that has passed should be overdue right now, not tomorrow');
});

OAD.test('isActionOverdue: a specific time later today that has not passed is NOT overdue', function () {
  const todayStr = _localDateStr();
  const t = OAD.makeThread({ next_action_date: todayStr, next_action_time: '23:59', connections: [] });
  OAD._assert(!OAD.isActionOverdue(t), 'a commitment later today that has not happened yet should not be flagged overdue');
});

// ── Tests: isDeadlineOverdue (ticket-overdue-filter-fix.md) ──────────

OAD.test('isDeadlineOverdue: distinct from isActionOverdue — a waiting thread with a past next_action_date but no deadline is NOT deadline-overdue', function () {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const t = OAD.makeThread({ status: 'waiting', next_action_date: _localDateStr(yesterday), deadline: null, connections: [] });
  OAD._assert(OAD.isActionOverdue(t), 'sanity check: this thread IS action-overdue (next_action_date passed)');
  OAD._assert(!OAD.isDeadlineOverdue(t), 'but it must NOT be deadline-overdue — a waiting thread\'s past next_action_date is normal, not a sign of a missed deadline');
});

OAD.test('isDeadlineOverdue: a thread with a past deadline is overdue, even if next_action_date is in the future', function () {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const t = OAD.makeThread({ next_action_date: _localDateStr(future), deadline: _localDateStr(yesterday), connections: [] });
  OAD._assert(!OAD.isActionOverdue(t), 'sanity check: this thread is NOT action-overdue (next_action_date is far in the future)');
  OAD._assert(OAD.isDeadlineOverdue(t), 'a genuinely-passed deadline is overdue regardless of a rescheduled next_action_date — real example: a class session moved from July 7 to July 21, deadline field never updated');
});

OAD.test('isDeadlineOverdue: no deadline at all is never overdue', function () {
  const t = OAD.makeThread({ deadline: null, connections: [] });
  OAD._assert(!OAD.isDeadlineOverdue(t), 'a thread with no deadline has nothing to be overdue against');
});

OAD.test('isDeadlineOverdue: deadline today, not yet past, is not overdue', function () {
  const todayStr = _localDateStr();
  const t = OAD.makeThread({ deadline: todayStr, deadline_time: null, connections: [] });
  OAD._assert(!OAD.isDeadlineOverdue(t), 'date-only deadline due today should not be overdue until the day passes (mirrors isActionOverdue behavior)');
});

OAD.test('isDeadlineOverdue: a specific deadline_time earlier today that has passed IS overdue', function () {
  const todayStr = _localDateStr();
  const t = OAD.makeThread({ deadline: todayStr, deadline_time: '00:01', connections: [] });
  OAD._assert(OAD.isDeadlineOverdue(t), 'a hard deadline time earlier today that has passed should be overdue right now');
});

OAD.test('getOverdueDays: a same-day missed time counts as at least 1 day-equivalent immediately', function () {
  const todayStr = _localDateStr();
  const notOverdue = OAD.makeThread({ next_action_date: todayStr, next_action_time: null, connections: [] });
  const overdueToday = OAD.makeThread({ next_action_date: todayStr, next_action_time: '00:01', connections: [] });
  OAD._assertEqual(OAD.getOverdueDays(notOverdue), 0, 'not overdue means 0 days');
  OAD._assertEqual(OAD.getOverdueDays(overdueToday), 1, 'a same-day missed time should register as 1 day-equivalent overdue, not 0');
});

OAD.test('pressure: a missed hard-time commitment today scores higher than an undifferentiated "due today" thread — the exact gap being fixed', function () {
  const todayStr = _localDateStr();
  const withTime = OAD.makeThread({ status: 'open', priority: 'low', next_action_date: todayStr, next_action_time: '00:01', connections: [] });
  const noTime    = OAD.makeThread({ status: 'open', priority: 'low', next_action_date: todayStr, next_action_time: null,   connections: [] });
  OAD._assert(OAD.pressure(withTime) > OAD.pressure(noTime),
    'a thread whose specific 00:01 commitment already passed today should score higher than one merely "due today" with no time');
});

OAD.test('pressure: a thread due later today (time not yet passed) scores the same as a date-only "due today" thread', function () {
  const todayStr = _localDateStr();
  const laterToday = OAD.makeThread({ status: 'open', priority: 'low', next_action_date: todayStr, next_action_time: '23:59', connections: [] });
  const noTime      = OAD.makeThread({ status: 'open', priority: 'low', next_action_date: todayStr, next_action_time: null,   connections: [] });
  OAD._assertEqual(OAD.pressure(laterToday), OAD.pressure(noTime), 'neither should be overdue yet, so neither gets the overdue pressure bump');
});

OAD.test('pressure: deadline within 7 days not on track adds 30', function () {
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const t = OAD.makeThread({
    status: 'open', priority: 'low', connections: [],
    deadline: _localDateStr(soon),
    effortEstimate: 10, effortLogged: 0, weeklyCommitment: 1
  });
  OAD._assert(OAD.pressure(t) >= 30, 'deadline pressure should add >= 30');
});

// ── Tests: esc() ──────────────────────────────────────────────────────

OAD.test('esc: escapes < > & " \'', function () {
  const result = OAD.esc('<script>&"\'</script>');
  OAD._assert(!result.includes('<script>'), 'Should escape < >');
  OAD._assert(result.includes('&lt;'), 'Should include &lt;');
  OAD._assert(result.includes('&amp;'), 'Should include &amp;');
  OAD._assert(result.includes('&quot;'), 'Should include &quot;');
  OAD._assert(result.includes('&#39;'), 'Should include &#39;');
});

OAD.test('esc: handles null and undefined gracefully', function () {
  OAD._assertEqual(OAD.esc(null), '', 'null → empty string');
  OAD._assertEqual(OAD.esc(undefined), '', 'undefined → empty string');
});

// ── Tests: data.js ────────────────────────────────────────────────────

OAD.test('addThread: assigns sequential id and returns thread', function () {
  const before = OAD.DB.threads.length;
  const t = OAD.addThread(OAD.makeThread({ title: 'Test A' }));
  OAD._assert(t.id > 0, 'Should have positive id');
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'Should increment thread count');
});

OAD.test('getThread: returns thread by id', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Findable' }));
  const found = OAD.getThread(t.id);
  OAD._assert(found !== null, 'Should find thread');
  OAD._assertEqual(found.title, 'Findable', 'Should match title');
});

OAD.test('getThread: returns null for missing id', function () {
  const found = OAD.getThread(99999);
  OAD._assertEqual(found, null, 'Should return null for missing id');
});

OAD.test('updateThread: merges patch', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Before', status: 'open' }));
  OAD.updateThread(t.id, { status: 'waiting' });
  OAD._assertEqual(OAD.getThread(t.id).status, 'waiting', 'Status should update');
  OAD._assertEqual(OAD.getThread(t.id).title, 'Before', 'Title should be unchanged');
});

OAD.test('updateThread: stamps next_action_updated_at / current_assumption_updated_at only when those fields actually change', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Timestamp stamping', next_action: 'Original action', current_assumption: 'Original assumption' }));
  OAD._assertEqual(t.next_action_updated_at, null, 'a freshly created thread must start with no timestamp');

  OAD.updateThread(t.id, { priority: 'high' });
  OAD._assertEqual(OAD.getThread(t.id).next_action_updated_at, null, 'changing an unrelated field must not stamp next_action_updated_at');

  OAD.updateThread(t.id, { next_action: 'A new action' });
  const afterAction = OAD.getThread(t.id);
  OAD._assert(afterAction.next_action_updated_at !== null, 'changing next_action\'s actual value must stamp next_action_updated_at');
  OAD._assertEqual(afterAction.current_assumption_updated_at, null, 'changing next_action must not stamp current_assumption_updated_at');

  OAD.updateThread(t.id, { next_action: 'A new action' });
  OAD._assertEqual(OAD.getThread(t.id).next_action_updated_at, afterAction.next_action_updated_at, 'passing the SAME value again must not re-stamp — this is change detection, not "touched"');

  OAD.updateThread(t.id, { current_assumption: 'A new assumption' });
  OAD._assert(OAD.getThread(t.id).current_assumption_updated_at !== null, 'changing current_assumption\'s actual value must stamp current_assumption_updated_at');
});

OAD.test('updateThread: setting parent_uuid on an inbox thread auto-promotes status to open (attaching a parent is itself an act of triage)', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Attach me', status: 'inbox' }));
  OAD.updateThread(t.id, { parent_uuid: 'some-parent-uuid' });
  OAD._assertEqual(OAD.getThread(t.id).status, 'open', 'status must auto-promote to open when a parent is attached');
});

OAD.test('updateThread: an explicit status in the same patch is never silently overridden by the parent_uuid auto-promotion', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Attach and close', status: 'inbox' }));
  OAD.updateThread(t.id, { parent_uuid: 'some-parent-uuid', status: 'closed' });
  OAD._assertEqual(OAD.getThread(t.id).status, 'closed', 'an explicit status in the patch must win over the auto-promotion');
});

OAD.test('updateThread: does not touch status when parent_uuid changes on a non-inbox thread', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Already open', status: 'waiting' }));
  OAD.updateThread(t.id, { parent_uuid: 'some-parent-uuid' });
  OAD._assertEqual(OAD.getThread(t.id).status, 'waiting', 'a non-inbox status must be left alone');
});

OAD.test('_normalizeDB: self-heals a legacy thread that has a parent_uuid but is still status:inbox (real case: Abigail-Nelnet / Abby-Mainstay docs)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const broken = { id: 1, uuid: 'nz-broken-parent-inbox', title: 'Abigail - Nelnet', status: 'inbox', parent_uuid: 'abigail-life-area-2026-06-15', evolution_log: [] };
    OAD.DB.threads = [broken];
    OAD._normalizeDB();
    const fixed = OAD.getThread(1);
    OAD._assertEqual(fixed.status, 'open', 'a thread with a parent must never remain status:inbox after normalizeDB runs');
    OAD._assert(fixed.evolution_log.some(function (e) { return e.note.indexOf('auto-corrected') !== -1; }), 'the correction must be logged, not silent');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('_normalizeDB: leaves a status:inbox thread with no parent_uuid untouched', function () {
  const origThreads = OAD.DB.threads;
  try {
    const t = { id: 1, uuid: 'nz-real-inbox', title: 'Mid July - check in on Limpies', status: 'inbox', parent_uuid: null, evolution_log: [] };
    OAD.DB.threads = [t];
    OAD._normalizeDB();
    OAD._assertEqual(OAD.getThread(1).status, 'inbox', 'a genuinely unattached inbox thread must not be touched');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

// ── Tests: Habits/Ideas migration into Thread+thread_kind (ARCHITECTURE_RULES.md Rule 1, ticket-flowqueue-data-model-migration.md Step 2) ──

OAD.test('_normalizeDB: converts legacy OAD.DB.habits/ideas array entries into real Threads with thread_kind, then empties the old arrays', function () {
  const origThreads = OAD.DB.threads;
  const origHabits = OAD.DB.habits;
  const origIdeas = OAD.DB.ideas;
  try {
    OAD.DB.threads = [OAD.makeThread({ id: 1, uuid: 'nz-mig-existing', title: 'Existing thread' })];
    OAD.DB.habits = [{ id: 1, title: 'Legacy habit', frequency: 'daily', phase: 'active', current_streak: 3 }];
    OAD.DB.ideas = [{ id: 1, title: 'Legacy idea', type: 'book' }];

    OAD._normalizeDB();

    OAD._assertEqual(OAD.DB.habits.length, 0, 'the old habits array must be empty after migration');
    OAD._assertEqual(OAD.DB.ideas.length, 0, 'the old ideas array must be empty after migration');

    const migratedHabit = OAD.DB.threads.find(function (t) { return t.title === 'Legacy habit'; });
    const migratedIdea = OAD.DB.threads.find(function (t) { return t.title === 'Legacy idea'; });
    OAD._assert(!!migratedHabit, 'the legacy habit must now exist as a real thread');
    OAD._assertEqual(migratedHabit.thread_kind, 'habit', 'migrated habit must carry the habit discriminator');
    OAD._assertEqual(migratedHabit.current_streak, 3, 'habit-specific field values must survive the migration');
    OAD._assertEqual(migratedHabit.uuid && typeof migratedHabit.uuid, 'string', 'migrated habit must have a real uuid, not none (it never had one before)');

    OAD._assert(!!migratedIdea, 'the legacy idea must now exist as a real thread');
    OAD._assertEqual(migratedIdea.thread_kind, 'idea', 'migrated idea must carry the idea discriminator');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.habits = origHabits;
    OAD.DB.ideas = origIdeas;
  }
});

OAD.test('_normalizeDB: migrated habit/idea ids never collide with existing thread ids (habits/ideas used to have their own independent id sequences)', function () {
  const origThreads = OAD.DB.threads;
  const origHabits = OAD.DB.habits;
  try {
    // Real collision case: a thread already has id 1 (from the thread id sequence), and a
    // legacy habit ALSO has id 1 (from its own independent nextHabitId() sequence) — before
    // this migration these lived in separate arrays so the collision was invisible.
    OAD.DB.threads = [OAD.makeThread({ id: 1, uuid: 'nz-collide-thread', title: 'Thread with id 1' })];
    OAD.DB.habits = [{ id: 1, title: 'Habit with id 1' }];

    OAD._normalizeDB();

    const ids = OAD.DB.threads.map(function (t) { return t.id; });
    OAD._assertEqual(new Set(ids).size, ids.length, 'no two threads may end up with the same id after migration');
    const migratedHabit = OAD.DB.threads.find(function (t) { return t.title === 'Habit with id 1'; });
    OAD._assert(migratedHabit.id !== 1 || OAD.DB.threads.filter(function (t) { return t.id === 1; }).length === 1, 'the migrated habit must not silently collide with the existing thread id 1');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.habits = origHabits;
  }
});

OAD.test('_normalizeDB: running twice does not re-migrate or duplicate (self-terminating, no separate done-flag needed)', function () {
  const origThreads = OAD.DB.threads;
  const origHabits = OAD.DB.habits;
  try {
    OAD.DB.threads = [];
    OAD.DB.habits = [{ id: 1, title: 'Once-only habit' }];

    OAD._normalizeDB();
    OAD._normalizeDB();
    OAD._normalizeDB();

    const matches = OAD.DB.threads.filter(function (t) { return t.title === 'Once-only habit'; });
    OAD._assertEqual(matches.length, 1, 'running _normalizeDB multiple times must not duplicate the migrated thread');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.habits = origHabits;
  }
});

OAD.test('exportThreads / applyImport: thread_kind and Habit/Idea fields round-trip (ARCHITECTURE_RULES.md Rule 4)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const h = OAD.addHabit(OAD.makeHabit({ title: 'Export round-trip habit', frequency: 'weekly', current_streak: 5, phase: 'active' }));
    const exported = JSON.parse(OAD.exportThreads());
    const row = exported.threads.find(function (t) { return t.uuid === h.uuid; });

    OAD._assert(!!row, 'the habit thread must be present in the export — it is just a thread now');
    OAD._assertEqual(row.thread_kind, 'habit', 'exported row must carry thread_kind');
    OAD._assertEqual(row.frequency, 'weekly', 'exported row must carry habit-specific fields');
    OAD._assertEqual(row.current_streak, 5, 'exported row must carry habit-specific fields');

    // Simulate re-importing that same row as an update to a DIFFERENT existing thread, proving
    // OAD._IMPORT_FIELDS actually syncs these fields, not just the export step.
    const target = OAD.addThread(OAD.makeThread({ title: 'Target for re-import' }));
    const patch = {};
    OAD._IMPORT_FIELDS.forEach(function (field) {
      if (row[field] !== undefined) patch[field] = row[field];
    });
    OAD.updateThread(target.id, patch);
    const updated = OAD.getThread(target.id);
    OAD._assertEqual(updated.thread_kind, 'habit', 'OAD._IMPORT_FIELDS must include thread_kind so re-import actually syncs it');
    OAD._assertEqual(updated.current_streak, 5, 'OAD._IMPORT_FIELDS must include habit fields so re-import actually syncs them');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

// ── Tests: Proposals migration into status:'proposed' Threads (ARCHITECTURE_RULES.md Rule 1, ticket-flowqueue-data-model-migration.md Step 3) ──

OAD.test('_normalizeDB: converts legacy OAD.DB.proposals array entries into status:\'proposed\' Threads, preserving their existing uuid', function () {
  const origThreads = OAD.DB.threads;
  const origProposals = OAD.DB.proposals;
  try {
    OAD.DB.threads = [];
    OAD.DB.proposals = [{ uuid: 'legacy-proposal-uuid', title: 'Legacy proposal', life_area: 'Career', closing_condition: 'Job offer accepted', rationale: 'Blind spot: no active job search thread' }];

    OAD._normalizeDB();

    OAD._assertEqual(OAD.DB.proposals.length, 0, 'the old proposals array must be empty after migration');
    const migrated = OAD.DB.threads.find(function (t) { return t.uuid === 'legacy-proposal-uuid'; });
    OAD._assert(!!migrated, 'the legacy proposal must now exist as a real thread, uuid preserved');
    OAD._assertEqual(migrated.status, 'proposed', 'migrated proposal must carry status:proposed, not a thread_kind discriminator');
    OAD._assertEqual(migrated.rationale, 'Blind spot: no active job search thread', 'proposal-specific field values must survive the migration');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.proposals = origProposals;
  }
});

OAD.test('status:\'proposed\' threads are invisible to pressure/Due/Active-count machinery, same treatment as inbox/dormant — an unreviewed AI suggestion is not real work yet', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    const proposal = OAD.addThread(OAD.makeThread({ status: 'proposed', title: 'Unreviewed suggestion', priority: 'critical', life_area: 'Career', next_action_date: OAD.todayStr() }));

    OAD._assertEqual(OAD.pressure(proposal), 0, 'a proposed thread must read pressure 0, regardless of priority/dates — it is not accepted yet');
    OAD._assert(!OAD.Due.activeThreadsRaw().some(function (t) { return t.uuid === proposal.uuid; }), 'a proposed thread must never appear in the active-thread pipeline (Due Today/Overdue/Focus Now all build on this)');
    OAD._assertEqual(OAD.getLifeAreaHeat().find(function (a) { return a.name === 'Career'; }), undefined, 'a proposed thread must not contribute to any life-area heat aggregate');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('getEisenhowerQuadrant: a proposed thread has no quadrant (falls through the open-only branch)', function () {
  const t = OAD.makeThread({ status: 'proposed', title: 'Proposal', priority: 'critical' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(t), null, 'a proposed thread must not appear in any Matrix quadrant');
});

OAD.test('exportThreads / applyImport: rationale round-trips (ARCHITECTURE_RULES.md Rule 4)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const p = OAD.addThread(OAD.makeThread({ status: 'proposed', title: 'Export round-trip proposal', rationale: 'Because the graph heat says so' }));
    const exported = JSON.parse(OAD.exportThreads());
    const row = exported.threads.find(function (t) { return t.uuid === p.uuid; });
    OAD._assert(!!row, 'the proposal thread must be present in the export — it is just a thread now');
    OAD._assertEqual(row.rationale, 'Because the graph heat says so', 'exported row must carry rationale');
    OAD._assert(OAD._IMPORT_FIELDS.indexOf('rationale') !== -1, 'OAD._IMPORT_FIELDS must include rationale so re-import actually syncs it');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('_threadForm: Next Action renders as a multi-line textarea, matching Closing Condition and Current Assumption, not a single-line input', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Textarea sizing', next_action: 'A next step' }));
  OAD.openEditModal(t.id);
  const field = document.getElementById('f-next-action');
  OAD._assert(field !== null, 'the Next Action field must exist');
  OAD._assertEqual(field.tagName, 'TEXTAREA', 'Next Action must be a <textarea>, not a single-line <input>, so a long step is actually readable while editing');
  OAD._assertEqual(field.value, 'A next step', 'existing next_action text must still populate the field');
  OAD.closeModal();
});

OAD.test('deleteThread: removes thread', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'ToDelete' }));
  OAD.deleteThread(t.id);
  OAD._assertEqual(OAD.getThread(t.id), null, 'Should not find deleted thread');
});

OAD.test('addEvolution: appends log entry', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Log test' }));
  OAD.addEvolution(t.id, 'Something happened');
  OAD._assertEqual(t.evolution_log.length, 1, 'Should have 1 log entry');
  OAD._assertEqual(t.evolution_log[0].note, 'Something happened', 'Note should match');
});

OAD.test('addInsight: appends to ai_insights and counsel_history, tagged with who/what triggered it', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Insight test' }));
  const before = OAD.DB.persona.counsel_history.length;
  OAD.addInsight(t.id, { observation: 'Interesting', date: '2026-05-30' }, 'manual');
  OAD._assertEqual(t.ai_insights.length, 1, 'Should have 1 insight');
  OAD._assertEqual(t.ai_insights[0].source, 'manual', 'ai_insights entry must record which path triggered it');
  OAD._assertEqual(OAD.DB.persona.counsel_history.length, before + 1, 'Should add to counsel_history');
  OAD._assertEqual(OAD.DB.persona.counsel_history[before].source, 'manual', 'counsel_history entry must record which path triggered it');

  OAD.addInsight(t.id, { observation: 'Auto-fired' }, 'auto');
  OAD._assertEqual(t.ai_insights[1].source, 'auto', 'a silently auto-triggered insight must be distinguishable from a manually requested one');
});

OAD.test('addInsight: throws on a missing or unrecognized source rather than silently guessing', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Insight source validation' }));
  let threwForMissing = false;
  try { OAD.addInsight(t.id, { observation: 'x' }); } catch (e) { threwForMissing = true; }
  OAD._assert(threwForMissing, 'omitting source must throw, not default to something that looks manual or automatic');

  let threwForBogus = false;
  try { OAD.addInsight(t.id, { observation: 'x' }, 'somebody'); } catch (e) { threwForBogus = true; }
  OAD._assert(threwForBogus, 'an unrecognized source string must throw, not be silently accepted');
});

OAD.test('makeThread: defaults are valid', function () {
  const t = OAD.makeThread();
  OAD._assertEqual(t.status, 'open', 'Default status is open');
  OAD._assertEqual(t.priority, 'medium', 'Default priority is medium');
  OAD._assert(Array.isArray(t.connections), 'connections is array');
  OAD._assert(Array.isArray(t.evolution_log), 'evolution_log is array');
  OAD._assert(Array.isArray(t.ai_insights), 'ai_insights is array');
});

// ── Tests: persistence ────────────────────────────────────────────────

OAD.test('saveDB/loadDB: round-trips threads with correct field values', function () {
  const prevKey     = OAD._DB_KEY;
  const prevPersist = OAD._DB_PERSIST;
  OAD._DB_KEY     = '_oad_test_' + Date.now();
  OAD._DB_PERSIST = true;
  try {
    const t = OAD.addThread(OAD.makeThread({ title: 'Persist me', status: 'waiting', priority: 'high' }));
    const savedDB = JSON.parse(JSON.stringify(OAD.DB));
    OAD.DB = { threads: [], cadences: [], persona: OAD.DB.persona };

    const found = OAD.loadDB();
    OAD._assert(found === true, 'loadDB should return true when data exists');
    const restored = OAD.DB.threads.find(function (x) { return x.title === 'Persist me'; });
    OAD._assert(!!restored, 'thread should survive localStorage round-trip');
    OAD._assertEqual(restored.status,   'waiting', 'status should survive round-trip');
    OAD._assertEqual(restored.priority, 'high',    'priority should survive round-trip');

    OAD.DB = savedDB;
  } finally {
    localStorage.removeItem(OAD._DB_KEY);
    OAD._DB_KEY     = prevKey;
    OAD._DB_PERSIST = prevPersist;
  }
});

OAD.test('saveDB/loadDB: round-trips persona fields', function () {
  const prevKey     = OAD._DB_KEY;
  const prevPersist = OAD._DB_PERSIST;
  OAD._DB_KEY     = '_oad_test_' + Date.now();
  OAD._DB_PERSIST = true;
  try {
    OAD.DB.persona.life_context.pressure_level = 'extreme';
    OAD.saveDB();
    const savedDB = JSON.parse(JSON.stringify(OAD.DB));
    OAD.DB = { threads: [], cadences: [], persona: { life_context: { pressure_level: 'low' }, tone_calibration: {}, counsel_history: [], assumption_tendencies: [], what_is_working: [], what_is_not_working: [] } };

    OAD.loadDB();
    OAD._assertEqual(OAD.DB.persona.life_context.pressure_level, 'extreme', 'persona pressure_level should survive round-trip');

    OAD.DB = savedDB;
  } finally {
    localStorage.removeItem(OAD._DB_KEY);
    OAD._DB_KEY     = prevKey;
    OAD._DB_PERSIST = prevPersist;
  }
});

OAD.test('loadDB: returns false when storage is empty', function () {
  const prevKey     = OAD._DB_KEY;
  const prevPersist = OAD._DB_PERSIST;
  OAD._DB_KEY     = '_oad_test_empty_' + Date.now();
  OAD._DB_PERSIST = true;
  try {
    localStorage.removeItem(OAD._DB_KEY);
    const result = OAD.loadDB();
    OAD._assertEqual(result, false, 'loadDB should return false when no data in storage');
  } finally {
    localStorage.removeItem(OAD._DB_KEY);
    OAD._DB_KEY     = prevKey;
    OAD._DB_PERSIST = prevPersist;
  }
});

OAD.test('loadDB: returns null on corrupt JSON without throwing', function () {
  const prevKey     = OAD._DB_KEY;
  const prevPersist = OAD._DB_PERSIST;
  OAD._DB_KEY     = '_oad_test_corrupt_' + Date.now();
  OAD._DB_PERSIST = true;
  try {
    localStorage.setItem(OAD._DB_KEY, 'not valid json {{{');
    const result = OAD.loadDB();
    OAD._assertEqual(result, null, 'loadDB should return null on corrupt JSON (not false, not throw)');
  } finally {
    localStorage.removeItem(OAD._DB_KEY);
    OAD._DB_KEY     = prevKey;
    OAD._DB_PERSIST = prevPersist;
  }
});

// ── Tests: suggestArea ────────────────────────────────────────────────

OAD.test('suggestArea: detects Career', function () {
  OAD._assertEqual(OAD.suggestArea('new job application'), 'Career');
});

OAD.test('suggestArea: detects Finances', function () {
  OAD._assertEqual(OAD.suggestArea('paying off debt'), 'Finances');
});

OAD.test('suggestArea: detects Health', function () {
  OAD._assertEqual(OAD.suggestArea('doctor appointment'), 'Health');
});

OAD.test('suggestArea: VR&E → Legal', function () {
  OAD._assertEqual(OAD.suggestArea('VR&E counselor meeting'), 'Legal');
});

OAD.test('suggestArea: job board → Job Search (not Career)', function () {
  OAD._assertEqual(OAD.suggestArea('M/W/F job board sweep'), 'Job Search');
});

OAD.test('suggestArea: weekly job application cadence → Job Search', function () {
  OAD._assertEqual(OAD.suggestArea('Weekly Job Application Cadence'), 'Job Search');
});

OAD.test('suggestArea: family → Family (not Relationships)', function () {
  OAD._assertEqual(OAD.suggestArea('Call mom about family finances'), 'Family');
});

// ── Tests: Complete Action Wizard ────────────────────────────────────

(function () {
  // Build a complete wizard state for a given thread id.
  // step2 holds "what's next" data (only present on the NO/not-closed path).
  function wizardState(id, overrides) {
    return Object.assign({
      id: id,
      step1: { what_done: 'Did the thing', assumption_verified: false },
      step2: {
        action:     'Next step',
        date:       '2026-12-01',
        channel:    'email',
        contact:    'Test Contact',
        ctg_date:   '2026-12-10',
        ctg_action: 'Escalate if no response'
      }
    }, overrides);
  }

  // ── _cawSave (NO path — thread stays open) ──────────────────────────

  OAD.test('cawSave: updates all next-action fields on thread', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW fields', status: 'open' }));
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    const u = OAD.getThread(t.id);
    OAD._assertEqual(u.next_action,              'Next step',                'next_action');
    OAD._assertEqual(u.next_action_date,         '2026-12-01',               'next_action_date');
    OAD._assertEqual(u.next_action_channel,      'email',                    'next_action_channel');
    OAD._assertEqual(u.next_action_contact,      'Test Contact',             'next_action_contact');
    OAD._assertEqual(u.contingency_trigger_date, '2026-12-10',               'contingency_trigger_date');
    OAD._assertEqual(u.contingency_action,       'Escalate if no response',  'contingency_action');
  });

  OAD.test('cawSave: logs evolution entry containing what_done', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW log', status: 'open' }));
    const before = t.evolution_log.length;
    OAD._caw = wizardState(t.id, { step1: { what_done: 'Sent the critical email', assumption_verified: false } });
    OAD._cawSave();
    const u = OAD.getThread(t.id);
    OAD._assert(u.evolution_log.length > before, 'evolution log should grow');
    OAD._assert(u.evolution_log.slice(-1)[0].note.includes('Sent the critical email'), 'log entry should contain what_done');
  });

  OAD.test('cawSave: log entry includes new next action and date', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW log detail', status: 'open' }));
    OAD._caw = wizardState(t.id, {
      step2: { action: 'Call Robin', date: '2026-06-02', channel: 'phone', contact: '', ctg_date: '', ctg_action: '' }
    });
    OAD._cawSave();
    const note = OAD.getThread(t.id).evolution_log.slice(-1)[0].note;
    OAD._assert(note.includes('Call Robin'), 'log entry should include next action');
    OAD._assert(note.includes('2026-06-02'), 'log entry should include next date');
  });

  OAD.test('cawSave: assumption_verified set true when step1 confirms', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW assumption yes', assumption_verified: false }));
    OAD._caw = wizardState(t.id, { step1: { what_done: 'Confirmed it', assumption_verified: true } });
    OAD._cawSave();
    OAD._assertEqual(OAD.getThread(t.id).assumption_verified, true, 'assumption_verified should be true');
  });

  OAD.test('cawSave: assumption_verified stays false when step1 denies', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW assumption no', assumption_verified: false }));
    OAD._caw = wizardState(t.id, { step1: { what_done: 'Still uncertain', assumption_verified: false } });
    OAD._cawSave();
    OAD._assertEqual(OAD.getThread(t.id).assumption_verified, false, 'assumption_verified should remain false');
  });

  OAD.test('cawSave: stalled thread moves to open after action completed', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW stalled', status: 'stalled' }));
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    OAD._assertEqual(OAD.getThread(t.id).status, 'open', 'stalled should become open');
  });

  OAD.test('cawSave: waiting thread stays waiting after action completed', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW waiting', status: 'waiting' }));
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    OAD._assertEqual(OAD.getThread(t.id).status, 'waiting', 'waiting status should be preserved');
  });

  OAD.test('cawSave: open thread stays open after action completed', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW open', status: 'open' }));
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    OAD._assertEqual(OAD.getThread(t.id).status, 'open', 'open status should be preserved');
  });

  OAD.test('cawSave: clears _caw state after save', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW cleanup' }));
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    OAD._assertEqual(OAD._caw, null, '_caw should be null after save');
  });

  OAD.test('cawSave: pressure drops after assumption verified', function () {
    const t = OAD.addThread(OAD.makeThread({
      title: 'CAW pressure assumption',
      status: 'open',
      priority: 'low',
      current_assumption: 'Something unverified',
      assumption_verified: false,
      connections: []
    }));
    const before = OAD.pressure(t);
    OAD._caw = wizardState(t.id, { step1: { what_done: 'Confirmed the fact', assumption_verified: true } });
    OAD._cawSave();
    const after = OAD.pressure(OAD.getThread(t.id));
    OAD._assert(after < before, `Pressure should drop after assumption verified. Before: ${before}, After: ${after}`);
  });

  OAD.test('cawSave: pressure drops after stalled thread action completed', function () {
    const t = OAD.addThread(OAD.makeThread({
      title: 'CAW pressure stalled',
      status: 'stalled',
      priority: 'low',
      connections: []
    }));
    const before = OAD.pressure(t);
    OAD._caw = wizardState(t.id);
    OAD._cawSave();
    const after = OAD.pressure(OAD.getThread(t.id));
    OAD._assert(after < before, `Pressure should drop after stalled→open. Before: ${before}, After: ${after}`);
  });

  // ── _cawSaveClose (YES path — thread closes immediately) ─────────────

  OAD.test('cawSaveClose: sets status closed and closing_condition_met without step2', function () {
    const t = OAD.addThread(OAD.makeThread({
      title: 'CAW close it',
      status: 'waiting',
      closing_condition: 'Equipment received and in use'
    }));
    OAD._caw = { id: t.id, step1: { what_done: 'Got the gear', assumption_verified: false }, step2: null };
    OAD._cawSaveClose();
    const u = OAD.getThread(t.id);
    OAD._assertEqual(u.status, 'closed', 'status should be closed');
    OAD._assertEqual(u.closing_condition_met, true, 'closing_condition_met should be true');
  });

  OAD.test('cawSaveClose: logs closure in evolution', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW close log', status: 'open' }));
    OAD._caw = { id: t.id, step1: { what_done: 'Final task done', assumption_verified: false }, step2: null };
    OAD._cawSaveClose();
    const note = OAD.getThread(t.id).evolution_log.slice(-1)[0].note;
    OAD._assert(note.includes('closed'), 'closure log entry should mention closed');
    OAD._assert(note.includes('Final task done'), 'closure log should include what_done');
  });

  OAD.test('cawSaveClose: clears _caw state after close', function () {
    const t = OAD.addThread(OAD.makeThread({ title: 'CAW close cleanup' }));
    OAD._caw = { id: t.id, step1: { what_done: 'Done', assumption_verified: false }, step2: null };
    OAD._cawSaveClose();
    OAD._assertEqual(OAD._caw, null, '_caw should be null after close');
  });

  // ── _isClosingAction + _cawStep3Next ────────────────────────────────

  OAD.test('isClosingAction: empty string, nothing, closed, and Nothing - it\'s closed are all closing actions', function () {
    OAD._assert(OAD._isClosingAction(''),                       'empty string should be closing');
    OAD._assert(OAD._isClosingAction('nothing'),                '"nothing" should be closing');
    OAD._assert(OAD._isClosingAction('closed'),                 '"closed" should be closing');
    OAD._assert(OAD._isClosingAction('Nothing - it\'s closed'), '"Nothing - it\'s closed" should be closing');
    OAD._assert(!OAD._isClosingAction('Call Robin by Friday'),  'normal next action should not be closing');
    OAD._assert(!OAD._isClosingAction('Send the report'),       '"Send the report" should not be closing');
  });

  OAD.test('cawStep3Next: skips By When validation when action is a closing phrase', function () {
    const fields = {
      'ca-action':     { value: "Nothing - it's closed" },
      'ca-date':       { value: '' },
      'ca-channel':    { value: 'email' },
      'ca-contact':    { value: '' },
      'ca-ctg-date':   { value: '' },
      'ca-ctg-action': { value: '' }
    };
    const origGetEl = document.getElementById.bind(document);
    document.getElementById = function (id) { return fields[id] || origGetEl(id); };

    let alertFired = false;
    const origAlert = window.alert;
    window.alert = function () { alertFired = true; };

    const t = OAD.addThread(OAD.makeThread({ title: 'Closing action no date' }));
    OAD._caw = { id: t.id, step1: { what_done: 'Done', assumption_verified: false }, step2: null };

    const origSave = OAD._cawSave;
    OAD._cawSave = function () {};

    OAD._cawStep3Next();

    document.getElementById = origGetEl;
    window.alert = origAlert;
    OAD._cawSave = origSave;
    OAD._caw = null;

    OAD._assert(!alertFired, 'By When alert should not fire for closing action with no date');
  });

  // ── _cawStep3 render: contingency date/action pre-fill ───────────────
  // Real bug this closes: unlike the regular edit-thread modal (which always pre-fills its
  // contingency inputs from the thread's own current value), this wizard's step 3 previously
  // defaulted straight to blank on first visit — so answering "not done" on a thread that already
  // had a contingency date/action set, then saving without manually re-typing them, silently wiped
  // both to empty. Per the pattern already used for ca-contact just above in this same template.

  OAD.test('cawStep3: contingency date/action pre-fill from the thread\'s existing values on first visit, not blank', function () {
    const t = OAD.addThread(OAD.makeThread({
      title: 'CAW ctg prefill', status: 'open',
      contingency_trigger_date: '2026-07-06', contingency_action: 'Let it go'
    }));
    OAD._caw = { id: t.id, step1: { what_done: 'Sent follow-up', assumption_verified: false }, step2: null };
    OAD._cawStep3();
    OAD._assertEqual(document.getElementById('ca-ctg-date').value, '2026-07-06', 'first visit to step 3 must pre-fill the existing contingency_trigger_date, not leave it blank');
    OAD._assertEqual(document.getElementById('ca-ctg-action').value, 'Let it go', 'first visit to step 3 must pre-fill the existing contingency_action, not leave it blank');
    OAD.closeModal();
    OAD._caw = null;
  });

  OAD.test('cawStep3: revisiting step 3 preserves what was actually typed in this wizard session, including an intentional clear', function () {
    const t = OAD.addThread(OAD.makeThread({
      title: 'CAW ctg revisit', status: 'open',
      contingency_trigger_date: '2026-07-06', contingency_action: 'Let it go'
    }));
    OAD._caw = { id: t.id, step1: { what_done: 'Sent follow-up', assumption_verified: false }, step2: { ctg_date: '', ctg_action: '' } };
    OAD._cawStep3();
    OAD._assertEqual(document.getElementById('ca-ctg-date').value, '', 'a value already cleared within this wizard session must stay cleared, not be silently re-filled from the thread');
    OAD._assertEqual(document.getElementById('ca-ctg-action').value, '', 'same for contingency_action');
    OAD.closeModal();
    OAD._caw = null;
  });

}());

// ── Tests: bulkImport dedup guard ────────────────────────────────────

OAD.test('bulkImport: skips rows whose title already exists', function () {
  const before = OAD.DB.threads.length;
  OAD.bulkImport([{ title: 'Dedup Test Thread', lifeArea: 'Career', status: 'open' }]);
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'first import should create the thread');
  OAD.bulkImport([{ title: 'Dedup Test Thread', lifeArea: 'Career', status: 'open' }]);
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'second import should not create a duplicate');
});

OAD.test('bulkImport: skips even when existing thread is closed', function () {
  const before = OAD.DB.threads.length;
  OAD.bulkImport([{ title: 'Closed Dedup Thread', lifeArea: 'Career', status: 'closed' }]);
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'first import creates it');
  OAD.bulkImport([{ title: 'Closed Dedup Thread', lifeArea: 'Career', status: 'open' }]);
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'should not recreate a closed thread');
});

OAD.test('bulkImport: skips titleless rows', function () {
  const before = OAD.DB.threads.length;
  OAD.bulkImport([{ title: '', lifeArea: 'Career' }, { lifeArea: 'Career' }]);
  OAD._assertEqual(OAD.DB.threads.length, before, 'titleless rows should be skipped');
});

// ── Tests: Import — title sync and no-UUID guard ─────────────────────

OAD.test('applyImport: title field updates when title is in _IMPORT_FIELDS', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Original Title' }));
  const updateItem = {
    incoming: { uuid: t.uuid, title: 'Updated Title', status: 'open' },
    existing: t
  };
  OAD.applyImport({ create: [], update: [updateItem], close: [] }, [updateItem]);
  OAD._assertEqual(OAD.getThread(t.id).title, 'Updated Title', 'title should be updated via import');
});

OAD.test('parseImportFile: no-UUID row with unique title match goes to update (title fallback)', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Title Fallback Sentinel' }));
  const json = JSON.stringify({ threads: [{ title: 'Title Fallback Sentinel', status: 'waiting' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.update.length, 1, 'unique title match without UUID should go to update');
  OAD._assertEqual(results.create.length, 0, 'should not create a duplicate when title uniquely matches');
  OAD._assertEqual(results.update[0].existing.id, t.id, 'update target should be the existing thread');
});

OAD.test('parseImportFile: no-UUID row with ambiguous title (2 matches) still goes to create', function () {
  OAD.addThread(OAD.makeThread({ title: 'Ambiguous Sentinel' }));
  OAD.addThread(OAD.makeThread({ title: 'Ambiguous Sentinel' }));
  const json = JSON.stringify({ threads: [{ title: 'Ambiguous Sentinel', status: 'waiting' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.create.length, 1, 'ambiguous title (2 open matches) must fall through to create');
  OAD._assertEqual(results.update.length, 0, 'should not update when title is ambiguous');
});

// ── Tests: _migrateActionDeadlines ───────────────────────────────────

OAD.test('_migrateActionDeadlines: sets deadline from next_action_date for action-type open threads only', function () {
  const tAction = OAD.addThread(OAD.makeThread({
    title: 'Action thread no deadline',
    closing_condition_type: 'action',
    deadline: null,
    next_action_date: '2026-07-15',
    status: 'open'
  }));
  const tOutcome = OAD.addThread(OAD.makeThread({
    title: 'Outcome thread no deadline',
    closing_condition_type: 'outcome',
    deadline: null,
    next_action_date: '2026-07-15',
    status: 'open'
  }));
  const tAlreadySet = OAD.addThread(OAD.makeThread({
    title: 'Action thread has deadline',
    closing_condition_type: 'action',
    deadline: '2026-08-01',
    next_action_date: '2026-07-15',
    status: 'open'
  }));
  const tClosed = OAD.addThread(OAD.makeThread({
    title: 'Closed action thread',
    closing_condition_type: 'action',
    deadline: null,
    next_action_date: '2026-07-15',
    status: 'closed'
  }));
  const changed = OAD._migrateActionDeadlines();
  OAD._assert(changed >= 1,                                         'at least one thread should be migrated');
  OAD._assertEqual(OAD.getThread(tAction.id).deadline,    '2026-07-15', 'action thread: deadline set from next_action_date');
  OAD._assertEqual(OAD.getThread(tOutcome.id).deadline,   null,         'outcome thread: deadline left null');
  OAD._assertEqual(OAD.getThread(tAlreadySet.id).deadline,'2026-08-01', 'existing deadline: not overwritten');
  OAD._assertEqual(OAD.getThread(tClosed.id).deadline,    null,         'closed thread: not migrated');
});

// ── Tests: getDayLoad + cross-load multiplier ─────────────────────────

OAD.test('getDayLoad: sums pressure scores of threads due on a given date', function () {
  const date = '2099-01-01';
  OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  const load = OAD.getDayLoad(date);
  OAD._assert(load > 150, 'day load of 3 stalled-critical threads should exceed 150 (got ' + load + ')');
});

OAD.test('pressure: load multiplier adds 12 when day load exceeds 150', function () {
  const date = '2099-01-02';
  // Three stalled critical threads: each scores 60 without load → day load = 180 > 150
  const t1 = OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  OAD.addThread(OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: date, connections: [] }));
  // Control: identical thread on an uncrowded date (not in DB so its date has no peers)
  const tControl = OAD.makeThread({ status: 'stalled', priority: 'critical', next_action_date: '2099-03-01', connections: [] });
  const loadedScore   = OAD.pressure(t1);
  const unloadedScore = OAD.pressure(tControl);
  OAD._assert(loadedScore > unloadedScore,
    'thread on overloaded date (' + loadedScore + ') should exceed identical thread on uncrowded date (' + unloadedScore + ')');
});

// ── Tests: This Week's Load composite score (calculateDayLoadScore / getDayLoadLabel) ──

OAD.test('getDayLoadLabel: uses configurable thresholds from OAD.Config.weekLoadWeights, not hardcoded values', function () {
  const original = OAD.Config.weekLoadWeights;
  try {
    OAD.Config.weekLoadWeights = { busyThreshold: 10, heavyThreshold: 20 };
    OAD._assertEqual(OAD.getDayLoadLabel(5), 'clear', 'below busyThreshold');
    OAD._assertEqual(OAD.getDayLoadLabel(10), 'busy', 'at busyThreshold');
    OAD._assertEqual(OAD.getDayLoadLabel(20), 'heavy', 'at heavyThreshold');

    // Same raw scores, different config -> different labels. Proves the thresholds are
    // actually read from config, not baked into the function.
    OAD.Config.weekLoadWeights = { busyThreshold: 1, heavyThreshold: 4 };
    OAD._assertEqual(OAD.getDayLoadLabel(5), 'heavy', 'same score (5), tighter thresholds -> heavy instead of clear');
  } finally {
    OAD.Config.weekLoadWeights = original;
  }
});

OAD.test('getDayLoadLabel: falls back to documented defaults (50/150) when config is missing', function () {
  const original = OAD.Config.weekLoadWeights;
  try {
    OAD.Config.weekLoadWeights = {};
    OAD._assertEqual(OAD.getDayLoadLabel(49), 'clear', 'below default busy threshold');
    OAD._assertEqual(OAD.getDayLoadLabel(50), 'busy', 'at default busy threshold');
    OAD._assertEqual(OAD.getDayLoadLabel(150), 'heavy', 'at default heavy threshold');
  } finally {
    OAD.Config.weekLoadWeights = original;
  }
});

OAD.test('calculateDayLoadScore: sums pressure, adds edge-weighted connections and per-cadence weight', function () {
  const originalThreads = OAD.DB.threads;
  const originalWeights = OAD.Config.weekLoadWeights;
  try {
    OAD.Config.weekLoadWeights = { edgeMultiplier: 2, cadenceWeight: 20, busyThreshold: 50, heavyThreshold: 150 };
    const date = '2099-05-01';
    const t = { id: 9001, uuid: 'wl-t1', title: 'Load test thread', status: 'open', priority: 'low',
      next_action_date: date,
      connections: [
        { to_uuid: 'wl-t2', edge_type: 'blocks' },
        { to_uuid: 'wl-t2', edge_type: 'relates' }
      ]
    };
    const t2 = { id: 9002, uuid: 'wl-t2', title: 'Unrelated', status: 'open', priority: 'low', connections: [] };
    // Cadences are thread_kind:'cadence' Threads now (ARCHITECTURE_RULES.md Rule 1) —
    // OAD.getVisibleCadences reads OAD.DB.threads, not a separate array.
    const cadenceThread = { id: 9101, uuid: 'wl-cad-1', title: 'Cadence due same day', thread_kind: 'cadence', next_due: date, recurrence: 'monthly-1st', days_of_week: [] };
    OAD.DB.threads = [t, t2, cadenceThread];

    const ownPressure = OAD.pressure(t, true); // matches how getDayLoad computes it internally
    const expectedEdgeContribution = 2 * 2; // 2 connections (blocks + relates) * edgeMultiplier 2
    const expectedCadenceContribution = 20; // 1 cadence * cadenceWeight 20
    const score = OAD.calculateDayLoadScore(date);
    OAD._assertEqual(score, ownPressure + expectedEdgeContribution + expectedCadenceContribution,
      'score should be pressure-sum + edge-weight + cadence-weight, using configured multipliers');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.Config.weekLoadWeights = originalWeights;
  }
});

OAD.test('calculateDayLoadScore: two entangled, genuinely overwhelming threads outscore ten easy ones — the exact intuition this replaces raw item count for', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const heavyDate = '2099-06-01';
    const easyDate = '2099-06-02';
    const ctgSoon = (function () { const d = new Date(); d.setDate(d.getDate() + 1); return _localDateStr(d); })();

    // Two critical/stalled threads, entangled with each other AND each facing an imminent
    // contingency — this is "two tasks and Underwater," not just "two tasks happen to be
    // marked critical." A bare stalled+critical pair with no other severity factor lands as
    // a solidly-elevated Busy day, not Heavy — and that's correct: Heavy should mean genuinely
    // overwhelming, not "contains any critical item."
    const heavy1 = { id: 9201, uuid: 'wl-heavy-1', title: 'Heavy 1', status: 'stalled', priority: 'critical',
      next_action_date: heavyDate, contingency_trigger_date: ctgSoon,
      connections: [{ to_uuid: 'wl-heavy-2', edge_type: 'blocks' }] };
    const heavy2 = { id: 9202, uuid: 'wl-heavy-2', title: 'Heavy 2', status: 'stalled', priority: 'critical',
      next_action_date: heavyDate, contingency_trigger_date: ctgSoon,
      connections: [{ to_uuid: 'wl-heavy-1', edge_type: 'blocked_by' }] };

    // Ten easy, isolated, medium-priority open threads — genuinely light individually,
    // but there are a lot of them.
    const easyThreads = [];
    for (let i = 0; i < 10; i++) {
      easyThreads.push({ id: 9300 + i, uuid: 'wl-easy-' + i, title: 'Easy ' + i, status: 'open', priority: 'medium',
        next_action_date: easyDate, connections: [] });
    }

    OAD.DB.threads = [heavy1, heavy2].concat(easyThreads);

    const heavyScore = OAD.calculateDayLoadScore(heavyDate);
    const easyScore = OAD.calculateDayLoadScore(easyDate);
    OAD._assert(heavyScore > easyScore,
      'two entangled, imminently-contingent critical/stalled threads (score ' + heavyScore + ') should outweigh ten easy medium-priority threads (score ' + easyScore + ')');
    OAD._assertEqual(OAD.getDayLoadLabel(easyScore), 'busy', 'ten easy items should land as Busy, not Heavy');
    OAD._assertEqual(OAD.getDayLoadLabel(heavyScore), 'heavy', 'two genuinely overwhelming entangled items should land as Heavy despite far fewer items');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('markCadenceDone: refreshes the active view, not just the Cadence panel', function () {
  const originalThreads = OAD.DB.threads;
  const originalCadences = OAD.DB.cadences;
  const originalActiveId = OAD._activeId;
  const originalLastView = OAD._lastView;
  try {
    const c = OAD.addCadence(OAD.makeCadence({ title: 'Refresh test cadence', recurrence: 'monthly-1st' }));
    OAD._activeId = null; // no thread detail open
    OAD._lastView = 'Daily';
    let refreshCalled = false;
    const origRefresh = OAD.refreshActiveView;
    OAD.refreshActiveView = function () { refreshCalled = true; };
    try {
      OAD.markCadenceDone(c.id);
      OAD._assert(refreshCalled, 'markCadenceDone should call refreshActiveView() regardless of which view is active');
    } finally {
      OAD.refreshActiveView = origRefresh;
    }
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.DB.cadences = originalCadences;
    OAD._activeId = originalActiveId;
    OAD._lastView = originalLastView;
  }
});

OAD.test('_autoRefreshActiveView: does not refresh while a thread detail is open', function () {
  const originalActiveId = OAD._activeId;
  try {
    OAD._activeId = 12345; // simulate a thread detail being open
    let refreshCalled = false;
    const origRefresh = OAD.refreshActiveView;
    OAD.refreshActiveView = function () { refreshCalled = true; };
    try {
      OAD._autoRefreshActiveView();
      OAD._assert(!refreshCalled, 'should not refresh and clobber an open thread detail');
    } finally {
      OAD.refreshActiveView = origRefresh;
    }
  } finally {
    OAD._activeId = originalActiveId;
  }
});

// ── Tests: _seedCadences ──────────────────────────────────────────────

OAD.test('_seedCadences: creates at least 3 cadences including Monthly Bills Review', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    OAD._seedCadences();
    const cadences = OAD.getCadenceThreads();
    OAD._assert(cadences.length >= 3, 'at least 3 cadences should be seeded');
    const mbr = cadences.find(function (c) { return c.title === 'Monthly Bills Review'; });
    OAD._assert(!!mbr,                          'Monthly Bills Review cadence should exist');
    OAD._assertEqual(mbr.recurrence, 'monthly-15th', 'Monthly Bills Review recurrence should be monthly-15th');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

// ── Tests: weekly-days recurrence ─────────────────────────────────────

OAD.test('nextCadenceDue: weekly-days finds the next matching weekday forward', function () {
  // 2024-01-01 is a Monday (day 1); days_of_week targets Wednesday (3).
  const due = OAD.nextCadenceDue('weekly-days', '2024-01-01', [3]);
  OAD._assertEqual(due, '2024-01-03', 'next Wednesday after Monday should be 2 days out');
});

OAD.test('nextCadenceDue: weekly-days wraps to next week when fromDate itself matches', function () {
  // fromDate is itself a Monday; next due must be strictly after fromDate, so it wraps to the following Monday.
  const due = OAD.nextCadenceDue('weekly-days', '2024-01-01', [1]);
  OAD._assertEqual(due, '2024-01-08', 'should wrap to next Monday, not return fromDate itself');
});

OAD.test('nextCadenceDue: weekly-days with no days configured falls back to +7 days', function () {
  const due = OAD.nextCadenceDue('weekly-days', '2024-01-01', []);
  OAD._assertEqual(due, '2024-01-08', 'empty days_of_week should behave like plain weekly');
});

OAD.test('prevCadenceDue: weekly-days returns today when today matches a configured day', function () {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = _localDateStr(today);
  const prev = OAD.prevCadenceDue('weekly-days', [today.getDay()]);
  OAD._assertEqual(prev, todayStr, 'today should count as the most recent matching day');
});

OAD.test('prevCadenceDue: weekly-days returns null when no days configured', function () {
  OAD._assertEqual(OAD.prevCadenceDue('weekly-days', []), null, 'no days configured means no previous due date');
});

OAD.test('formatRecurrence: expands weekly-days into sorted day names', function () {
  const c = { recurrence: 'weekly-days', days_of_week: [5, 1, 3] };
  OAD._assertEqual(OAD.formatRecurrence(c), 'weekly-days (Mon, Wed, Fri)', 'days should display sorted, not insertion order');
});

OAD.test('formatRecurrence: other recurrence types pass through unchanged', function () {
  const c = { recurrence: 'monthly-1st', days_of_week: [] };
  OAD._assertEqual(OAD.formatRecurrence(c), 'monthly-1st', 'non weekly-days recurrence returned as-is');
});

OAD.test('makeCadence: defaults days_of_week to an empty array', function () {
  const c = OAD.makeCadence({});
  OAD._assert(Array.isArray(c.days_of_week) && c.days_of_week.length === 0, 'days_of_week should default to []');
});

OAD.test('markCadenceDone: passes cadence.days_of_week through to nextCadenceDue', function () {
  const c = OAD.addCadence(OAD.makeCadence({ title: 'Wiring test cadence', recurrence: 'weekly-days', days_of_week: [2, 4] }));
  const origNextDue = OAD.nextCadenceDue;
  let capturedDays = null;
  OAD.nextCadenceDue = function (recurrence, fromDate, daysOfWeek) {
    capturedDays = daysOfWeek;
    return origNextDue(recurrence, fromDate, daysOfWeek);
  };
  OAD.markCadenceDone(c.id);
  OAD.nextCadenceDue = origNextDue;
  OAD._assertEqual(JSON.stringify(capturedDays), JSON.stringify([2, 4]), 'days_of_week should be passed through to nextCadenceDue');
  OAD.deleteCadence(c.id);
});

OAD.test('_normalizeDB: converts legacy OAD.DB.cadences array entries into real Threads with thread_kind and a real uuid (ARCHITECTURE_RULES.md Rule 3 — cadences never had one before)', function () {
  const origThreads = OAD.DB.threads;
  const origCadences = OAD.DB.cadences;
  try {
    OAD.DB.threads = [];
    OAD.DB.cadences = [{ id: 1, title: 'Legacy migration cadence', recurrence: 'weekly', next_due: '2026-08-01', last_completed: '2026-07-01' }];

    OAD._normalizeDB();

    OAD._assertEqual(OAD.DB.cadences.length, 0, 'the old cadences array must be empty after migration');
    const migrated = OAD.DB.threads.find(function (t) { return t.title === 'Legacy migration cadence'; });
    OAD._assert(!!migrated, 'the legacy cadence must now exist as a real thread');
    OAD._assertEqual(migrated.thread_kind, 'cadence', 'migrated cadence must carry the cadence discriminator');
    OAD._assertEqual(migrated.next_due, '2026-08-01', 'cadence-specific field values must survive the migration');
    OAD._assert(!!migrated.uuid && typeof migrated.uuid === 'string', 'migrated cadence must have a real uuid — cadences never had one before this migration (Rule 3)');
    OAD._assertEqual(typeof migrated.owner_id, 'string', 'migrated cadence must have an owner_id too (Rule 3)');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.cadences = origCadences;
  }
});

OAD.test('_normalizeDB: backfills days_of_week on cadences that predate the field', function () {
  // Legacy-array-shaped input (no thread_kind, no uuid) exercises the same self-terminating
  // migration path as the dedicated "_normalizeDB: converts legacy OAD.DB.cadences" test below —
  // this one specifically locks in the days_of_week backfill survives the migration. id is not
  // preserved (collision-avoidance, same as Habits/Ideas), so the migrated thread is found by
  // title, not its old legacy id.
  const origThreads = OAD.DB.threads;
  const origCadences = OAD.DB.cadences;
  try {
    OAD.DB.threads = [];
    OAD.DB.cadences = [{ id: 999999, title: 'Legacy cadence', recurrence: 'weekly' }];
    OAD._normalizeDB();
    const migrated = OAD.getCadenceThreads().find(function (c) { return c.title === 'Legacy cadence'; });
    OAD._assert(!!migrated, 'legacy cadence must be migrated to a real thread');
    OAD._assert(Array.isArray(migrated.days_of_week), 'legacy cadence should get a days_of_week array backfilled');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.cadences = origCadences;
  }
});

OAD.test('_normalizeDB: normalizes cadence life_area the same way threads already do', function () {
  const origThreads = OAD.DB.threads;
  const origCadences = OAD.DB.cadences;
  try {
    OAD.DB.threads = [];
    OAD.DB.cadences = [
      { id: 999998, title: 'Bad casing cadence', recurrence: 'weekly', life_area: 'Finance' },
      { id: 999997, title: 'Lowercase cadence',  recurrence: 'weekly', life_area: 'finances' }
    ];
    OAD._normalizeDB();
    const badCasing = OAD.getCadenceThreads().find(function (c) { return c.title === 'Bad casing cadence'; });
    const lowercase = OAD.getCadenceThreads().find(function (c) { return c.title === 'Lowercase cadence'; });
    OAD._assertEqual(badCasing.life_area, 'Finances', "'Finance' normalizes to canonical 'Finances'");
    OAD._assertEqual(lowercase.life_area, 'Finances', "'finances' normalizes to canonical 'Finances'");
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.cadences = origCadences;
  }
});

OAD.test('addCadence: normalizes life_area on create', function () {
  const c = OAD.addCadence(OAD.makeCadence({ title: 'New area test cadence', life_area: 'finance' }));
  OAD._assertEqual(c.life_area, 'Finances', 'addCadence normalizes life_area to canonical form');
  OAD.deleteCadence(c.id);
});

OAD.test('updateCadence: normalizes life_area on update', function () {
  const c = OAD.addCadence(OAD.makeCadence({ title: 'Update area test cadence' }));
  OAD.updateCadence(c.id, { life_area: 'Finance' });
  OAD._assertEqual(OAD.getCadence(c.id).life_area, 'Finances', 'updateCadence normalizes life_area to canonical form');
  OAD.deleteCadence(c.id);
});

OAD.test('cadenceDoneThisPeriod: identifies if a cadence has been completed in the current period', function () {
  const today = _localDateStr(new Date());
  const c = OAD.makeCadence({
    title: 'Done this period test',
    recurrence: 'weekly',
    last_completed: today,
    next_due: OAD.nextCadenceDue('weekly', today)
  });

  OAD._assert(OAD.cadenceDoneThisPeriod(c), 'Weekly cadence marked done today should be done this period');

  c.last_completed = '1970-01-01';
  c.next_due = today;
  OAD._assert(!OAD.cadenceDoneThisPeriod(c), 'Weekly cadence due today but not completed today should not be done this period');
});

OAD.test('OAD.Due.isCadenceDueOn: excludes an already-completed-today cadence (regression — This Week\'s Load over-counting bug)', function () {
  // Real reported case: "Total Consecration to Jesus Through Mary" had next_due === today
  // AND last_completed === today (already done for this period), but This Week's Load's
  // per-day cadence tally used a naive `next_due === dateStr` check with no done-this-period
  // exclusion, unlike OAD.Due.cadenceBuckets — so it double-counted a cadence that was already
  // handled, showing 9 items for a day that genuinely only had 8.
  const todayStr = OAD.todayStr();
  const doneToday = OAD.makeCadence({ title: 'Done today', recurrence: 'weekly', next_due: todayStr, last_completed: todayStr });
  OAD._assert(!OAD.Due.isCadenceDueOn(doneToday, todayStr), 'a cadence already completed for today must not count as due today');

  const notDoneToday = OAD.makeCadence({ title: 'Not done today', recurrence: 'weekly', next_due: todayStr, last_completed: '1970-01-01' });
  OAD._assert(OAD.Due.isCadenceDueOn(notDoneToday, todayStr), 'a genuinely undone cadence due today must still count');

  const future = new Date(); future.setDate(future.getDate() + 3);
  const futureStr = _localDateStr(future);
  const dueLater = OAD.makeCadence({ title: 'Due later this week', recurrence: 'weekly', next_due: futureStr, last_completed: '1970-01-01' });
  OAD._assert(OAD.Due.isCadenceDueOn(dueLater, futureStr), 'a cadence genuinely due on a future day must count for that day');
  OAD._assert(!OAD.Due.isCadenceDueOn(dueLater, todayStr), 'that same cadence must not count for today, only its actual due date');
});

// ── Tests: Cycle and Critical Path ─────────────────────────────────────

OAD.test('detectCycles: returns cycles', function () {
  const savedThreads = OAD.DB.threads.slice();
  OAD.DB.threads = [];
  const t1 = OAD.addThread(OAD.makeThread({ title: 'A', status: 'open' }));
  const t2 = OAD.addThread(OAD.makeThread({ title: 'B', status: 'open' }));
  t1.connections = [{ to_uuid: t2.uuid, edge_type: 'blocks' }];
  t2.connections = [{ to_uuid: t1.uuid, edge_type: 'blocks' }];
  const cycles = OAD.detectCycles(true);
  OAD._assertEqual(cycles.length, 1, 'should find 1 cycle');
  OAD._assert(cycles[0].indexOf(t1.id) !== -1 && cycles[0].indexOf(t2.id) !== -1, 'cycle should include A and B');
  OAD.DB.threads = savedThreads;
});

OAD.test('calculateCriticalPath: finds longest blocking path', function () {
  const savedThreads = OAD.DB.threads.slice();
  OAD.DB.threads = [];
  const t1 = OAD.addThread(OAD.makeThread({ title: 'A', status: 'open', priority: 'medium' }));
  const t2 = OAD.addThread(OAD.makeThread({ title: 'B', status: 'open', priority: 'medium' }));
  const t3 = OAD.addThread(OAD.makeThread({ title: 'C', status: 'open', priority: 'critical' }));
  t1.connections = [{ to_uuid: t2.uuid, edge_type: 'blocks' }];
  t2.connections = [{ to_uuid: t3.uuid, edge_type: 'blocks' }];
  const pathData = OAD.calculateCriticalPath(t1.id);
  OAD._assert(pathData.path.length === 3, 'path should have length 3');
  OAD._assertEqual(pathData.path[2], t3.id, 'path ends at C');
  OAD.DB.threads = savedThreads;
});

OAD.test('getEisenhowerQuadrant: correctly maps high priority + overdue to Q1', function () {
  const t = OAD.makeThread({ title: 'A', status: 'open', priority: 'high', next_action_date: '2000-01-01' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(t), 'Q1', 'High priority and overdue should be Q1');
  const t2 = OAD.makeThread({ title: 'B', status: 'open', priority: 'medium', next_action_date: '2099-01-01' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(t2), 'Q2', 'Open, not urgent, and not important falls into Q2 by default (no Q5)');
});

OAD.test('getEisenhowerQuadrant: status-based Q3/Q4 win regardless of priority/urgency', function () {
  const waiting = OAD.makeThread({ title: 'W', status: 'waiting', priority: 'critical', next_action_date: '2000-01-01' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(waiting), 'Q3', 'waiting status is always Q3, even if urgent+important');
  const dormant = OAD.makeThread({ title: 'D', status: 'dormant', priority: 'low' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(dormant), 'Q3', 'dormant status is always Q3');
  const inbox = OAD.makeThread({ title: 'I', status: 'inbox', priority: 'critical', next_action_date: '2000-01-01' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(inbox), 'Q4', 'inbox status is always Q4, even if urgent+important');
  const closed = OAD.makeThread({ title: 'C', status: 'closed', priority: 'critical' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(closed), null, 'closed threads belong in no quadrant');
});

OAD.test('getEisenhowerQuadrant: deadline takes precedence over next_action_date for urgency when both are set', function () {
  const nearDeadline = OAD.makeThread({ title: 'ND', status: 'open', priority: 'high', deadline: OAD.todayStr(), next_action_date: '2099-01-01' });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(nearDeadline), 'Q1', 'deadline today should be Q1 even though next_action_date is far out');
  const farDeadline = OAD.makeThread({ title: 'FD', status: 'open', priority: 'high', deadline: '2099-01-01', next_action_date: OAD.todayStr() });
  OAD._assertEqual(OAD.getEisenhowerQuadrant(farDeadline), 'Q2', 'far deadline should be Q2 even though next_action_date is today (deadline wins when both set)');
});

OAD.test('renderInboxAlertBanner: creates a real, clickable banner when inbox items exist, with the true count', function () {
  const savedThreads = OAD.DB.threads;
  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-panel';
  document.body.appendChild(mockPanel);

  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Capture A', status: 'inbox' }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Capture B', status: 'inbox' }),
      OAD.makeThread({ id: 3, uuid: OAD._generateUUID(), title: 'Real work', status: 'open', priority: 'high' })
    ];

    OAD.renderInboxAlertBanner();
    const banner = document.getElementById('inbox-alert-banner');
    OAD._assert(!!banner, 'banner should be created when inbox items exist');
    OAD._assert(banner.innerHTML.indexOf('2 items') !== -1, 'banner should show the true inbox count (2), not a hardcoded value');
    OAD._assert(banner.innerHTML.indexOf('OAD.renderInboxPanel()') !== -1, 'banner should route to the real Inbox panel, not a synthetic thread id');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = savedThreads;
  }
});

OAD.test('renderInboxAlertBanner: removes itself once the inbox is actually empty (not snoozable)', function () {
  const savedThreads = OAD.DB.threads;
  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-panel';
  document.body.appendChild(mockPanel);

  try {
    OAD.DB.threads = [OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Capture A', status: 'inbox' })];
    OAD.renderInboxAlertBanner();
    OAD._assert(!!document.getElementById('inbox-alert-banner'), 'banner should exist while inbox has items');

    OAD.DB.threads = [];
    OAD.renderInboxAlertBanner();
    OAD._assert(!document.getElementById('inbox-alert-banner'), 'banner should be removed once the inbox is empty — no snooze mechanism to accidentally leave it dismissed');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = savedThreads;
  }
});

OAD.test('renderInboxAlertBanner: does not affect Focus Now, pressure, or DueEngine active-thread counts', function () {
  const savedThreads = OAD.DB.threads;
  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-panel';
  document.body.appendChild(mockPanel);

  try {
    const todayStr = OAD.todayStr();
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Capture A', status: 'inbox' }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Real work', status: 'open', priority: 'low', next_action: 'do it', next_action_date: todayStr })
    ];

    OAD.renderInboxAlertBanner();

    const active = OAD.Due.activeThreadsRaw();
    OAD._assertEqual(active.length, 1, 'the inbox item must not appear in activeThreadsRaw — no synthetic thread injected');
    OAD._assertEqual(active[0].id, 2, 'only the real open thread should be active');

    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus && focus.id === 2, 'Focus Now should still pick the real work, not be hijacked by an inbox reminder');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = savedThreads;
  }
});

OAD.test('proposals: accepting a proposal creates an active thread (proposals are status:\'proposed\' Threads, ARCHITECTURE_RULES.md Rule 1)', function () {
  const savedThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    const proposal = OAD.addThread(OAD.makeThread({ uuid: 'test-uuid', status: 'proposed', title: 'Prop A', life_area: 'Other', closing_condition: 'Done', rationale: 'Testing' }));
    const t = OAD.acceptProposal('test-uuid');
    OAD._assert(t, 'should return thread');
    OAD._assertEqual(t.id, proposal.id, 'accepting must update the SAME thread in place, not create a new one');
    OAD._assertEqual(t.status, 'open', 'accepted proposal must become a real open thread');
    OAD._assertEqual(OAD.getProposalThreads().length, 0, 'no longer a pending proposal once accepted');
    OAD._assertEqual(OAD.DB.threads.length, 1, 'still exactly one thread — accept updates in place, it does not add a second');
    OAD._assertEqual(t.title, 'Prop A', 'title matches');
  } finally {
    OAD.DB.threads = savedThreads;
  }
});

OAD.test('proposals: rejecting a proposal removes it from the queue', function () {
  const savedThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    OAD.addThread(OAD.makeThread({ uuid: 'test-uuid2', status: 'proposed', title: 'Prop B' }));
    OAD.rejectProposal('test-uuid2');
    OAD._assertEqual(OAD.getProposalThreads().length, 0, 'proposal should be removed');
    OAD._assertEqual(OAD.DB.threads.length, 0, 'rejecting deletes the thread outright, matching the original reject behavior (no audit trail)');
  } finally {
    OAD.DB.threads = savedThreads;
  }
});

// ── Test Overlay ──────────────────────────────────────────────────────

OAD._renderTestOverlay = function (results, summary) {
  const overlay = document.createElement('div');
  overlay.id = 'test-overlay';

  const rows = results.map(r => {
    const cls = r.ok ? 'pass' : 'fail';
    const icon = r.ok ? '✓' : '✗';
    const err = r.ok ? '' : ` — ${OAD.esc(r.error)}`;
    return `<div class="test-result ${cls}">${icon} ${OAD.esc(r.name)}${err}</div>`;
  }).join('');

  const sumCls = summary.failed === 0 ? 'all-pass' : 'has-fail';
  const sumMsg = summary.failed === 0
    ? `All ${summary.total} tests passed.`
    : `${summary.failed} of ${summary.total} tests FAILED.`;

  overlay.innerHTML = `
    <h1>One-A-Day — Test Suite</h1>
    ${rows}
    <div class="test-summary ${sumCls}">${sumMsg}</div>
    ${summary.failed === 0
      ? `<button id="test-continue-btn" onclick="OAD._dismissTests()">Launch App →</button>`
      : `<div style="color:var(--critical);margin-top:16px;font-size:14px">Fix failing tests before the UI will load.</div>`}`;

  document.body.appendChild(overlay);
};

OAD._dismissTests = function () {
  const overlay = document.getElementById('test-overlay');
  if (overlay) overlay.remove();
  OAD._initApp();
};

OAD._initApp = async function () {
  OAD._DB_PERSIST = true;
  OAD.loadApiKey();

  // ── Supabase path ────────────────────────────────────────────────────
  if (OAD.supabase) {
    const { data: { session } } = await OAD.supabase.auth.getSession();
    if (session) {
      OAD._userId = session.user.id;
      await OAD._bootAfterAuth();
      return;
    }
    
    // Auto-login logic for demo mode
    const _dCfg = (typeof window.OAD !== 'undefined' && typeof window.OAD.DemoConfig !== 'undefined') ? window.OAD.DemoConfig : null;
    const demoRole = localStorage.getItem('oad_demo_role');
    if (OAD.Config.demoMode && _dCfg && demoRole) {
      if (demoRole === 'CCO') {
        OAD._userId = 'demo-superadmin-id';
        await OAD._bootAfterAuth();
        return;
      }
      const match = _dCfg.roles.find(r => r.role === demoRole);
      if (match) {
        OAD._userId = match.userId;
        await OAD._bootAfterAuth();
        return;
      }
    }

    // No session — show sign-in modal, boot continues after successful auth
    OAD.openSignInModal();
    return;
  }

  // ── localStorage fallback (no Supabase configured) ───────────────────
  const loadResult = OAD.loadDB();
  if (loadResult === null) {
    alert(
      'One-A-Day could not load your saved data — it appears to be corrupt.\n\n' +
      'Your data has NOT been overwritten. To recover, open the browser console and ' +
      'run: localStorage.removeItem("oad_db")\n\nThen reload the page to start fresh.'
    );
    return;
  }
  if (!loadResult) {
    if (window.OAD && window.OAD.Config && window.OAD.Config.demoMode) {
      try {
        const res = await fetch('/modules/demo/demo_data.json');
        if (res.ok) {
          OAD.DB = await res.json();
          OAD._normalizeDB();
          OAD.saveDB();
        } else {
          throw new Error('demo_data.json not found');
        }
      } catch (err) {
        console.error("Demo data auto-load failed", err);
        OAD.DB = { threads: [], cadences: [], habits: [], ideas: [], persona: { life_context: {}, assumption_tendencies: [], what_is_working: [], what_is_not_working: [], tone_calibration: {} } };
      }
    } else {
      // Provide an empty database for new accounts instead of mock data
      OAD.DB = {
        threads: [], cadences: [], habits: [], ideas: [],
        persona: { life_context: {}, assumption_tendencies: [], what_is_working: [], what_is_not_working: [], tone_calibration: {} }
      };
    }
  }
  if (OAD._migrateActionDeadlines() > 0) OAD.saveDB();
  OAD._finishBoot();
};

// Called after successful auth to load cloud data (or seed if none), then render.
OAD._bootAfterAuth = async function () {
  let cloudLoaded = false;
  if (sessionStorage.getItem('oad_fresh_demo_seed_required')) {
    console.log('[OAD] Fresh demo seed required. Bypassing cloud load to force re-hydration.');
    sessionStorage.removeItem('oad_fresh_demo_seed_required');
  } else {
    cloudLoaded = await OAD._loadFromCloud();
  }

  if (!cloudLoaded) {
    // New user or cloud empty: try migrating localStorage, otherwise seed fresh.
    const localResult = OAD.loadDB();
    if (localResult === null) {
      alert(
        'One-A-Day found corrupt local data. It has not been overwritten.\n' +
        'Run localStorage.removeItem("oad_db") in the console, then reload.'
      );
      return;
    }
    if (!localResult) {
      if (window.OAD && window.OAD.Config && window.OAD.Config.demoMode) {
        try {
          let dataObj;
          if (window.OAD_DEMO_DATA) {
            console.log('[OAD] Loading demo data synchronously from injected script');
            dataObj = window.OAD_DEMO_DATA;
          } else {
            const url = '/modules/demo/demo_data.json?v=' + Date.now();
            console.log('[OAD] Fetching demo data from:', url);
            const res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
            dataObj = await res.json();
          }
          OAD.DB = JSON.parse(JSON.stringify(dataObj));
          OAD.DB.lastError = "FETCH SUCCESS. Parsed threads array length: " + (OAD.DB.threads ? OAD.DB.threads.length : 'null');
          OAD._normalizeDB();
          OAD.saveDB(); // Persist auto-loaded demo data to localStorage
          console.log('[OAD] Demo data auto-loaded successfully. Threads:', OAD.DB.threads.length);
        } catch (err) {
          console.error("Demo data auto-load failed", err);
          alert("Demo data auto-load failed: " + err.message + "\\nPlease take a screenshot of this error and show it to the developer.");
          OAD.DB = { threads: [], cadences: [], habits: [], ideas: [], persona: { life_context: {}, assumption_tendencies: [], what_is_working: [], what_is_not_working: [], tone_calibration: {} }, lastError: err.stack || err.message };
        }
      } else {
        // Provide an empty database for new accounts instead of mock data
        OAD.DB = {
          threads: [], cadences: [], habits: [], ideas: [],
          persona: { life_context: {}, assumption_tendencies: [], what_is_working: [], what_is_not_working: [], tone_calibration: {} },
          lastError: 'HIT_ELSE_BLOCK_DEMO_MODE_FALSE'
        };
      }
    }
    await OAD._saveToCloud();
  } else {
    // Cloud data loaded — migrate any arrays added after the user's initial seed.
    // This handles the case where habits/ideas were added to the app after the user
    // already had data in Supabase, so _seedData() was never run for those arrays.
    // Per ticket-flowqueue-data-model-migration.md Steps 2 & 4: Habits/Ideas/Cadences are
    // Threads now (thread_kind discriminator) — OAD.DB.habits/ideas/cadences are always empty
    // after migration, so checking their .length here would spuriously re-seed on every single
    // cloud load, even for a user who already has real habit/idea/cadence threads.
    var needsSave = false;
    if (!OAD.getHabitThreads().length)   { OAD._seedHabits();   needsSave = true; }
    if (!OAD.getIdeaThreads().length)    { OAD._seedIdeas();    needsSave = true; }
    if (!OAD.getCadenceThreads().length) { OAD._seedCadences(); needsSave = true; }
    if (OAD._migrateActionDeadlines() > 0) needsSave = true;
    OAD._runJune16DedupV2();   // calls saveDB() internally; always persists its guard flag
    OAD._runJune16PatchV1();  // targeted title/status fixes; calls saveDB() internally
    OAD._runJuly2Cac102EdgeTypeFixV1(); // backfills missing edge_type on CAC102 assignment edges; calls saveDB() internally
    if (needsSave) await OAD._saveToCloud();
  }
  OAD._finishBoot();
};

// Called once data is loaded and ready — renders the daily summary as the default landing view.
OAD._finishBoot = function () {
  const theme = (OAD.DB.persona && OAD.DB.persona.theme) || 'dark';
  document.body.setAttribute('data-theme', theme);
  
  if (typeof OAD.renderHeaderActions === 'function') {
    OAD.renderHeaderActions();
  }

  OAD._enableQuickAdd();

  OAD.renderDailyView();

  if (typeof OAD.renderRunwayRiskBanner === 'function') {
    OAD.renderRunwayRiskBanner();
  }

  if (typeof OAD.renderInboxAlertBanner === 'function') {
    OAD.renderInboxAlertBanner();
  }

  if (typeof OAD.runADE === 'function') {
    OAD.runADE();
  }

  if (typeof OAD.runCHE === 'function') {
    OAD.runCHE();
  }

  if (typeof OAD.sweepStalledTendencyEvidence === 'function') {
    OAD.sweepStalledTendencyEvidence();
  }

  if (typeof OAD.sweepInboxSentinel === 'function') {
    OAD.sweepInboxSentinel();
  }

  OAD._updateCHEBadge();

  if (typeof OAD.checkDailyIntercept === 'function') {
    OAD.checkDailyIntercept();
  }
};

// ── Tests: render.js Graph Data Extraction ───────────────────────────

OAD.test('graph: getGraphDataForArea filters by area and gathers neighbors', function () {
  const originalThreads = OAD.DB.threads;
  
  const t1 = { id: 101, uuid: 'u1', title: 'Finance Task 1', life_area: 'Finance', status: 'open', connections: [{ to_uuid: 'u2', edge_type: 'blocks' }] };
  const t2 = { id: 102, uuid: 'u2', title: 'Career Task 2', life_area: 'Career', status: 'open', connections: [] };
  const t3 = { id: 103, uuid: 'u3', title: 'Health Task 3', life_area: 'Health', status: 'open', connections: [] };
  const t4 = { id: 104, uuid: 'u4', title: 'Closed Finance Task', life_area: 'Finance', status: 'closed', connections: [] };
  
  OAD.DB.threads = [t1, t2, t3, t4];
  
  try {
    const allResult = OAD.getGraphDataForArea('All Areas');
    OAD._assertEqual(allResult.nodes.length, 3, 'All open threads should be included');
    OAD._assertEqual(allResult.edges.length, 1, 'Connection should be returned as edge');
    OAD._assertEqual(allResult.edges[0].source, 'u1');
    OAD._assertEqual(allResult.edges[0].target, 'u2');
    
    const financeResult = OAD.getGraphDataForArea('Finance');
    OAD._assertEqual(financeResult.nodes.length, 2, 'Should include target Finance and neighbor Career');
    
    const nodeUuids = financeResult.nodes.map(function(n) { return n.uuid; });
    OAD._assert(nodeUuids.indexOf('u1') !== -1, 'Should contain u1');
    OAD._assert(nodeUuids.indexOf('u2') !== -1, 'Should contain u2');
    OAD._assert(nodeUuids.indexOf('u3') === -1, 'Should not contain u3');
    OAD._assert(nodeUuids.indexOf('u4') === -1, 'Should not contain closed u4');
    
    OAD._assertEqual(financeResult.edges.length, 1, 'Should contain edge between u1 and u2');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('cycle: detectCycles identifies circular dependencies', function () {
  const originalThreads = OAD.DB.threads;
  
  // Create a 3-node cycle: A blocks B, B blocks C, C blocks A
  const tA = { id: 201, uuid: 'uA', title: 'Task A', status: 'open', connections: [{ to_uuid: 'uB', edge_type: 'blocks' }] };
  const tB = { id: 202, uuid: 'uB', title: 'Task B', status: 'open', connections: [{ to_uuid: 'uC', edge_type: 'blocks' }] };
  const tC = { id: 203, uuid: 'uC', title: 'Task C', status: 'open', connections: [{ to_uuid: 'uA', edge_type: 'blocks' }] };
  
  OAD.DB.threads = [tA, tB, tC];
  
  try {
    const cycles = OAD.detectCycles(true); // force recalculation
    OAD._assertEqual(cycles.length, 1, 'Should find exactly 1 cycle');
    OAD._assertEqual(cycles[0].length, 3, 'Cycle should consist of 3 nodes');
    OAD._assert(cycles[0].indexOf(201) !== -1, 'Cycle should contain Task A');
    OAD._assert(cycles[0].indexOf(202) !== -1, 'Cycle should contain Task B');
    OAD._assert(cycles[0].indexOf(203) !== -1, 'Cycle should contain Task C');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.detectCycles(true); // reset cache
  }
});

OAD.test('list: filter caching preserves search and status states', function () {
  const originalSearch = OAD._activeListSearch;
  const originalStatus = OAD._activeListStatus;

  try {
    OAD._activeListSearch = 'test-query';
    OAD._activeListStatus = 'stalled';

    // Call renderListView (mocked panel setup)
    const mockPanel = document.createElement('div');
    mockPanel.id = 'detail-content';
    document.body.appendChild(mockPanel);

    OAD.renderListView();

    OAD._assertEqual(OAD._activeListSearch, 'test-query', 'Search query should be retained');
    OAD._assertEqual(OAD._activeListStatus, 'stalled', 'Status filter should be retained');

    document.body.removeChild(mockPanel);
  } finally {
    OAD._activeListSearch = originalSearch;
    OAD._activeListStatus = originalStatus;
  }
});

OAD.test('list: search matches title, closing condition, and next action — no longer matches life_area (dedicated dropdown handles that now)', function () {
  const originalThreads = OAD.DB.threads;
  const originalSearch = OAD._activeListSearch;
  const originalStatus = OAD._activeListStatus;
  const originalArea = OAD._activeListArea;
  const originalSavedViewId = OAD._activeSavedViewId;

  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-content';
  document.body.appendChild(mockPanel);

  try {
    OAD._activeSavedViewId = null;
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Renew passport', closing_condition: 'Passport received in mail', next_action: 'Submit application', life_area: 'Legal' }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Unrelated thread', closing_condition: 'Something else entirely', next_action: 'Do a different thing', life_area: 'Legal' })
    ];

    function visibleTitles(query) {
      OAD._activeListSearch = query;
      OAD._activeListStatus = 'all';
      OAD._activeListArea = '';
      OAD.renderListView();
      return document.getElementById('list-tab-threads').innerHTML;
    }

    OAD._assert(visibleTitles('passport').includes('Renew passport'), 'search matches title');
    OAD._assert(visibleTitles('received in mail').includes('Renew passport'), 'search matches closing_condition');
    OAD._assert(visibleTitles('submit application').includes('Renew passport'), 'search matches next_action');
    const legalResults = visibleTitles('legal');
    OAD._assert(!legalResults.includes('Renew passport') && !legalResults.includes('Unrelated thread'),
      'search no longer matches life_area by free text — that is the dedicated area dropdown\'s job now');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = originalThreads;
    OAD._activeListSearch = originalSearch;
    OAD._activeListStatus = originalStatus;
    OAD._activeListArea = originalArea;
    OAD._activeSavedViewId = originalSavedViewId;
  }
});

OAD.test('list: life area dropdown filters independently of the search box', function () {
  const originalThreads = OAD.DB.threads;
  const originalSearch = OAD._activeListSearch;
  const originalStatus = OAD._activeListStatus;
  const originalArea = OAD._activeListArea;
  const originalSavedViewId = OAD._activeSavedViewId;

  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-content';
  document.body.appendChild(mockPanel);

  try {
    OAD._activeSavedViewId = null;
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Health thing', life_area: 'Health' }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Career thing', life_area: 'Career' })
    ];

    OAD._activeListSearch = '';
    OAD._activeListStatus = 'all';
    OAD._activeListArea = 'Health';
    OAD.renderListView();
    const html = document.getElementById('list-tab-threads').innerHTML;

    OAD._assert(html.includes('Health thing'), 'area filter includes the matching-area thread');
    OAD._assert(!html.includes('Career thing'), 'area filter excludes the non-matching-area thread');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = originalThreads;
    OAD._activeListSearch = originalSearch;
    OAD._activeListStatus = originalStatus;
    OAD._activeListArea = originalArea;
    OAD._activeSavedViewId = originalSavedViewId;
  }
});

OAD.test('list: "All except Closed" status preset excludes only closed threads', function () {
  const originalThreads = OAD.DB.threads;
  const originalSearch = OAD._activeListSearch;
  const originalStatus = OAD._activeListStatus;
  const originalArea = OAD._activeListArea;
  const originalSavedViewId = OAD._activeSavedViewId;

  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-content';
  document.body.appendChild(mockPanel);

  try {
    OAD._activeSavedViewId = null;
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Open one', status: 'open' }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Stalled one', status: 'stalled' }),
      OAD.makeThread({ id: 3, uuid: OAD._generateUUID(), title: 'Closed one', status: 'closed' })
    ];

    OAD._activeListSearch = '';
    OAD._activeListArea = '';
    OAD._activeListStatus = 'not-closed';
    OAD.renderListView();
    const html = document.getElementById('list-tab-threads').innerHTML;

    OAD._assert(html.includes('Open one'), 'not-closed preset includes open threads');
    OAD._assert(html.includes('Stalled one'), 'not-closed preset includes stalled threads');
    OAD._assert(!html.includes('Closed one'), 'not-closed preset excludes closed threads');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = originalThreads;
    OAD._activeListSearch = originalSearch;
    OAD._activeListStatus = originalStatus;
    OAD._activeListArea = originalArea;
    OAD._activeSavedViewId = originalSavedViewId;
  }
});

OAD.test('daily summary rendering validates correct elements and no exceptions', function () {
  const originalThreads = OAD.DB.threads;
  const originalHabits  = OAD.DB.habits;
  const originalCadences = OAD.DB.cadences;
  const originalPersona = OAD.DB.persona;
  const originalGreeting = OAD.Config.userGreetingTitle;

  const panel = document.getElementById('detail-content');
  const originalHTML = panel ? panel.innerHTML : '';

  try {
    OAD.Config.userGreetingTitle = '';
    // Set up minimal mock DB
    OAD.DB.threads = [
      { id: 1, uuid: 't1', title: 'Task A', status: 'open', life_area: 'Work', priority: 'high', next_action_date: '2026-06-15' },
      { id: 2, uuid: 't2', title: 'Task B', status: 'stalled', life_area: 'Personal', priority: 'medium', parent_uuid: 't1' }
    ];
    OAD.DB.habits = [
      { id: 1, title: 'Drink water', phase: 'building', frequency: 'daily', last_checked_in: '2026-06-16', current_streak: 5 }
    ];
    OAD.DB.cadences = [
      { id: 1, title: 'Weekly sync', next_due: '2026-06-17', recurrence: 'weekly' }
    ];
    OAD.DB.persona = {
      name: 'Test Chief',
      life_context: {
        pressure_level: 'low',
        hard_deadline: '2026-12-31'
      }
    };

    // Render daily summary
    OAD.renderDailyView();

    // Verify it injected structural elements
    OAD._assert(panel !== null, 'Panel should exist');
    const dashboard = panel.querySelector('.ds-dashboard');
    OAD._assert(dashboard !== null, 'Should render .ds-dashboard container');

    const metricsGrid = panel.querySelector('.ds-metrics-grid');
    OAD._assert(metricsGrid !== null, 'Should render .ds-metrics-grid');

    const usernameSpan = panel.querySelector('.ds-username');
    OAD._assert(usernameSpan !== null, 'Should render .ds-username');
    OAD._assertEqual(usernameSpan.textContent, 'Test Chief', 'Username should match the mock persona');

    const focusCard = panel.querySelector('.focus-card');
    OAD._assert(focusCard !== null, 'Should select a focus card');

  } finally {
    if (panel) {
      panel.innerHTML = originalHTML;
    }
    OAD.DB.threads = originalThreads;
    OAD.DB.habits = originalHabits;
    OAD.DB.cadences = originalCadences;
    OAD.DB.persona = originalPersona;
    OAD.Config.userGreetingTitle = originalGreeting;
  }
});

OAD.test('renderDailyView: Stalled is a real, browsable section with thread cards, not just a count (regression — ENV-125 report)', function () {
  // Real reported case: an open thread whose next_action_date has drifted into the past but
  // whose deadline is still comfortable was invisible everywhere except by luck of winning the
  // single Focus Now slot -- not in Overdue Tasks (deliberately deadline-only, per
  // ticket-overdue-filter-fix.md) and not in This Week (which only shows FUTURE next_action
  // dates). OAD.Due.stalledThreads() already found these; this locks in that renderDailyView
  // actually surfaces them as clickable cards, not just a small stat number.
  const originalThreads = OAD.DB.threads;
  const panel = document.getElementById('detail-content');
  const originalHTML = panel ? panel.innerHTML : '';
  try {
    const todayStr = OAD.todayStr();
    const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = _localDateStr(twoDaysAgo);
    const inThreeDays = new Date(); inThreeDays.setDate(inThreeDays.getDate() + 3);
    const inThreeDaysStr = _localDateStr(inThreeDays);

    OAD.DB.threads = [
      OAD.makeThread({
        id: 501, uuid: 'stalled-regression-1', title: 'Stalled but not overdue (deadline comfortable)',
        status: 'open', priority: 'high', life_area: 'Education',
        next_action_date: twoDaysAgoStr, deadline: inThreeDaysStr
      })
    ];

    OAD.renderDailyView();

    OAD._assert(panel !== null, 'panel should exist');
    const stalledSection = panel.querySelector('.ds-bucket-stalled');
    OAD._assert(stalledSection !== null, 'a real .ds-bucket-stalled section should render, not just a stat number');
    OAD._assert(stalledSection.querySelector('.ds-row-stalled') !== null, 'the stalled thread should render as an actual clickable card');
    OAD._assert(stalledSection.textContent.indexOf('Stalled but not overdue') !== -1, 'the stalled card should show the real thread title');

    const overdueSection = panel.querySelector('.ds-bucket-overdue');
    OAD._assert(!overdueSection || overdueSection.textContent.indexOf('Stalled but not overdue') === -1,
      'a thread with a comfortable deadline must never also appear in Overdue Tasks -- the two concepts stay separate by design');
  } finally {
    if (panel) panel.innerHTML = originalHTML;
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('strict ID-driven engine and focus selection excludes blocked threads', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr(); // matches selectFocusThread()'s own todayStr basis
    const threadA = { id: 101, uuid: 'uuid-a', title: 'Task A', status: 'open', life_area: 'Work', priority: 'high', next_action_date: todayStr, connections: [] };
    const threadB = { id: 102, uuid: 'uuid-b', title: 'Task B', status: 'open', life_area: 'Work', priority: 'high', next_action_date: todayStr, connections: [{ to_uuid: 'uuid-a', to_label: 'Task A', edge_type: 'blocks' }] };

    OAD.DB.threads = [threadA, threadB];

    // Assert that Task A is blocked by Task B
    OAD._assert(OAD.isBlocked(threadA), 'Task A should be blocked by Task B via UUID');
    OAD._assert(!OAD.isBlocked(threadB), 'Task B should not be blocked');

    // Focus selection should select Task B (Task A is blocked)
    const focus = OAD.selectFocusThread();
    OAD._assert(focus !== null, 'Focus thread should be selected');
    OAD._assertEqual(focus.id, 102, 'Task B should be selected as focus since Task A is blocked');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('daily TOAT selection and persistence', function () {
  const originalThreads = OAD.DB.threads;
  const originalToat = OAD.DB.toat;
  try {
    OAD.DB.toat = [];

    const threadA = { id: 101, uuid: 'uuid-a', title: 'Task A', status: 'open', life_area: 'Work', priority: 'medium' };
    const threadC = { id: 103, uuid: 'uuid-c', title: 'Task C', status: 'waiting', life_area: 'Work', priority: 'low', next_action_date: '2020-01-01' };
    const threadD = { id: 104, uuid: 'uuid-d', title: 'Task D', status: 'waiting', life_area: 'Work', priority: 'low', next_action_date: '2099-01-01' };

    OAD.DB.threads = [threadA, threadC, threadD];

    // Should select Task C as the oldest overdue waiting thread (tier 3 — 'stalled' tier 1 was
    // removed per ticket-stalled-metric-fix.md, see the dedicated regression test below)
    const toat = OAD.getDailyToat();
    OAD._assert(toat !== null, 'TOAT should be selected');
    OAD._assertEqual(toat.id, 103, 'Should select Task C as overdue waiting thread');

    // Calling again should return the persisted selection
    const secondToat = OAD.getDailyToat();
    OAD._assertEqual(secondToat.id, 103, 'Should persist selected TOAT for the day');

    // Clear locked TOAT
    OAD.DB.toat = [];
    // Remove overdue waiting task. If only healthy open (threadA) and future waiting (threadD) remain, no TOAT should be selected
    OAD.DB.threads = [threadA, threadD];
    const fourthToat = OAD.getDailyToat();
    OAD._assert(fourthToat === null, 'Should return null when no friction tasks are present');

    // Add an overdue open thread, which is a friction task, so it should be selected
    const threadE = { id: 105, uuid: 'uuid-e', title: 'Task E', status: 'open', life_area: 'Work', priority: 'medium', next_action_date: '2020-01-01' };
    OAD.DB.threads = [threadA, threadD, threadE];
    const fifthToat = OAD.getDailyToat();
    OAD._assertEqual(fifthToat.id, 105, 'Should select Task E as overdue open thread');

    OAD.DB.toat = [];
    const threadF = { id: 106, uuid: 'uuid-f', title: 'Task F', status: 'open', life_area: 'Work', priority: 'critical' };
    OAD.DB.threads = [threadA, threadD, threadF];
    const seventhToat = OAD.getDailyToat();
    OAD._assert(seventhToat === null, 'Should return null for high pressure open thread (only overdue open/waiting are TOAT candidates)');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.DB.toat = originalToat;
  }
});

OAD.test('daily TOAT: a thread with a leftover status of "stalled" (e.g. from an old import) is never selected — tier 1 removed, regression lock (ticket-stalled-metric-fix.md)', function () {
  const originalThreads = OAD.DB.threads;
  const originalToat = OAD.DB.toat;
  try {
    OAD.DB.toat = [];
    // 'stalled' is no longer in OAD.STATUSES and nothing in the UI can set it, but a raw
    // object literal (e.g. leftover from an old import, bypassing the Edit modal entirely)
    // could still carry it — TOAT must not treat it as friction any more than any other
    // status it doesn't recognize.
    const leftoverStalled = { id: 201, uuid: 'uuid-leftover', title: 'Leftover stalled thread', status: 'stalled', life_area: 'Work', priority: 'critical' };
    OAD.DB.threads = [leftoverStalled];

    const toat = OAD.getDailyToat();
    OAD._assert(toat === null, 'a thread with a leftover "stalled" status must never be selected as TOAT — tier 1 is gone');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.DB.toat = originalToat;
  }
});

OAD.test('moat-safe export strips proprietary attributes', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const thread = {
      id: 101,
      uuid: 'uuid-a',
      title: 'Task A',
      status: 'open',
      priority: 'high',
      life_area: 'Work',
      current_assumption: 'A test assumption',
      contingency_action: 'A fallback plan',
      connections: [{ to_uuid: 'uuid-b', edge_type: 'blocks' }],
      evolution_log: [{ date: '2026-06-17', note: 'Created' }],
      ai_insights: ['Proactive scan note']
    };
    OAD.DB.threads = [thread];

    const exportedStr = OAD.exportThreads();
    const parsed = JSON.parse(exportedStr);

    OAD._assert(Array.isArray(parsed.threads), 'Export should contain threads array');
    const exportedThread = parsed.threads[0];

    // Assert essential attributes are kept
    OAD._assertEqual(exportedThread.title, 'Task A', 'Title should be exported');
    OAD._assertEqual(exportedThread.uuid, 'uuid-a', 'UUID should be exported');

    // Assert connections included, other proprietary attributes stripped
    OAD._assert(Array.isArray(exportedThread.connections), 'connections should be included as array');
    OAD._assert(exportedThread.evolution_log === undefined, 'evolution_log should be stripped');
    OAD._assert(exportedThread.current_assumption === undefined, 'current_assumption should be stripped');
    OAD._assert(exportedThread.contingency_action === undefined, 'contingency_action should be stripped');
    OAD._assert(exportedThread.contingency_escalation === undefined, 'contingency_escalation should be stripped');
    OAD._assert(exportedThread.ai_insights === undefined, 'ai_insights should be stripped');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('blocked_by connection validation and bidirectional graph resolution', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const threadA = { id: 101, uuid: 'uuid-a', title: 'Task A', status: 'open', connections: [{ to_uuid: 'uuid-b', edge_type: 'blocked_by' }] };
    const threadB = { id: 102, uuid: 'uuid-b', title: 'Task B', status: 'open', connections: [] };

    OAD.DB.threads = [threadA, threadB];

    // Graph context for Task A (blocked by B)
    const ctxA = OAD.getGraphContext(threadA.id);
    OAD._assert(ctxA.blockedBy.length === 1, 'Task A should be blocked by 1 thread');
    OAD._assertEqual(ctxA.blockedBy[0].id, 102, 'Task B should block Task A');

    // Graph context for Task B (blocks A)
    const ctxB = OAD.getGraphContext(threadB.id);
    OAD._assert(ctxB.blocks.length === 1, 'Task B should block 1 thread');
    OAD._assertEqual(ctxB.blocks[0].uuid, 'uuid-a', 'Task B should block Task A');

    // Blocked validation check
    OAD._assert(OAD.isBlocked(threadA), 'Task A should be blocked');
    OAD._assert(!OAD.isBlocked(threadB), 'Task B should not be blocked');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('mailroom text extraction of dates, currency, and life areas', function () {
  const sampleOCRText = `
    IRS NOTICE OF TAX LIEN - STATEMENT DATE: 2026-07-15
    Total Balance Due: $4,850.73 by June 24, 2026.
    Please send payment immediately to the IRS office.
  `;

  const parsed = OAD.Mailroom.parseText(sampleOCRText);

  // Assertions for dates
  OAD._assert(parsed.dates.indexOf('2026-07-15') !== -1, 'Should extract YYYY-MM-DD date');
  OAD._assert(parsed.dates.indexOf('2026-06-24') !== -1, 'Should extract word Month date');

  // Assertions for money
  OAD._assert(parsed.money.indexOf(4850.73) !== -1, 'Should extract monetary balance');

  // Assertions for suggested title & life area
  OAD._assertEqual(parsed.suggestedTitle, 'IRS NOTICE OF TAX LIEN - STATEMENT DATE: 2026-07-1', 'Should extract first line as title');
  OAD._assertEqual(parsed.suggestedLifeArea, 'Finance', 'Should match Finance keywords (tax, balance, irs, lien)');
});

OAD.test('mailroom thread recommendation scoring', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const thread1 = { id: 201, uuid: 'uuid-ecornell', title: 'eCornell Course Registration', status: 'open' };
    const thread2 = { id: 202, uuid: 'uuid-irs', title: 'IRS Lien Investigation', status: 'open' };
    OAD.DB.threads = [thread1, thread2];

    const sampleText = 'Got an official notice from eCornell university regarding assignment CAC101.';
    const recommendations = OAD.Mailroom.getRecommendations(sampleText);

    OAD._assert(recommendations.length > 0, 'Should find matching recommendations');
    OAD._assertEqual(recommendations[0].thread.uuid, 'uuid-ecornell', 'Top match should be eCornell');
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

OAD.test('_saveMailroomIntake: creates a real Thread via makeThread/addThread, not a hand-built object (ARCHITECTURE_RULES.md Rule 5)', function () {
  // _saveMailroomIntake calls the real OAD.refreshActiveView(), which re-renders #main from
  // live OAD.DB state — save/restore the whole container so this test's fixture never leaks
  // into the real rendered page (same principle as the submitQuickAdd tests above).
  const main = document.getElementById('main');
  const originalMainHTML = main ? main.innerHTML : '';
  const origThreads = OAD.DB.threads;
  const before = OAD.DB.threads.length;
  const scratch = document.createElement('div');
  scratch.innerHTML = `
    <input type="radio" name="mailroom-action" id="act-new" checked>
    <input type="text" id="m-title" value="IRS Notice">
    <textarea id="m-desc">Extracted text from the notice.</textarea>
    <select id="m-area"><option value="Finance" selected>Finance</option></select>
    <select id="m-priority"><option value="high" selected>High</option></select>
    <input type="date" id="m-date" value="2026-08-01">
  `;
  document.body.appendChild(scratch);
  try {
    OAD._saveMailroomIntake();

    OAD._assertEqual(OAD.DB.threads.length, before + 1, 'exactly one thread must be created');
    const t = OAD.DB.threads[OAD.DB.threads.length - 1];

    OAD._assertEqual(t.title, 'IRS Notice', 'title must be taken from the form');
    OAD._assertEqual(t.life_area, 'Finance', 'life_area must be taken from the form');
    OAD._assertEqual(t.priority, 'high', 'priority must be taken from the form');
    OAD._assertEqual(t.next_action_date, '2026-08-01', 'next_action_date must be taken from the form');
    OAD._assertEqual(t.description, 'Extracted text from the notice.', 'description must be preserved — OAD.Mailroom.getRecommendations reads it for match-scoring');

    // The actual regression: these only exist if OAD.makeThread() was really called, not a
    // hand-built object with just the fields the old code happened to list.
    OAD._assertEqual(t.closing_condition_type, 'outcome', 'must carry makeThread defaults not present in the old hand-built object');
    OAD._assert(Array.isArray(t.connections), 'connections must be a real array from makeThread, not undefined');
    OAD._assert(Array.isArray(t.ai_insights), 'ai_insights must be a real array from makeThread, not undefined');
    OAD._assertEqual(t.date_push_count, 0, 'must carry makeThread defaults not present in the old hand-built object');
    OAD._assert(!!t.uuid, 'must have a uuid');
    OAD._assert(t.id < 1000000000000, 'id must come from OAD.nextId() (sequential), not Date.now() (a 13-digit millisecond timestamp)');

    OAD._assertEqual(t.evolution_log.length, 1, 'must log exactly one evolution entry');
    OAD._assertEqual(t.evolution_log[0].note, 'Thread created via Mailroom Intake.', 'evolution note must be preserved');
  } finally {
    document.body.removeChild(scratch);
    OAD.DB.threads = origThreads;
    if (main) main.innerHTML = originalMainHTML;
  }
});

OAD.test('translation and configuration system core verification', async function () {
  const prevLocale = OAD.Config.currentLocale;
  const prevTitle = OAD.Config.userGreetingTitle;
  const prevCache = JSON.parse(JSON.stringify(OAD.TranslationCache));
  const prevUserId = OAD._userId;

  try {
    // isSuperAdmin() is real access control now, not a stub — must set up a real
    // superadmin identity to exercise it, not rely on it being unconditionally true.
    OAD._userId = 'demo-superadmin-id';
    OAD._assert(OAD.isSuperAdmin(), 'demo-superadmin-id must verify as SuperAdmin');

    OAD.TranslationCache = {
      testScanButton: "Escanear correo de prueba",
      testSaveButton: "Guardar prueba"
    };

    OAD._assertEqual(OAD.t('testScanButton'), 'Escanear correo de prueba', 'OAD.t should look up key in cache');
    OAD._assertEqual(OAD.t('missing_translation_key'), 'missing_translation_key', 'OAD.t should fallback to key if not in cache');

    await OAD.loadLanguage('es');
    OAD._assertEqual(OAD.Config.currentLocale, 'es', 'Config locale should update to es');
    OAD._assertEqual(OAD.t('scanMail'), '📥 Escanear Correo', 'Translation cache should fetch Spanish keys from json file');

    await OAD.loadLanguage('en');
    OAD._assertEqual(OAD.Config.currentLocale, 'en', 'Config locale should switch back to en');
    OAD._assertEqual(OAD.t('scanMail'), '📥 Scan Mail', 'Translation cache should fetch English keys');

  } finally {
    OAD.Config.currentLocale = prevLocale;
    OAD.Config.userGreetingTitle = prevTitle;
    OAD.TranslationCache = prevCache;
    OAD._userId = prevUserId;
    await OAD.loadLanguage();
  }
});

OAD.test('isSuperAdmin: real access-control identity rules', function () {
  const prevUserId = OAD._userId;
  const prevDemoMode = OAD.Config.demoMode;
  try {
    OAD._userId = 'demo-superadmin-id';
    OAD._assert(OAD.isSuperAdmin(), 'the fixed demo-superadmin sentinel is always SuperAdmin, in or out of demo mode');

    OAD.Config.demoMode = true;
    OAD._userId = 'demo-counselor-3-id';
    OAD._assert(!OAD.isSuperAdmin(), 'a regular demo-role persona (e.g. a Counselor) must never be SuperAdmin');

    OAD.Config.demoMode = false;
    OAD._userId = 'a1b2c3d4-real-supabase-user-uuid';
    OAD._assert(OAD.isSuperAdmin(), 'a genuinely signed-in, non-demo Supabase user is the app owner and is SuperAdmin');

    OAD._userId = null;
    OAD._assert(!OAD.isSuperAdmin(), 'nobody signed in must never be SuperAdmin');
  } finally {
    OAD._userId = prevUserId;
    OAD.Config.demoMode = prevDemoMode;
  }
});

OAD.test('getVisibleThreads/getVisibleCadences: core visibility-filter registration is generic, not role-aware', function () {
  // Proves core's extension point itself works, independent of what fq-demo registers into
  // it — core must have zero knowledge of role names, only "run whatever's registered".
  const origThreads = OAD.DB.threads;
  const origFilters = OAD._threadVisibilityFilters;
  const prevDemoMode = OAD.Config.demoMode;
  const prevRole = OAD._demoRole;
  try {
    const t1 = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Alpha', life_area: 'Anything' });
    const t2 = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Beta', life_area: 'Anything' });
    OAD.DB.threads = [t1, t2];

    let seenRole = null;
    OAD._threadVisibilityFilters = [function (threads, role) {
      seenRole = role;
      return threads.filter(function (t) { return t.title === 'Alpha'; });
    }];

    OAD.Config.demoMode = false;
    OAD._assertEqual(OAD.getVisibleThreads().length, 2, 'non-demo mode must never run visibility filters, regardless of what is registered');

    OAD.Config.demoMode = true;
    OAD._demoRole = 'SomeArbitraryRoleCoreHasNeverHeardOf';
    const visible = OAD.getVisibleThreads();
    OAD._assertEqual(visible.length, 1, 'demo mode must run registered filters');
    OAD._assertEqual(visible[0].title, 'Alpha', 'registered filter result must be used as-is');
    OAD._assertEqual(seenRole, 'SomeArbitraryRoleCoreHasNeverHeardOf', 'core must pass whatever role is set through unmodified, proving it does not branch on role names itself');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._threadVisibilityFilters = origFilters;
    OAD.Config.demoMode = prevDemoMode;
    OAD._demoRole = prevRole;
  }
});

OAD.test('fq-demo role visibility rules: Counselor sees only their own patient + counselor threads', function () {
  const origThreads = OAD.DB.threads;
  const prevDemoMode = OAD.Config.demoMode;
  const prevRole = OAD._demoRole;
  try {
    const patientMine    = OAD.makeThread({ id: 1, uuid: 'p-mine', title: 'My Patient', life_area: 'Patient', metadata: { counselor: 'Counselor 1' } });
    const patientOther    = OAD.makeThread({ id: 2, uuid: 'p-other', title: 'Other Patient', life_area: 'Patient', metadata: { counselor: 'Counselor 2' } });
    const counselorTaskMine  = OAD.makeThread({ id: 3, uuid: 'c-mine', title: 'My task', life_area: 'Counselor', metadata: { counselor: 'Counselor 1' }, parent_uuid: 'p-mine' });
    const counselorTaskOther = OAD.makeThread({ id: 4, uuid: 'c-other', title: 'Other task', life_area: 'Counselor', metadata: { counselor: 'Counselor 2' }, parent_uuid: 'p-other' });
    const unrelated = OAD.makeThread({ id: 5, uuid: 'u-1', title: 'Unrelated', life_area: 'Career' });
    OAD.DB.threads = [patientMine, patientOther, counselorTaskMine, counselorTaskOther, unrelated];

    OAD.Config.demoMode = true;
    OAD._demoRole = 'Counselor 1';
    const visible = OAD.getVisibleThreads().map(function (t) { return t.uuid; });

    OAD._assert(visible.indexOf('c-mine') !== -1, 'Counselor 1 must see their own counselor-task thread');
    OAD._assert(visible.indexOf('c-other') === -1, 'Counselor 1 must not see another counselor\'s task thread');
    OAD._assert(visible.indexOf('p-mine') === -1, 'Patient life_area threads themselves are not directly visible, only via the Counselor rollup — matches pre-existing behavior');
    OAD._assert(visible.indexOf('u-1') === -1, 'Counselor must not see unrelated non-clinical threads');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.Config.demoMode = prevDemoMode;
    OAD._demoRole = prevRole;
  }
});

OAD.test('fq-demo role visibility rules: Director sees all clinical areas, RA/Case Manager/Medical see only their own, CCO sees everything', function () {
  const origThreads = OAD.DB.threads;
  const prevDemoMode = OAD.Config.demoMode;
  const prevRole = OAD._demoRole;
  try {
    const clinical = OAD.makeThread({ id: 1, uuid: 'clin-1', title: 'Clinical', life_area: 'Counselor' });
    const ra = OAD.makeThread({ id: 2, uuid: 'ra-1', title: 'RA task', life_area: 'RA' });
    const caseManager = OAD.makeThread({ id: 3, uuid: 'cm-1', title: 'Case Manager task', life_area: 'Case Manager' });
    const medical = OAD.makeThread({ id: 4, uuid: 'med-1', title: 'Medical task', life_area: 'Medical' });
    const nonClinical = OAD.makeThread({ id: 5, uuid: 'nc-1', title: 'Non-clinical', life_area: 'Career' });
    OAD.DB.threads = [clinical, ra, caseManager, medical, nonClinical];
    OAD.Config.demoMode = true;

    OAD._demoRole = 'Director Alpha';
    let visible = OAD.getVisibleThreads().map(function (t) { return t.uuid; });
    OAD._assert(visible.indexOf('clin-1') !== -1 && visible.indexOf('ra-1') !== -1 && visible.indexOf('cm-1') !== -1 && visible.indexOf('med-1') !== -1, 'Director must see all clinical areas');
    OAD._assert(visible.indexOf('nc-1') === -1, 'Director must not see non-clinical threads');

    OAD._demoRole = 'RA';
    visible = OAD.getVisibleThreads().map(function (t) { return t.uuid; });
    OAD._assertEqual(visible.join(','), 'ra-1', 'RA must see only RA life_area threads');

    OAD._demoRole = 'CCO';
    visible = OAD.getVisibleThreads().map(function (t) { return t.uuid; });
    OAD._assertEqual(visible.length, 5, 'CCO must see everything, unfiltered');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.Config.demoMode = prevDemoMode;
    OAD._demoRole = prevRole;
  }
});

OAD.test('life areas configuration and normalization', function () {
  // Test normalizeLifeArea
  OAD._assertEqual(OAD.normalizeLifeArea('education'), 'Education', 'Should capitalize education');
  OAD._assertEqual(OAD.normalizeLifeArea('job_search'), 'Job Search', 'Should capitalize and replace underscores');
  OAD._assertEqual(OAD.normalizeLifeArea('finance'), 'Finances', 'Should map finance to Finances');
  OAD._assertEqual(OAD.normalizeLifeArea('finances'), 'Finances', 'Should map finances to Finances');
  OAD._assertEqual(OAD.normalizeLifeArea('career'), 'Career', 'Should capitalize career');

  // Test dynamic configuration pointer
  const origLifeAreas = OAD.Config.lifeAreas;
  try {
    OAD.Config.lifeAreas = ['Custom Area 1', 'Custom Area 2'];
    OAD.LIFE_AREAS = OAD.Config.lifeAreas;
    OAD._assertEqual(OAD.LIFE_AREAS[0], 'Custom Area 1', 'LIFE_AREAS should point to Config.lifeAreas');
  } finally {
    OAD.Config.lifeAreas = origLifeAreas;
    OAD.LIFE_AREAS = origLifeAreas;
  }
});

// ── Tests: ADE Engine ────────────────────────────────────────────────

OAD.test('_adeAddEdge: creates edge between two threads', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    const t1 = OAD.addThread(OAD.makeThread({ title: 'Source', status: 'open' }));
    const t2 = OAD.addThread(OAD.makeThread({ title: 'Target', status: 'open' }));
    OAD.DB.ade_suppressions = [];
    const added = OAD._adeAddEdge(t1, t2, 'blocks', 'ADE-TEST', 0.95);
    OAD._assert(added, '_adeAddEdge should return true when edge created');
    const edge = (t1.connections || []).find(function (c) { return c.to_uuid === t2.uuid; });
    OAD._assert(!!edge, 'edge should exist on source thread');
    OAD._assert(edge.auto_generated, 'edge should be marked auto_generated');
    OAD._assert(!edge.confirmed_by_user, 'edge should not be confirmed yet');
    OAD._assertEqual(edge.rule, 'ADE-TEST', 'rule should be set');
    OAD._assertEqual(edge.confidence, 0.95, 'confidence should be set');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('_adeAddEdge: does not duplicate existing edge', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    const t1 = OAD.addThread(OAD.makeThread({ title: 'Source2', status: 'open' }));
    const t2 = OAD.addThread(OAD.makeThread({ title: 'Target2', status: 'open' }));
    OAD.DB.ade_suppressions = [];
    OAD._adeAddEdge(t1, t2, 'blocks', 'ADE-TEST', 0.95);
    const second = OAD._adeAddEdge(t1, t2, 'blocks', 'ADE-TEST', 0.95);
    OAD._assert(!second, '_adeAddEdge should return false on duplicate');
    const count = (t1.connections || []).filter(function (c) { return c.to_uuid === t2.uuid && c.edge_type === 'blocks'; }).length;
    OAD._assertEqual(count, 1, 'only one edge should exist');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('_adeAddEdge: respects ade_suppressions', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    const t1 = OAD.addThread(OAD.makeThread({ title: 'Sup source', status: 'open' }));
    const t2 = OAD.addThread(OAD.makeThread({ title: 'Sup target', status: 'open' }));
    OAD.DB.ade_suppressions = [{ from_uuid: t1.uuid, to_uuid: t2.uuid, rule: 'ADE-TEST' }];
    const added = OAD._adeAddEdge(t1, t2, 'blocks', 'ADE-TEST', 0.95);
    OAD._assert(!added, 'suppressed edge should not be created');
    OAD._assertEqual((t1.connections || []).length, 0, 'no edges on suppressed source');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('ADE-001: sequential week threads get blocks edge', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const w1 = OAD.addThread(OAD.makeThread({ title: 'Python 101 Week 1', status: 'open' }));
    const w2 = OAD.addThread(OAD.makeThread({ title: 'Python 101 Week 2', status: 'open' }));
    const w3 = OAD.addThread(OAD.makeThread({ title: 'Python 101 Week 3', status: 'open' }));
    OAD._ade001_sequential();
    const e12 = (w1.connections || []).find(function (c) { return c.to_uuid === w2.uuid && c.edge_type === 'blocks'; });
    const e23 = (w2.connections || []).find(function (c) { return c.to_uuid === w3.uuid && c.edge_type === 'blocks'; });
    OAD._assert(!!e12, 'Week 1 should block Week 2');
    OAD._assert(!!e23, 'Week 2 should block Week 3');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('ADE-001: non-consecutive weeks do not get direct edge', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const w1 = OAD.addThread(OAD.makeThread({ title: 'Data 200 Week 1', status: 'open' }));
    const w3 = OAD.addThread(OAD.makeThread({ title: 'Data 200 Week 3', status: 'open' }));
    OAD._ade001_sequential();
    const e13 = (w1.connections || []).find(function (c) { return c.to_uuid === w3.uuid && c.edge_type === 'blocks'; });
    OAD._assert(!e13, 'Week 1 should NOT directly block Week 3 (non-consecutive)');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('ADE-002: parent_uuid creates enables edge', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const parent = OAD.addThread(OAD.makeThread({ title: 'Parent project', status: 'open' }));
    const child  = OAD.addThread(OAD.makeThread({ title: 'Child task', status: 'open', parent_uuid: parent.uuid }));
    OAD._ade002_parentChild();
    const edge = (parent.connections || []).find(function (c) { return c.to_uuid === child.uuid && c.edge_type === 'enables'; });
    OAD._assert(!!edge, 'parent should enable child');
    OAD._assertEqual(edge.rule, 'ADE-002', 'rule should be ADE-002');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('_adeAddEdge: does not add a second edge of a DIFFERENT type to the same target', function () {
  // Root-cause regression for the "corrected edge silently duplicates back" bug: a user (or a
  // corrective import) reclassifies an auto-generated edge from `enables` to `blocked_by`.
  // _adeAddEdge must recognize a relationship ALREADY exists between this pair — regardless of
  // type — and defer, rather than layering its own inferred type on top of it.
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    const t1 = OAD.addThread(OAD.makeThread({ title: 'Reclass source', status: 'open' }));
    const t2 = OAD.addThread(OAD.makeThread({ title: 'Reclass target', status: 'open' }));
    OAD.DB.ade_suppressions = [];
    t1.connections = [{
      uuid: 'edge-1', to_uuid: t2.uuid, to_label: t2.title, edge_type: 'blocked_by',
      auto_generated: true, rule: 'ADE-002', confidence: 1, confirmed_by_user: true,
      created_at: '2026-01-01T00:00:00.000Z'
    }];
    const added = OAD._adeAddEdge(t1, t2, 'enables', 'ADE-002', 1.0);
    OAD._assert(!added, '_adeAddEdge should refuse to add a differently-typed edge to an already-connected target');
    OAD._assertEqual((t1.connections || []).length, 1, 'no duplicate edge should have been created');
    OAD._assertEqual(t1.connections[0].edge_type, 'blocked_by', 'the original, reclassified edge type must be untouched');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('ADE-002: does not re-duplicate a parent/child edge the user already reclassified', function () {
  // End-to-end version of the same regression, through the actual rule that caused it in
  // production: a thread's ADE-002 `enables` edge was corrected to `blocked_by` via a corrective
  // import; re-running ADE-002 (which happens automatically after every import, see
  // OAD._confirmImport) must not silently re-add the `enables` edge alongside it.
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const parent = OAD.addThread(OAD.makeThread({ title: 'Reclassified parent', status: 'open' }));
    const child  = OAD.addThread(OAD.makeThread({ title: 'Reclassified child', status: 'open', parent_uuid: parent.uuid }));
    parent.connections = [{
      uuid: 'edge-2', to_uuid: child.uuid, to_label: child.title, edge_type: 'blocked_by',
      auto_generated: true, rule: 'ADE-002', confidence: 1, confirmed_by_user: true,
      created_at: '2026-01-01T00:00:00.000Z'
    }];
    OAD._ade002_parentChild();
    OAD._assertEqual((parent.connections || []).length, 1, 'ADE-002 must not add a second edge to the reclassified target');
    OAD._assertEqual(parent.connections[0].edge_type, 'blocked_by', 'reclassified edge type survives a re-run of ADE-002');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('CHE-011: flags a thread with conflicting edge types to the same target', function () {
  const thread = OAD.makeThread({
    title: 'Conflicted thread', status: 'open',
    connections: [
      { uuid: 'e1', to_uuid: 'target-1', to_label: 'Target', edge_type: 'blocked_by', confirmed_by_user: true },
      { uuid: 'e2', to_uuid: 'target-1', to_label: 'Target', edge_type: 'enables', auto_generated: true, confirmed_by_user: false }
    ]
  });
  const alerts = OAD._che011_conflictingEdges(thread);
  OAD._assertEqual(alerts.length, 1, 'exactly one CHE-011 alert should fire for the conflicting pair');
  OAD._assertEqual(alerts[0].type, 'CHE-011', 'alert type should be CHE-011');
  OAD._assert(!alerts[0].auto_fixable, 'CHE-011 is detection-only, not auto-fixable');
});

OAD.test('CHE-011: does not flag a thread with clean, non-conflicting edges', function () {
  const thread = OAD.makeThread({
    title: 'Clean thread', status: 'open',
    connections: [
      { uuid: 'e1', to_uuid: 'target-1', to_label: 'A', edge_type: 'blocked_by' },
      { uuid: 'e2', to_uuid: 'target-2', to_label: 'B', edge_type: 'enables' }
    ]
  });
  OAD._assertEqual(OAD._che011_conflictingEdges(thread).length, 0, 'distinct targets, and a single type per target, should never flag');
});

OAD.test('CHE-011: does not flag a closed thread', function () {
  const thread = OAD.makeThread({
    title: 'Closed conflicted thread', status: 'closed',
    connections: [
      { uuid: 'e1', to_uuid: 'target-1', to_label: 'Target', edge_type: 'blocked_by' },
      { uuid: 'e2', to_uuid: 'target-1', to_label: 'Target', edge_type: 'enables' }
    ]
  });
  OAD._assertEqual(OAD._che011_conflictingEdges(thread).length, 0, 'closed threads are not actionable, so are not worth flagging');
});

OAD.test('computeSuppressedChildUUIDs: suppresses a lower-urgency child under an active parent', function () {
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-08-01' });
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(result.has('c1'), 'future-dated child should be suppressed under its parent');
});

OAD.test('computeSuppressedChildUUIDs: never suppresses a child due within the given horizon (This Week under-reporting bug)', function () {
  // Real reported case: HVAC Repair (P85) and VA Orthopedic Consult (P82) both had active
  // parents with no next_action_date of their own, and were due 5 days out — not today, not
  // overdue — so the old "only exempt overdue-or-today" rule suppressed them out of the This
  // Week list entirely, with no compensating detail anywhere (their parents didn't even render
  // in a date bucket to show the child-summary badge). horizonStr fixes this: This Week passes
  // its own 7-day window so anything it exists to show is never suppressed out of it.
  const todayStr = OAD.todayStr();
  const in5 = new Date(); in5.setDate(in5.getDate() + 5);
  const in5Str = in5.toISOString().slice(0, 10);
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().slice(0, 10);

  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' }); // no next_action_date, mirrors the real parents
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: in5Str }); // 5 days out
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };

  const withoutHorizon = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr);
  OAD._assert(withoutHorizon.has('c1'), 'sanity check: without a horizon, a child due 5 days out is still suppressed (old behavior)');

  const withHorizon = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, null, in7Str);
  OAD._assert(!withHorizon.has('c1'), 'a child due within the given horizon must never be suppressed');
});

OAD.test('computeSuppressedChildUUIDs: still suppresses a child due beyond the given horizon', function () {
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-08-01' }); // well beyond a 7-day horizon
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03', null, '2026-07-10');
  OAD._assert(result.has('c1'), 'a child due well beyond the horizon should still be suppressed under its parent');
});

OAD.test('computeSuppressedChildUUIDs: never suppresses a child due today (Bug 5)', function () {
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-07-03' });
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(!result.has('c1'), 'child due today must never be suppressed, even though its parent is active');
});

OAD.test('computeSuppressedChildUUIDs: never suppresses an overdue child', function () {
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2020-01-01' });
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(!result.has('c1'), 'overdue child must never be suppressed');
});

OAD.test('computeSuppressedChildUUIDs: never suppresses a child whose deadline has passed, even if next_action_date is far out (ticket-overdue-filter-fix.md)', function () {
  // Real reproduction of the CAC102 Live Session case from the 7/11 export: a child whose
  // deadline genuinely passed (rescheduled session, deadline field never updated) but whose
  // next_action_date is weeks out — without this exemption it would be folded into its
  // parent's summary badge and silently vanish from the deadline-based Overdue bucket, the
  // same failure mode as the original Bug 4/5 (documented in dev/CLAUDE.md) for the
  // next_action_date-based buckets.
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2099-01-01', deadline: '2020-01-01' });
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(!result.has('c1'), 'a child with a genuinely passed deadline must never be suppressed, regardless of how far out its next_action_date is');
});

OAD.test('computeSuppressedChildUUIDs: Patient life_area parent never suppresses its children', function () {
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1', life_area: 'Patient' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-08-01' });
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };
  const result = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(!result.has('c1'), 'children of a Patient life_area parent should never be suppressed');
});

OAD.test('computeSuppressedChildUUIDs: never suppresses the child matching focusUUID, even if due later this week (regression — "This Week excludes Focus Now" bug)', function () {
  const todayStr = OAD.todayStr();
  const in5 = new Date(); in5.setDate(in5.getDate() + 5);
  const in5Str = in5.toISOString().slice(0, 10);

  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: in5Str }); // 5 days out — not today, not overdue
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };

  const withoutFocus = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr);
  OAD._assert(withoutFocus.has('c1'), 'sanity check: without a focus exemption this child is suppressed like any other future-dated child');

  const withFocus = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, 'c1');
  OAD._assert(!withFocus.has('c1'), 'a child matching focusUUID must never be suppressed, regardless of its date');
});

OAD.test('getFocusUUID: returns selectFocusThread\'s uuid when something is due now, else selectFutureFocusSuggestion\'s', function () {
  const orig = OAD.DB.threads;
  try {
    const dueNow = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Due now', status: 'open', priority: 'high', next_action_date: OAD.todayStr() });
    OAD.DB.threads = [dueNow];
    OAD._assertEqual(OAD.getFocusUUID(), dueNow.uuid, 'should match selectFocusThread when something is due now');

    const future = new Date(); future.setDate(future.getDate() + 3);
    const upcoming = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Upcoming', status: 'open', priority: 'high', next_action_date: _localDateStr(future) });
    OAD.DB.threads = [upcoming];
    OAD._assertEqual(OAD.getFocusUUID(), upcoming.uuid, 'should fall back to selectFutureFocusSuggestion when nothing is due now');

    OAD.DB.threads = [];
    OAD._assertEqual(OAD.getFocusUUID(), null, 'should return null when there is nothing to focus on at all');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('renderDailyView-style suppression pipeline: a child Focus Now would suggest is never invisible from This Week (regression — the exact reported bug)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in5 = new Date(); in5.setDate(in5.getDate() + 5);
    const in5Str = _localDateStr(in5);

    const parent = OAD.makeThread({ id: 1, uuid: 'parent-1', title: 'Parent project', status: 'open', priority: 'low' }); // no next_action_date of its own
    const child = OAD.makeThread({ id: 2, uuid: 'child-1', title: 'High-pressure child', status: 'stalled', priority: 'critical', parent_uuid: 'parent-1', next_action_date: in5Str });
    OAD.DB.threads = [parent, child];

    // Mirrors the exact pipeline renderDailyView/renderTodayView/renderMatrixView use.
    const active = OAD.DB.threads.filter(t => t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox');
    const activeByUUID = {};
    active.forEach(t => { activeByUUID[t.uuid] = t; });
    const childrenByParentUUID = {};
    active.forEach(t => {
      if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
        (childrenByParentUUID[t.parent_uuid] = childrenByParentUUID[t.parent_uuid] || []).push(t);
      }
    });

    const focusUUID = OAD.getFocusUUID();
    OAD._assertEqual(focusUUID, 'child-1', 'sanity check: Focus Now should be suggesting this child (highest pressure, only upcoming item)');

    const suppressedUUIDs = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, focusUUID);
    OAD._assert(!suppressedUUIDs.has('child-1'), 'a thread Focus Now is currently recommending must never be suppressed from the This Week list');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('renderDailyView-style suppression pipeline: This Week under-reporting bug, reproduced exactly — two high-pressure children with dateless active parents, neither the Focus Now pick', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in2 = new Date(); in2.setDate(in2.getDate() + 2);
    const in2Str = _localDateStr(in2);
    const in5 = new Date(); in5.setDate(in5.getDate() + 5);
    const in5Str = _localDateStr(in5);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = _localDateStr(in7Dt);

    // Mirrors the real reported case exactly: HVAC Repair (P85) and VA Orthopedic Consult
    // (P82), each a child of an active parent with no next_action_date of its own, due a few
    // days out — plus something due sooner so Focus Now's pick is a third thread, meaning the
    // focusUUID exemption alone can't save either of these two.
    const parentA = OAD.makeThread({ id: 1, uuid: 'parent-a', title: 'Home — Sandwich Transition', status: 'open', priority: 'low' });
    const parentB = OAD.makeThread({ id: 2, uuid: 'parent-b', title: 'VA Health & Claims Coordination', status: 'open', priority: 'low' });
    const hvac = OAD.makeThread({ id: 3, uuid: 'hvac-repair', title: 'HVAC Repair', status: 'waiting', priority: 'high', parent_uuid: 'parent-a', next_action_date: in2Str });
    const ortho = OAD.makeThread({ id: 4, uuid: 'va-orthopedic', title: 'VA Orthopedic Consult', status: 'open', priority: 'high', parent_uuid: 'parent-b', next_action_date: in2Str });
    const dueSooner = OAD.makeThread({ id: 5, uuid: 'due-sooner', title: 'Due sooner, wins Focus Now', status: 'open', priority: 'medium', next_action_date: OAD.todayStr() });
    OAD.DB.threads = [parentA, parentB, hvac, ortho, dueSooner];

    const focusUUID = OAD.getFocusUUID();
    OAD._assertEqual(focusUUID, 'due-sooner', 'sanity check: Focus Now picks the item due today, not either 2-days-out child');

    const active = OAD.DB.threads.filter(t => t.status !== 'closed' && t.status !== 'dormant' && t.status !== 'inbox');
    const activeByUUID = {};
    active.forEach(t => { activeByUUID[t.uuid] = t; });
    const childrenByParentUUID = {};
    active.forEach(t => {
      if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
        (childrenByParentUUID[t.parent_uuid] = childrenByParentUUID[t.parent_uuid] || []).push(t);
      }
    });

    const suppressedUUIDs = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, todayStr, focusUUID, in7Str);
    OAD._assert(!suppressedUUIDs.has('hvac-repair'), 'HVAC Repair must not be suppressed from This Week, even though it is not the Focus Now pick');
    OAD._assert(!suppressedUUIDs.has('va-orthopedic'), 'VA Orthopedic Consult must not be suppressed from This Week, even though it is not the Focus Now pick');

    const weekThreads = active.filter(t => !suppressedUUIDs.has(t.uuid) && t.next_action_date > todayStr && t.next_action_date <= in7Str);
    OAD._assert(weekThreads.some(t => t.uuid === 'hvac-repair'), 'HVAC Repair must actually appear in the This Week list');
    OAD._assert(weekThreads.some(t => t.uuid === 'va-orthopedic'), 'VA Orthopedic Consult must actually appear in the This Week list');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: OAD.Due — single source of truth for "what's due" ─────────
// Unlike the hand-rolled pipelines above (which predate OAD.Due and still test
// computeSuppressedChildUUIDs directly), these call the real production entry point,
// OAD.Due.dashboardData(), so they prove the actual consumer code agrees — not just that the
// underlying suppression primitive is correct in isolation.

OAD.test('OAD.Due.dashboardData: two dateless active parents each with a high-pressure child due ~2 days out both appear in .week (regression — the exact reported bug)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in2 = new Date(); in2.setDate(in2.getDate() + 2);
    const in2Str = _localDateStr(in2);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = _localDateStr(in7Dt);

    // Mirrors the real reported case: HVAC Repair (P85) and VA Orthopedic Consult (P82), each
    // a child of an active parent with no next_action_date of its own, due a few days out —
    // plus something due sooner (low pressure noise) so Focus Now's pick is a third thread.
    const parentA = OAD.makeThread({ id: 1, uuid: 'due-parent-a', title: 'Home — Sandwich Transition', status: 'open', priority: 'low' });
    const parentB = OAD.makeThread({ id: 2, uuid: 'due-parent-b', title: 'VA Health & Claims Coordination', status: 'open', priority: 'low' });
    const hvac = OAD.makeThread({ id: 3, uuid: 'due-hvac-repair', title: 'HVAC Repair', status: 'waiting', priority: 'high', parent_uuid: 'due-parent-a', next_action_date: in2Str });
    const ortho = OAD.makeThread({ id: 4, uuid: 'due-va-orthopedic', title: 'VA Orthopedic Consult', status: 'open', priority: 'high', parent_uuid: 'due-parent-b', next_action_date: in2Str });
    const noise = OAD.makeThread({ id: 5, uuid: 'due-noise', title: 'Low-pressure noise, wins Focus Now', status: 'open', priority: 'low', next_action_date: todayStr });
    OAD.DB.threads = [parentA, parentB, hvac, ortho, noise];

    const data = OAD.Due.dashboardData(todayStr, in7Str);
    OAD._assertEqual(data.focusUUID, 'due-noise', 'sanity check: Focus Now picks the item due today, not either 2-days-out child');
    OAD._assert(data.week.some(t => t.uuid === 'due-hvac-repair'), 'HVAC Repair must appear in dashboardData().week');
    OAD._assert(data.week.some(t => t.uuid === 'due-va-orthopedic'), 'VA Orthopedic Consult must appear in dashboardData().week');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('OAD.Due.dashboardData: whatever getFocusUUID() picks, if due in [today, in7Str], also shows up in that same call\'s today/week bucket', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in3 = new Date(); in3.setDate(in3.getDate() + 3);
    const in3Str = _localDateStr(in3);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = _localDateStr(in7Dt);

    const t1 = OAD.makeThread({ id: 1, uuid: 'consist-t1', title: 'Due today, wins focus', status: 'stalled', priority: 'critical', next_action_date: todayStr });
    const t2 = OAD.makeThread({ id: 2, uuid: 'consist-t2', title: 'Due later this week', status: 'open', priority: 'medium', next_action_date: in3Str });
    OAD.DB.threads = [t1, t2];

    const data = OAD.Due.dashboardData(todayStr, in7Str);
    OAD._assert(!!data.focusUUID, 'sanity check: something should be focused');
    const focusThread = data.active.find(t => t.uuid === data.focusUUID);
    OAD._assert(!!focusThread, 'the focus pick must be present in dashboardData().active');
    if (focusThread.next_action_date >= todayStr && focusThread.next_action_date <= in7Str) {
      const inToday = data.today.some(t => t.uuid === data.focusUUID);
      const inWeek  = data.week.some(t => t.uuid === data.focusUUID);
      OAD._assert(inToday || inWeek, 'Focus Now\'s pick must also appear in the same call\'s today or week bucket, not just its own separate selection logic');
    }
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('OAD.Due.dashboardData: .overdue is deadline-based end-to-end — waiting threads with past next_action_date, closed threads, and dormant threads are excluded; a genuinely deadline-overdue child survives suppression (ticket-overdue-filter-fix.md)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = _localDateStr(in7Dt);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);
    const future = new Date(); future.setDate(future.getDate() + 30);
    const futureStr = _localDateStr(future);

    // Real reproduction of ticket-overdue-filter-fix.md against a mirror of the 7/11 export:
    // a waiting thread whose next_action_date is stale (normal — blocked on someone else) must
    // NOT count as overdue; a closed thread with a genuinely past deadline must never appear
    // regardless of deadline; a dormant thread must never appear (existing app-wide invariant —
    // dormant contributes zero pressure everywhere else); and a real deadline-overdue thread
    // must appear even with a rescheduled, future next_action_date.
    const waitingStale = OAD.makeThread({ id: 1, uuid: 'ovd-waiting-stale', title: 'Waiting, stale next_action_date, no deadline', status: 'waiting', next_action_date: yStr, deadline: null });
    const closedPastDeadline = OAD.makeThread({ id: 2, uuid: 'ovd-closed-past', title: 'Closed but has a past deadline', status: 'closed', deadline: yStr });
    const dormantPastDeadline = OAD.makeThread({ id: 3, uuid: 'ovd-dormant-past', title: 'Dormant but has a past deadline', status: 'dormant', deadline: yStr });
    const genuinelyOverdue = OAD.makeThread({ id: 4, uuid: 'ovd-genuine', title: 'Genuinely deadline-overdue, rescheduled next_action_date', status: 'open', priority: 'low', next_action_date: futureStr, deadline: yStr });
    OAD.DB.threads = [waitingStale, closedPastDeadline, dormantPastDeadline, genuinelyOverdue];

    const data = OAD.Due.dashboardData(todayStr, in7Str);

    OAD._assert(!data.overdue.some(t => t.uuid === 'ovd-waiting-stale'), 'a waiting thread with only a stale next_action_date (no deadline) must not appear in overdue');
    OAD._assert(!data.overdue.some(t => t.uuid === 'ovd-closed-past'), 'a closed thread must never appear in overdue regardless of deadline value');
    OAD._assert(!data.overdue.some(t => t.uuid === 'ovd-dormant-past'), 'a dormant thread must never appear in overdue — consistent with dormant contributing zero pressure everywhere else in the app');
    OAD._assert(data.overdue.some(t => t.uuid === 'ovd-genuine'), 'a thread with a genuinely passed deadline must appear in overdue even with a rescheduled, future next_action_date');
    OAD._assertEqual(data.overdue.length, 1, 'exactly one thread should be in overdue');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('OAD.Due.dashboardData: a deadline-overdue child of an active parent is not folded into the parent\'s summary badge (CAC102 Live Session case)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = _localDateStr(in7Dt);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);
    const future = new Date(); future.setDate(future.getDate() + 30);
    const futureStr = _localDateStr(future);

    // Mirrors the real CAC102 Live Session case from the 7/11 export exactly: a `waiting` child
    // of an active parent, next_action_date rescheduled 30 days out (so it fails the normal
    // horizon-based suppression exemption), but its deadline genuinely passed and was never
    // updated to match the reschedule.
    const parent = OAD.makeThread({ id: 1, uuid: 'cac-parent', title: 'CAC102 Completion', status: 'open', priority: 'low' });
    const child = OAD.makeThread({ id: 2, uuid: 'cac-child', title: 'CAC102 Live Session', status: 'waiting', priority: 'low', parent_uuid: 'cac-parent', next_action_date: futureStr, deadline: yStr });
    OAD.DB.threads = [parent, child];

    const data = OAD.Due.dashboardData(todayStr, in7Str);
    OAD._assert(!data.suppressedUUIDs.has('cac-child'), 'the deadline-overdue child must not be suppressed into its parent\'s summary badge');
    OAD._assert(data.overdue.some(t => t.uuid === 'cac-child'), 'the deadline-overdue child must actually appear in the overdue bucket, not silently vanish');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('OAD.Due.selfCheck: returns ok with no issues on the "This Week under-reporting" scenario (proves the fix holds, not just that the bug is gone)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const in2 = new Date(); in2.setDate(in2.getDate() + 2);
    const in2Str = _localDateStr(in2);

    const parentA = OAD.makeThread({ id: 1, uuid: 'self-parent-a', title: 'Home — Sandwich Transition', status: 'open', priority: 'low' });
    const parentB = OAD.makeThread({ id: 2, uuid: 'self-parent-b', title: 'VA Health & Claims Coordination', status: 'open', priority: 'low' });
    const hvac = OAD.makeThread({ id: 3, uuid: 'self-hvac-repair', title: 'HVAC Repair', status: 'waiting', priority: 'high', parent_uuid: 'self-parent-a', next_action_date: in2Str });
    const ortho = OAD.makeThread({ id: 4, uuid: 'self-va-orthopedic', title: 'VA Orthopedic Consult', status: 'open', priority: 'high', parent_uuid: 'self-parent-b', next_action_date: in2Str });
    const noise = OAD.makeThread({ id: 5, uuid: 'self-noise', title: 'Low-pressure noise, wins Focus Now', status: 'open', priority: 'low', next_action_date: todayStr });
    OAD.DB.threads = [parentA, parentB, hvac, ortho, noise];

    const result = OAD.Due.selfCheck();
    OAD._assertEqual(result.ok, true, 'selfCheck should report no issues: ' + JSON.stringify(result.issues));
    OAD._assertEqual(result.issues.length, 0, 'issues list should be empty');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('ADE-003: shared identifier with prep→submit creates blocks edge', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const prep   = OAD.addThread(OAD.makeThread({ title: 'Draft CS-101 Proposal', status: 'open' }));
    const submit = OAD.addThread(OAD.makeThread({ title: 'Submit CS-101 Proposal', status: 'open' }));
    OAD._ade003_sharedIdentifier();
    const edge = (prep.connections || []).find(function (c) { return c.to_uuid === submit.uuid && c.edge_type === 'blocks'; });
    OAD._assert(!!edge, 'Draft should block Submit for same identifier');
    OAD._assertEqual(edge.rule, 'ADE-003', 'rule should be ADE-003');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

OAD.test('confirmEdge: sets confirmed_by_user on matching edge', function () {
  const orig = OAD.DB.threads;
  try {
    const edgeUuid = OAD._generateUUID();
    const t = OAD.addThread(OAD.makeThread({ title: 'Confirm target', status: 'open' }));
    t.connections = [{ uuid: edgeUuid, to_uuid: 'some-uuid', edge_type: 'blocks', auto_generated: true, confirmed_by_user: false }];
    OAD.confirmEdge(t.id, edgeUuid);
    const edge = t.connections.find(function (c) { return c.uuid === edgeUuid; });
    OAD._assert(edge.confirmed_by_user, 'edge should be confirmed after confirmEdge');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('rejectEdge: removes edge and adds to ade_suppressions', function () {
  const orig = OAD.DB.threads;
  const origSupp = OAD.DB.ade_suppressions;
  try {
    OAD.DB.ade_suppressions = [];
    const edgeUuid = OAD._generateUUID();
    const t = OAD.addThread(OAD.makeThread({ title: 'Reject target', status: 'open' }));
    const targetUuid = OAD._generateUUID();
    t.connections = [{ uuid: edgeUuid, to_uuid: targetUuid, edge_type: 'blocks', auto_generated: true, confirmed_by_user: false, rule: 'ADE-001' }];
    OAD.rejectEdge(t.id, edgeUuid);
    OAD._assertEqual(t.connections.length, 0, 'edge should be removed after reject');
    const suppressed = OAD.DB.ade_suppressions.find(function (s) { return s.from_uuid === t.uuid && s.to_uuid === targetUuid; });
    OAD._assert(!!suppressed, 'suppression entry should be created');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.ade_suppressions = origSupp;
  }
});

// ── Tests: Dormant status (Issue 1) ──────────────────────────────────

OAD.test('pressure: dormant thread returns 0', function () {
  const t = OAD.makeThread({ status: 'dormant', priority: 'critical', current_assumption: 'x', assumption_verified: false, connections: [] });
  OAD._assertEqual(OAD.pressure(t), 0, 'dormant thread must have pressure 0');
});

OAD.test('makeThread: dormant_trigger defaults to empty string', function () {
  const t = OAD.makeThread({});
  OAD._assert(Object.prototype.hasOwnProperty.call(t, 'dormant_trigger'), 'dormant_trigger field exists');
  OAD._assertEqual(t.dormant_trigger, '', 'dormant_trigger defaults to empty string');
});

OAD.test('makeThread: user_action_complete defaults to false', function () {
  const t = OAD.makeThread({});
  OAD._assert(Object.prototype.hasOwnProperty.call(t, 'user_action_complete'), 'user_action_complete field exists');
  OAD._assertEqual(t.user_action_complete, false, 'user_action_complete defaults to false');
});

OAD.test('getDailyToat: dormant thread is never selected', function () {
  const orig = OAD.DB.threads;
  const origToat = OAD.DB.toat;
  try {
    const pastDate = '2020-01-01';
    OAD.DB.toat = [];
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Dormant stalled', status: 'dormant', next_action_date: pastDate }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Open overdue', status: 'open', next_action_date: pastDate })
    ];
    const toat = OAD.getDailyToat();
    OAD._assert(!!toat, 'TOAT should return a thread');
    OAD._assertEqual(toat.id, 2, 'TOAT should select the open overdue thread, not the dormant one');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.toat = origToat;
  }
});

OAD.test('selectFocusThread: dormant thread is never returned', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Dormant high priority', status: 'dormant', priority: 'critical', next_action: 'do something', next_action_date: todayStr }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Open low priority', status: 'open', priority: 'low', next_action: 'do something else', next_action_date: todayStr })
    ];
    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'focus should return a thread');
    OAD._assertEqual(focus.id, 2, 'focus should select the open thread, not the dormant one');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: Quick Add / Inbox status ──────────────────────────────────

OAD.test('OAD.STATUSES includes inbox', function () {
  OAD._assert(OAD.STATUSES.includes('inbox'), 'inbox should be a recognized status value');
});

OAD.test('OAD.STATUSES no longer includes "stalled" — removed per ticket-stalled-metric-fix.md, superseded by OAD.Due.stalledThreads()', function () {
  OAD._assert(!OAD.STATUSES.includes('stalled'), '"stalled" must not be a settable status value — no thread across the real dataset ever used it, and it is now a live-computed view instead');
});

OAD.test('makeThread: created_at defaults to a valid ISO timestamp', function () {
  const t = OAD.makeThread({});
  OAD._assert(!!t.created_at, 'created_at should be set');
  OAD._assert(!isNaN(new Date(t.created_at).getTime()), 'created_at should parse as a valid date');
});

OAD.test('_normalizeDB: hydrates plain-object threads into real domain-model instances, in place', function () {
  const origThreads = OAD.DB.threads;
  try {
    const plainThread = { id: 9001, uuid: OAD._generateUUID(), title: 'Plain object thread', status: 'open',
      next_action_date: '2020-01-01', connections: [] }; // deliberately overdue, to prove isOverdue() actually works
    OAD.DB.threads = [plainThread];

    OAD._assert(!(plainThread instanceof OAD.Models.Thread), 'sanity check: starts as a plain object, not a Thread');
    OAD._normalizeDB();

    OAD._assert(plainThread instanceof OAD.Models.Thread, 'thread must be a real Thread instance after normalize');
    OAD._assert(typeof plainThread.isOverdue === 'function', 'hydrated thread must have its class methods available');
    OAD._assert(plainThread.isOverdue(), 'hydrated thread method must actually work, not just exist (this one really is overdue)');
    OAD._assertEqual(OAD.DB.threads[0], plainThread, 'hydration must upgrade the object in place — same reference, not a replacement — so any code already holding this reference keeps working');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('cadenceOverdue: a plain-object cadence-thread (not universally hydrated — RecurringThread is applied lazily, same as Track) still gets real isOverdue() behavior', function () {
  const origThreads = OAD.DB.threads;
  try {
    const c = OAD.addCadence(OAD.makeCadence({ title: 'Plain object cadence', recurrence: 'weekly', next_due: '2020-01-01' }));
    OAD._assert(!(c instanceof OAD.Models.RecurringThread), 'sanity check: a cadence-thread is not universally hydrated to RecurringThread — only wrapped on demand');
    OAD._assert(OAD.cadenceOverdue(c), 'OAD.cadenceOverdue must still correctly detect this as overdue via its lazy RecurringThread wrap');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('_normalizeDB: legacy thread without created_at backfills to null, not a fabricated date', function () {
  const orig = OAD.DB.threads;
  try {
    const legacy = { id: 701, uuid: OAD._generateUUID(), title: 'Predates created_at', status: 'open', connections: [] };
    delete legacy.created_at;
    OAD.DB.threads = [legacy];
    OAD._normalizeDB();
    OAD._assert(Object.prototype.hasOwnProperty.call(legacy, 'created_at'), 'created_at key should exist after normalize');
    OAD._assertEqual(legacy.created_at, null, 'backfilled created_at should be null (unknown), not a guessed date');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('quickAddThread: creates a minimal inbox thread from raw text', function () {
  const before = OAD.DB.threads.length;
  const t = OAD.quickAddThread('Mom beta test Bible Clock');
  OAD._assert(!!t, 'should return the created thread');
  OAD._assertEqual(t.title, 'Mom beta test Bible Clock', 'raw text becomes the title');
  OAD._assertEqual(t.status, 'inbox', 'status should be inbox');
  OAD._assertEqual(t.date_push_count, 0, 'date_push_count starts at 0');
  OAD._assert(!!t.created_at, 'created_at should be set');
  OAD._assertEqual(OAD.DB.threads.length, before + 1, 'thread count increased by one');
});

OAD.test('quickAddThread: trims whitespace and rejects empty/whitespace-only input', function () {
  const before = OAD.DB.threads.length;
  OAD._assertEqual(OAD.quickAddThread('   '), null, 'whitespace-only input should not create a thread');
  OAD._assertEqual(OAD.quickAddThread(''), null, 'empty input should not create a thread');
  OAD._assertEqual(OAD.DB.threads.length, before, 'no threads created from empty/whitespace input');

  const t = OAD.quickAddThread('  padded title  ');
  OAD._assertEqual(t.title, 'padded title', 'title should be trimmed');
});

OAD.test('openPushbackWizard/_confirmPushback: survives apostrophes in thread data (regression — "Cannot move \'\'" bug)', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Apostrophe regression thread', status: 'open', priority: 'low', next_action_date: '2026-07-01' }));
  try {
    // Old bug: this data was JSON-stringified, encodeURIComponent'd (which leaves ' unescaped),
    // then embedded inside a single-quoted onclick="..." attribute — the apostrophe below broke
    // the generated inline handler's JS syntax and the Save button silently did nothing.
    const data = Object.assign({}, t, {
      next_action: "Reference Kevin's email and the 2-week extension Cornell granted.",
      date_push_count: 3
    });
    const notes = ['Date pushed back to 2026-07-10'];

    OAD.openPushbackWizard(t.id, data, notes);
    OAD._assertEqual(OAD._pendingPushback.data.next_action, data.next_action, 'pending data holds the apostrophe-containing field intact, not re-encoded into markup');

    const modalHtml = document.getElementById('modal-overlay').innerHTML;
    OAD._assert(modalHtml.indexOf('_confirmPushback()') !== -1, 'Save button wires to the no-arg handler — no encoded data round-tripped through the attribute');

    document.getElementById('f-pushback-reason').value = 'The real reason';
    OAD._confirmPushback();

    const saved = OAD.getThread(t.id);
    OAD._assertEqual(saved.next_action, data.next_action, "apostrophe-containing next_action saved correctly, not truncated");
    OAD._assertEqual(saved.current_assumption, 'The real reason', 'pushback reason saved');
    OAD._assert(!OAD._pendingPushback, 'pending pushback cleared after confirm');
  } finally {
    OAD.closeModal();
    OAD.deleteThread(t.id);
  }
});

OAD.test('_enableQuickAdd: enables the quick-add input (guards against pre-auth capture loss)', function () {
  const input = document.getElementById('quick-add-input');
  if (!input) return; // not present in this DOM context (e.g. non-browser test runner) — nothing to check
  const wasDisabled = input.disabled;
  input.disabled = true; // force known state regardless of prior test runs
  OAD._enableQuickAdd();
  OAD._assert(!input.disabled, '_enableQuickAdd() must enable the quick-add input');
  input.disabled = wasDisabled; // restore, in case a later test depends on default state
});

OAD.test('pressure: inbox status is 0, matching dormant', function () {
  const inbox = OAD.makeThread({ status: 'inbox', priority: 'critical', connections: [] });
  const dormant = OAD.makeThread({ status: 'dormant', priority: 'critical', connections: [] });
  OAD._assertEqual(OAD.pressure(inbox), 0, 'inbox thread pressure should be 0 regardless of priority');
  OAD._assertEqual(OAD.pressure(inbox), OAD.pressure(dormant), 'inbox and dormant should both be 0');
});

OAD.test('selectFocusThread: inbox thread is never returned', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Inbox capture', status: 'inbox', priority: 'critical', next_action_date: todayStr }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Open low priority', status: 'open', priority: 'low', next_action: 'do something', next_action_date: todayStr })
    ];
    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'focus should return a thread');
    OAD._assertEqual(focus.id, 2, 'focus should select the open thread, not the inbox capture');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('getLifeAreaHeat: excludes inbox threads from area aggregates', function () {
  const orig = OAD.DB.threads;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Inbox item', status: 'inbox', life_area: 'Test Area', connections: [] }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Real work', status: 'open', life_area: 'Test Area', connections: [] })
    ];
    const heat = OAD.getLifeAreaHeat();
    const area = heat.find(h => h.name === 'Test Area');
    OAD._assert(!!area, 'Test Area should appear in heat map');
    OAD._assertEqual(area.count, 1, 'only the non-inbox thread should count toward the area');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: Actioned Waiting / user_action_complete (Issue 2) ─────────

OAD.test('pressure: waiting+actioned pressure is 35% of base', function () {
  const base = OAD.makeThread({ status: 'waiting', priority: 'critical', current_assumption: 'x', assumption_verified: false, connections: [], user_action_complete: false });
  const actioned = OAD.makeThread({ status: 'waiting', priority: 'critical', current_assumption: 'x', assumption_verified: false, connections: [], user_action_complete: true });
  const baseScore = OAD.pressure(base);
  const actionedScore = OAD.pressure(actioned);
  OAD._assert(baseScore > 0, 'base waiting thread should have nonzero pressure');
  OAD._assertEqual(actionedScore, Math.round(baseScore * 0.35), 'actioned waiting pressure should be 35% of base');
});

OAD.test('selectFocusThread: waiting+actioned excluded when alternatives exist', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Actioned waiting', status: 'waiting', priority: 'critical', user_action_complete: true, next_action: 'sent email', next_action_date: todayStr }),
      OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Open thread', status: 'open', priority: 'medium', next_action: 'do something', next_action_date: todayStr })
    ];
    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'focus should return a thread');
    OAD._assertEqual(focus.id, 2, 'focus should prefer the open thread over waiting+actioned');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('selectFocusThread: waiting+actioned returned as last resort when nothing else', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Only actioned waiting', status: 'waiting', priority: 'high', user_action_complete: true, next_action: 'waiting for reply', next_action_date: todayStr })
    ];
    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'focus should still return a thread as last resort');
    OAD._assertEqual(focus.id, 1, 'waiting+actioned returned when nothing else qualifies');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: Focus Now date-scoping (Bug 3 — was ORDER BY pressure DESC with no date filter) ──

OAD.test('selectFocusThread: a lower-pressure item due today outranks a higher-pressure item due later — the exact reported bug', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const future = new Date(); future.setDate(future.getDate() + 5);
    const futureStr = _localDateStr(future);

    // Mirrors the real report: "Digital.ai" (pressure 69, due in 5 days) vs "HVAC Repair"
    // (pressure 53, due today). HVAC should win now, even though its raw pressure is lower.
    const digitalAi = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Digital.ai Class P Units Repurchase Offer',
      status: 'waiting', priority: 'high', next_action_date: futureStr, next_action: 'Decide on offer' });
    const hvac = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'HVAC Repair — Plymouth',
      status: 'waiting', priority: 'medium', next_action_date: todayStr, next_action: 'Call contractor' });
    OAD.DB.threads = [digitalAi, hvac];

    OAD._assert(OAD.pressure(digitalAi) > OAD.pressure(hvac), 'sanity check: digitalAi genuinely has higher raw pressure than hvac');

    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'focus should return a thread');
    OAD._assertEqual(focus.id, hvac.id, 'the thread due today should win over a higher-pressure thread due 5 days out');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('selectFocusThread: returns null when nothing is due today or overdue, even if high-pressure future items exist', function () {
  const orig = OAD.DB.threads;
  try {
    const future = new Date(); future.setDate(future.getDate() + 5);
    const futureStr = _localDateStr(future);
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Future critical thread', status: 'stalled', priority: 'critical', next_action_date: futureStr })
    ];
    const focus = OAD.selectFocusThread();
    OAD._assertEqual(focus, null, 'nothing due today/overdue means Focus Now has nothing to recommend right now');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('selectFocusThread: an overdue thread is still selected (date-scoping includes overdue, not just exactly today)', function () {
  const orig = OAD.DB.threads;
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const t = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Overdue thread', status: 'open', priority: 'medium', next_action_date: _localDateStr(yesterday) });
    OAD.DB.threads = [t];
    const focus = OAD.selectFocusThread();
    OAD._assert(!!focus, 'an overdue thread should still be selected, not excluded by date-scoping');
    OAD._assertEqual(focus.id, t.id, 'overdue thread selected');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('selectFutureFocusSuggestion: returns the nearest upcoming item, tie-broken by pressure', function () {
  const orig = OAD.DB.threads;
  try {
    const in3 = new Date(); in3.setDate(in3.getDate() + 3);
    const in5 = new Date(); in5.setDate(in5.getDate() + 5);
    const nearLow  = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Near, low pressure', status: 'open', priority: 'low', next_action_date: _localDateStr(in3) });
    const farHigh  = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Far, high pressure', status: 'stalled', priority: 'critical', next_action_date: _localDateStr(in5) });
    OAD.DB.threads = [farHigh, nearLow];

    const suggestion = OAD.selectFutureFocusSuggestion();
    OAD._assert(!!suggestion, 'should return a suggestion');
    OAD._assertEqual(suggestion.id, nearLow.id, 'nearest date wins over higher pressure further out');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('selectFutureFocusSuggestion: returns null when nothing is upcoming either', function () {
  const orig = OAD.DB.threads;
  try {
    OAD.DB.threads = [];
    OAD._assertEqual(OAD.selectFutureFocusSuggestion(), null, 'no threads at all means no suggestion');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: OAD.todayStr() (Focus Now "due today" one-day-off bug) ──────
// Regression for: Focus Now labeled a next-day thread "due today" in the evening while the
// dashboard/"This Week" list (which already zeroes to local midnight before ISO conversion)
// showed the correct date for the same thread at the same moment. Root cause: plain
// `_localDateStr(new Date())` converts the current instant straight to UTC, which
// rolls to the next calendar date once local time is late enough in the evening — before
// selectFocusThread/selectFutureFocusSuggestion/focusReason were switched to OAD.todayStr(),
// they computed their own unsafe version of this independently.

OAD.test('todayStr: matches the local calendar date, not a raw UTC conversion', function () {
  const now = new Date();
  const expected = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  OAD._assertEqual(OAD.todayStr(), expected, 'todayStr() should equal the local Y-M-D regardless of time of day or UTC offset');
});

OAD.test('todayStr: is stable across repeated calls within the same local day', function () {
  OAD._assertEqual(OAD.todayStr(), OAD.todayStr(), 'two calls in the same test tick should agree');
});

// ── Tests: reopen no longer misfires the closure wizard (Bug 4) ─────────

OAD.test('_saveEditThread: reopening a closed thread does not trigger the closure wizard, even with a stale closing_condition_met checkbox and an active connection', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const blocked = OAD.addThread(OAD.makeThread({ title: 'Blocked target', status: 'open' }));
    const closedThread = OAD.addThread(OAD.makeThread({
      title: 'APEX Pitch Deck (test)', status: 'closed', closing_condition_met: true,
      connections: [{ to_uuid: blocked.uuid, to_label: blocked.title, edge_type: 'blocks' }]
    }));

    OAD._assert(OAD.needsClosureWizard(closedThread.id), 'sanity check: this thread does have an active connection, so the wizard WOULD fire if isClosing misfired true');

    OAD.openEditModal(closedThread.id);
    // Simulate: user changes only the status dropdown to Open, leaves the (still-checked)
    // "closing_condition_met" checkbox alone — exactly the reported reproduction steps.
    document.getElementById('f-status').value = 'open';

    let wizardOpened = false;
    const origOpenWizard = OAD.openClosureWizard;
    OAD.openClosureWizard = function () { wizardOpened = true; };
    try {
      OAD._saveEditThread(closedThread.id);
    } finally {
      OAD.openClosureWizard = origOpenWizard;
    }

    OAD._assert(!wizardOpened, 'closure wizard must not fire when reopening a closed thread');
    OAD._assertEqual(OAD.getThread(closedThread.id).status, 'open', 'the reopen should have actually saved');
    OAD.closeModal();
  } finally {
    OAD.DB.threads = originalThreads;
  }
});

// ── Tests: OAD.Due.buckets (Temporal Mutually Exclusive Buckets) ──────

OAD.test('Due.buckets: correctly separates overdue, today, week, and nodate — today intentionally overlaps overdue', function () {
  const d = function (offset) {
    const dt = new Date(); dt.setDate(dt.getDate() + offset);
    return _localDateStr(dt);
  };

  const todayStr = d(0);
  const in7Str = d(7);

  // 1. Overdue: deadline is before today, or today but overdue by time — NOT next_action_date
  // (per ticket-overdue-filter-fix.md, a waiting thread's next_action_date passing is normal,
  // not overdue). tOverdue1 gets an unrelated past next_action_date (mirrors a real waiting
  // thread with a stale next_action_date and a separately-passed deadline) purely so it lands
  // cleanly in only the overdue bucket for this test, not so it can double as noDate — a thread
  // can legitimately be deadline-overdue with NO next_action_date at all and appear in both
  // overdue and noDate simultaneously, that's a real, valid overlap, just not what this
  // particular assertion is isolating. tOverdue2 carries next_action_date=today so it can
  // double as the today/overdue overlap case below.
  const tOverdue1 = OAD.makeThread({ title: 'Deadline passed yesterday', next_action_date: d(-3), deadline: d(-1) });
  const tOverdue2 = OAD.makeThread({ title: 'Due today AND deadline overdue by time', next_action_date: todayStr, next_action_time: '23:59', deadline: todayStr, deadline_time: '00:01' });

  // 2. Today: next_action_date is today, no deadline at all — must not appear in overdue
  const tToday = OAD.makeThread({ title: 'Due today', next_action_date: todayStr, next_action_time: '23:59' });

  // 3. Week: strictly after today and <= in7Str, no deadline
  const tWeek1 = OAD.makeThread({ title: 'Due tomorrow', next_action_date: d(1) });
  const tWeek7 = OAD.makeThread({ title: 'Due day 7', next_action_date: in7Str });

  // 4. noDate is genuinely "has no date" only — not a catch-all for "beyond the week window"
  // too. A thread due 8 days out isn't in any bucket this function returns; that's correct
  // for a widget scoped to "this week" specifically, not a gap.
  const tNoDate = OAD.makeThread({ title: 'No date', next_action_date: null });
  const tFar = OAD.makeThread({ title: 'Due day 8', next_action_date: d(8) });

  const threads = [tOverdue1, tOverdue2, tToday, tWeek1, tWeek7, tNoDate, tFar];

  // We need to mock OAD.TemporalStatus.isOverdue (the function OAD.Due.buckets actually calls
  // now, per ticket-flowqueue-temporal-and-schema.md) since it depends on the actual current time.
  const origIsOverdue = OAD.TemporalStatus.isOverdue;
  try {
    OAD.TemporalStatus.isOverdue = function(t) {
      if (t === tOverdue1 || t === tOverdue2) return true;
      return false;
    };

    const buckets = OAD.Due.buckets(threads, todayStr, in7Str);

    OAD._assertEqual(buckets.overdue.length, 2, 'overdue bucket has 2 threads — driven by deadline, not next_action_date');
    OAD._assert(buckets.overdue.includes(tOverdue1) && buckets.overdue.includes(tOverdue2), 'overdue bucket contains correct threads');
    OAD._assert(!buckets.overdue.includes(tToday), 'a thread due today with no deadline at all must never appear in overdue');

    // today deliberately does NOT exclude tOverdue2 — it's due today AND deadline-overdue,
    // and hiding it from "today" the moment it crosses into "overdue" would make it disappear
    // from the list a user is actively looking at right when it became urgent.
    OAD._assertEqual(buckets.today.length, 2, 'today bucket has 2 threads — a due-today thread that is also deadline-overdue stays visible in both');
    OAD._assert(buckets.today.includes(tToday) && buckets.today.includes(tOverdue2), 'today bucket contains both the plain due-today thread and the deadline-overdue one');

    OAD._assertEqual(buckets.week.length, 2, 'week bucket has 2 threads');
    OAD._assert(buckets.week.includes(tWeek1) && buckets.week.includes(tWeek7), 'week bucket contains correct threads');

    OAD._assertEqual(buckets.noDate.length, 1, 'nodate bucket has only the truly dateless thread');
    OAD._assert(buckets.noDate.includes(tNoDate), 'nodate bucket contains the dateless thread');
    OAD._assert(!buckets.noDate.includes(tFar), 'a thread due 8 days out is not "no date" — it just isn\'t in any of this function\'s buckets, which is correct for a this-week-scoped view');

  } finally {
    OAD.TemporalStatus.isOverdue = origIsOverdue;
  }
});

OAD.test('Due.buckets: a thread due today AND deadline-overdue appears in both buckets (deliberate, not a bug)', function () {
  // Regression lock for a real incident: an earlier session silently added an exclusion
  // (`&& !isActionOverdue(t)`) to the "today" bucket, reversing this intentional design
  // decision, framed merely as "fixing double counting." No test caught the reversal at the
  // time. This test exists specifically so that can't happen silently again. Updated for the
  // deadline-based overdue signal (ticket-overdue-filter-fix.md) — the overlap is now driven
  // by next_action_date (today bucket) and deadline (overdue bucket) independently, which is
  // actually a more realistic version of the same scenario: a thread can be due today AND have
  // a separately-passed hard deadline at the same time.
  const d = function (offset) {
    const dt = new Date(); dt.setDate(dt.getDate() + offset);
    return _localDateStr(dt);
  };

  const todayStr = d(0);
  const in7Str = d(7);

  const tricky = OAD.makeThread({ title: 'Due today and deadline overdue', next_action_date: todayStr });

  const origIsOverdue = OAD.TemporalStatus.isOverdue;
  try {
    OAD.TemporalStatus.isOverdue = function(t) { return true; };
    const bucketsOverdue = OAD.Due.buckets([tricky], todayStr, in7Str);
    OAD._assertEqual(bucketsOverdue.overdue.length, 1, 'appears in overdue');
    OAD._assertEqual(bucketsOverdue.today.length, 1, 'ALSO appears in today — this is the deliberate overlap, not a bug');
    OAD._assertEqual(bucketsOverdue.week.length, 0, 'never appears in week regardless');

    OAD.TemporalStatus.isOverdue = function(t) { return false; };
    const bucketsToday = OAD.Due.buckets([tricky], todayStr, in7Str);
    OAD._assertEqual(bucketsToday.overdue.length, 0, 'not overdue when deadline is not overdue');
    OAD._assertEqual(bucketsToday.today.length, 1, 'still appears in today');
    OAD._assertEqual(bucketsToday.week.length, 0, 'never appears in week regardless');
  } finally {
    OAD.TemporalStatus.isOverdue = origIsOverdue;
  }
});

// ── Tests: OAD.Due.stalledThreads (ticket-stalled-metric-fix.md) ─────

OAD.test('Due.stalledThreads: a thread with next_action_date in the past appears, regardless of status === "stalled" (dead status, never set)', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);

    const drifted = OAD.makeThread({ id: 1, uuid: 'st-drifted', title: 'Drifted open thread', status: 'open', next_action_date: yStr });
    const notDrifted = OAD.makeThread({ id: 2, uuid: 'st-not-drifted', title: 'Not drifted', status: 'open', next_action_date: todayStr });
    OAD.DB.threads = [drifted, notDrifted];

    const stalled = OAD.Due.stalledThreads();
    OAD._assert(stalled.some(t => t.uuid === 'st-drifted'), 'a thread with a past next_action_date must appear, purely from date drift, no status flag involved');
    OAD._assert(!stalled.some(t => t.uuid === 'st-not-drifted'), 'a thread due today (not yet past) must not appear');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.stalledThreads: excludes closed and dormant even with a past next_action_date', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);

    const closedDrifted = OAD.makeThread({ id: 1, uuid: 'st-closed', title: 'Closed drifted', status: 'closed', next_action_date: yStr });
    const dormantDrifted = OAD.makeThread({ id: 2, uuid: 'st-dormant', title: 'Dormant drifted', status: 'dormant', next_action_date: yStr });
    OAD.DB.threads = [closedDrifted, dormantDrifted];

    const stalled = OAD.Due.stalledThreads();
    OAD._assertEqual(stalled.length, 0, 'closed and dormant threads must never appear regardless of date drift');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.stalledThreads: excludes a waiting thread with user_action_complete ("ball in their court") — matches TOAT tier 3\'s own exclusion', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);

    const ballInCourt = OAD.makeThread({ id: 1, uuid: 'st-ball', title: 'Ball in their court', status: 'waiting', user_action_complete: true, next_action_date: yStr });
    const stillOnMe = OAD.makeThread({ id: 2, uuid: 'st-onme', title: 'Still on me', status: 'waiting', user_action_complete: false, next_action_date: yStr });
    OAD.DB.threads = [ballInCourt, stillOnMe];

    const stalled = OAD.Due.stalledThreads();
    OAD._assert(!stalled.some(t => t.uuid === 'st-ball'), 'a waiting thread with nothing left for the user to do must not read as "needs attention"');
    OAD._assert(stalled.some(t => t.uuid === 'st-onme'), 'a genuinely drifted waiting thread (action still on the user) must appear');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.stalledThreads: sorted oldest-first by next_action_date', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const d = function (offset) { const dt = new Date(); dt.setDate(dt.getDate() + offset); return _localDateStr(dt); };

    const t3 = OAD.makeThread({ id: 1, uuid: 'st-3d', title: '3 days ago', status: 'open', next_action_date: d(-3) });
    const t1 = OAD.makeThread({ id: 2, uuid: 'st-1d', title: '1 day ago', status: 'open', next_action_date: d(-1) });
    const t5 = OAD.makeThread({ id: 3, uuid: 'st-5d', title: '5 days ago', status: 'open', next_action_date: d(-5) });
    OAD.DB.threads = [t3, t1, t5];

    const stalled = OAD.Due.stalledThreads();
    OAD._assertEqual(stalled.map(t => t.uuid).join(','), 'st-5d,st-3d,st-1d', 'must be sorted oldest next_action_date first');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('filterListTab: "stalled" status preset filters to the live drift computation, not a literal status match', function () {
  const orig = OAD.DB.threads;
  const originalStatus = OAD._activeListStatus;
  const originalSearch = OAD._activeListSearch;
  const originalArea = OAD._activeListArea;
  const originalSavedViewId = OAD._activeSavedViewId;
  const mockPanel = document.createElement('div');
  mockPanel.id = 'detail-content';
  document.body.appendChild(mockPanel);

  try {
    const todayStr = OAD.todayStr();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);

    const drifted = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Genuinely drifted thread', status: 'open', next_action_date: yStr });
    const notDrifted = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Not drifted thread', status: 'open', next_action_date: todayStr });
    OAD.DB.threads = [drifted, notDrifted];

    OAD._activeSavedViewId = null;
    OAD._activeListStatus = 'stalled';
    OAD._activeListSearch = '';
    OAD._activeListArea = '';
    OAD.renderListView();

    const html = document.getElementById('list-tab-threads').innerHTML;
    OAD._assert(html.includes('Genuinely drifted thread'), 'the "stalled" preset must show the live-computed drifted thread');
    OAD._assert(!html.includes('Not drifted thread'), 'a non-drifted thread must not appear under the "stalled" preset');
  } finally {
    document.body.removeChild(mockPanel);
    OAD.DB.threads = orig;
    OAD._activeListStatus = originalStatus;
    OAD._activeListSearch = originalSearch;
    OAD._activeListArea = originalArea;
    OAD._activeSavedViewId = originalSavedViewId;
  }
});

// ── Tests: OAD.TemporalStatus (ticket-flowqueue-temporal-and-schema.md, Phase 1) ─────────
// Single source of truth for overdue/due-today/stalled — this is the "actual bulletproofing,"
// per the ticket's own words: any future change that breaks a deadline/next_action_date/status
// combination fails here immediately instead of being found by hand-diffing an export weeks
// later, which is what happened four separate times in one day before this module existed.

OAD.test('OAD.TemporalStatus: full 64-case matrix — deadline x next_action_date x status, each checked against isOverdue/isDueToday/isStalled', function () {
  // Fixed reference moment, not real "now" — this is exactly what makes the module testable
  // without being time-dependent/flaky. Deliberately mid-day (not midnight) so "today" cases
  // have real same-day headroom to be unambiguously not-yet-overdue.
  var today = new Date('2026-07-15T12:00:00');
  var todayStr = '2026-07-15';
  var pastStr = '2026-07-10';
  var futureStr = '2026-07-20';

  var dateValues = { null: null, past: pastStr, today: todayStr, future: futureStr };
  var statuses = ['open', 'waiting', 'dormant', 'closed'];

  var failures = [];
  var caseCount = 0;

  Object.keys(dateValues).forEach(function (deadlineKey) {
    Object.keys(dateValues).forEach(function (nadKey) {
      statuses.forEach(function (status) {
        caseCount++;
        var deadline = dateValues[deadlineKey];
        var next_action_date = dateValues[nadKey];
        var t = OAD.makeThread({
          id: caseCount, uuid: 'matrix-' + caseCount, title: 'matrix case ' + caseCount,
          status: status, deadline: deadline, next_action_date: next_action_date
        });

        var excluded = (status === 'closed' || status === 'dormant');

        var expectedOverdue = !excluded && deadlineKey === 'past';
        var expectedDueToday = !excluded && nadKey === 'today';
        var expectedStalled = !excluded && nadKey === 'past';

        var actualOverdue = OAD.TemporalStatus.isOverdue(t, today);
        var actualDueToday = OAD.TemporalStatus.isDueToday(t, today);
        var actualStalled = OAD.TemporalStatus.isStalled(t, today);

        var label = 'deadline=' + deadlineKey + ' next_action_date=' + nadKey + ' status=' + status;
        if (actualOverdue !== expectedOverdue) failures.push('isOverdue(' + label + '): expected ' + expectedOverdue + ', got ' + actualOverdue);
        if (actualDueToday !== expectedDueToday) failures.push('isDueToday(' + label + '): expected ' + expectedDueToday + ', got ' + actualDueToday);
        if (actualStalled !== expectedStalled) failures.push('isStalled(' + label + '): expected ' + expectedStalled + ', got ' + actualStalled);
      });
    });
  });

  OAD._assertEqual(caseCount, 64, 'matrix must cover exactly 4 x 4 x 4 = 64 cases');
  OAD._assertEqual(failures.length, 0, 'all 64 cases x 3 predicates must match — failures: ' + failures.join(' | '));
});

OAD.test('OAD.TemporalStatus.isOverdue: same-day deadline_time precision preserved (not lost in the Phase 1 consolidation)', function () {
  var today = new Date('2026-07-15T10:00:00');
  var alreadyPassed = OAD.makeThread({ status: 'open', deadline: '2026-07-15', deadline_time: '09:00' });
  var notYetPassed = OAD.makeThread({ status: 'open', deadline: '2026-07-15', deadline_time: '11:00' });
  OAD._assert(OAD.TemporalStatus.isOverdue(alreadyPassed, today), 'a deadline_time of 09:00 must be overdue at 10:00 the same day');
  OAD._assert(!OAD.TemporalStatus.isOverdue(notYetPassed, today), 'a deadline_time of 11:00 must not be overdue yet at 10:00 the same day');
});

OAD.test('OAD.TemporalStatus.isStalled: excludes waiting+user_action_complete ("ball in their court")', function () {
  var today = new Date('2026-07-15T12:00:00');
  var ballInCourt = OAD.makeThread({ status: 'waiting', user_action_complete: true, next_action_date: '2026-07-10' });
  var stillOnMe = OAD.makeThread({ status: 'waiting', user_action_complete: false, next_action_date: '2026-07-10' });
  OAD._assert(!OAD.TemporalStatus.isStalled(ballInCourt, today), 'ball-in-their-court must not read as stalled');
  OAD._assert(OAD.TemporalStatus.isStalled(stillOnMe, today), 'still-on-me must read as stalled');
});

OAD.test('OAD.TemporalStatus.daysUntilDeadline / daysSinceNextActionDate: correct sign and null handling, no status exclusion', function () {
  var today = new Date('2026-07-15T12:00:00');
  OAD._assertEqual(OAD.TemporalStatus.daysUntilDeadline(OAD.makeThread({ deadline: '2026-07-20' }), today), 5, 'future deadline is positive');
  OAD._assertEqual(OAD.TemporalStatus.daysUntilDeadline(OAD.makeThread({ deadline: '2026-07-10' }), today), -5, 'past deadline is negative');
  OAD._assertEqual(OAD.TemporalStatus.daysUntilDeadline(OAD.makeThread({ deadline: null }), today), null, 'no deadline is null');
  OAD._assertEqual(OAD.TemporalStatus.daysSinceNextActionDate(OAD.makeThread({ next_action_date: '2026-07-10' }), today), 5, 'past next_action_date counts days since as positive');
  OAD._assertEqual(OAD.TemporalStatus.daysSinceNextActionDate(OAD.makeThread({ next_action_date: null }), today), null, 'no next_action_date is null');
  // No status exclusion — a closed thread's dates are still real historical facts.
  OAD._assertEqual(OAD.TemporalStatus.daysUntilDeadline(OAD.makeThread({ status: 'closed', deadline: '2026-07-20' }), today), 5, 'daysUntilDeadline ignores status entirely, unlike isOverdue');
});

OAD.test('OAD.TemporalStatus.cardDateLabel: deadline wins when both set; daysRemaining sign is consistent regardless of which field won', function () {
  var today = new Date('2026-07-15T12:00:00');
  var both = OAD.TemporalStatus.cardDateLabel(OAD.makeThread({ deadline: '2026-07-20', next_action_date: '2026-07-10' }), today);
  OAD._assertEqual(both.label, 'deadline', 'deadline wins when both fields are set');
  OAD._assertEqual(both.date, '2026-07-20', 'date matches the winning field');
  OAD._assertEqual(both.daysRemaining, 5, 'daysRemaining reflects the deadline, positive since it is in the future');

  var onlyNad = OAD.TemporalStatus.cardDateLabel(OAD.makeThread({ deadline: null, next_action_date: '2026-07-10' }), today);
  OAD._assertEqual(onlyNad.label, 'next_action_date', 'falls back to next_action_date when no deadline');
  OAD._assertEqual(onlyNad.daysRemaining, -5, 'daysRemaining is negative for a past next_action_date — same sign convention as the deadline case, not inverted');

  var neither = OAD.TemporalStatus.cardDateLabel(OAD.makeThread({ deadline: null, next_action_date: null }), today);
  OAD._assertEqual(neither.label, 'none', 'no dates set at all');
  OAD._assertEqual(neither.daysRemaining, null, 'no daysRemaining when there is no date');
});

OAD.test('OAD.TemporalStatus.dataHygieneWarnings: catches the two real cases found against the 7/11 export (ticket-flowqueue-temporal-and-schema.md acceptance criteria)', function () {
  var today = new Date('2026-07-11T12:00:00');

  // Real case 1: CAC102 Live Session — July 13 (now dormant). deadline 7/13 passed, rescheduled
  // next_action_date is 7/27 — the deadline was simply never updated to match the reschedule.
  var cac102 = OAD.makeThread({ id: 501, uuid: 'cac102-live-03', title: 'CAC102 Live Session — July 13, 2026 7:00pm ET', status: 'dormant', deadline: '2026-07-13', next_action_date: '2026-07-27' });
  var cac102Warnings = OAD.TemporalStatus.dataHygieneWarnings(cac102, today);
  OAD._assert(cac102Warnings.some(w => w.rule === 'next_action_after_deadline'), 'CAC102 case: next_action_date after deadline must be flagged, even though the thread is dormant');

  // Real case 2: ENV-125 Coastal Marine Ecology. deadline 8/6 (comfortably future), next_action_date
  // 7/9 (2 days past today). A card would show a calm "weeks remaining" deadline countdown while
  // masking a genuinely drifted next action.
  var env125 = OAD.makeThread({ id: 502, uuid: 'env125', title: 'ENV-125 Coastal Marine Ecology (CCCC, Gil Newton)', status: 'open', deadline: '2026-08-06', next_action_date: '2026-07-09' });
  var env125Warnings = OAD.TemporalStatus.dataHygieneWarnings(env125, today);
  OAD._assert(env125Warnings.some(w => w.rule === 'drifted_next_action_masked_by_future_deadline'), 'ENV-125 case: a drifted next_action_date behind a comfortable future deadline must be flagged');

  // Structured output, not a bare string — per the audit-log-seed requirement.
  var sample = env125Warnings[0];
  OAD._assert(sample.thread_id === 502 && sample.thread_uuid === 'env125', 'warning must identify which thread');
  OAD._assert(typeof sample.rule === 'string' && typeof sample.message === 'string', 'warning must have a rule id and a human-readable message');
  OAD._assertEqual(sample.checked_against, '2026-07-11', 'warning records what it was checked against, not a live wall-clock read — stays pure/deterministic');
});

OAD.test('OAD.TemporalStatus.dataHygieneWarnings: excludes closed threads, does NOT exclude dormant', function () {
  var today = new Date('2026-07-15T12:00:00');
  var closedBad = OAD.makeThread({ status: 'closed', deadline: '2026-07-10', next_action_date: '2026-07-20' });
  var dormantBad = OAD.makeThread({ status: 'dormant', deadline: '2026-07-10', next_action_date: '2026-07-20' });
  OAD._assertEqual(OAD.TemporalStatus.dataHygieneWarnings(closedBad, today).length, 0, 'closed threads are excluded — old, finished, inconsistent dates are not an actionable data-quality issue');
  OAD._assert(OAD.TemporalStatus.dataHygieneWarnings(dormantBad, today).length > 0, 'dormant threads are NOT excluded — dates are expected to be stale but still worth catching before reactivation');
});

OAD.test('OAD.TemporalStatus.dataHygieneWarnings: flags an open/waiting thread with no dates set at all', function () {
  var today = new Date('2026-07-15T12:00:00');
  var noDates = OAD.makeThread({ status: 'open', deadline: null, next_action_date: null });
  var warnings = OAD.TemporalStatus.dataHygieneWarnings(noDates, today);
  OAD._assert(warnings.some(w => w.rule === 'no_dates_set'), 'a thread with neither date set must be flagged — it can drift forever, invisible everywhere date-based');
});

OAD.test('OAD.TemporalStatus: ownerId scoping — a thread belonging to a different owner returns the "safe negative" from every function', function () {
  var today = new Date('2026-07-15T12:00:00');
  var otherOwnersThread = OAD.makeThread({ status: 'open', deadline: '2026-07-10', next_action_date: '2026-07-10', owner_id: 'some-other-owner' });

  OAD._assert(!OAD.TemporalStatus.isOverdue(otherOwnersThread, today, 'my-owner-id'), 'isOverdue must return false for a mismatched owner');
  OAD._assert(!OAD.TemporalStatus.isDueToday(otherOwnersThread, today, 'my-owner-id'), 'isDueToday must return false for a mismatched owner');
  OAD._assert(!OAD.TemporalStatus.isStalled(otherOwnersThread, today, 'my-owner-id'), 'isStalled must return false for a mismatched owner');
  OAD._assertEqual(OAD.TemporalStatus.daysUntilDeadline(otherOwnersThread, today, 'my-owner-id'), null, 'daysUntilDeadline must return null for a mismatched owner');
  OAD._assertEqual(OAD.TemporalStatus.cardDateLabel(otherOwnersThread, today, 'my-owner-id').label, 'none', 'cardDateLabel must return "none" for a mismatched owner');
  OAD._assertEqual(OAD.TemporalStatus.dataHygieneWarnings(otherOwnersThread, today, 'my-owner-id').length, 0, 'dataHygieneWarnings must return empty for a mismatched owner');

  // No ownerId passed at all = no scoping applied — preserves today's single-tenant behavior.
  OAD._assert(OAD.TemporalStatus.isOverdue(otherOwnersThread, today), 'omitting ownerId entirely must not filter by owner — single-tenant behavior unchanged');

  // Matching owner works normally.
  OAD._assert(OAD.TemporalStatus.isOverdue(otherOwnersThread, today, 'some-other-owner'), 'a matching ownerId must behave identically to no scoping at all');
});

OAD.test('OAD.TemporalStatus: real threads created via OAD.makeThread default to OAD.DEFAULT_OWNER_ID', function () {
  var t = OAD.makeThread({ title: 'Owner default check' });
  OAD._assertEqual(t.owner_id, OAD.DEFAULT_OWNER_ID, 'a freshly created thread must default to the single-tenant owner sentinel');
});

// ── Tests: OAD._che006_staleNextAction unified with OAD.TemporalStatus ────────────────────
// CHE-006 predates threadTemporalStatus.js and was an independent reimplementation of nearly
// the same "stale next action" signal, found and unified afterward (per T.J.'s explicit
// follow-up request). These lock in both what stayed the same and what deliberately changed.

OAD.test('CHE-006: still fires for an open thread with a stale next_action_date and no deadline (unchanged case)', function () {
  var today = new Date('2026-07-15T12:00:00');
  var t = OAD.makeThread({ id: 1, uuid: 'che006-open-nodl', status: 'open', next_action_date: '2026-07-10', deadline: null });
  var alert = OAD._che006_staleNextAction(t, today);
  OAD._assert(!!alert, 'an open thread with a stale next_action_date and no deadline must still fire CHE-006');
  OAD._assertEqual(alert.type, 'CHE-006', 'alert type is CHE-006');
});

OAD.test('CHE-006: still fires for the masking case — stale next_action_date behind a comfortable future deadline (ENV-125)', function () {
  var today = new Date('2026-07-11T12:00:00');
  var t = OAD.makeThread({ id: 2, uuid: 'che006-masked', status: 'open', next_action_date: '2026-07-09', deadline: '2026-08-06' });
  var alert = OAD._che006_staleNextAction(t, today);
  OAD._assert(!!alert, 'the exact ENV-125-shaped case must still fire CHE-006');
});

OAD.test('CHE-006: deliberately widened — now also fires for a genuinely-stuck waiting thread (previously excluded ALL waiting threads outright)', function () {
  var today = new Date('2026-07-15T12:00:00');
  var stuckWaiting = OAD.makeThread({ id: 3, uuid: 'che006-waiting-stuck', status: 'waiting', user_action_complete: false, next_action_date: '2026-07-10', deadline: null });
  var alert = OAD._che006_staleNextAction(stuckWaiting, today);
  OAD._assert(!!alert, 'a waiting thread that is genuinely stuck (action still on the user) must now fire CHE-006 — a deliberate widening from the pre-unification "open only" rule');
});

OAD.test('CHE-006: still correctly excludes a ball-in-their-court waiting thread', function () {
  var today = new Date('2026-07-15T12:00:00');
  var ballInCourt = OAD.makeThread({ id: 4, uuid: 'che006-ball', status: 'waiting', user_action_complete: true, next_action_date: '2026-07-10', deadline: null });
  var alert = OAD._che006_staleNextAction(ballInCourt, today);
  OAD._assert(!alert, 'ball-in-their-court must not fire CHE-006 — isStalled\'s exclusion is preserved through the unification');
});

OAD.test('CHE-006: does not fire when the thread is already deadline-overdue (loud via Overdue Tasks already — "CHE-003 territory")', function () {
  var today = new Date('2026-07-15T12:00:00');
  var alreadyOverdue = OAD.makeThread({ id: 5, uuid: 'che006-already-overdue', status: 'open', next_action_date: '2026-07-10', deadline: '2026-07-12' });
  var alert = OAD._che006_staleNextAction(alreadyOverdue, today);
  OAD._assert(!alert, 'a thread whose deadline has also passed is already prominently visible in Overdue Tasks — a second CHE nudge would be noise, not signal');
});

OAD.test('CHE-006: does not fire for closed or dormant threads', function () {
  var today = new Date('2026-07-15T12:00:00');
  var closedStale = OAD.makeThread({ id: 6, uuid: 'che006-closed', status: 'closed', next_action_date: '2026-07-10', deadline: null });
  var dormantStale = OAD.makeThread({ id: 7, uuid: 'che006-dormant', status: 'dormant', next_action_date: '2026-07-10', deadline: null });
  OAD._assert(!OAD._che006_staleNextAction(closedStale, today), 'closed threads must never fire CHE-006');
  OAD._assert(!OAD._che006_staleNextAction(dormantStale, today), 'dormant threads must never fire CHE-006');
});

OAD.test('OAD.runCHE(): CHE-006 fires correctly end-to-end for a real thread mix, using the unified predicates', function () {
  var orig = OAD.DB.threads;
  var origAlerts = OAD.DB.health_alerts;
  try {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var yesterday = new Date(today.getTime()); yesterday.setDate(yesterday.getDate() - 1);
    var yStr = _localDateStr(yesterday);

    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'run-che-stale', title: 'Stale open thread', status: 'open', next_action_date: yStr, deadline: null }),
      OAD.makeThread({ id: 2, uuid: 'run-che-fine', title: 'Fine thread', status: 'open', next_action_date: OAD.todayStr(), deadline: null })
    ];
    OAD.DB.health_alerts = [];

    OAD.runCHE();
    var che006Alerts = OAD.DB.health_alerts.filter(a => a.type === 'CHE-006');
    OAD._assertEqual(che006Alerts.length, 1, 'exactly one CHE-006 alert should fire for the one genuinely stale thread');
    OAD._assertEqual(che006Alerts[0].suggested_fix.uuid, 'run-che-stale', 'the alert must point at the correct thread');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.health_alerts = origAlerts;
  }
});

// ── Tests: CHE-012/013/014 (Next Action staleness/contradiction detector) ───────────────────

OAD.test('CHE-012: fires when next_action_updated_at predates current_assumption_updated_at', function () {
  var t = OAD.makeThread({ id: 1, uuid: 'che012-stale', status: 'open', next_action_updated_at: '2026-06-01T00:00:00.000Z', current_assumption_updated_at: '2026-07-01T00:00:00.000Z' });
  var alert = OAD._che012_staleNextActionVsAssumption(t);
  OAD._assert(!!alert, 'a next_action older than the current_assumption it should reflect must fire CHE-012');
  OAD._assertEqual(alert.type, 'CHE-012', 'alert type is CHE-012');
});

OAD.test('CHE-012: does not fire when next_action is the same age or newer', function () {
  var t = OAD.makeThread({ id: 1, uuid: 'che012-fresh', status: 'open', next_action_updated_at: '2026-07-01T00:00:00.000Z', current_assumption_updated_at: '2026-06-01T00:00:00.000Z' });
  OAD._assert(!OAD._che012_staleNextActionVsAssumption(t), 'a next_action updated after the current_assumption must not fire');
});

OAD.test('CHE-012: does not fire when either timestamp is unknown (legacy thread) — silence, not a guess', function () {
  var noAssumptionTs = OAD.makeThread({ id: 1, uuid: 'che012-no-assumption-ts', status: 'open', next_action_updated_at: '2026-06-01T00:00:00.000Z', current_assumption_updated_at: null });
  var noActionTs = OAD.makeThread({ id: 2, uuid: 'che012-no-action-ts', status: 'open', next_action_updated_at: null, current_assumption_updated_at: '2026-06-01T00:00:00.000Z' });
  OAD._assert(!OAD._che012_staleNextActionVsAssumption(noAssumptionTs), 'a missing current_assumption_updated_at must not be treated as "always stale"');
  OAD._assert(!OAD._che012_staleNextActionVsAssumption(noActionTs), 'a missing next_action_updated_at must not be treated as "always stale"');
});

OAD.test('CHE-013: fires when closing_condition_type is action and next_action is empty or too short', function () {
  var empty = OAD.makeThread({ id: 1, uuid: 'che013-empty', status: 'open', closing_condition_type: 'action', next_action: '' });
  var tooShort = OAD.makeThread({ id: 2, uuid: 'che013-short', status: 'open', closing_condition_type: 'action', next_action: 'Call' });
  OAD._assert(!!OAD._che013_missingActionStep(empty), 'an empty next_action on an action-type closing thread must fire CHE-013');
  OAD._assert(!!OAD._che013_missingActionStep(tooShort), 'a next_action shorter than the configured floor must fire CHE-013');
});

OAD.test('CHE-013: does not fire for outcome-type closing threads, or when next_action is long enough', function () {
  var outcomeType = OAD.makeThread({ id: 1, uuid: 'che013-outcome', status: 'open', closing_condition_type: 'outcome', next_action: '' });
  var longEnough = OAD.makeThread({ id: 2, uuid: 'che013-long', status: 'open', closing_condition_type: 'action', next_action: 'Call Jake back about the offer' });
  OAD._assert(!OAD._che013_missingActionStep(outcomeType), 'an outcome-type closing condition does not require next_action to be a specific action, so an empty one is not a CHE-013 case');
  OAD._assert(!OAD._che013_missingActionStep(longEnough), 'a real, sufficiently long next_action must not fire');
});

OAD.test('CHE-014: fires when next_action mentions an explicit date far from next_action_date/deadline', function () {
  var t = OAD.makeThread({ id: 1, uuid: 'che014-mismatch', status: 'open', next_action: 'Follow up by 2026-07-01', next_action_date: '2026-08-15', deadline: null });
  var alert = OAD._che014_urgencyContradiction(t);
  OAD._assert(!!alert, 'a next_action text mentioning a date weeks before the actual next_action_date must fire CHE-014');
  OAD._assertEqual(alert.type, 'CHE-014', 'alert type is CHE-014');
});

OAD.test('CHE-014: does not fire when no explicit date is mentioned in next_action (no keyword matching for vague urgency language)', function () {
  var t = OAD.makeThread({ id: 1, uuid: 'che014-vague', status: 'open', next_action: 'This is urgent, needs to happen ASAP', next_action_date: '2026-08-15', deadline: null });
  OAD._assert(!OAD._che014_urgencyContradiction(t), 'vague urgency language with no explicit date must not fire — this rule only catches an explicit date-vs-field contradiction, not keyword-detected urgency tone');
});

OAD.test('CHE-014: does not fire when the mentioned date and the field are close together (under the configured gap)', function () {
  var t = OAD.makeThread({ id: 1, uuid: 'che014-close', status: 'open', next_action: 'Follow up by 2026-08-10', next_action_date: '2026-08-15', deadline: null });
  OAD._assert(!OAD._che014_urgencyContradiction(t), 'a few days of normal slop between the text and the field must not fire');
});

// ── Tests: OAD.exportDevDiagnostic (ticket-dev-diagnostic-export.md) ─────────────────────

OAD.test('exportThreads (the real, moat-safe export) is unaffected by the new DEV export — regression lock', function () {
  const t = OAD.makeThread({ title: 'Moat check', current_assumption: 'Should not leak', status: 'open' });
  OAD.DB.threads = [t];
  const parsed = JSON.parse(OAD.exportThreads());
  const row = parsed.threads.find(x => x.uuid === t.uuid);
  OAD._assert(!('current_assumption' in row), 'the real export must still exclude current_assumption');
  OAD._assert(!('evolution_log' in row), 'the real export must still exclude evolution_log');
  OAD._assert(!('computed_status' in row), 'the real export must never gain computed_status — that is DEV-export-only');
  OAD._assert(!('dev_export' in parsed), 'the real export must not carry the dev_export flag');
});

OAD.test('exportDevDiagnostic: labeled clearly as DEV-only, includes fields the real export deliberately excludes', function () {
  const orig = OAD.DB.threads;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'dev-exp-assump', title: 'Assumption check', status: 'open', current_assumption: 'A real assumption', next_action_date: OAD.todayStr() });
    OAD.DB.threads = [t];
    OAD.addEvolution(t.id, 'A history entry');

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    OAD._assertEqual(parsed.dev_export, true, 'must carry an explicit dev_export flag');
    OAD._assert(parsed.note.indexOf('DEV-ONLY') !== -1, 'note must clearly say DEV-only');

    const row = parsed.threads.find(x => x.uuid === 'dev-exp-assump');
    OAD._assertEqual(row.current_assumption, 'A real assumption', 'current_assumption must be present here, unlike the real export');
    OAD._assert(Array.isArray(row.evolution_log) && row.evolution_log.length > 0, 'evolution_log must be present here');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: contingency_action, contingency_escalation, dormant_trigger, user_action_complete, and stage are present for field-adoption analysis', function () {
  const orig = OAD.DB.threads;
  try {
    const t = OAD.makeThread({
      id: 1, uuid: 'dev-exp-adoption', title: 'Adoption check', status: 'dormant',
      contingency_action: 'Call the backup contact', contingency_escalation: 'Escalate to manager',
      dormant_trigger: 'Re-engage when funding approved', user_action_complete: true, stage: 'interviewing'
    });
    OAD.DB.threads = [t];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const row = parsed.threads.find(x => x.uuid === 'dev-exp-adoption');
    OAD._assertEqual(row.contingency_action, 'Call the backup contact', 'contingency_action must be present here, unlike the real export');
    OAD._assertEqual(row.contingency_escalation, 'Escalate to manager', 'contingency_escalation must be present here, unlike the real export');
    OAD._assertEqual(row.dormant_trigger, 'Re-engage when funding approved', 'dormant_trigger must be present');
    OAD._assertEqual(row.user_action_complete, true, 'user_action_complete must be present');
    OAD._assertEqual(row.stage, 'interviewing', 'stage must be present');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: computed_status per thread matches OAD.TemporalStatus called directly', function () {
  const orig = OAD.DB.threads;
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const t = OAD.makeThread({ id: 1, uuid: 'dev-exp-computed', title: 'Computed status check', status: 'open', next_action_date: _localDateStr(yesterday), deadline: null });
    OAD.DB.threads = [t];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const row = parsed.threads.find(x => x.uuid === 'dev-exp-computed');
    const now = new Date();

    OAD._assertEqual(row.computed_status.is_stalled, OAD.TemporalStatus.isStalled(t, now), 'is_stalled must match a direct call');
    OAD._assertEqual(row.computed_status.is_overdue, OAD.TemporalStatus.isOverdue(t, now), 'is_overdue must match a direct call');
    OAD._assertEqual(row.computed_status.card_date_label.label, OAD.TemporalStatus.cardDateLabel(t, now).label, 'card_date_label must match a direct call');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: data_hygiene_warnings and che_alerts are populated across all threads, not just one example', function () {
  const orig = OAD.DB.threads;
  const origAlerts = OAD.DB.health_alerts;
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);
    const future = new Date(); future.setDate(future.getDate() + 30);

    const masked = OAD.makeThread({ id: 1, uuid: 'dev-hyg-masked', title: 'Masked case', status: 'open', next_action_date: yStr, deadline: _localDateStr(future) });
    const staleOpen = OAD.makeThread({ id: 2, uuid: 'dev-hyg-stale', title: 'Stale open case', status: 'open', next_action_date: yStr, deadline: null });
    OAD.DB.threads = [masked, staleOpen];
    OAD.DB.health_alerts = [];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    OAD._assert(Array.isArray(parsed.data_hygiene_warnings), 'data_hygiene_warnings must be an array');
    OAD._assert(parsed.data_hygiene_warnings.some(w => w.thread_uuid === 'dev-hyg-masked'), 'the masked case must appear in data_hygiene_warnings');

    OAD._assert(Array.isArray(parsed.che_alerts), 'che_alerts must be an array');
    OAD._assert(parsed.che_alerts.some(a => a.thread_uuid === 'dev-hyg-stale' && a.code === 'CHE-006'), 'the stale-open case must produce a CHE-006 alert');
    OAD._assert(parsed.che_alerts.every(a => 'code' in a && 'severity' in a && 'message' in a), 'every CHE alert must have code/severity/message, not just CHE-006');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.health_alerts = origAlerts;
  }
});

OAD.test('exportDevDiagnostic: toat_diagnostic exposes the winner, its tier, and the full ranked candidate list', function () {
  const orig = OAD.DB.threads;
  const origToat = OAD.DB.toat;
  try {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = _localDateStr(yesterday);
    const openStale = OAD.makeThread({ id: 1, uuid: 'toat-diag-open', title: 'Open stale', status: 'open', next_action_date: yStr });
    const waitingStale = OAD.makeThread({ id: 2, uuid: 'toat-diag-waiting', title: 'Waiting stale', status: 'waiting', next_action_date: yStr });
    OAD.DB.threads = [openStale, waitingStale];
    OAD.DB.toat = [];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const diag = parsed.toat_diagnostic;
    OAD._assertEqual(diag.winner.uuid, 'toat-diag-open', 'tier 2 (open) must win over tier 3 (waiting)');
    OAD._assertEqual(diag.winner.tier, 2, 'winner tier must be recorded as 2');
    OAD._assert(diag.candidates.some(c => c.uuid === 'toat-diag-open' && c.tier === 2 && c.won === true), 'the winning candidate must be marked won in the full candidate list');
    OAD._assert(diag.candidates.some(c => c.uuid === 'toat-diag-waiting' && c.tier === 3 && c.won === false), 'the non-winning tier-3 candidate must still appear, marked not won');
  } finally {
    OAD.DB.threads = orig;
    OAD.DB.toat = origToat;
  }
});

OAD.test('exportDevDiagnostic: focus_now_diagnostic exposes the winner\'s pressure and the real top-5 candidate pool', function () {
  const orig = OAD.DB.threads;
  try {
    const todayStr = OAD.todayStr();
    const high = OAD.makeThread({ id: 1, uuid: 'focus-diag-high', title: 'High pressure', status: 'open', priority: 'critical', next_action_date: todayStr, current_assumption: '' });
    const low = OAD.makeThread({ id: 2, uuid: 'focus-diag-low', title: 'Low pressure', status: 'open', priority: 'low', next_action_date: todayStr });
    const notDueYet = OAD.makeThread({ id: 3, uuid: 'focus-diag-future', title: 'Not due yet', status: 'open', priority: 'critical', next_action_date: '2099-01-01' });
    OAD.DB.threads = [high, low, notDueYet];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const diag = parsed.focus_now_diagnostic;
    OAD._assertEqual(diag.winner.uuid, 'focus-diag-high', 'the higher-pressure due-now thread should win Focus Now');
    OAD._assert(diag.winner.pressure > 0, 'winner must carry a real pressure score');
    OAD._assert(!diag.top5.some(c => c.uuid === 'focus-diag-future'), 'a thread not yet due must not appear in the top5 candidate pool, even if its pressure would otherwise be high');
    OAD._assert(diag.top5.length <= 5, 'top5 must never exceed 5 entries');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: this_week_diagnostic reports a real definition and membership matching OAD.Due.dashboardData directly', function () {
  const orig = OAD.DB.threads;
  try {
    const in3 = new Date(); in3.setDate(in3.getDate() + 3);
    const t = OAD.makeThread({ id: 1, uuid: 'week-diag-t1', title: 'Due in 3 days', status: 'open', next_action_date: _localDateStr(in3) });
    OAD.DB.threads = [t];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const diag = parsed.this_week_diagnostic;
    OAD._assert(typeof diag.definition === 'string' && diag.definition.indexOf('next_action_date') !== -1, 'definition must be a real plain-text description mentioning next_action_date');
    OAD._assert(diag.member_uuids.indexOf('week-diag-t1') !== -1, 'the thread due in 3 days must appear in the actual membership list');

    // Cross-check against the real production call directly, not just this export's own claim.
    const todayStr = OAD.todayStr();
    const in7Dt = new Date(); in7Dt.setHours(0, 0, 0, 0); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = in7Dt.toISOString().slice(0, 10);
    const real = OAD.Due.dashboardData(todayStr, in7Str);
    OAD._assertEqual(diag.member_uuids.slice().sort().join(','), real.week.map(x => x.uuid).slice().sort().join(','), 'member_uuids must exactly match a real OAD.Due.dashboardData().week call');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: stale_closed_edges catches a closed thread still blocking a non-closed thread (real smoke-test shape: APEX Guidance case)', function () {
  const orig = OAD.DB.threads;
  try {
    const closedBlocker = OAD.makeThread({
      id: 1, uuid: 'stale-edge-closed', title: 'Closed but still blocking', status: 'closed',
      connections: [{ uuid: 'edge-1', to_uuid: 'stale-edge-open', to_label: 'Open target', edge_type: 'blocks' }]
    });
    const openTarget = OAD.makeThread({ id: 2, uuid: 'stale-edge-open', title: 'Open target', status: 'open' });
    OAD.DB.threads = [closedBlocker, openTarget];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const hit = parsed.stale_closed_edges.find(e => e.thread_uuid === 'stale-edge-closed');
    OAD._assert(!!hit, 'a closed thread with an outbound edge to a non-closed thread must be flagged');
    OAD._assertEqual(hit.to_uuid, 'stale-edge-open', 'must correctly identify the target thread');
    OAD._assertEqual(hit.to_status, 'open', 'must correctly report the target\'s current status');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: stale_closed_edges does not flag a closed thread blocking another closed thread', function () {
  const orig = OAD.DB.threads;
  try {
    const closedBlocker = OAD.makeThread({
      id: 1, uuid: 'stale-edge-closed2', title: 'Closed, blocks another closed', status: 'closed',
      connections: [{ uuid: 'edge-2', to_uuid: 'stale-edge-closed-target', to_label: 'Closed target', edge_type: 'blocks' }]
    });
    const closedTarget = OAD.makeThread({ id: 2, uuid: 'stale-edge-closed-target', title: 'Closed target', status: 'closed' });
    OAD.DB.threads = [closedBlocker, closedTarget];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    OAD._assert(!parsed.stale_closed_edges.some(e => e.thread_uuid === 'stale-edge-closed2'), 'a closed thread blocking another closed thread is not stale — both sides are done');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('exportDevDiagnostic: pressure_distribution, active_threads_by_score, and load_overview match the live console functions directly (ticket-enterprise-mode-and-load-overview.md Part 3)', function () {
  // These were the exact functions hand-typed into devtools to diagnose a live discrepancy — the
  // whole point of Part 3 is that an export file alone must be able to answer the same question.
  const orig = OAD.DB.threads;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'dx-critical', title: 'Critical', status: 'open', priority: 'critical', contingency_trigger_date: OAD.todayStr() }),
      OAD.makeThread({ id: 2, uuid: 'dx-low', title: 'Low', status: 'open', priority: 'low' })
    ];

    const parsed = JSON.parse(OAD.exportDevDiagnostic());
    const liveDist = OAD.Due.pressureDistribution();
    const liveActive = OAD.Due.activeThreads();
    const liveOverview = OAD.Due.loadOverview();

    OAD._assertEqual(JSON.stringify(parsed.pressure_distribution), JSON.stringify(liveDist), 'exported pressure_distribution must match OAD.Due.pressureDistribution() called live');
    OAD._assertEqual(parsed.active_threads_by_score.length, liveActive.length, 'exported active_threads_by_score must include every active thread');
    OAD._assert(parsed.active_threads_by_score.every(function (row) { return 'uuid' in row && 'title' in row && 'score' in row; }), 'each active_threads_by_score row must expose uuid/title/score');
    OAD._assertEqual(parsed.load_overview.criticalPressure.count, liveOverview.criticalPressure.count, 'exported load_overview.criticalPressure must match OAD.Due.loadOverview() called live');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: OAD.Due.criticalLoad / pressureDistribution (ticket-pressure-propagation-and-critical-load.md) ──

OAD.test('Due.criticalLoad: counts open/waiting threads at or above the threshold, defaulting to pressureThresholds.high', function () {
  const orig = OAD.DB.threads;
  try {
    const high = OAD.makeThread({ id: 1, uuid: 'cl-high', title: 'High', status: 'open', priority: 'critical', contingency_trigger_date: OAD.todayStr() });
    const low = OAD.makeThread({ id: 2, uuid: 'cl-low', title: 'Low', status: 'open', priority: 'low' });
    OAD.DB.threads = [high, low];

    const highScore = OAD.pressure(high);
    const result = OAD.Due.criticalLoad();
    OAD._assertEqual(result.threshold, (OAD.Config.pressureThresholds && OAD.Config.pressureThresholds.high) || 60, 'default threshold must come from pressureThresholds.high, not a separate magic number');
    if (highScore >= result.threshold) {
      OAD._assert(result.threadUUIDs.includes('cl-high'), 'a thread at/above threshold must be counted');
    }
    OAD._assert(!result.threadUUIDs.includes('cl-low'), 'a low-priority thread with nothing else driving pressure must not be counted');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.criticalLoad: excludes dormant, inbox, and closed threads even at critical priority', function () {
  const orig = OAD.DB.threads;
  try {
    const dormantCritical = OAD.makeThread({ id: 1, uuid: 'cl-dormant', title: 'Dormant critical', status: 'dormant', priority: 'critical' });
    const closedCritical = OAD.makeThread({ id: 2, uuid: 'cl-closed', title: 'Closed critical', status: 'closed', priority: 'critical' });
    const inboxCritical = OAD.makeThread({ id: 3, uuid: 'cl-inbox', title: 'Inbox critical', status: 'inbox', priority: 'critical' });
    OAD.DB.threads = [dormantCritical, closedCritical, inboxCritical];

    const result = OAD.Due.criticalLoad(0); // threshold 0 so even a base score would count if included
    OAD._assertEqual(result.count, 0, 'dormant/closed/inbox threads must never contribute to Critical Load, regardless of priority');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.criticalLoad: accepts an explicit threshold override', function () {
  const orig = OAD.DB.threads;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'cl-override', title: 'Mid pressure', status: 'open', priority: 'high' });
    OAD.DB.threads = [t];
    const score = OAD.pressure(t);

    const strict = OAD.Due.criticalLoad(score + 1);
    OAD._assertEqual(strict.count, 0, 'a threshold above the thread\'s own score must exclude it');
    const lenient = OAD.Due.criticalLoad(score);
    OAD._assertEqual(lenient.count, 1, 'a threshold at or below the thread\'s own score must include it');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.pressureDistribution: buckets every active thread into exactly one of the four fixed tiers', function () {
  const orig = OAD.DB.threads;
  try {
    const t1 = OAD.makeThread({ id: 1, uuid: 'pd-1', title: 'T1', status: 'open', priority: 'low' });
    const t2 = OAD.makeThread({ id: 2, uuid: 'pd-2', title: 'T2', status: 'waiting', priority: 'low' });
    OAD.DB.threads = [t1, t2];

    const dist = OAD.Due.pressureDistribution();
    const total = dist['80+'] + dist['50-79'] + dist['20-49'] + dist['0-19'];
    OAD._assertEqual(total, 2, 'every active thread must land in exactly one tier — the four tiers must sum to the active thread count');
    OAD._assert('80+' in dist && '50-79' in dist && '20-49' in dist && '0-19' in dist, 'all four fixed tiers must always be present, even at zero');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('Due.pressureDistribution: dormant/inbox/closed threads never appear in any tier', function () {
  const orig = OAD.DB.threads;
  try {
    const dormantHigh = OAD.makeThread({ id: 1, uuid: 'pd-dormant', title: 'Dormant', status: 'dormant', priority: 'critical' });
    OAD.DB.threads = [dormantHigh];

    const dist = OAD.Due.pressureDistribution();
    const total = dist['80+'] + dist['50-79'] + dist['20-49'] + dist['0-19'];
    OAD._assertEqual(total, 0, 'a dormant thread must not appear in any tier, even at critical priority');
  } finally {
    OAD.DB.threads = orig;
  }
});

// ── Tests: OAD.Due.loadOverview / Load Overview UI (ticket-enterprise-mode-and-load-overview.md Part 2) ──
// Replaces the old single "Critical Load" headline (dist['80+'] + dist['50-79'], one number
// standing in for four kinds of urgency) with four distinct counts. These tests lock in (a) that
// each count matches its own single-purpose source function exactly, so the four can never drift
// from each other the way Critical Load itself once drifted from its own tier breakdown (a live
// report: headline read 16, tiers summed to 22), and (b) that all four render together, labeled,
// on every surface that used to show the old single number.

OAD.test('Due.loadOverview: four counts each match their own single-purpose source function exactly', function () {
  const orig = OAD.DB.threads;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'lo-overdue', title: 'Overdue', status: 'open', priority: 'high', deadline: '2000-01-01' }),
      OAD.makeThread({ id: 2, uuid: 'lo-critical', title: 'Critical', status: 'open', priority: 'critical', contingency_trigger_date: OAD.todayStr() }),
      OAD.makeThread({ id: 3, uuid: 'lo-plain', title: 'Plain', status: 'open', priority: 'low' })
    ];

    const overview = OAD.Due.loadOverview();
    const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
    const todayStr = todayDt.toISOString().slice(0, 10);
    const in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = in7Dt.toISOString().slice(0, 10);
    const due = OAD.Due.dashboardData(todayStr, in7Str);

    OAD._assertEqual(overview.overdue.count, due.overdue.length, 'loadOverview.overdue must match dashboardData\'s own overdue bucket exactly');
    OAD._assertEqual(overview.dueThisWeek.count, due.week.length, 'loadOverview.dueThisWeek must match dashboardData\'s own week bucket exactly');
    OAD._assertEqual(overview.stalled.count, OAD.Due.stalledThreads().length, 'loadOverview.stalled must match Due.stalledThreads() exactly');
    OAD._assertEqual(overview.criticalPressure.count, OAD.Due.criticalLoad(80).count, 'loadOverview.criticalPressure must match Due.criticalLoad(80) exactly, not the old 80+/50-79 blend');
  } finally {
    OAD.DB.threads = orig;
  }
});

OAD.test('renderPersonaBar/renderListView/renderDailyView: Load Overview renders Overdue, Stalled, Due This Week, and Critical Pressure together, each matching Due.loadOverview()', function () {
  const origThreads = OAD.DB.threads;
  const origPersona = OAD.DB.persona;
  const panel = document.getElementById('detail-content');
  const bar = document.getElementById('persona-bar');
  const originalPanelHTML = panel ? panel.innerHTML : '';
  const originalBarHTML = bar ? bar.innerHTML : '';
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'crit-headline-1', title: 'Critical one', status: 'open', priority: 'critical', contingency_trigger_date: OAD.todayStr() }),
      OAD.makeThread({ id: 2, uuid: 'crit-headline-2', title: 'Critical two', status: 'waiting', priority: 'high' }),
      OAD.makeThread({ id: 3, uuid: 'crit-headline-3', title: 'Low pressure', status: 'open', priority: 'low' })
    ];
    OAD.DB.persona = { name: 'Test', life_context: { pressure_level: 'moderate', hard_deadline: null } };

    const overview = OAD.Due.loadOverview();
    const findStat = function (root, label) {
      return Array.from(root.querySelectorAll('.persona-stat')).find(function (el) { return el.textContent.indexOf(label) !== -1; });
    };

    if (bar) {
      OAD.renderPersonaBar();
      ['Overdue', 'Stalled', 'Due This Week', 'Critical Pressure'].forEach(function (label) {
        const stat = findStat(bar, label);
        OAD._assert(stat !== undefined, 'renderPersonaBar should render a "' + label + '" stat');
      });
      OAD._assertEqual(findStat(bar, 'Critical Pressure').querySelector('.val').textContent, String(overview.criticalPressure.count), 'renderPersonaBar Critical Pressure must equal loadOverview.criticalPressure.count exactly');
    }

    if (panel) {
      OAD.renderListView();
      ['Overdue', 'Stalled', 'Due This Week', 'Critical Pressure'].forEach(function (label) {
        const stat = findStat(panel, label);
        OAD._assert(stat !== undefined, 'renderListView should render a "' + label + '" stat');
      });
      OAD._assertEqual(findStat(panel, 'Critical Pressure').querySelector('.val').textContent, String(overview.criticalPressure.count), 'renderListView Critical Pressure must equal loadOverview.criticalPressure.count exactly');

      OAD.renderDailyView();
      const findCard = function (label) {
        return Array.from(panel.querySelectorAll('.ds-metric-card')).find(function (el) { return el.textContent.indexOf(label) !== -1; });
      };
      OAD._assert(panel.querySelector('.ds-section-label') !== null && panel.querySelector('.ds-section-label').textContent.indexOf('Load Overview') !== -1, 'renderDailyView should label the section "Load Overview"');
      ['Overdue', 'Stalled', 'Due This Week', 'Critical Pressure'].forEach(function (label) {
        OAD._assert(findCard(label) !== undefined, 'renderDailyView should render a "' + label + '" metric card');
      });
      OAD._assertEqual(findCard('Critical Pressure').querySelector('.ds-metric-value').textContent, String(overview.criticalPressure.count), 'renderDailyView Critical Pressure must equal loadOverview.criticalPressure.count exactly');
    }
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.persona = origPersona;
    if (panel) panel.innerHTML = originalPanelHTML;
    if (bar) bar.innerHTML = originalBarHTML;
  }
});

// ── Tests: OAD.genDailyIntercept (ticket-daily-intercept-content-accuracy.md) ──────────────
// _llmCall is mocked (never hits the network) so these assert on the ACTUAL prompt content sent
// to the model — the false accusation and the fabricated number were both bugs in what gets fed
// in, not in the model's output, so that's what has to be locked down.

OAD.test('genDailyIntercept: a waiting thread with the ball in its own court (user_action_complete) never appears in OVERDUE TASKS or DUE TODAY', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    const pastDate = '2000-01-01';
    const blockedOverdue = OAD.makeThread({
      id: 1, uuid: 'di-blocked-overdue', title: 'SBA VetCert waiting on Federal review',
      status: 'waiting', user_action_complete: true, next_action: 'Wait for SBA', next_action_date: pastDate
    });
    const blockedToday = OAD.makeThread({
      id: 2, uuid: 'di-blocked-today', title: 'Also blocked, due today',
      status: 'waiting', user_action_complete: true, next_action: 'Wait', next_action_date: OAD.todayStr()
    });
    const genuinelyAvoided = OAD.makeThread({
      id: 3, uuid: 'di-avoided', title: 'Genuinely avoided task',
      status: 'open', next_action: 'Call the client back', next_action_date: pastDate
    });
    OAD.DB.threads = [blockedOverdue, blockedToday, genuinelyAvoided];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    OAD._assert(capturedUserMsg.indexOf('SBA VetCert') === -1, 'a waiting thread with user_action_complete must never appear in OVERDUE TASKS — it is correctly left alone, not avoided');
    OAD._assert(capturedUserMsg.indexOf('Also blocked, due today') === -1, 'the same exclusion must apply to DUE TODAY, not just OVERDUE');
    OAD._assert(capturedUserMsg.indexOf('Genuinely avoided task') !== -1, 'a genuinely actionable overdue thread must still appear — the fix must not exclude everything');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: an overdue thread with no real next_action text is excluded even if status/dates would otherwise qualify', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    const noNextAction = OAD.makeThread({
      id: 1, uuid: 'di-no-next-action', title: 'Overdue with blank next action',
      status: 'open', next_action: '', next_action_date: '2000-01-01'
    });
    OAD.DB.threads = [noNextAction];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    // The thread legitimately still appears under "Stalled Threads" (OAD.Due.stalledThreads()
    // doesn't require next_action text, and correctly so — that's a separate, unrelated part of
    // the prompt this ticket didn't touch: `Stalled Threads: ["Overdue with blank next action"]`).
    // What must specifically be excluded is the OVERDUE TASKS agenda line, which is only ever
    // written in the `- [Pressure: N] Title` bullet format — distinct from the quoted JSON-array
    // entry the Stalled Threads line uses.
    OAD._assert(capturedUserMsg.indexOf('] Overdue with blank next action') === -1, 'a thread with no real next action text is not a legitimate avoidance candidate, regardless of dates');
    OAD._assert(capturedUserMsg.indexOf('OVERDUE TASKS:') === -1, 'with no qualifying thread, the OVERDUE TASKS section must not even appear');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: feeds real Load Overview counts, never the old summed/fabricated Day Load Score', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'di-load-1', title: 'Critical', status: 'open', priority: 'critical', contingency_trigger_date: OAD.todayStr() }),
      OAD.makeThread({ id: 2, uuid: 'di-load-2', title: 'Plain', status: 'open', priority: 'low' })
    ];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    const overview = OAD.Due.loadOverview();
    const expectedLine = `Load Overview — Overdue: ${overview.overdue.count}, Stalled: ${overview.stalled.count}, Due This Week: ${overview.dueThisWeek.count}, Critical Pressure: ${overview.criticalPressure.count}`;
    OAD._assert(capturedUserMsg.indexOf(expectedLine) !== -1, 'must feed the real Load Overview counts verbatim, matching OAD.Due.loadOverview() exactly');
    OAD._assert(capturedUserMsg.indexOf('Day Load Score') === -1, 'must not reference the old fabricated Day Load Score label at all');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: the highest-pressure looming task is never also in the OVERDUE/DUE TODAY agenda, and the prompt explicitly forbids using it for focus (MOHELA-shaped bug)', async function () {
  // Real bug this closes: the model generated "Crush MOHELA" as today's focus line by pulling
  // from the HIGHEST PRESSURE LOOMING TASK section (background-only, explicitly "not due today")
  // instead of OVERDUE TASKS/DUE TODAY, even though MOHELA's own next_action_date was weeks out.
  // The two lists are already mutually exclusive by construction (highestLooming explicitly
  // excludes isDueToday/isActionOverdue) — this test locks that invariant in and confirms the
  // prompt itself carries an explicit, unambiguous instruction not to cross the two, since the
  // free-text output can't be validated after the fact.
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'di-mohela-shaped', title: 'MOHELA — Select Repayment Plan', status: 'open', priority: 'critical', next_action_date: '2099-09-01', contingency_trigger_date: OAD.todayStr() })
    ];

    let capturedSystemPrompt = null;
    let capturedUserMsg = null;
    OAD._llmCall = async function (messages, systemPrompt) {
      capturedUserMsg = messages[0].content;
      capturedSystemPrompt = systemPrompt;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    OAD._assert(capturedUserMsg.indexOf('OVERDUE TASKS') === -1, 'a thread due weeks out must not appear in OVERDUE TASKS');
    OAD._assert(capturedUserMsg.indexOf('DUE TODAY') === -1, 'a thread due weeks out must not appear in DUE TODAY either');
    OAD._assert(capturedUserMsg.indexOf('MOHELA') !== -1, 'it must still appear SOMEWHERE — as the highest-pressure looming task, for blind-spot awareness');
    OAD._assert(capturedUserMsg.indexOf('NEVER eligible for') !== -1, 'the looming-task section header itself must carry the explicit exclusion');
    OAD._assert(capturedSystemPrompt.indexOf('OVERDUE TASKS') !== -1 && capturedSystemPrompt.indexOf('DUE TODAY') !== -1, 'the focus field\'s own instruction must name the two eligible sections explicitly');
    OAD._assert(capturedSystemPrompt.toLowerCase().indexOf('never name the looming task') !== -1, 'the focus field\'s instruction must explicitly forbid naming the looming task, not just describe what focus should contain');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: a passed contingency_trigger_date is tagged [CONTINGENCY TRIGGERED] with the real contingency_action, not left for the model to guess at', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    // Real case this reproduces: Orpheus Ocean's contingency ("let it go if no response by
    // July 6") had passed, but the agenda line was just "[Pressure: N] Title" with zero
    // contingency signal, and the model called it a "missed opportunity" instead of "decision
    // already made, needs executing."
    const triggered = OAD.makeThread({
      id: 1, uuid: 'di-ctg-triggered', title: 'Orpheus Ocean — Cold Outreach to Jake Russell',
      status: 'waiting', next_action: 'Follow up sent. If no response, let it go.', next_action_date: '2000-01-01',
      contingency_trigger_date: '2000-01-01', contingency_action: 'Let it go — two unanswered outreaches is the limit'
    });
    OAD.DB.threads = [triggered];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    OAD._assert(capturedUserMsg.indexOf('[CONTINGENCY TRIGGERED: Let it go — two unanswered outreaches is the limit]') !== -1, 'a passed contingency_trigger_date must be tagged with the real contingency_action text, so the model has something real to reason from instead of the title alone');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: a passed contingency_trigger_date with no contingency_action set still gets a generic execute-it tag', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    const t = OAD.makeThread({
      id: 1, uuid: 'di-ctg-no-action', title: 'Triggered but no action text',
      status: 'open', next_action: 'Something', next_action_date: '2000-01-01',
      contingency_trigger_date: '2000-01-01', contingency_action: ''
    });
    OAD.DB.threads = [t];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    OAD._assert(capturedUserMsg.indexOf('[CONTINGENCY TRIGGERED — decision already made, execute it]') !== -1, 'an empty contingency_action must still produce a generic tag, not silently omit the trigger entirely');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('genDailyIntercept: a future contingency_trigger_date gets no tag at all', async function () {
  const origThreads = OAD.DB.threads;
  const origLLMCall = OAD._llmCall;
  try {
    const future = new Date(); future.setDate(future.getDate() + 30);
    const t = OAD.makeThread({
      id: 1, uuid: 'di-ctg-future', title: 'Not triggered yet',
      status: 'open', next_action: 'Something', next_action_date: '2000-01-01',
      contingency_trigger_date: future.toISOString().slice(0, 10), contingency_action: 'Some future action'
    });
    OAD.DB.threads = [t];

    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ focus: 'x', avoidance: 'y', reality_check: 'z' });
    };

    await OAD.genDailyIntercept();

    OAD._assert(capturedUserMsg.indexOf('CONTINGENCY TRIGGERED') === -1, 'a contingency_trigger_date that has not passed yet must not be tagged as triggered');
  } finally {
    OAD.DB.threads = origThreads;
    OAD._llmCall = origLLMCall;
  }
});

// ── Tests: Coach Observation modal (Refute/Accept apostrophe-safety) ───────────────────────
// Real bug this closes: lesson data (LLM-generated natural language — contractions, possessives)
// used to round-trip through encodeURIComponent(JSON.stringify(lesson)) embedded directly in a
// single-quoted onclick attribute. encodeURIComponent doesn't escape apostrophes, so any lesson
// containing one broke the attribute's JS and both buttons silently did nothing — no dismissal,
// no logged pushback, no persona update, no visible error. Same failure mode this file already
// fixed for OAD._pendingPushback/OAD._pendingImport; this modal was missed. Fix moves the pending
// lesson onto OAD._pendingPersonaLesson instead of the DOM string.

OAD.test('_acceptPersonaUpdate: apostrophe-laden lesson content does not break Accept (regression — previously threw a SyntaxError and did nothing)', function () {
  const origPersona = OAD.DB.persona;
  try {
    OAD.DB.persona = { assumption_tendencies: [], what_is_not_working: [] };
    const lesson = {
      warrants_update: true,
      target_list: 'assumption_tendencies',
      proposed_addition: "Tendency to assume it's handled once it's out of their hands",
      coach_message: "You've pushed this back three times."
    };
    OAD.openPersonaUpdateModal(lesson);
    document.querySelector('#modal-overlay .modal-footer button.success').click();

    OAD._assertEqual(OAD.DB.persona.assumption_tendencies.length, 1, 'Accept Update must append the proposed_addition even when it contains apostrophes');
    OAD._assertEqual(OAD.personaTendencyText(OAD.DB.persona.assumption_tendencies[0]), lesson.proposed_addition, 'the appended text must match exactly, read through personaTendencyText since Accept now stores a structured trait object');
    OAD._assertEqual(OAD._pendingPersonaLesson, null, 'pending lesson state must clear after Accept');
  } finally {
    OAD.DB.persona = origPersona;
    OAD.closeModal();
    OAD._pendingPersonaLesson = null;
  }
});

OAD.test('openPersonaUpdateModal: Dismiss clears pending lesson state', function () {
  try {
    OAD.openPersonaUpdateModal({ warrants_update: true, target_list: 'assumption_tendencies', proposed_addition: "Something", coach_message: "Hi" });
    document.querySelector('#modal-overlay .modal-footer button.secondary').click();
    OAD._assertEqual(OAD._pendingPersonaLesson, null, 'Dismiss must clear the pending lesson so a stale one can never be applied by a later, unrelated click');
  } finally {
    OAD.closeModal();
    OAD._pendingPersonaLesson = null;
  }
});

OAD.test('_rebutPersonaUpdate: apostrophe-laden lesson content does not break Refute (regression — previously threw a SyntaxError and did nothing)', async function () {
  const origLLMCall = OAD._llmCall;
  try {
    const lesson = {
      warrants_update: true,
      target_list: 'assumption_tendencies',
      proposed_addition: "Tendency to assume it's handled once it's out of their hands",
      coach_message: "You've pushed this back three times."
    };
    OAD.openPersonaUpdateModal(lesson);
    document.getElementById('coach-rebuttal').value = "Waiting on government bureaucracy, not avoiding it.";

    OAD._llmCall = async function () {
      return JSON.stringify({ conceded: true, coach_response: "Fair — that's out of your control.", warrants_update: false, proposed_addition: "" });
    };

    document.getElementById('rebut-btn').click();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    OAD._assert(document.getElementById('coach-observation-content').innerHTML.indexOf('Fair') !== -1, 'Refute must actually process and render the coach response, not silently fail');
    OAD._assertEqual(OAD._pendingPersonaLesson, null, 'a fully-conceded rebuttal leaves nothing to accept, so pending state must clear');
  } finally {
    OAD._llmCall = origLLMCall;
    OAD.closeModal();
    OAD._pendingPersonaLesson = null;
  }
});

OAD.test('_rebutPersonaUpdate: the revised-update screen (after a warrants_update refute response) has its own working Refute button, not just Dismiss/Accept', async function () {
  const origLLMCall = OAD._llmCall;
  try {
    const lesson = {
      warrants_update: true,
      target_list: 'assumption_tendencies',
      proposed_addition: 'Original observation',
      coach_message: 'Seen a pattern.'
    };
    OAD.openPersonaUpdateModal(lesson);
    document.getElementById('coach-rebuttal').value = 'Partially fair, but consider this context.';

    OAD._llmCall = async function () {
      return JSON.stringify({ conceded: false, coach_response: 'Noted, revising slightly.', warrants_update: true, proposed_addition: 'Revised observation' });
    };
    document.getElementById('rebut-btn').click();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    const revisedRebutBtn = document.getElementById('rebut-btn');
    OAD._assert(revisedRebutBtn !== null, 'the revised-update screen must have its own Refute button, not just Dismiss/Accept');
    OAD._assert(document.getElementById('coach-rebuttal') !== null, 'the revised-update screen must have its own rebuttal textarea to actually use that button');

    // Refute a second time, on the revised screen, using the same handler pattern.
    document.getElementById('coach-rebuttal').value = 'Still missing context.';
    OAD._llmCall = async function () {
      return JSON.stringify({ conceded: true, coach_response: 'Fair, withdrawing entirely.', warrants_update: false, proposed_addition: '' });
    };
    revisedRebutBtn.click();
    await new Promise(function (resolve) { resolve(); });
    await new Promise(function (resolve) { setTimeout(resolve, 0); });

    OAD._assert(document.getElementById('coach-observation-content').innerHTML.indexOf('withdrawing entirely') !== -1, 'the second Refute click must actually process, proving the button on the revised screen is wired, not decorative');
  } finally {
    OAD._llmCall = origLLMCall;
    OAD.closeModal();
    OAD._pendingPersonaLesson = null;
  }
});

// ── Tests: Tendency Evidence Ledger + Promotion Job ─────────────────────────────────────────
// Replaces single-thread "3 pushbacks → propose a permanent persona trait" with a real
// statistical gate. These tests exist specifically to hold the two things pushed back on before
// approval: (1) 'stalled' detection must be OAD.TemporalStatus.isStalled, not a reimplementation;
// (2) evidence_strength must be a real, checkable formula, not a hand-waved number.

OAD.test('logTendencyEvidence: validates eventType and requires a real thread', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Evidence target', life_area: 'Career' }));
  const row = OAD.logTendencyEvidence(t.uuid, 'pushback', 'Waiting on a callback');
  OAD._assert(row !== null, 'a valid thread + eventType must produce a row');
  OAD._assertEqual(row.thread_uuid, t.uuid, 'row must record the thread uuid');
  OAD._assertEqual(row.life_area, 'Career', 'row must record the thread\'s life_area, for clustering');
  OAD._assertEqual(row.excuse_text, 'Waiting on a callback', 'row must record the real excuse text');
  OAD._assertEqual(row.consumed, false, 'a fresh row must start unconsumed');

  OAD._assertEqual(OAD.logTendencyEvidence('not-a-real-uuid', 'pushback', 'x'), null, 'a nonexistent thread must not produce a row');

  let threw = false;
  try { OAD.logTendencyEvidence(t.uuid, 'something_else', 'x'); } catch (e) { threw = true; }
  OAD._assert(threw, 'an unrecognized eventType must throw, not silently accept an undefined category');
});

OAD.test('sweepStalledTendencyEvidence: uses OAD.TemporalStatus.isStalled directly, not a reimplementation', function () {
  const origThreads = OAD.DB.threads;
  const origEvidence = OAD.DB.persona.tendency_evidence;
  try {
    OAD.DB.persona.tendency_evidence = [];
    const stalled = OAD.makeThread({ id: 1, uuid: 'sweep-stalled', title: 'Drifted', status: 'open', next_action_date: '2000-01-01', life_area: 'Career' });
    const notStalled = OAD.makeThread({ id: 2, uuid: 'sweep-fresh', title: 'Fine', status: 'open', next_action_date: OAD.todayStr(), life_area: 'Career' });
    const ballInCourt = OAD.makeThread({ id: 3, uuid: 'sweep-waiting-done', title: 'Ball in their court', status: 'waiting', user_action_complete: true, next_action_date: '2000-01-01', life_area: 'Career' });
    OAD.DB.threads = [stalled, notStalled, ballInCourt];

    OAD.sweepStalledTendencyEvidence();

    const uuids = OAD.DB.persona.tendency_evidence.map(function (e) { return e.thread_uuid; });
    OAD._assertEqual(uuids.indexOf('sweep-stalled') !== -1, true, 'a thread OAD.TemporalStatus.isStalled flags true must get an evidence row');
    OAD._assertEqual(uuids.indexOf('sweep-fresh'), -1, 'a thread with a current next_action_date must not — matches isStalled exactly, not a looser reimplementation');
    OAD._assertEqual(uuids.indexOf('sweep-waiting-done'), -1, 'a waiting+user_action_complete thread must not — same ball-in-their-court exclusion isStalled already has, proving no separate check was written here');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.persona.tendency_evidence = origEvidence;
  }
});

OAD.test('sweepStalledTendencyEvidence: does not re-log the same ongoing stall within the cooldown window', function () {
  const origThreads = OAD.DB.threads;
  const origEvidence = OAD.DB.persona.tendency_evidence;
  try {
    OAD.DB.persona.tendency_evidence = [];
    const t = OAD.makeThread({ id: 1, uuid: 'sweep-cooldown', title: 'Still stalled', status: 'open', next_action_date: '2000-01-01', life_area: 'Career' });
    OAD.DB.threads = [t];

    OAD.sweepStalledTendencyEvidence();
    OAD.sweepStalledTendencyEvidence();
    OAD.sweepStalledTendencyEvidence();

    const rows = OAD.DB.persona.tendency_evidence.filter(function (e) { return e.thread_uuid === 'sweep-cooldown'; });
    OAD._assertEqual(rows.length, 1, 'three sweeps of the same ongoing stall must produce one row, not three — an ongoing fact isn\'t new evidence each time it\'s checked');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.persona.tendency_evidence = origEvidence;
  }
});

// ── Tests: OAD.sweepInboxSentinel (ticket-flowqueue-inbox-triage.md Ticket 1) ──────────────

OAD.test('getInboxThreads: is the single source both the alert banner and the sentinel sweep key off', function () {
  const origThreads = OAD.DB.threads;
  try {
    OAD.DB.threads = [
      OAD.makeThread({ id: 1, uuid: 'gi-1', title: 'A', status: 'inbox' }),
      OAD.makeThread({ id: 2, uuid: 'gi-2', title: 'B', status: 'inbox' }),
      OAD.makeThread({ id: 3, uuid: 'gi-3', title: 'C', status: 'open' })
    ];
    OAD._assertEqual(OAD.getInboxThreads().length, 2, 'must return exactly the status:inbox threads');
    const uuids = OAD.getInboxThreads().map(function (t) { return t.uuid; });
    OAD._assert(uuids.indexOf('gi-1') !== -1 && uuids.indexOf('gi-2') !== -1 && uuids.indexOf('gi-3') === -1, 'must include only inbox threads');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: creates a sentinel with medium priority for a fresh (0-1 day old) inbox', function () {
  const origThreads = OAD.DB.threads;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'sis-fresh', title: 'Fresh', status: 'inbox' });
    t.created_at = new Date().toISOString();
    OAD.DB.threads = [t];

    OAD.sweepInboxSentinel();
    const sentinel = OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID);
    OAD._assert(!!sentinel, 'a sentinel thread must be created when the inbox is non-empty');
    OAD._assertEqual(sentinel.priority, 'medium', 'a fresh inbox (0-1 days) must read medium priority');
    OAD._assertEqual(sentinel.life_area, 'System', 'sentinel must use the System life_area');
    OAD._assertEqual(sentinel.parent_uuid, null, 'sentinel must be top-level so it is never suppressed by the bollard rule');
    OAD._assertEqual(sentinel.title, 'Inbox needs triage (1 item)', 'title must reflect the live count');
    OAD._assertEqual(sentinel.next_action_date, OAD.todayStr(), 'next_action_date must be today');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: escalates priority as the OLDEST item ages past each threshold, using the age of the item, not the sentinel', function () {
  const origThreads = OAD.DB.threads;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'sis-age', title: 'Aging item', status: 'inbox' });
    t.created_at = new Date().toISOString();
    OAD.DB.threads = [t];

    OAD.sweepInboxSentinel();
    OAD._assertEqual(OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID).priority, 'medium', 'fresh must read medium');

    const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    t.created_at = threeDaysAgo.toISOString();
    OAD.sweepInboxSentinel();
    OAD._assertEqual(OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID).priority, 'high', '3 days old (past overdueMinDays=2) must escalate to high');

    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    t.created_at = fiveDaysAgo.toISOString();
    OAD.sweepInboxSentinel();
    OAD._assertEqual(OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID).priority, 'critical', '5 days old (past criticalMinDays=4) must escalate to critical');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: oldest-age falls back from created_at to evolution_log[0].date when created_at is null (real legacy-data shape)', function () {
  const origThreads = OAD.DB.threads;
  try {
    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const dateStr = fiveDaysAgo.toISOString().slice(0, 10);
    const t = OAD.makeThread({ id: 1, uuid: 'sis-legacy', title: 'Legacy item', status: 'inbox' });
    t.created_at = null; // confirmed real shape: every current live inbox thread has this
    t.evolution_log = [{ date: dateStr, note: 'Captured via Quick Add.' }];
    OAD.DB.threads = [t];

    OAD.sweepInboxSentinel();
    OAD._assertEqual(OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID).priority, 'critical', 'must use evolution_log[0].date when created_at is null, not treat the item as age 0');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: T.J.\'s specific scenario — triaging the oldest item and capturing a new one same-day resets escalation entirely, no carry-forward', function () {
  const origThreads = OAD.DB.threads;
  try {
    const fiveDaysAgo = new Date(); fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const old = OAD.makeThread({ id: 1, uuid: 'sis-old', title: 'Old', status: 'inbox' });
    old.created_at = fiveDaysAgo.toISOString();
    OAD.DB.threads = [old];
    OAD.sweepInboxSentinel();
    OAD._assertEqual(OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID).priority, 'critical', 'sanity check: old item alone reads critical');

    OAD.updateThread(old.id, { status: 'closed', closing_condition_met: true });
    const fresh = OAD.addThread(OAD.makeThread({ id: 2, uuid: 'sis-fresh2', title: 'Fresh replacement', status: 'inbox' }));
    fresh.created_at = new Date().toISOString();

    OAD.sweepInboxSentinel();
    const sentinel = OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID);
    OAD._assertEqual(sentinel.priority, 'medium', 'triaging the old item and replacing it same-day must read exactly like a fresh Day-1 state, not carry forward the prior escalation');
    OAD._assertEqual(sentinel.title, 'Inbox needs triage (1 item)', 'title must reflect only the current inbox, not historical items');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: closes the sentinel when the inbox empties, and reopens fresh (not re-escalated) if items land again', function () {
  const origThreads = OAD.DB.threads;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'sis-close', title: 'Only item', status: 'inbox' });
    t.created_at = new Date().toISOString();
    OAD.DB.threads = [t];
    OAD.sweepInboxSentinel();
    OAD._assert(!!OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID), 'sanity check: sentinel exists while inbox is non-empty');

    OAD.updateThread(t.id, { status: 'closed', closing_condition_met: true });
    OAD.sweepInboxSentinel();
    let sentinel = OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID);
    OAD._assertEqual(sentinel.status, 'closed', 'sentinel must close when the inbox is empty');
    OAD._assertEqual(sentinel.closing_condition_met, true, 'closing_condition_met must be set');
    OAD._assertEqual(sentinel.evolution_log[sentinel.evolution_log.length - 1].note, 'Inbox cleared, sentinel auto-closed.', 'must log the auto-close note');

    const t2 = OAD.addThread(OAD.makeThread({ id: 2, uuid: 'sis-reopen', title: 'New item', status: 'inbox' }));
    t2.created_at = new Date().toISOString();
    OAD.sweepInboxSentinel();
    sentinel = OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID);
    OAD._assertEqual(sentinel.status, 'open', 'sentinel must reopen once the inbox has items again');
    OAD._assertEqual(sentinel.priority, 'medium', 'reopened sentinel must read fresh (medium), not resume any prior escalation');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('sweepInboxSentinel: updating an existing sentinel never routes through updateThread/addThread (reentrancy guard)', function () {
  // The real risk: updateThread/addThread call OAD._runAfterSave, which is what the debounced
  // sweepInboxSentinel registration (js/data.js) hooks into — so if the sentinel's own update
  // path used updateThread, every sweep would schedule another sweep of itself. Spy on both to
  // prove the "existing sentinel" branch mutates directly + saveDB() instead.
  const origThreads = OAD.DB.threads;
  const origUpdateThread = OAD.updateThread;
  const origAddThread = OAD.addThread;
  try {
    const t = OAD.makeThread({ id: 1, uuid: 'sis-reentrant', title: 'Item', status: 'inbox' });
    t.created_at = new Date().toISOString();
    OAD.DB.threads = [t];
    OAD.sweepInboxSentinel(); // create path — legitimately uses addThread once
    OAD._assert(!!OAD.getThreadByUUID(OAD._INBOX_SENTINEL_UUID), 'sanity check: sentinel created');

    let updateThreadCalls = 0, addThreadCalls = 0;
    OAD.updateThread = function () { updateThreadCalls++; return origUpdateThread.apply(this, arguments); };
    OAD.addThread = function () { addThreadCalls++; return origAddThread.apply(this, arguments); };
    try {
      OAD.sweepInboxSentinel(); // update path
      OAD._assertEqual(updateThreadCalls, 0, 'updating an existing sentinel must never call OAD.updateThread — that would re-trigger the debounced sweep on itself');
      OAD._assertEqual(addThreadCalls, 0, 'updating an existing sentinel must never call OAD.addThread — creation only happens once');
    } finally {
      OAD.updateThread = origUpdateThread;
      OAD.addThread = origAddThread;
    }
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('tendencyEvidenceStrength: exactly at the gate reads 0.5; at 2x every dimension reads 1.0', function () {
  const thresholds = { minOccurrences: 3, minDistinctThreads: 2, minSpanDays: 14 };
  OAD._assertEqual(OAD.tendencyEvidenceStrength(3, 2, 14, thresholds), 0.5, 'exactly at the minimum on all three dimensions must read 0.5 — "just cleared the bar," not falsely precise');
  OAD._assertEqual(OAD.tendencyEvidenceStrength(6, 4, 28, thresholds), 1.0, 'double every threshold must saturate at 1.0');
  OAD._assertEqual(OAD.tendencyEvidenceStrength(100, 50, 500, thresholds), 1.0, 'far beyond double must not exceed 1.0 — more doesn\'t mean truer past saturation');
});

OAD.test('tendencyEvidenceStrength: the weakest dimension caps the score (min, not average)', function () {
  const thresholds = { minOccurrences: 3, minDistinctThreads: 2, minSpanDays: 14 };
  // Huge on occurrences and span, but distinct_thread_count sits exactly at the floor — this is
  // precisely the "one hard thread, not a real tendency" case the redesign exists to catch.
  const strength = OAD.tendencyEvidenceStrength(50, 2, 200, thresholds);
  OAD._assertEqual(strength, 0.5, 'a weak distinct-thread-count must cap the whole score at its own ratio (0.5), not get averaged up by the other two strong dimensions');
});

OAD.test('evaluateTendencyCandidates: gates on ALL three thresholds independently, and groups by life_area', function () {
  const origThreads = OAD.DB.threads;
  const origEvidence = OAD.DB.persona.tendency_evidence;
  try {
    OAD.DB.threads = [
      OAD.addThread(OAD.makeThread({ title: 'A', life_area: 'Career' })),
      OAD.addThread(OAD.makeThread({ title: 'B', life_area: 'Career' }))
    ];
    const [a, b] = OAD.DB.threads.slice(-2);

    // Case 1: enough occurrences, but only ONE distinct thread — must not clear the gate.
    OAD.DB.persona.tendency_evidence = [
      { id: '1', thread_uuid: a.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-01', excuse_text: 'x', consumed: false },
      { id: '2', thread_uuid: a.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-15', excuse_text: 'y', consumed: false },
      { id: '3', thread_uuid: a.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-07-01', excuse_text: 'z', consumed: false }
    ];
    OAD._assertEqual(OAD.evaluateTendencyCandidates().length, 0, 'one thread repeating three times must not clear minDistinctThreads — that\'s a thread problem, not a tendency');

    // Case 2: enough distinct threads and occurrences, but all inside one week — must not clear.
    OAD.DB.persona.tendency_evidence = [
      { id: '1', thread_uuid: a.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-01', excuse_text: 'x', consumed: false },
      { id: '2', thread_uuid: b.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-03', excuse_text: 'y', consumed: false },
      { id: '3', thread_uuid: a.uuid, life_area: 'Career', event_type: 'stalled', date: '2026-06-05', excuse_text: '', consumed: false }
    ];
    OAD._assertEqual(OAD.evaluateTendencyCandidates().length, 0, 'three occurrences clustered inside one week must not clear minSpanDays — one hard week, not a standing tendency');

    // Case 3: clears all three — must produce exactly one candidate with correct stats.
    OAD.DB.persona.tendency_evidence = [
      { id: '1', thread_uuid: a.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-01', excuse_text: 'Waiting on a callback', consumed: false },
      { id: '2', thread_uuid: b.uuid, life_area: 'Career', event_type: 'pushback', date: '2026-06-20', excuse_text: 'Forgot to follow up', consumed: false },
      { id: '3', thread_uuid: a.uuid, life_area: 'Career', event_type: 'stalled', date: '2026-07-01', excuse_text: '', consumed: false }
    ];
    const candidates = OAD.evaluateTendencyCandidates();
    OAD._assertEqual(candidates.length, 1, 'a cluster clearing all three thresholds must produce exactly one candidate');
    OAD._assertEqual(candidates[0].life_area, 'Career', 'candidate must be grouped by life_area');
    OAD._assertEqual(candidates[0].occurrence_count, 3, 'occurrence_count must equal the row count');
    OAD._assertEqual(candidates[0].distinct_thread_count, 2, 'distinct_thread_count must count unique thread_uuids, not rows');
    OAD._assertEqual(candidates[0].span_days, 30, 'span_days must be first-to-last, in days');
    OAD._assertEqual(candidates[0].excuse_texts.length, 2, 'excuse_texts must include only non-empty excuses (the mechanical stall row has none)');

    // Case 4: already-consumed evidence must not count toward a new candidate.
    OAD.DB.persona.tendency_evidence.forEach(function (e) { e.consumed = true; });
    OAD._assertEqual(OAD.evaluateTendencyCandidates().length, 0, 'consumed evidence must be excluded — an already-surfaced cluster must not re-propose on its own');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.persona.tendency_evidence = origEvidence;
  }
});

OAD.test('personaTendencyText: reads .text from a structured entry and returns a plain string entry unchanged', function () {
  OAD._assertEqual(OAD.personaTendencyText('a plain legacy string'), 'a plain legacy string', 'a plain string entry must pass through unchanged');
  OAD._assertEqual(OAD.personaTendencyText({ text: 'a structured entry', source: 'auto-promoted' }), 'a structured entry', 'a structured entry must yield its .text');
  OAD._assertEqual(OAD.personaTendencyText(null), '', 'a null/missing entry must not throw');
});

OAD.test('reconcilePersonaTendencyList: preserves structured metadata on unchanged entries, adds new manual lines, drops removed ones', function () {
  const structured = { text: 'Tendency to let external threads drift', source: 'auto-promoted', evidence_strength: 0.75, evidence_thread_uuids: ['a', 'b'] };
  const existing = [structured, 'a plain legacy string', 'a line about to be deleted'];

  const result = OAD.reconcilePersonaTendencyList(existing, 'Tendency to let external threads drift\na plain legacy string\na brand new manual line');

  OAD._assert(result.indexOf(structured) !== -1, 'the structured entry must be the SAME object (metadata preserved), not flattened to a string, since its text is unchanged');
  OAD._assert(result.indexOf('a plain legacy string') !== -1, 'an unchanged plain-string entry must be preserved as-is');
  OAD._assert(!result.some(function (e) { return OAD.personaTendencyText(e) === 'a line about to be deleted'; }), 'a line removed from the textarea must be dropped, not silently kept');
  const added = result.find(function (e) { return OAD.personaTendencyText(e) === 'a brand new manual line'; });
  OAD._assert(added && typeof added === 'object' && added.source === 'manual', 'a genuinely new line must become a structured entry tagged source:"manual"');
});

OAD.test('_savePersona: saving for an unrelated reason (Pressure Level) does not flatten an existing structured trait', function () {
  const origPersona = OAD.DB.persona;
  try {
    const structuredTrait = { text: 'Existing auto-promoted trait', source: 'auto-promoted', evidence_strength: 0.6, evidence_thread_uuids: ['x'] };
    OAD.DB.persona = Object.assign({}, origPersona, {
      assumption_tendencies: [structuredTrait],
      what_is_not_working: [],
      what_is_working: [],
      life_context: { pressure_level: 'moderate', hard_deadline: null, hard_deadline_context: '' },
      tone_calibration: { challenge_tolerance: 'medium', current_mode: 'problem-solving', avoid_patterns: [] }
    });
    OAD.openPersonaModal();
    document.getElementById('f-pressure-level').value = 'high';
    OAD._savePersona();

    OAD._assertEqual(OAD.DB.persona.assumption_tendencies.length, 1, 'the trait must still be present after an unrelated save');
    OAD._assertEqual(OAD.DB.persona.assumption_tendencies[0].evidence_strength, 0.6, 'evidence_strength must survive an unrelated Persona Settings save, not get flattened to a bare string');
  } finally {
    OAD.closeModal();
    OAD.DB.persona = origPersona;
  }
});

OAD.test('_confirmPushback: logs the "Real Blocking Reason" text as pushback evidence, giving it a real structured home', function () {
  const origThreads = OAD.DB.threads;
  const origEvidence = OAD.DB.persona.tendency_evidence;
  try {
    OAD.DB.persona.tendency_evidence = [];
    const t = OAD.addThread(OAD.makeThread({ title: 'Pushback evidence target', status: 'open', life_area: 'Finances', next_action_date: OAD.todayStr() }));

    OAD._pendingPushback = { id: t.id, data: { status: 'open', next_action_date: OAD.todayStr() }, notes: [] };
    OAD.openModal('<textarea id="f-pushback-reason">Waiting on the bank, not avoiding it.</textarea>');

    OAD._confirmPushback();

    const rows = OAD.DB.persona.tendency_evidence.filter(function (e) { return e.thread_uuid === t.uuid; });
    OAD._assertEqual(rows.length, 1, 'confirming a pushback must log exactly one evidence row for that thread');
    OAD._assertEqual(rows[0].event_type, 'pushback', 'the row must be tagged as a pushback event');
    OAD._assertEqual(rows[0].excuse_text, 'Waiting on the bank, not avoiding it.', 'excuse_text must be the actual Real Blocking Reason text, verbatim');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.persona.tendency_evidence = origEvidence;
    OAD._pendingPushback = null;
    OAD.closeModal();
  }
});

OAD.test('characterizeTendencyCluster: sends real occurrence/thread/span counts and excuse text, and reads mixed string/object persona lists safely', async function () {
  const origLLMCall = OAD._llmCall;
  const origPersona = OAD.DB.persona.assumption_tendencies;
  try {
    OAD.DB.persona.assumption_tendencies = ['a legacy string entry', { text: 'a structured entry', source: 'auto-promoted' }];
    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ warrants_update: true, target_list: 'assumption_tendencies', proposed_addition: 'x', suggested_adjustment: 'y', coach_message: 'z' });
    };

    const candidate = {
      life_area: 'Career', occurrence_count: 4, distinct_thread_count: 3, span_days: 21,
      first_observed: '2026-06-01', last_observed: '2026-06-22',
      excuse_texts: ['Waiting on a callback', 'Forgot to follow up']
    };
    await OAD.characterizeTendencyCluster(candidate);

    OAD._assert(capturedUserMsg.indexOf('Career') !== -1, 'prompt must include the life_area');
    OAD._assert(capturedUserMsg.indexOf('4') !== -1, 'prompt must include the real occurrence count');
    OAD._assert(capturedUserMsg.indexOf('Waiting on a callback') !== -1, 'prompt must include the real excuse text collected across the cluster');
    OAD._assert(capturedUserMsg.indexOf('a legacy string entry') !== -1 && capturedUserMsg.indexOf('a structured entry') !== -1, 'must render both legacy string and structured object persona entries as clean text, not [object Object]');
  } finally {
    OAD._llmCall = origLLMCall;
    OAD.DB.persona.assumption_tendencies = origPersona;
  }
});

// ── Tests: OAD.classifyQuickCaptureDeadline / Quick Add deadline prompt (ticket-flowqueue-inbox-triage.md Ticket 2) ──

OAD.test('classifyQuickCaptureDeadline: sends the real title and returns true when the model says has_deadline', async function () {
  const origLLMCall = OAD._llmCall;
  try {
    let capturedUserMsg = null;
    OAD._llmCall = async function (messages) {
      capturedUserMsg = messages[0].content;
      return JSON.stringify({ has_deadline: true, reasoning: 'implies an RSVP' });
    };
    const result = await OAD.classifyQuickCaptureDeadline('Ameer birthday');
    OAD._assertEqual(result, true, 'must resolve true when the model says has_deadline: true');
    OAD._assert(capturedUserMsg.indexOf('Ameer birthday') !== -1, 'prompt must include the real captured title');
  } finally {
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('classifyQuickCaptureDeadline: returns false when the model says no', async function () {
  const origLLMCall = OAD._llmCall;
  try {
    OAD._llmCall = async function () { return JSON.stringify({ has_deadline: false, reasoning: 'a routine errand, no real date pressure' }); };
    const result = await OAD.classifyQuickCaptureDeadline('Mid July - check in on Limpies');
    OAD._assertEqual(result, false, 'must resolve false when the model says has_deadline: false');
  } finally {
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('classifyQuickCaptureDeadline: fails closed (false) on a malformed response or a thrown error, never surfaces an error to the caller', async function () {
  const origLLMCall = OAD._llmCall;
  try {
    OAD._llmCall = async function () { return 'not valid json at all'; };
    OAD._assertEqual(await OAD.classifyQuickCaptureDeadline('Something'), false, 'malformed JSON must resolve false, not throw');

    OAD._llmCall = async function () { throw new Error('network down'); };
    OAD._assertEqual(await OAD.classifyQuickCaptureDeadline('Something else'), false, 'a thrown error must resolve false, not propagate — a classifier hiccup must never surface as a visible error mid-capture');
  } finally {
    OAD._llmCall = origLLMCall;
  }
});

OAD.test('submitQuickAdd: capture stays synchronous and instant — thread is saved and input cleared before the deadline classifier ever resolves', function () {
  // OAD.submitQuickAdd calls the real OAD.refreshActiveView(), which re-renders #main from
  // whatever OAD.DB.threads/OAD._lastView happen to be at that moment — save/restore the whole
  // container, same principle as the renderPersonaBar/renderListView/renderDailyView Load
  // Overview test above, so this test's fixture data never leaks into the real rendered page.
  const main = document.getElementById('main');
  const originalMainHTML = main ? main.innerHTML : '';
  const input = document.getElementById('quick-add-input');
  const origDisabled = input.disabled;
  const origThreads = OAD.DB.threads;
  const origClassify = OAD.classifyQuickCaptureDeadline;
  const origApiKey = OAD.API_KEY;
  try {
    input.disabled = false;
    input.value = 'Sync test capture';
    OAD.DB.threads = [];
    OAD.API_KEY = 'test-key';
    let classifyCalled = false;
    OAD.classifyQuickCaptureDeadline = function () { classifyCalled = true; return new Promise(function () {}); }; // never resolves

    OAD.submitQuickAdd();

    OAD._assertEqual(OAD.DB.threads.length, 1, 'the thread must already be saved synchronously');
    OAD._assertEqual(input.value, '', 'the input must already be cleared synchronously, not waiting on the classifier');
    OAD._assert(classifyCalled, 'the classifier must have been invoked (fire-and-forget), just not awaited');
  } finally {
    input.disabled = origDisabled;
    input.value = '';
    OAD.DB.threads = origThreads;
    OAD.classifyQuickCaptureDeadline = origClassify;
    OAD.API_KEY = origApiKey;
    if (main) main.innerHTML = originalMainHTML;
  }
});

OAD.test('submitQuickAdd: when the classifier resolves true, the inline deadline prompt appears near the Quick Add input', async function () {
  const main = document.getElementById('main');
  const originalMainHTML = main ? main.innerHTML : '';
  const input = document.getElementById('quick-add-input');
  const origDisabled = input.disabled;
  const origThreads = OAD.DB.threads;
  const origClassify = OAD.classifyQuickCaptureDeadline;
  const origApiKey = OAD.API_KEY;
  try {
    input.disabled = false;
    input.value = 'Ameer birthday';
    OAD.DB.threads = [];
    OAD.API_KEY = 'test-key';
    OAD.classifyQuickCaptureDeadline = async function () { return true; };

    OAD.submitQuickAdd();
    await new Promise(function (r) { setTimeout(r, 0); }); // let the fire-and-forget promise settle

    const prompt = document.getElementById('quick-add-deadline-prompt');
    OAD._assert(!!prompt, 'the inline "Does this have a deadline?" prompt must appear when the classifier says yes');
  } finally {
    const p = document.getElementById('quick-add-deadline-prompt');
    if (p) p.remove();
    input.disabled = origDisabled;
    input.value = '';
    OAD.DB.threads = origThreads;
    OAD.classifyQuickCaptureDeadline = origClassify;
    OAD.API_KEY = origApiKey;
    if (main) main.innerHTML = originalMainHTML;
  }
});

OAD.test('_saveQuickCaptureDeadline: writes deadline and a next_action_date with real lead time, never equal to the deadline (CHE-002)', function () {
  const origThreads = OAD.DB.threads;
  document.body.insertAdjacentHTML('beforeend', '<input type="date" id="quick-add-deadline-date" value="2026-08-01">');
  try {
    const t = OAD.addThread(OAD.makeThread({ title: 'Deadline entry test', status: 'inbox' }));
    OAD._saveQuickCaptureDeadline(t.id);
    const updated = OAD.getThread(t.id);
    OAD._assertEqual(updated.deadline, '2026-08-01', 'deadline must be written as entered');
    OAD._assert(!!updated.next_action_date, 'a next_action_date must be set, not left blank');
    OAD._assert(updated.next_action_date < updated.deadline, 'next_action_date must have real lead time before the deadline, never equal to it');
  } finally {
    document.getElementById('quick-add-deadline-date')?.remove();
    OAD.DB.threads = origThreads;
  }
});

OAD.test('_skipQuickCaptureDeadline: flags the thread without writing any date, so the signal is not silently dropped', function () {
  const origThreads = OAD.DB.threads;
  const t = OAD.addThread(OAD.makeThread({ title: 'Skip test', status: 'inbox' }));
  try {
    OAD._skipQuickCaptureDeadline(t.id);
    const updated = OAD.getThread(t.id);
    OAD._assertEqual(updated.deadline_check_skipped, true, 'deadline_check_skipped must be set');
    OAD._assertEqual(updated.next_action_date, '', 'skipping must not write any date');
    OAD._assertEqual(updated.deadline, null, 'skipping must not write any date');
  } finally {
    OAD.DB.threads = origThreads;
  }
});

OAD.test('dataHygieneWarnings: quick_capture_deadline_skipped fires for a skipped, still-dateless inbox thread — reads differently from a plain no_dates_set item', function () {
  const skipped = OAD.makeThread({ id: 1, uuid: 'dhw-skipped', title: 'Skipped', status: 'inbox', deadline_check_skipped: true });
  const warnings = OAD.TemporalStatus.dataHygieneWarnings(skipped, new Date(), OAD.DEFAULT_OWNER_ID);
  OAD._assert(warnings.some(function (w) { return w.rule === 'quick_capture_deadline_skipped'; }), 'a skipped, still-dateless thread must carry the quick_capture_deadline_skipped warning');
});

OAD.test('dataHygieneWarnings: quick_capture_deadline_skipped does not fire once a real date has been entered', function () {
  const resolved = OAD.makeThread({ id: 1, uuid: 'dhw-resolved', title: 'Resolved', status: 'open', deadline_check_skipped: true, deadline: '2026-08-01', next_action_date: '2026-07-29' });
  const warnings = OAD.TemporalStatus.dataHygieneWarnings(resolved, new Date(), OAD.DEFAULT_OWNER_ID);
  OAD._assert(!warnings.some(function (w) { return w.rule === 'quick_capture_deadline_skipped'; }), 'once real dates exist, the skipped flag must stop firing — it is stale signal at that point');
});

OAD.test('_acceptPersonaUpdate: writes the full structured trait, including evidence_strength and suggested_adjustment, not just the bare text', function () {
  const origPersona = OAD.DB.persona.assumption_tendencies;
  try {
    OAD.DB.persona.assumption_tendencies = [];
    OAD.openPersonaUpdateModal({
      warrants_update: true, target_list: 'assumption_tendencies',
      proposed_addition: 'Tendency to let external-dependency threads drift',
      suggested_adjustment: 'Add a 14-day auto-checkin cadence on waiting threads with no contingency date',
      coach_message: 'Seen across 3 threads.',
      evidence_strength: 0.6, occurrence_count: 4, distinct_thread_count: 3, span_days: 21,
      evidence_thread_uuids: ['a', 'b', 'c'], first_observed: '2026-06-01', last_observed: '2026-06-22'
    });
    document.querySelector('#modal-overlay .modal-footer button.success').click();

    const trait = OAD.DB.persona.assumption_tendencies[0];
    OAD._assertEqual(trait.text, 'Tendency to let external-dependency threads drift', 'text must match proposed_addition');
    OAD._assertEqual(trait.suggested_adjustment, 'Add a 14-day auto-checkin cadence on waiting threads with no contingency date', 'suggested_adjustment must be stored, not discarded');
    OAD._assertEqual(trait.evidence_strength, 0.6, 'evidence_strength must be stored as computed, not re-derived or dropped');
    OAD._assertEqual(trait.source, 'auto-promoted', 'source must be tagged, same auditability principle as addInsight');
  } finally {
    OAD.closeModal();
    OAD._pendingPersonaLesson = null;
    OAD.DB.persona.assumption_tendencies = origPersona;
  }
});

OAD.boot = async function () {
  if (window.location.search.includes('reset=true')) {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = window.location.pathname;
    return;
  }
  
  await OAD.loadLanguage();

  if (location.search.includes('tests=true')) {
    const savedPersona  = JSON.parse(JSON.stringify(OAD.DB.persona));
    const mainEl = document.getElementById('main');
    const originalMainHTML = mainEl ? mainEl.innerHTML : null;

    const summary = await OAD._runTests();

    // Tests mutate real OAD.DB entity arrays and, in some cases, render onto the real DOM to
    // assert against it. threads and habits are reset the same way (both accumulate leftover
    // fixture rows across the suite with no per-test cleanup, e.g. a stray 'Test habit' with no
    // check-in history); #main's pre-test HTML is restored too, since some tests render the real
    // dashboard directly to assert against it. cadences/ideas/etc are deliberately NOT reset
    // here — at least one UI test (test_cadence_recurrence_edit_round_trip) depends on a
    // leftover cadence fixture surviving the unit-test run as the row it edits.
    OAD.DB.threads = [];
    OAD.DB.habits = [];
    OAD.DB.persona = savedPersona;
    if (mainEl && originalMainHTML !== null) mainEl.innerHTML = originalMainHTML;

    const showOverlay = summary.failed > 0 || location.search.includes('tests=true');
    if (showOverlay) {
      OAD._renderTestOverlay(OAD._testResults, summary);
      if (summary.failed === 0) {
        document.getElementById('test-continue-btn')?.focus();
      }
    } else {
      OAD._initApp();
      if (typeof OAD._updateDemoIndicator === 'function') OAD._updateDemoIndicator();
    }
  } else {
    // Skip tests in production / demo so mock data doesn't pollute the DOM
    OAD._initApp();
    if (typeof OAD._updateDemoIndicator === 'function') OAD._updateDemoIndicator();
  }
};
