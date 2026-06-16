window.OAD = window.OAD || {};

OAD._tests = [];
OAD._testResults = [];

OAD.test = function (name, fn) {
  OAD._tests.push({ name, fn });
};

OAD._runTests = function () {
  OAD._testResults = [];
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of OAD._tests) {
    try {
      fn();
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
  OAD._assert('current_assumption'       in row,      'current_assumption included');
  OAD._assert('assumption_verified'      in row,      'assumption_verified included');
  OAD._assert('next_action'              in row,      'next_action included');
  OAD._assert('next_action_date'         in row,      'next_action_date included');
  OAD._assert('deadline'                 in row,      'deadline included');
  OAD._assert('effortEstimate'           in row,      'effortEstimate included');
  OAD._assert('connections'              in row,      'connections included');
  OAD._assert(row.connections.length > 0,            'connections array exported');
  OAD._assertEqual(row.connections[0].to_uuid, 'abc-123', 'connection to_uuid preserved');
  OAD._assert(row.evolution_log.length > 0,          'evolution_log included');
  OAD._assert(!('ai_insights' in row),               'ai_insights excluded');
  OAD._assert('exported_at'   in parsed,             'export has timestamp');
  OAD._assert('thread_count'  in parsed,             'export has thread_count');
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

OAD.test('suggestArea: detects Finance', function () {
  OAD._assertEqual(OAD.suggestArea('paying off debt'), 'Finance');
});

OAD.test('suggestArea: detects Health', function () {
  OAD._assertEqual(OAD.suggestArea('doctor appointment'), 'Health');
});

OAD.test('suggestArea: VR&E → Legal', function () {
  OAD._assertEqual(OAD.suggestArea('VR&E counselor meeting'), 'Legal');
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
    OAD._seedData();
    OAD.importCourseData();
  }
  OAD._finishBoot();
};

// Called after successful auth to load cloud data (or seed if none), then render.
OAD._bootAfterAuth = async function () {
  const cloudLoaded = await OAD._loadFromCloud();
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
      OAD._seedData();
      await OAD.importCourseData();
    }
    await OAD._saveToCloud();
  } else {
    // Cloud data loaded — migrate any arrays added after the user's initial seed.
    // This handles the case where habits/ideas were added to the app after the user
    // already had data in Supabase, so _seedData() was never run for those arrays.
    var needsSave = false;
    if (!OAD.DB.habits.length)  { OAD._seedHabits(); needsSave = true; }
    if (!OAD.DB.ideas.length)   { OAD._seedIdeas();  needsSave = true; }
    if (needsSave) await OAD._saveToCloud();
  }
  OAD._finishBoot();
};

// Called once data is loaded and ready — renders the daily summary as the default landing view.
OAD._finishBoot = function () {
  const theme = (OAD.DB.persona && OAD.DB.persona.theme) || 'dark';
  document.body.setAttribute('data-theme', theme);
  OAD.renderDailyView();
};

OAD.boot = function () {
  const savedThreads  = OAD.DB.threads.slice();
  const savedPersona  = JSON.parse(JSON.stringify(OAD.DB.persona));

  const summary = OAD._runTests();

  OAD.DB.threads = [];
  OAD.DB.persona = savedPersona;

  OAD._renderTestOverlay(OAD._testResults, summary);

  if (summary.failed === 0) {
    document.getElementById('test-continue-btn')?.focus();
  }
};
