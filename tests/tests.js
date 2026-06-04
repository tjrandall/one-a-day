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

OAD.test('pressure: contingency < 3 days adds 25', function () {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const t = OAD.makeThread({
    status: 'open',
    priority: 'low',
    connections: [],
    contingency_trigger_date: tomorrow.toISOString().slice(0, 10)
  });
  const s = OAD.pressure(t);
  OAD._assert(s >= 25, `Expected >= 25 for contingency < 3d, got ${s}`);
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
      const cloudLoaded = await OAD._loadFromCloud();
      if (!cloudLoaded) {
        // First sign-in: try to migrate localStorage data, then seed if empty
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
        // Push whatever we have (migrated or seeded) up to Supabase
        await OAD._saveToCloud();
      }
      OAD._finishBoot();
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

// Called after successful auth (sign-in, sign-up, or restored session).
OAD._finishBoot = function () {
  OAD.renderList();
  const first = OAD.DB.threads[0];
  if (first) OAD.selectThread(first.id);
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
