window.OAD = window.OAD || {};

OAD.openModal = function (html) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) OAD.closeModal();
    });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal modal-lg">${html}</div>`;
  overlay.classList.remove('hidden');
};

OAD.closeModal = function () {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('hidden');
};

OAD._areaOptions = function (selected) {
  return OAD.LIFE_AREAS.map(a =>
    `<option value="${OAD.esc(a)}" ${a === selected ? 'selected' : ''}>${OAD.esc(a)}</option>`
  ).join('');
};

OAD._statusOptions = function (selected) {
  return OAD.STATUSES.map(s =>
    `<option value="${s}" ${s === selected ? 'selected' : ''}>${s}</option>`
  ).join('');
};

OAD._priorityOptions = function (selected) {
  return OAD.PRIORITIES.map(p =>
    `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`
  ).join('');
};

OAD._closingTypeOptions = function (selected) {
  return OAD.CLOSING_TYPES.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`
  ).join('');
};

OAD._threadForm = function (t) {
  return `
    <div class="field">
      <label>Title</label>
      <input id="f-title" type="text" value="${OAD.esc(t.title)}" placeholder="What is this thread about?">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Life Area</label>
        <select id="f-area">${OAD._areaOptions(t.life_area)}</select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="f-status">${OAD._statusOptions(t.status)}</select>
      </div>
    </div>
    <div class="field">
      <label>Priority</label>
      <select id="f-priority">${OAD._priorityOptions(t.priority)}</select>
    </div>

    <div class="field">
      <label>Closing Condition — what OUTCOME closes this?</label>
      <textarea id="f-closing">${OAD.esc(t.closing_condition)}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Closing Type</label>
        <select id="f-closing-type">${OAD._closingTypeOptions(t.closing_condition_type)}</select>
      </div>
      <div class="field" style="align-self:end">
        <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;margin:0">
          <input type="checkbox" id="f-closing-met" ${t.closing_condition_met ? 'checked' : ''} style="width:auto">
          Closing condition met
        </label>
      </div>
    </div>

    <div class="field">
      <label>Current Assumption</label>
      <textarea id="f-assumption">${OAD.esc(t.current_assumption)}</textarea>
    </div>
    <div class="field" style="align-self:end">
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;margin:0">
        <input type="checkbox" id="f-assumption-verified" ${t.assumption_verified ? 'checked' : ''} style="width:auto">
        Assumption verified
      </label>
    </div>

    <div class="field">
      <label>Next Action</label>
      <input id="f-next-action" type="text" value="${OAD.esc(t.next_action)}" placeholder="What is the specific next step?">
    </div>
    <div class="field-row">
      <div class="field">
        <label>By Date</label>
        <input id="f-next-date" type="date" value="${OAD.esc(t.next_action_date)}">
      </div>
      <div class="field">
        <label>Channel</label>
        <input id="f-next-channel" type="text" value="${OAD.esc(t.next_action_channel)}" placeholder="email, phone, in-person…">
      </div>
    </div>
    <div class="field">
      <label>Contact</label>
      <input id="f-next-contact" type="text" value="${OAD.esc(t.next_action_contact)}" placeholder="Who are you acting with?">
    </div>

    <div class="field">
      <label>Contingency Trigger Date</label>
      <input id="f-ctg-date" type="date" value="${OAD.esc(t.contingency_trigger_date)}">
    </div>
    <div class="field">
      <label>Contingency Action</label>
      <input id="f-ctg-action" type="text" value="${OAD.esc(t.contingency_action)}" placeholder="What do you do if no response by trigger date?">
    </div>
    <div class="field">
      <label>Escalation</label>
      <input id="f-ctg-escalation" type="text" value="${OAD.esc(t.contingency_escalation)}" placeholder="Who or what is the escalation path?">
    </div>`;
};

OAD._readThreadForm = function (base) {
  const title = document.getElementById('f-title')?.value.trim() || '';
  if (!title) { alert('Title is required.'); return null; }
  return Object.assign({}, base, {
    title,
    life_area:               document.getElementById('f-area')?.value || base.life_area,
    status:                  document.getElementById('f-status')?.value || base.status,
    priority:                document.getElementById('f-priority')?.value || base.priority,
    closing_condition:       document.getElementById('f-closing')?.value.trim() || '',
    closing_condition_type:  document.getElementById('f-closing-type')?.value || 'outcome',
    closing_condition_met:   document.getElementById('f-closing-met')?.checked || false,
    current_assumption:      document.getElementById('f-assumption')?.value.trim() || '',
    assumption_verified:     document.getElementById('f-assumption-verified')?.checked || false,
    next_action:             document.getElementById('f-next-action')?.value.trim() || '',
    next_action_date:        document.getElementById('f-next-date')?.value || '',
    next_action_channel:     document.getElementById('f-next-channel')?.value.trim() || '',
    next_action_contact:     document.getElementById('f-next-contact')?.value.trim() || '',
    contingency_trigger_date: document.getElementById('f-ctg-date')?.value || '',
    contingency_action:      document.getElementById('f-ctg-action')?.value.trim() || '',
    contingency_escalation:  document.getElementById('f-ctg-escalation')?.value.trim() || ''
  });
};

OAD.openNewThreadModal = function () {
  const blank = OAD.makeThread();
  OAD.openModal(`
    <h2>New Thread</h2>
    ${OAD._threadForm(blank)}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveNewThread()">Create Thread</button>
    </div>`);
};

OAD._saveNewThread = function () {
  const data = OAD._readThreadForm(OAD.makeThread());
  if (!data) return;
  const thread = OAD.addThread(data);
  OAD.addEvolution(thread.id, 'Thread created.');
  OAD.closeModal();
  OAD.renderList();
  OAD.selectThread(thread.id);
};

OAD.openEditModal = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  OAD.openModal(`
    <h2>Edit Thread</h2>
    ${OAD._threadForm(t)}
    <div class="modal-footer">
      <button class="danger" onclick="OAD._deleteThread(${id})">Delete</button>
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveEditThread(${id})">Save</button>
    </div>`);
};

OAD._saveEditThread = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  const data = OAD._readThreadForm(t);
  if (!data) return;
  const prev = { status: t.status, priority: t.priority, assumption_verified: t.assumption_verified };
  OAD.updateThread(id, data);
  const notes = [];
  if (prev.status !== data.status) notes.push(`Status → ${data.status}`);
  if (prev.priority !== data.priority) notes.push(`Priority → ${data.priority}`);
  if (!prev.assumption_verified && data.assumption_verified) notes.push('Assumption verified');
  if (notes.length) OAD.addEvolution(id, notes.join('; '));
  OAD.closeModal();
  OAD.renderList();
  OAD.renderDetail(id);
};

OAD._deleteThread = function (id) {
  if (!confirm('Delete this thread? This cannot be undone.')) return;
  OAD.deleteThread(id);
  OAD._activeId = null;
  OAD.closeModal();
  OAD.renderList();
  const panel = document.getElementById('detail-content');
  if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
};

OAD.openLogModal = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  OAD.openModal(`
    <h2>Log Update — ${OAD.esc(t.title)}</h2>
    <div class="field">
      <label>What happened or changed?</label>
      <textarea id="f-log-note" placeholder="Add a note to the evolution log…"></textarea>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveLog(${id})">Save Log</button>
    </div>`);
  setTimeout(() => document.getElementById('f-log-note')?.focus(), 50);
};

OAD._saveLog = function (id) {
  const note = document.getElementById('f-log-note')?.value.trim();
  if (!note) { alert('Enter a note.'); return; }
  OAD.addEvolution(id, note);
  OAD.closeModal();
  OAD.renderDetail(id);
};

OAD.openConnectionModal = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  const edgeOpts = OAD.EDGE_TYPES.map(e =>
    `<option value="${e}">${e}</option>`).join('');
  OAD.openModal(`
    <h2>Add Connection — ${OAD.esc(t.title)}</h2>
    <div class="field">
      <label>Edge Type</label>
      <select id="f-edge-type">${edgeOpts}</select>
    </div>
    <div class="field">
      <label>Connected Thread / Label</label>
      <input id="f-edge-label" type="text" placeholder="Name of the related thread or item">
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveConnection(${id})">Add</button>
    </div>`);
};

OAD._saveConnection = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  const edge_type = document.getElementById('f-edge-type')?.value;
  const to_label  = document.getElementById('f-edge-label')?.value.trim();
  if (!to_label) { alert('Enter a label.'); return; }
  t.connections.push({ to_label, edge_type });
  OAD.addEvolution(id, `Connection added: ${edge_type} → ${to_label}`);
  OAD.closeModal();
  OAD.renderList();
  OAD.renderDetail(id);
};

OAD.openPersonaModal = function () {
  const p  = OAD.DB.persona;
  const lc = p.life_context;
  const tc = p.tone_calibration;
  OAD.openModal(`
    <h2>Persona Settings</h2>
    <div class="field">
      <label>Pressure Level</label>
      <select id="f-pressure-level">
        ${['low','moderate','high','critical'].map(v =>
          `<option value="${v}" ${lc.pressure_level === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Hard Deadline</label>
        <input id="f-hard-deadline" type="date" value="${OAD.esc(lc.hard_deadline || '')}">
      </div>
      <div class="field">
        <label>Deadline Context</label>
        <input id="f-deadline-ctx" type="text" value="${OAD.esc(lc.hard_deadline_context)}" placeholder="Why is this date critical?">
      </div>
    </div>
    <div class="field">
      <label>Challenge Tolerance</label>
      <select id="f-challenge-tol">
        ${['low','medium','high'].map(v =>
          `<option value="${v}" ${tc.challenge_tolerance === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Current Mode</label>
      <select id="f-current-mode">
        ${['problem-solving','crisis','maintenance','growth'].map(v =>
          `<option value="${v}" ${tc.current_mode === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>What Is Working (one per line)</label>
      <textarea id="f-working">${(p.what_is_working || []).join('\n')}</textarea>
    </div>
    <div class="field">
      <label>What Is Not Working (one per line)</label>
      <textarea id="f-not-working">${(p.what_is_not_working || []).join('\n')}</textarea>
    </div>
    <div class="field">
      <label>Assumption Tendencies (one per line)</label>
      <textarea id="f-tendencies">${(p.assumption_tendencies || []).join('\n')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._savePersona()">Save Persona</button>
    </div>`);
};

OAD._savePersona = function () {
  const p = OAD.DB.persona;
  p.life_context.pressure_level      = document.getElementById('f-pressure-level')?.value || 'moderate';
  p.life_context.hard_deadline       = document.getElementById('f-hard-deadline')?.value || null;
  p.life_context.hard_deadline_context = document.getElementById('f-deadline-ctx')?.value.trim() || '';
  p.tone_calibration.challenge_tolerance = document.getElementById('f-challenge-tol')?.value || 'medium';
  p.tone_calibration.current_mode    = document.getElementById('f-current-mode')?.value || 'problem-solving';
  const toArr = id => (document.getElementById(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  p.what_is_working    = toArr('f-working');
  p.what_is_not_working = toArr('f-not-working');
  p.assumption_tendencies = toArr('f-tendencies');
  OAD.saveDB();
  OAD.closeModal();
  OAD.renderPersonaBar();
};

OAD.openSettingsModal = function () {
  OAD.loadApiKey();
  const userEmail = OAD.supabase
    ? (OAD.supabase.auth.getSession().then ? '' : '')
    : '';
  const signOutBtn = OAD._userId
    ? `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
         <button class="ghost" style="width:100%;color:var(--text-muted)" onclick="OAD.closeModal();OAD.openSignOutModal()">Sign Out</button>
       </div>`
    : '';
  OAD.openModal(`
    <h2>Settings</h2>
    <div class="field">
      <label>Anthropic API Key</label>
      <input id="f-api-key" type="password" value="${OAD.esc(OAD.API_KEY)}" placeholder="sk-ant-…">
    </div>
    <p class="text-muted text-sm">Key is stored in localStorage — never sent anywhere except Anthropic's API.</p>
    ${signOutBtn}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveSettings()">Save</button>
    </div>`);
};

OAD._saveSettings = function () {
  const key = document.getElementById('f-api-key')?.value.trim() || '';
  OAD.setApiKey(key);
  OAD.closeModal();
};

// ── Complete Action Wizard ──────────────────────────────────────

OAD._caw = null;

OAD._wizardSteps = function (active) {
  const labels = ['What happened', 'Close?', "What's next"];
  return '<div class="wizard-steps">' + labels.map(function (label, i) {
    const n = i + 1;
    const cls = n < active ? 'ws done' : n === active ? 'ws active' : 'ws';
    return (i > 0 ? '<span class="ws-sep">›</span>' : '') +
      '<span class="' + cls + '">' + n + ' ' + label + '</span>';
  }).join('') + '</div>';
};

OAD.openCompleteActionModal = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  OAD._caw = { id: id, step1: null, step2: null };
  OAD._cawStep1();
};

OAD._cawStep1 = function () {
  const caw = OAD._caw;
  const t   = OAD.getThread(caw.id);
  const prev = caw.step1 || {};
  const hasAssumption = !!(t.current_assumption && t.current_assumption.trim());

  const assumptionHtml = hasAssumption ? `
    <div class="field">
      <label>Did this verify the current assumption?</label>
      <div class="text-sm text-muted" style="font-style:italic;margin:0 0 8px">"${OAD.esc(t.current_assumption)}"</div>
      <div class="yn-group">
        <label class="yn-opt">
          <input type="radio" name="ca-av" value="yes" ${prev.assumption_verified === true ? 'checked' : ''}>
          Yes — assumption verified
        </label>
        <label class="yn-opt">
          <input type="radio" name="ca-av" value="no" ${prev.assumption_verified !== true ? 'checked' : ''}>
          No — still unverified
        </label>
      </div>
    </div>` : '';

  OAD.openModal(`
    ${OAD._wizardSteps(1)}
    <h2>Complete Action — <span style="color:var(--text-muted);font-weight:400;font-size:15px">${OAD.esc(t.title)}</span></h2>
    <div class="field">
      <label>What did you do? <span style="color:var(--critical)">*</span></label>
      <textarea id="ca-what-done" placeholder="Describe exactly what you did — this becomes the evolution log entry." style="min-height:90px">${OAD.esc(prev.what_done || '')}</textarea>
    </div>
    ${assumptionHtml}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._cawStep1Next()">Next →</button>
    </div>`);
  setTimeout(function () { document.getElementById('ca-what-done')?.focus(); }, 50);
};

OAD._cawStep1Next = function () {
  const what_done = document.getElementById('ca-what-done')?.value.trim();
  if (!what_done) { alert('Describe what you did — this cannot be empty.'); return; }

  const t = OAD.getThread(OAD._caw.id);
  const hasAssumption = !!(t.current_assumption && t.current_assumption.trim());
  let assumption_verified = t.assumption_verified;

  if (hasAssumption) {
    const av = document.querySelector('input[name="ca-av"]:checked')?.value;
    if (!av) { alert('Select whether the assumption was verified.'); return; }
    assumption_verified = (av === 'yes');
  }

  OAD._caw.step1 = { what_done: what_done, assumption_verified: assumption_verified };
  OAD._cawStep2();
};

// Step 2: Did this close the thread? YES → _cawSaveClose(); NO → _cawStep3()
OAD._cawStep2 = function () {
  const t = OAD.getThread(OAD._caw.id);
  const closingText = t.closing_condition
    ? OAD.esc(t.closing_condition)
    : '<span class="text-muted">No closing condition defined</span>';

  OAD.openModal(`
    ${OAD._wizardSteps(2)}
    <h2>Did this close the thread?</h2>
    <div class="caw-closing-box">
      <div class="card-title">Closing Condition</div>
      <div class="text-sm">${closingText}</div>
    </div>
    <div class="field">
      <div class="yn-group">
        <label class="yn-opt yn-card">
          <input type="radio" name="ca-closed" value="yes">
          <div>
            <div style="font-weight:600;font-size:14px">Yes — closing condition met</div>
            <div class="text-sm text-muted" style="margin-top:2px">Thread will be marked closed</div>
          </div>
        </label>
        <label class="yn-opt yn-card">
          <input type="radio" name="ca-closed" value="no" checked>
          <div>
            <div style="font-weight:600;font-size:14px">No — still in progress</div>
            <div class="text-sm text-muted" style="margin-top:2px">Set next action</div>
          </div>
        </label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD._cawStep1()">← Back</button>
      <button class="success" onclick="OAD._cawStep2Next()">Next →</button>
    </div>`);
};

OAD._cawStep2Next = function () {
  const val = document.querySelector('input[name="ca-closed"]:checked')?.value;
  if (!val) { alert('Please select yes or no.'); return; }
  if (val === 'yes') { OAD._cawSaveClose(); } else { OAD._cawStep3(); }
};

// Step 3: What's next? (only reached on NO path)
OAD._cawStep3 = function () {
  const caw  = OAD._caw;
  const t    = OAD.getThread(caw.id);
  const prev = caw.step2 || {};
  const channels = ['email', 'phone', 'portal', 'in-person', 'text', 'other'];
  const curChannel = prev.channel || t.next_action_channel || 'email';
  const channelOpts = channels.map(function (c) {
    return '<option value="' + c + '" ' + (c === curChannel ? 'selected' : '') + '>' + c + '</option>';
  }).join('');

  OAD.openModal(`
    ${OAD._wizardSteps(3)}
    <h2>What's Next?</h2>
    <div class="field">
      <label>New next action <span style="color:var(--critical)">*</span></label>
      <input id="ca-action" type="text" value="${OAD.esc(prev.action || '')}" placeholder="Specific next step you will take">
    </div>
    <div class="field-row">
      <div class="field">
        <label>By when <span style="color:var(--critical)">*</span></label>
        <input id="ca-date" type="date" value="${OAD.esc(prev.date || '')}">
      </div>
      <div class="field">
        <label>Channel</label>
        <select id="ca-channel">${channelOpts}</select>
      </div>
    </div>
    <div class="field">
      <label>Contact</label>
      <input id="ca-contact" type="text" value="${OAD.esc(prev.contact !== undefined ? prev.contact : t.next_action_contact || '')}" placeholder="Who are you acting with?">
    </div>
    <div class="field-row">
      <div class="field">
        <label>Contingency date</label>
        <input id="ca-ctg-date" type="date" value="${OAD.esc(prev.ctg_date || '')}">
      </div>
      <div class="field">
        <label>Contingency action</label>
        <input id="ca-ctg-action" type="text" value="${OAD.esc(prev.ctg_action || '')}" placeholder="If no response by that date…">
      </div>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD._cawStep2()">← Back</button>
      <button onclick="OAD._cawStep3Next()">Save →</button>
    </div>`);
  setTimeout(function () { document.getElementById('ca-action')?.focus(); }, 50);
};

OAD._isClosingAction = function (action) {
  if (!action) return true;
  const lower = action.toLowerCase();
  return lower.includes('nothing') || lower.includes('closed');
};

OAD._cawStep3Next = function () {
  const action = document.getElementById('ca-action')?.value.trim();
  if (!action) { alert('Next action is required — a thread without a next action is dead.'); return; }
  const date = document.getElementById('ca-date')?.value;
  if (!date && !OAD._isClosingAction(action)) { alert('"By when?" is required.'); return; }

  OAD._caw.step2 = {
    action:     action,
    date:       date,
    channel:    document.getElementById('ca-channel')?.value    || '',
    contact:    document.getElementById('ca-contact')?.value.trim()    || '',
    ctg_date:   document.getElementById('ca-ctg-date')?.value   || '',
    ctg_action: document.getElementById('ca-ctg-action')?.value.trim() || ''
  };
  OAD._cawSave();
};

// Save: NO path — thread stays open, next action recorded
OAD._cawSave = function () {
  const caw = OAD._caw;
  const t   = OAD.getThread(caw.id);
  if (!t) return;

  const patch = {
    assumption_verified:      caw.step1.assumption_verified,
    next_action:              caw.step2.action,
    next_action_date:         caw.step2.date,
    next_action_channel:      caw.step2.channel,
    next_action_contact:      caw.step2.contact,
    contingency_trigger_date: caw.step2.ctg_date,
    contingency_action:       caw.step2.ctg_action
  };

  if (t.deadline) patch.effortLogged = (t.effortLogged || 0) + 1;
  if (t.status === 'stalled') patch.status = 'open';

  OAD.updateThread(caw.id, patch);

  const logParts = ['Completed: ' + caw.step1.what_done];
  if (caw.step1.assumption_verified && !t.assumption_verified) logParts.push('Assumption verified.');
  logParts.push('Next: ' + caw.step2.action + ' by ' + caw.step2.date + '.');
  OAD.addEvolution(caw.id, logParts.join(' '));

  OAD._caw = null;
  OAD.closeModal();
  OAD.renderList();
  OAD.renderDetail(caw.id);
};

// Save: YES path — thread closes immediately, no next action required
OAD._cawSaveClose = function () {
  const caw = OAD._caw;
  const t   = OAD.getThread(caw.id);
  if (!t) return;

  const patch = {
    assumption_verified:   caw.step1.assumption_verified,
    status:                'closed',
    closing_condition_met: true
  };

  if (t.deadline) patch.effortLogged = (t.effortLogged || 0) + 1;

  OAD.updateThread(caw.id, patch);

  const logParts = ['Completed: ' + caw.step1.what_done];
  if (caw.step1.assumption_verified && !t.assumption_verified) logParts.push('Assumption verified.');
  logParts.push('Closing condition met — thread closed.');
  OAD.addEvolution(caw.id, logParts.join(' '));

  OAD._caw = null;
  OAD.closeModal();
  OAD.renderList();
  OAD.renderDetail(caw.id);
};

// ── Auth modal ────────────────────────────────────────────────────────

OAD.openSignInModal = function (opts) {
  opts = opts || {};
  const msg = opts.message ? `<div class="auth-message">${OAD.esc(opts.message)}</div>` : '';
  OAD.openModal(`
    <h2>Sign In to One-A-Day</h2>
    ${msg}
    <div class="field">
      <label>Email</label>
      <input id="auth-email" type="email" placeholder="you@example.com" autocomplete="email">
    </div>
    <div class="field">
      <label>Password</label>
      <input id="auth-password" type="password" placeholder="Password" autocomplete="current-password">
    </div>
    <div id="auth-error" style="color:var(--critical);font-size:13px;min-height:18px"></div>
    <div class="modal-footer" style="flex-direction:column;gap:8px">
      <button class="success" style="width:100%" onclick="OAD._signIn()">Sign In</button>
      <button class="secondary" style="width:100%" onclick="OAD._signUp()">Create Account</button>
    </div>`);
  setTimeout(() => document.getElementById('auth-email')?.focus(), 50);
};

OAD._authError = function (msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
};

OAD._signIn = async function () {
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { OAD._authError('Email and password are required.'); return; }
  OAD._authError('');
  const btn = document.querySelector('.modal .success');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  const { data, error } = await OAD.supabase.auth.signInWithPassword({ email, password });
  if (error) {
    OAD._authError(error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    return;
  }
  OAD._userId = data.user.id;
  OAD.closeModal();
  await OAD._bootAfterAuth();
};

OAD._signUp = async function () {
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { OAD._authError('Email and password are required.'); return; }
  if (password.length < 6) { OAD._authError('Password must be at least 6 characters.'); return; }
  OAD._authError('');
  const btn = document.querySelector('.modal .secondary');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  const { data, error } = await OAD.supabase.auth.signUp({ email, password });
  if (error) {
    OAD._authError(error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    return;
  }
  // If Supabase requires email confirmation, data.session is null.
  // Tell the user to confirm, then sign in.
  if (!data.session) {
    OAD.openModal(`
      <h2>Check Your Email</h2>
      <p style="color:var(--text-muted);font-size:14px;line-height:1.5">
        A confirmation link has been sent to <strong>${OAD.esc(email)}</strong>.<br><br>
        Click the link in that email, then come back and <strong>Sign In</strong> with your credentials.<br><br>
        To skip this step in future: Supabase dashboard → Authentication → Providers →
        disable <em>Confirm email</em>.
      </p>
      <div class="modal-footer">
        <button class="success" style="width:100%" onclick="OAD.openSignInModal()">Go to Sign In</button>
      </div>`);
    return;
  }
  OAD._userId = data.user.id;
  OAD.closeModal();
  await OAD._bootAfterAuth();
};

OAD.openSignOutModal = function () {
  OAD.openModal(`
    <h2>Sign Out</h2>
    <p style="color:var(--text-muted);font-size:14px">Your data is saved to Supabase. You can sign back in on any device.</p>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._signOut()">Sign Out</button>
    </div>`);
};

OAD._signOut = async function () {
  await OAD.supabase.auth.signOut();
  OAD._userId = null;
  OAD._DB_PERSIST = false;
  OAD.DB = { threads: [], cadences: [], persona: JSON.parse(JSON.stringify(OAD.DB.persona)) };
  OAD.closeModal();
  OAD.openSignInModal({ message: 'You have been signed out.' });
};
