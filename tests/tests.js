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
    next_action_date: past.toISOString().slice(0, 10),
    connections: []
  });
  OAD._assertEqual(OAD.pressure(t), 100, 'pressure should cap at 100');
});

OAD.test('pressure: contingency adds more pressure when closer (quadratic curve)', function () {
  const d = function (offset) {
    const dt = new Date(); dt.setDate(dt.getDate() + offset);
    return dt.toISOString().slice(0, 10);
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

OAD.test('exportThreads: includes cadences array with full fields', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    OAD.DB.cadences = [{
      id: 5001, title: 'Export cadence test', life_area: 'finances', recurrence: 'monthly-1st',
      days_of_week: [], last_completed: '2026-06-01', next_due: '2026-07-01',
      notes: 'note text', consequences: 'consequence text'
    }];
    const parsed = JSON.parse(OAD.exportThreads());
    OAD._assert('cadences' in parsed, 'export has top-level cadences array');
    OAD._assert(Array.isArray(parsed.cadences), 'cadences is an array');
    OAD._assert('cadence_count' in parsed, 'export has cadence_count');
    const row = parsed.cadences.find(function (c) { return c.id === 5001; });
    OAD._assert(!!row, 'seeded cadence present in export');
    OAD._assertEqual(row.title, 'Export cadence test', 'title round-trips');
    OAD._assertEqual(row.recurrence, 'monthly-1st', 'recurrence round-trips');
    OAD._assertEqual(row.next_due, '2026-07-01', 'next_due round-trips');
    OAD._assertEqual(row.notes, 'note text', 'notes round-trips');
    OAD._assertEqual(row.consequences, 'consequence text', 'consequences round-trips');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('parseImportFile: cadence row with no id goes to create list', function () {
  const json = JSON.stringify({ threads: [], cadences: [{ title: 'New cadence via import', recurrence: 'weekly' }] });
  const results = OAD.parseImportFile(json);
  OAD._assertEqual(results.cadences.create.length, 1, 'one cadence queued for create');
  OAD._assertEqual(results.cadences.update.length, 0, 'none queued for update');
});

OAD.test('parseImportFile: cadence row matching an existing id goes to update list', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    OAD.DB.cadences = [{ id: 5002, title: 'Existing cadence', recurrence: 'weekly', next_due: '2026-07-01' }];
    const json = JSON.stringify({ threads: [], cadences: [{ id: 5002, title: 'Existing cadence', next_due: '2026-07-15' }] });
    const results = OAD.parseImportFile(json);
    OAD._assertEqual(results.cadences.update.length, 1, 'one cadence queued for update');
    OAD._assertEqual(results.cadences.create.length, 0, 'none queued for create');
    OAD._assertEqual(results.cadences.update[0].existing.id, 5002, 'correct cadence matched by id');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('applyImport: creates a new cadence from import', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    OAD.DB.cadences = [];
    const results = { create: [], update: [], cadences: { create: [{ title: 'Imported cadence', recurrence: 'monthly-1st', next_due: '2026-08-01' }], update: [] } };
    const result = OAD.applyImport(results, [], []);
    OAD._assertEqual(result.cadences_created, 1, 'one cadence created');
    OAD._assertEqual(OAD.DB.cadences.length, 1, 'cadence added to DB');
    OAD._assertEqual(OAD.DB.cadences[0].title, 'Imported cadence', 'title set correctly');
    OAD._assertEqual(OAD.DB.cadences[0].next_due, '2026-08-01', 'next_due set correctly');
    OAD._assert(OAD.DB.cadences[0].id != null, 'new cadence gets a real assigned id, not a fabricated one from the import row');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('applyImport: updates an existing cadence\'s next_due via import (Cadence Export/Import spec)', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    const existing = { id: 5003, title: 'Cadence to update', recurrence: 'weekly', next_due: '2026-07-01', notes: '', consequences: '' };
    OAD.DB.cadences = [existing];
    const incoming = { id: 5003, title: 'Cadence to update', recurrence: 'weekly', next_due: '2026-07-22', notes: '', consequences: '' };
    const results = { create: [], update: [], cadences: { create: [], update: [{ incoming: incoming, existing: existing }] } };
    const result = OAD.applyImport(results, [], [{ incoming: incoming, existing: existing }]);
    OAD._assertEqual(result.cadences_updated, 1, 'one cadence updated');
    OAD._assertEqual(OAD.getCadence(5003).next_due, '2026-07-22', 'next_due patched via import');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('applyImport: cadence update only patches actually-changed fields', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    const existing = { id: 5004, title: 'Unchanged title', recurrence: 'weekly', next_due: '2026-07-01', notes: 'keep me', consequences: '' };
    OAD.DB.cadences = [existing];
    const incoming = { id: 5004, title: 'Unchanged title', recurrence: 'weekly', next_due: '2026-07-01', notes: 'keep me', consequences: 'now set' };
    const results = { create: [], update: [], cadences: { create: [], update: [] } };
    OAD.applyImport(results, [], [{ incoming: incoming, existing: existing }]);
    OAD._assertEqual(OAD.getCadence(5004).consequences, 'now set', 'changed field patched');
    OAD._assertEqual(OAD.getCadence(5004).notes, 'keep me', 'unchanged field left alone');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('parseImportFile: deleted_cadence_ids queues matching cadences for delete, ignores unknown ids', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    OAD.DB.cadences = [{ id: 5005, title: 'Duplicate cadence to remove', recurrence: 'monthly-15th' }];
    const json = JSON.stringify({ threads: [], cadences: [], deleted_cadence_ids: [5005, 999999] });
    const results = OAD.parseImportFile(json);
    OAD._assertEqual(results.cadences.delete.length, 1, 'only the matching cadence is queued for delete');
    OAD._assertEqual(results.cadences.delete[0].id, 5005, 'queued delete is the correct cadence');
  } finally {
    OAD.DB.cadences = saved;
  }
});

OAD.test('applyImport: deletes confirmed cadences, leaves unconfirmed ones alone', function () {
  const saved = OAD.DB.cadences.slice();
  try {
    const toDelete = { id: 5006, title: 'Duplicate to delete', recurrence: 'monthly-15th' };
    const toKeep   = { id: 5007, title: 'Not confirmed, should survive', recurrence: 'monthly-15th' };
    OAD.DB.cadences = [toDelete, toKeep];
    const results = { create: [], update: [], cadences: { create: [], update: [], delete: [toDelete, toKeep] } };
    const result = OAD.applyImport(results, [], [], [toDelete]);
    OAD._assertEqual(result.cadences_deleted, 1, 'one cadence deleted');
    OAD._assert(!OAD.getCadence(5006), 'confirmed cadence is actually removed from DB.cadences');
    OAD._assert(!!OAD.getCadence(5007), 'unconfirmed cadence is left untouched');
  } finally {
    OAD.DB.cadences = saved;
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
  const c = OAD.addCadence(OAD.makeCadence({ title: 'Delete me cadence' }));
  const before = OAD.DB.cadences.length;
  OAD.deleteCadence(c.id);
  OAD._assertEqual(OAD.DB.cadences.length, before - 1, 'count decreased');
  OAD._assertEqual(OAD.getCadence(c.id), null, 'not findable after delete');
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

OAD.test('addIdea: assigns id and appends to DB', function () {
  const before = OAD.DB.ideas.length;
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Test idea' }));
  OAD._assert(idea.id > 0, 'id should be positive');
  OAD._assertEqual(OAD.DB.ideas.length, before + 1, 'ideas count should increase');
  OAD._assertEqual(OAD.getIdea(idea.id).title, 'Test idea', 'should retrieve by id');
});

OAD.test('deleteIdea: removes from DB', function () {
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Delete me' }));
  const before = OAD.DB.ideas.length;
  OAD.deleteIdea(idea.id);
  OAD._assertEqual(OAD.DB.ideas.length, before - 1, 'count should decrease');
  OAD._assertEqual(OAD.getIdea(idea.id), null, 'should not be findable after delete');
});

OAD.test('ideaOfTheWeek: returns an idea when ideas exist', function () {
  const idea = OAD.addIdea(OAD.makeIdea({ title: 'Week idea' }));
  const result = OAD.ideaOfTheWeek();
  OAD._assert(result !== null, 'should return an idea');
  OAD._assert(OAD.DB.ideas.includes(result), 'returned idea should be in DB');
});

OAD.test('ideaOfTheWeek: returns null when no ideas', function () {
  const saved = OAD.DB.ideas.slice();
  OAD.DB.ideas = [];
  OAD._assertEqual(OAD.ideaOfTheWeek(), null, 'null when no ideas');
  OAD.DB.ideas = saved;
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

OAD.test('addHabit: assigns id and appends to DB', function () {
  const before = OAD.DB.habits.length;
  const h = OAD.addHabit(OAD.makeHabit({ title: 'Test habit' }));
  OAD._assert(h.id > 0, 'id should be positive');
  OAD._assertEqual(OAD.DB.habits.length, before + 1, 'habit count should increase');
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
  const yesterday = yd.toISOString().slice(0, 10);
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
  const yesterday = yd.toISOString().slice(0, 10);
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
  const t = OAD.makeThread({ deadline: soon.toISOString().slice(0, 10), effortEstimate: 5, effortLogged: 0, weeklyCommitment: 1 });
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
  return d.toISOString().slice(0, 10);
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
    OAD._assertEqual(track.runway_ack_until, expected.toISOString().slice(0, 10), 'snooze should be exactly _RUNWAY_REPRESENT_DAYS out');
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

    const snoozed   = OAD.makeThread({ id: 851, uuid: 'rr-snoozed',   title: 'Snoozed',   runway_ack_until: future.toISOString().slice(0, 10) });
    const expired    = OAD.makeThread({ id: 852, uuid: 'rr-expired',   title: 'Expired',    runway_ack_until: past.toISOString().slice(0, 10) });
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
    const fedTrack = OAD.makeThread({ id: 863, uuid: 'rr-fed-track-ack', title: 'Federal — Snoozed Track', status: 'open', runway_ack_until: future.toISOString().slice(0, 10) });
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
    deadline: soon.toISOString().slice(0, 10),
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

OAD.test('addInsight: appends to ai_insights and counsel_history', function () {
  const t = OAD.addThread(OAD.makeThread({ title: 'Insight test' }));
  const before = OAD.DB.persona.counsel_history.length;
  OAD.addInsight(t.id, { observation: 'Interesting', date: '2026-05-30' });
  OAD._assertEqual(t.ai_insights.length, 1, 'Should have 1 insight');
  OAD._assertEqual(OAD.DB.persona.counsel_history.length, before + 1, 'Should add to counsel_history');
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
  const originalCadences = OAD.DB.cadences;
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
    OAD.DB.threads = [t, t2];
    OAD.DB.cadences = [{ id: 9101, title: 'Cadence due same day', next_due: date, recurrence: 'monthly-1st', days_of_week: [] }];

    const ownPressure = OAD.pressure(t, true); // matches how getDayLoad computes it internally
    const expectedEdgeContribution = 2 * 2; // 2 connections (blocks + relates) * edgeMultiplier 2
    const expectedCadenceContribution = 20; // 1 cadence * cadenceWeight 20
    const score = OAD.calculateDayLoadScore(date);
    OAD._assertEqual(score, ownPressure + expectedEdgeContribution + expectedCadenceContribution,
      'score should be pressure-sum + edge-weight + cadence-weight, using configured multipliers');
  } finally {
    OAD.DB.threads = originalThreads;
    OAD.DB.cadences = originalCadences;
    OAD.Config.weekLoadWeights = originalWeights;
  }
});

OAD.test('calculateDayLoadScore: two entangled, genuinely overwhelming threads outscore ten easy ones — the exact intuition this replaces raw item count for', function () {
  const originalThreads = OAD.DB.threads;
  try {
    const heavyDate = '2099-06-01';
    const easyDate = '2099-06-02';
    const ctgSoon = (function () { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();

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
  const saved = OAD.DB.cadences.slice();
  OAD.DB.cadences = [];
  OAD._seedCadences();
  OAD._assert(OAD.DB.cadences.length >= 3, 'at least 3 cadences should be seeded');
  const mbr = OAD.DB.cadences.find(function (c) { return c.title === 'Monthly Bills Review'; });
  OAD._assert(!!mbr,                          'Monthly Bills Review cadence should exist');
  OAD._assertEqual(mbr.recurrence, 'monthly-15th', 'Monthly Bills Review recurrence should be monthly-15th');
  OAD.DB.cadences = saved;
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
  const todayStr = today.toISOString().slice(0, 10);
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

OAD.test('_normalizeDB: backfills days_of_week on cadences that predate the field', function () {
  const saved = OAD.DB.cadences.slice();
  OAD.DB.cadences = [{ id: 999999, title: 'Legacy cadence', recurrence: 'weekly' }];
  OAD._normalizeDB();
  OAD._assert(Array.isArray(OAD.DB.cadences[0].days_of_week), 'legacy cadence should get a days_of_week array backfilled');
  OAD.DB.cadences = saved;
});

OAD.test('_normalizeDB: normalizes cadence life_area the same way threads already do', function () {
  const saved = OAD.DB.cadences.slice();
  OAD.DB.cadences = [
    { id: 999998, title: 'Bad casing cadence', recurrence: 'weekly', life_area: 'Finance' },
    { id: 999997, title: 'Lowercase cadence',  recurrence: 'weekly', life_area: 'finances' }
  ];
  OAD._normalizeDB();
  OAD._assertEqual(OAD.getCadence(999998).life_area, 'Finances', "'Finance' normalizes to canonical 'Finances'");
  OAD._assertEqual(OAD.getCadence(999997).life_area, 'Finances', "'finances' normalizes to canonical 'Finances'");
  OAD.DB.cadences = saved;
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
  const today = new Date().toISOString().slice(0, 10);
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
  const futureStr = future.toISOString().slice(0, 10);
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

OAD.test('proposals: accepting a proposal creates an active thread', function () {
  const savedProposals = (OAD.DB.proposals || []).slice();
  const savedThreads = (OAD.DB.threads || []).slice();
  OAD.DB.proposals = [{ uuid: 'test-uuid', title: 'Prop A', life_area: 'Other', closing_condition: 'Done', rationale: 'Testing' }];
  OAD.DB.threads = [];
  const t = OAD.acceptProposal('test-uuid');
  OAD._assert(t, 'should return thread');
  OAD._assertEqual(OAD.DB.proposals.length, 0, 'proposal should be removed');
  OAD._assertEqual(OAD.DB.threads.length, 1, 'thread should be added');
  OAD._assertEqual(t.title, 'Prop A', 'title matches');
  OAD.DB.proposals = savedProposals;
  OAD.DB.threads = savedThreads;
});

OAD.test('proposals: rejecting a proposal removes it from the queue', function () {
  const savedProposals = (OAD.DB.proposals || []).slice();
  OAD.DB.proposals = [{ uuid: 'test-uuid2', title: 'Prop B' }];
  OAD.rejectProposal('test-uuid2');
  OAD._assertEqual(OAD.DB.proposals.length, 0, 'proposal should be removed');
  OAD.DB.proposals = savedProposals;
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
    var needsSave = false;
    if (!OAD.DB.habits.length)   { OAD._seedHabits();   needsSave = true; }
    if (!OAD.DB.ideas.length)    { OAD._seedIdeas();    needsSave = true; }
    if (!OAD.DB.cadences.length) { OAD._seedCadences(); needsSave = true; }
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
    const threadB = { id: 102, uuid: 'uuid-b', title: 'Task B', status: 'stalled', life_area: 'Work', priority: 'high' };
    const threadC = { id: 103, uuid: 'uuid-c', title: 'Task C', status: 'waiting', life_area: 'Work', priority: 'low', next_action_date: '2020-01-01' };
    const threadD = { id: 104, uuid: 'uuid-d', title: 'Task D', status: 'waiting', life_area: 'Work', priority: 'low', next_action_date: '2099-01-01' };
    
    OAD.DB.threads = [threadA, threadB, threadC, threadD];

    // Should select Task B (stalled) first as it has highest priority
    const toat = OAD.getDailyToat();
    OAD._assert(toat !== null, 'TOAT should be selected');
    OAD._assertEqual(toat.id, 102, 'Should select Task B as oldest stalled thread');

    // Calling again should return the persisted selection
    const secondToat = OAD.getDailyToat();
    OAD._assertEqual(secondToat.id, 102, 'Should persist selected TOAT for the day');

    // Clear locked TOAT
    OAD.DB.toat = [];
    // Remove stalled task, should pick overdue waiting next
    OAD.DB.threads = [threadA, threadC, threadD];
    const thirdToat = OAD.getDailyToat();
    OAD._assertEqual(thirdToat.id, 103, 'Should select Task C as overdue waiting thread');

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
    OAD._assert(seventhToat === null, 'Should return null for high pressure open thread (only stalled or overdue are TOAT candidates)');
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
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' }); // no next_action_date, mirrors the real parents
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-07-08' }); // 5 days out
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };

  const withoutHorizon = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(withoutHorizon.has('c1'), 'sanity check: without a horizon, a child due 5 days out is still suppressed (old behavior)');

  const withHorizon = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03', null, '2026-07-10');
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
  const parent = OAD.makeThread({ title: 'Parent', uuid: 'p1' });
  const child = OAD.makeThread({ title: 'Child', uuid: 'c1', parent_uuid: 'p1', next_action_date: '2026-07-08' }); // 5 days out — not today, not overdue
  const childrenByParentUUID = { p1: [child] };
  const activeByUUID = { p1: parent };

  const withoutFocus = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03');
  OAD._assert(withoutFocus.has('c1'), 'sanity check: without a focus exemption this child is suppressed like any other future-dated child');

  const withFocus = OAD.computeSuppressedChildUUIDs(childrenByParentUUID, activeByUUID, '2026-07-03', 'c1');
  OAD._assert(!withFocus.has('c1'), 'a child matching focusUUID must never be suppressed, regardless of its date');
});

OAD.test('getFocusUUID: returns selectFocusThread\'s uuid when something is due now, else selectFutureFocusSuggestion\'s', function () {
  const orig = OAD.DB.threads;
  try {
    const dueNow = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Due now', status: 'open', priority: 'high', next_action_date: OAD.todayStr() });
    OAD.DB.threads = [dueNow];
    OAD._assertEqual(OAD.getFocusUUID(), dueNow.uuid, 'should match selectFocusThread when something is due now');

    const future = new Date(); future.setDate(future.getDate() + 3);
    const upcoming = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Upcoming', status: 'open', priority: 'high', next_action_date: future.toISOString().slice(0, 10) });
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
    const in5Str = in5.toISOString().slice(0, 10);

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
    const in2Str = in2.toISOString().slice(0, 10);
    const in5 = new Date(); in5.setDate(in5.getDate() + 5);
    const in5Str = in5.toISOString().slice(0, 10);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = in7Dt.toISOString().slice(0, 10);

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
    const in2Str = in2.toISOString().slice(0, 10);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = in7Dt.toISOString().slice(0, 10);

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
    const in3Str = in3.toISOString().slice(0, 10);
    const in7Dt = new Date(); in7Dt.setDate(in7Dt.getDate() + 7);
    const in7Str = in7Dt.toISOString().slice(0, 10);

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
    const in7Str = in7Dt.toISOString().slice(0, 10);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    const future = new Date(); future.setDate(future.getDate() + 30);
    const futureStr = future.toISOString().slice(0, 10);

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
    const in7Str = in7Dt.toISOString().slice(0, 10);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    const future = new Date(); future.setDate(future.getDate() + 30);
    const futureStr = future.toISOString().slice(0, 10);

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
    const in2Str = in2.toISOString().slice(0, 10);

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

OAD.test('makeThread: created_at defaults to a valid ISO timestamp', function () {
  const t = OAD.makeThread({});
  OAD._assert(!!t.created_at, 'created_at should be set');
  OAD._assert(!isNaN(new Date(t.created_at).getTime()), 'created_at should parse as a valid date');
});

OAD.test('_normalizeDB: hydrates plain-object threads/cadences into real domain-model instances, in place', function () {
  const origThreads = OAD.DB.threads;
  const origCadences = OAD.DB.cadences;
  try {
    const plainThread = { id: 9001, uuid: OAD._generateUUID(), title: 'Plain object thread', status: 'open',
      next_action_date: '2020-01-01', connections: [] }; // deliberately overdue, to prove isOverdue() actually works
    const plainCadence = { id: 9002, title: 'Plain object cadence', recurrence: 'weekly', next_due: '2020-01-01' };
    OAD.DB.threads = [plainThread];
    OAD.DB.cadences = [plainCadence];

    OAD._assert(!(plainThread instanceof OAD.Models.Thread), 'sanity check: starts as a plain object, not a Thread');
    OAD._normalizeDB();

    OAD._assert(plainThread instanceof OAD.Models.Thread, 'thread must be a real Thread instance after normalize');
    OAD._assert(typeof plainThread.isOverdue === 'function', 'hydrated thread must have its class methods available');
    OAD._assert(plainThread.isOverdue(), 'hydrated thread method must actually work, not just exist (this one really is overdue)');
    OAD._assertEqual(OAD.DB.threads[0], plainThread, 'hydration must upgrade the object in place — same reference, not a replacement — so any code already holding this reference keeps working');

    OAD._assert(plainCadence instanceof OAD.Models.Cadence, 'cadence must be a real Cadence instance after normalize');
    OAD._assert(typeof plainCadence.isOverdue === 'function', 'hydrated cadence must have its class methods available');
    OAD._assert(plainCadence.isOverdue(), 'hydrated cadence method must actually work (this one really is overdue)');
  } finally {
    OAD.DB.threads = origThreads;
    OAD.DB.cadences = origCadences;
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
    const futureStr = future.toISOString().slice(0, 10);

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
    const futureStr = future.toISOString().slice(0, 10);
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
    const t = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Overdue thread', status: 'open', priority: 'medium', next_action_date: yesterday.toISOString().slice(0, 10) });
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
    const nearLow  = OAD.makeThread({ id: 1, uuid: OAD._generateUUID(), title: 'Near, low pressure', status: 'open', priority: 'low', next_action_date: in3.toISOString().slice(0, 10) });
    const farHigh  = OAD.makeThread({ id: 2, uuid: OAD._generateUUID(), title: 'Far, high pressure', status: 'stalled', priority: 'critical', next_action_date: in5.toISOString().slice(0, 10) });
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
// `new Date().toISOString().slice(0,10)` converts the current instant straight to UTC, which
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
    return dt.toISOString().slice(0, 10);
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

  // We need to mock isDeadlineOverdue since it depends on the actual current time.
  const origIsDeadlineOverdue = OAD.isDeadlineOverdue;
  try {
    OAD.isDeadlineOverdue = function(t) {
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
    OAD.isDeadlineOverdue = origIsDeadlineOverdue;
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
    return dt.toISOString().slice(0, 10);
  };

  const todayStr = d(0);
  const in7Str = d(7);

  const tricky = OAD.makeThread({ title: 'Due today and deadline overdue', next_action_date: todayStr });

  const origIsDeadlineOverdue = OAD.isDeadlineOverdue;
  try {
    OAD.isDeadlineOverdue = function(t) { return true; };
    const bucketsOverdue = OAD.Due.buckets([tricky], todayStr, in7Str);
    OAD._assertEqual(bucketsOverdue.overdue.length, 1, 'appears in overdue');
    OAD._assertEqual(bucketsOverdue.today.length, 1, 'ALSO appears in today — this is the deliberate overlap, not a bug');
    OAD._assertEqual(bucketsOverdue.week.length, 0, 'never appears in week regardless');

    OAD.isDeadlineOverdue = function(t) { return false; };
    const bucketsToday = OAD.Due.buckets([tricky], todayStr, in7Str);
    OAD._assertEqual(bucketsToday.overdue.length, 0, 'not overdue when deadline is not overdue');
    OAD._assertEqual(bucketsToday.today.length, 1, 'still appears in today');
    OAD._assertEqual(bucketsToday.week.length, 0, 'never appears in week regardless');
  } finally {
    OAD.isDeadlineOverdue = origIsDeadlineOverdue;
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
    const savedThreads  = OAD.DB.threads.slice();
    const savedPersona  = JSON.parse(JSON.stringify(OAD.DB.persona));

    const summary = await OAD._runTests();

    OAD.DB.threads = [];
    OAD.DB.persona = savedPersona;

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
