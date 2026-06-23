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

OAD.test('pressure: blocking connection adds 10 each', function () {
  const t = OAD.makeThread({ status: 'open', priority: 'low', connections: [
    { to_label: 'A', edge_type: 'blocks' },
    { to_label: 'B', edge_type: 'blocks' }
  ]});
  const t0 = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  OAD._assert(OAD.pressure(t) - OAD.pressure(t0) >= 20, 'Two blocking connections should add at least 20');
});

OAD.test('pressure: enables connection does not add pressure', function () {
  const t1 = OAD.makeThread({ status: 'open', priority: 'low', connections: [{ to_label: 'A', edge_type: 'enables' }] });
  const t2 = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  OAD._assertEqual(OAD.pressure(t1), OAD.pressure(t2), 'enables should not change pressure');
});

OAD.test('pressure: capped at 100', function () {
  const t = OAD.makeThread({
    status: 'stalled',
    priority: 'critical',
    current_assumption: 'x',
    assumption_verified: false,
    connections: [
      { to_label: 'A', edge_type: 'blocks' },
      { to_label: 'B', edge_type: 'blocks' },
      { to_label: 'C', edge_type: 'blocks' },
      { to_label: 'D', edge_type: 'blocks' }
    ]
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

OAD.test('makeThread: parent_uuid defaults to null', function () {
  const t = OAD.makeThread({ title: 'Child candidate' });
  OAD._assert(Object.prototype.hasOwnProperty.call(t, 'parent_uuid'), 'parent_uuid field exists');
  OAD._assertEqual(t.parent_uuid, null, 'parent_uuid defaults to null');
});

OAD.test('pressure: bleed-up uses to_uuid when present, ignores stale title', function () {
  const blocked = OAD.addThread(OAD.makeThread({ title: 'Stall target', status: 'stalled', priority: 'low', connections: [] }));
  // Edge stores UUID of blocked thread; to_label is intentionally wrong (stale title)
  const blocker = OAD.makeThread({ status: 'open', priority: 'low', connections: [
    { to_uuid: blocked.uuid, to_label: 'WRONG STALE TITLE', edge_type: 'blocks' }
  ]});
  const blockerNoConn = OAD.makeThread({ status: 'open', priority: 'low', connections: [] });
  OAD._assert(OAD.pressure(blocker) > OAD.pressure(blockerNoConn), 'UUID-resolved bleed-up should add pressure even with wrong to_label');
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
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
  OAD._assertEqual(OAD.getEisenhowerQuadrant(t2), 'Q4', 'Medium priority and not urgent should be Q4');
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
        OAD._userId = 'local-superadmin-id';
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
          const url = '/modules/demo/demo_data.json?v=' + Date.now();
          console.log('[OAD] Fetching demo data from:', url);
          const res = await fetch(url);
          if (res.ok) {
            OAD.DB = await res.json();
            OAD._normalizeDB();
            OAD.saveDB(); // Persist auto-loaded demo data to localStorage
            console.log('[OAD] Demo data auto-loaded successfully. Threads:', OAD.DB.threads.length);
          } else {
            throw new Error('HTTP ' + res.status + ' ' + res.statusText);
          }
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
  
  OAD.renderDailyView();

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
    const threadA = { id: 101, uuid: 'uuid-a', title: 'Task A', status: 'open', life_area: 'Work', priority: 'high', connections: [] };
    const threadB = { id: 102, uuid: 'uuid-b', title: 'Task B', status: 'open', life_area: 'Work', priority: 'high', connections: [{ to_uuid: 'uuid-a', to_label: 'Task A', edge_type: 'blocks' }] };
    
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

  try {
    OAD._assert(OAD.isSuperAdmin(), 'Current user environment must verify as SuperAdmin');

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
    await OAD.loadLanguage();
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
