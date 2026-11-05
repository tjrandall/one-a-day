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

OAD._stageOptions = function (selected) {
  var all = ['— Not an application —'].concat(OAD.APPLICATION_STAGES, OAD.APPLICATION_TERMINAL_STAGES);
  return all.map(function (s) {
    var value = s === '— Not an application —' ? '' : s;
    return '<option value="' + value + '" ' + (value === (selected || '') ? 'selected' : '') + '>' + s + '</option>';
  }).join('');
};

// Threads this one may sit under. Excludes itself, its descendants, and closed
// threads, so a bollard cannot be parented under its own child.
OAD.parentChoices = function (thread) {
  var banned = {};
  if (thread && thread.uuid) {
    banned[thread.uuid] = true;
    if (OAD.Bulk && OAD.Bulk.descendants) {
      OAD.Bulk.descendants(thread.uuid).forEach(function (d) { banned[d.uuid] = true; });
    }
  }
  return (OAD.DB.threads || []).filter(function (x) {
    if (!x || !x.uuid || banned[x.uuid]) return false;
    if (x.status === 'closed') return false;
    if (thread && x.id != null && thread.id != null && x.id === thread.id) return false;
    return true;
  }).sort(function (a, b) {
    return (a.title || '').localeCompare(b.title || '');
  });
};

OAD._parentFieldsHtml = function (thread) {
  OAD._parentPickerThread = thread || null;
  var current = thread && thread.parent_uuid ? OAD.getThreadByUUID(thread.parent_uuid) : null;
  var hasParent = !!(thread && thread.parent_uuid);
  var currentLabel = current ? current.title : 'a missing thread';
  return `
    <div class="field parent-picker">
      <label>Parent</label>
      <div id="f-parent-summary" class="parent-summary">
        <div id="f-parent-current" class="parent-current"${hasParent ? '' : ' hidden'}>Current: ${OAD.esc(currentLabel)}</div>
        <button type="button" id="f-parent-open" class="parent-open">${hasParent ? 'Change' : 'Add parent'}</button>
      </div>
      <div id="f-parent-chooser" hidden>
        <div class="autocomplete-container">
          <input type="text" id="f-parent-search" placeholder="Search threads..." autocomplete="off" />
          <input type="hidden" id="f-parent-uuid" value="${OAD.esc((thread && thread.parent_uuid) || '')}" />
          <div id="f-parent-count" class="connection-count"></div>
          <div id="f-parent-results" class="autocomplete-results"></div>
        </div>
      </div>
    </div>`;
};

OAD._initParentPicker = function () {
  var thread = OAD._parentPickerThread;
  var searchInput = document.getElementById('f-parent-search');
  var uuidInput = document.getElementById('f-parent-uuid');
  var resultsDiv = document.getElementById('f-parent-results');
  var countEl = document.getElementById('f-parent-count');
  var currentEl = document.getElementById('f-parent-current');
  var chooser = document.getElementById('f-parent-chooser');
  var openBtn = document.getElementById('f-parent-open');
  if (!searchInput || !uuidInput || !resultsDiv || !chooser || !openBtn) return;

  var choices = OAD.parentChoices(thread);
  var activeIndex = -1;

  function parentLabel(uuid) {
    var picked = choices.filter(function (t) { return t.uuid === uuid; })[0];
    if (picked) return picked.title;
    var stored = OAD.getThreadByUUID(uuid);
    return stored ? stored.title : 'a missing thread';
  }

  function paintSummary() {
    var uuid = uuidInput.value || '';
    var open = !chooser.hidden;
    if (currentEl) {
      currentEl.hidden = !uuid;
      if (uuid) currentEl.textContent = 'Current: ' + parentLabel(uuid);
    }
    openBtn.textContent = open ? 'Close' : (uuid ? 'Change' : 'Add parent');
  }

  function setChooserOpen(open) {
    chooser.hidden = !open;
    if (!open) {
      searchInput.value = '';
      activeIndex = -1;
    }
    paintSummary();
    if (open) {
      showList();
      searchInput.focus();
    }
  }

  function matches(t, q) {
    return (t.title || '').toLowerCase().includes(q) ||
           (t.life_area || '').toLowerCase().includes(q) ||
           (t.status || '').toLowerCase().includes(q);
  }

  function renderList(query) {
    var q = (query || '').toLowerCase().trim();
    var filtered = choices.filter(function (t) { return matches(t, q); });
    if (countEl) {
      countEl.textContent = q
        ? (filtered.length + ' of ' + choices.length)
        : (choices.length + ' thread' + (choices.length === 1 ? '' : 's'));
    }
    var selected = uuidInput.value || '';
    var noneClass = selected ? '' : ' selected';
    var rows = '<div class="autocomplete-item' + noneClass + '" data-uuid="">' +
      '<span class="item-title"><strong>No parent</strong></span></div>';
    if (!filtered.length) {
      rows += '<div class="autocomplete-item text-muted">No threads found</div>';
    } else {
      rows += filtered.map(function (t, idx) {
        var activeClass = idx === activeIndex ? ' active' : '';
        var selectedClass = t.uuid === selected ? ' selected' : '';
        return '<div class="autocomplete-item' + activeClass + selectedClass + '" data-uuid="' + OAD.esc(t.uuid) + '">' +
          '<span class="item-title"><strong>' + OAD.esc(t.title) + '</strong></span>' +
          '<span class="item-meta"><span class="item-area">' + OAD.esc(t.life_area) + '</span>' +
          '<span class="item-area">' + OAD.esc(t.status) + '</span></span></div>';
      }).join('');
    }
    resultsDiv.innerHTML = rows;
    var none = resultsDiv.querySelector('[data-uuid=""]');
    if (none) none.addEventListener('click', function () { selectParent(null); });
    Array.from(resultsDiv.querySelectorAll('.autocomplete-item[data-uuid]')).forEach(function (item) {
      if (!item.getAttribute('data-uuid')) return;
      item.addEventListener('click', function () {
        var uuid = item.getAttribute('data-uuid');
        var picked = filtered.filter(function (t) { return t.uuid === uuid; })[0];
        if (picked) selectParent(picked);
      });
    });
    return filtered;
  }

  function selectParent(picked) {
    uuidInput.value = picked ? picked.uuid : '';
    setChooserOpen(false);
  }

  function showList() {
    resultsDiv.style.display = 'block';
    renderList(searchInput.value);
  }

  function scrollItemIntoView(activeEl) {
    if (!activeEl) return;
    var elRect = activeEl.getBoundingClientRect();
    var boxRect = resultsDiv.getBoundingClientRect();
    if (elRect.top < boxRect.top) resultsDiv.scrollTop -= (boxRect.top - elRect.top);
    else if (elRect.bottom > boxRect.bottom) resultsDiv.scrollTop += (elRect.bottom - boxRect.bottom);
  }

  searchInput.addEventListener('input', function () {
    activeIndex = -1;
    showList();
  });

  searchInput.addEventListener('keydown', function (e) {
    var q = searchInput.value.toLowerCase().trim();
    var filtered = choices.filter(function (t) { return matches(t, q); });
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      if (e.key === 'ArrowDown') activeIndex = (activeIndex + 1) % filtered.length;
      else activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      showList();
      scrollItemIntoView(resultsDiv.querySelector('.autocomplete-item.active'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) selectParent(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setChooserOpen(false);
    }
  });

  openBtn.addEventListener('click', function () {
    setChooserOpen(chooser.hidden);
  });
};

OAD._threadForm = function (t) {
  var repeatBlock = '';
  if (t && (t.thread_kind === 'habit' || t.thread_kind === 'cadence')) {
    if (OAD.Repeat && OAD.Repeat.ensure) OAD.Repeat.ensure(t);
    repeatBlock = OAD._repeatFieldsHtml('f', t.repeat, t.next_due);
  }
  return `
    <div class="field">
      <label>Title</label>
      <input id="f-title" type="text" value="${OAD.esc(t.title)}" placeholder="What is this thread about?">
    </div>
    ${repeatBlock}
    ${OAD._parentFieldsHtml(t)}
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
      <textarea id="f-next-action" placeholder="What is the specific next step?">${OAD.esc(t.next_action)}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label>By Date</label>
        <input id="f-next-date" type="date" value="${OAD.esc(t.next_action_date)}" onchange="OAD._pickLoadDay(this.value)">
      </div>
      <div class="field">
        <label>By Time <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input id="f-next-time" type="time" value="${OAD.esc(t.next_action_time || '')}">
      </div>
      <div class="field">
        <label>Channel</label>
        <input id="f-next-channel" type="text" value="${OAD.esc(t.next_action_channel)}" placeholder="email, phone, in-person…">
      </div>
    </div>
    ${(typeof OAD.weekLoadHtml === 'function') ? OAD.weekLoadHtml(t.next_action_date || '') : ''}
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
    </div>

    <div class="field">
      <label>Dormant Re-engagement Trigger <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(set when status is Dormant)</span></label>
      <input id="f-dormant-trigger" type="text" value="${OAD.esc(t.dormant_trigger || '')}" placeholder="e.g. Re-engage when SDVOSB certified or APEX contract won">
    </div>
    <div class="field" style="align-self:end">
      <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;margin:0">
        <input type="checkbox" id="f-user-action-complete" ${t.user_action_complete ? 'checked' : ''} style="width:auto">
        I've done my part — ball in their court <span class="text-muted" style="font-size:12px">(suppresses Focus Now; only applies when status is Waiting)</span>
      </label>
    </div>

    <div class="field-section-label">Job Application Tracking <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional — only for leaf application threads; feeds Runway Risk)</span></div>
    <div class="field">
      <label>Pipeline Stage</label>
      <select id="f-stage">${OAD._stageOptions(t.stage)}</select>
    </div>

    <div class="field-section-label">Deadline Tracking <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></div>
    <div class="field-row">
      <div class="field">
        <label>Deadline</label>
        <input id="f-deadline" type="date" value="${OAD.esc(t.deadline || '')}">
      </div>
      <div class="field">
        <label>Deadline Time <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input id="f-deadline-time" type="time" value="${OAD.esc(t.deadline_time || '')}">
      </div>
      <div class="field">
        <label>Total sessions needed</label>
        <input id="f-effort-estimate" type="number" min="1" step="1" value="${t.effortEstimate != null ? t.effortEstimate : ''}" placeholder="e.g. 4">
      </div>
      <div class="field">
        <label>Sessions/week required</label>
        <input id="f-weekly-commitment" type="number" min="1" step="1" value="${t.weeklyCommitment != null ? t.weeklyCommitment : ''}" placeholder="e.g. 1">
      </div>
    </div>
    <div class="field">
      <label>Day impact <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
      <select id="f-day-impact">
        <option value=""${OAD._dayImpact(t.day_impact) === '' ? ' selected' : ''}>Normal work day</option>
        <option value="partial"${t.day_impact === 'partial' ? ' selected' : ''}>Part of this day is gone</option>
        <option value="full"${t.day_impact === 'full' ? ' selected' : ''}>This whole day is gone</option>
        <option value="windshield"${t.day_impact === 'windshield' ? ' selected' : ''}>Driving day. Calls fit, desk work does not</option>
      </select>
      <div class="text-muted text-sm">Uses the next action date, or the deadline when that is empty. The assistant relates that day to the work due the same week. It does not block that work. A driving day still allows calls.</div>
    </div>`;
};

OAD._readThreadForm = function (base) {
  const title = document.getElementById('f-title')?.value.trim() || '';
  if (!title) { alert('Title is required.'); return null; }
  var data = Object.assign({}, base, {
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
    next_action_time:        document.getElementById('f-next-time')?.value || null,
    next_action_channel:     document.getElementById('f-next-channel')?.value.trim() || '',
    next_action_contact:     document.getElementById('f-next-contact')?.value.trim() || '',
    contingency_trigger_date: document.getElementById('f-ctg-date')?.value || '',
    contingency_action:      document.getElementById('f-ctg-action')?.value.trim() || '',
    contingency_escalation:  document.getElementById('f-ctg-escalation')?.value.trim() || '',
    deadline:          document.getElementById('f-deadline')?.value || null,
    deadline_time:     document.getElementById('f-deadline-time')?.value || null,
    day_impact:        OAD._dayImpact(document.getElementById('f-day-impact')?.value || ''),
    travel_miles:      OAD._dayImpact(document.getElementById('f-day-impact')?.value || '') === 'windshield' ? (base.travel_miles != null ? base.travel_miles : null) : null,
    travel_minutes:    OAD._dayImpact(document.getElementById('f-day-impact')?.value || '') === 'windshield' ? (base.travel_minutes != null ? base.travel_minutes : null) : null,
    effortEstimate:    document.getElementById('f-effort-estimate')?.value !== ''
                         ? parseInt(document.getElementById('f-effort-estimate').value, 10) : null,
    weeklyCommitment:  document.getElementById('f-weekly-commitment')?.value !== ''
                         ? parseInt(document.getElementById('f-weekly-commitment').value, 10) : null,
    dormant_trigger:   document.getElementById('f-dormant-trigger')?.value.trim() || '',
    user_action_complete: (document.getElementById('f-status')?.value === 'waiting')
                         ? (document.getElementById('f-user-action-complete')?.checked || false)
                         : false,
    stage: document.getElementById('f-stage')?.value || null
  });
  if (document.getElementById('f-every') && OAD.Repeat && OAD.Repeat.commit) {
    var typed = document.getElementById('f-repeat-next');
    var typedValue = typed ? typed.value : '';
    var opened = OAD.Repeat._opened && OAD.Repeat._opened.f;
    var committed = OAD.Repeat.commit(
      base,
      OAD.Repeat.readFields('f'),
      typedValue,
      typedValue !== (base.next_due || ''),
      opened
    );
    data.repeat = committed.repeat;
    data.next_due = committed.next_due;
    data.days_of_week = committed.days_of_week;
    data._repeatNote = committed.note;
  }
  var parentInput = document.getElementById('f-parent-uuid');
  if (parentInput) {
    var parentUuid = parentInput.value || null;
    if (parentUuid && parentUuid !== (base.parent_uuid || null)) {
      var allowed = OAD.parentChoices(base).some(function (c) { return c.uuid === parentUuid; });
      if (!allowed) { alert('Pick a parent from the list.'); return null; }
    }
    data.parent_uuid = parentUuid;
  }
  return data;
};

OAD.openPromoteIdeaModal = function (id) {
  const idea = OAD.getIdea(id);
  if (!idea) return;
  const starter = OAD.makeThread({ title: idea.title });
  OAD.openModal(`
    <h2>Promote Idea to Thread</h2>
    <div class="promote-notice">
      You are turning an incubated idea into a committed thread. This means defining a closing condition,
      a next action, and taking ownership of it. The idea will remain in your incubation list.
    </div>
    ${OAD._threadForm(starter)}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel — keep incubating</button>
      <button onclick="OAD._savePromotedThread()">Create Thread</button>
    </div>`);
  OAD._initParentPicker();
};

OAD._savePromotedThread = function () {
  const data = OAD._readThreadForm(OAD.makeThread());
  if (!data) return;
  const thread = OAD.addThread(data);
  if (thread.parent_uuid && OAD.syncParentEdge) {
    OAD.syncParentEdge(thread, null);
    OAD.saveDB();
  }
  if (OAD.Capacity && OAD.Capacity.syncEdges) OAD.Capacity.syncEdges();
  var promoteNote = 'Thread promoted from idea incubation.';
  if (thread.parent_uuid) {
    var promoteParent = OAD.getThreadByUUID(thread.parent_uuid);
    promoteNote += ' Parent → ' + (promoteParent ? promoteParent.title : 'another thread') + '.';
  }
  OAD.addEvolution(thread.id, promoteNote);
  OAD.closeModal();
  OAD.refreshActiveView();
  OAD.selectThread(thread.id);
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
  OAD._initParentPicker();
};

OAD._saveNewThread = function () {
  const data = OAD._readThreadForm(OAD.makeThread());
  if (!data) return;
  const thread = OAD.addThread(data);
  if (thread.parent_uuid && OAD.syncParentEdge) {
    OAD.syncParentEdge(thread, null);
    OAD.saveDB();
  }
  if (OAD.Capacity && OAD.Capacity.syncEdges) OAD.Capacity.syncEdges();
  var createdNote = 'Thread created.';
  if (thread.parent_uuid) {
    var createdParent = OAD.getThreadByUUID(thread.parent_uuid);
    createdNote += ' Parent → ' + (createdParent ? createdParent.title : 'another thread') + '.';
  }
  OAD.addEvolution(thread.id, createdNote);
  OAD.closeModal();
  OAD.refreshActiveView();
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
  if ((t.thread_kind === 'habit' || t.thread_kind === 'cadence') && OAD.Repeat && OAD.Repeat.remember) {
    OAD.Repeat.syncFields('f', false);
    OAD.Repeat.remember('f');
  }
  OAD._initParentPicker();
};

OAD._saveEditThread = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  const data = OAD._readThreadForm(t);
  if (!data) return;
  const repeatNote = data._repeatNote || '';
  delete data._repeatNote;

  const prevParent = t.parent_uuid || null;
  const prev = { status: t.status, priority: t.priority, assumption_verified: t.assumption_verified, next_action_date: t.next_action_date };
  // Guarded by prev.status !== 'closed': the "closing_condition_met" checkbox isn't wired to
  // the status dropdown, so it stays checked from a prior closure unless the user separately
  // unchecks it. Without this guard, reopening a closed thread (status: closed -> open) would
  // misread as a fresh close, firing the closure wizard and its dependency-break flow on a
  // thread that was never actually being closed by this save.
  const isClosing = (data.status === 'closed' || data.closing_condition_met) && prev.status !== 'closed';
  const notes = [];
  if (prev.status !== data.status) {
    notes.push(`Status → ${data.status}`);
    if (prev.status === 'dormant' && data.status !== 'dormant') {
      notes.push('Re-activated from dormant' + (data.dormant_trigger ? ' (trigger: ' + data.dormant_trigger + ')' : ''));
    }
  }
  if (prev.priority !== data.priority) notes.push(`Priority → ${data.priority}`);
  if (!prev.assumption_verified && data.assumption_verified) notes.push('Assumption verified');
  if (repeatNote) notes.push(repeatNote);
  var nextParent = data.parent_uuid || null;
  if (prevParent !== nextParent) {
    if (!nextParent) notes.push('Parent cleared');
    else {
      var parentThread = OAD.getThreadByUUID(nextParent);
      notes.push('Parent → ' + (parentThread ? parentThread.title : 'another thread'));
    }
  }

  if (prev.next_action_date !== data.next_action_date && prev.next_action_date && data.next_action_date) {
    if (data.next_action_date > prev.next_action_date) {
      data.date_push_count = (t.date_push_count || 0) + 1;
      notes.push(`Date pushed back to ${data.next_action_date}`);
      
      if (data.date_push_count % 3 === 0) {
        OAD.closeModal();
        OAD.openPushbackWizard(id, data, notes);
        return;
      }
    } else {
      notes.push(`Date moved up to ${data.next_action_date}`);
    }
  }

  if (isClosing && OAD.needsClosureWizard && OAD.needsClosureWizard(id)) {
    OAD.closeModal();
    OAD.openClosureWizard(id, data, notes.length ? notes.join('; ') : '');
  } else {
    OAD.updateThreadAndLog(id, data, notes.length ? notes.join('; ') : null);
    if (OAD.Capacity && OAD.Capacity.syncEdges) OAD.Capacity.syncEdges();
    OAD.closeModal();
    OAD.refreshActiveView();
    if (isClosing) {
      const panel = document.getElementById('detail-content');
      if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
      OAD.goBackToLastView();
    } else {
      OAD.renderDetail(id);
    }
  }
};

OAD._deleteThread = function (id) {
  if (!confirm('Delete this thread? This cannot be undone.')) return;
  OAD.deleteThread(id);
  OAD._activeId = null;
  OAD.closeModal();
  OAD.refreshActiveView();
  const panel = document.getElementById('detail-content');
  if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
};

OAD.openPushbackWizard = function(id, data, notes) {
  // Pending data lives on OAD, not round-tripped through an inline onclick attribute —
  // encodeURIComponent leaves apostrophes un-escaped (they're in its unreserved set), so
  // any thread text field containing one (e.g. "Kevin's email") broke out of the
  // single-quoted onclick string and silently corrupted the handler's JS. Same pattern
  // as OAD._pendingImport.
  OAD._pendingPushback = { id: id, data: data, notes: notes };
  OAD.openModal(`
    <h2>Coach Pushback</h2>
    <div class="field" style="color: var(--critical); margin-bottom: 16px;">
      You've pushed the date back on this thread ${data.date_push_count} times.
      The AI coach is requesting clarification. What is actually blocking this?
    </div>
    <div class="field">
      <label>Real Blocking Reason</label>
      <textarea id="f-pushback-reason" placeholder="What's the real truth here?"></textarea>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD._pendingPushback=null; OAD.openEditModal(${id})">Cancel Date Change</button>
      <button onclick="OAD._confirmPushback()">Acknowledge & Save</button>
    </div>
  `);
};

OAD._confirmPushback = function() {
  if (!OAD._pendingPushback) return;
  const id = OAD._pendingPushback.id;
  const data = OAD._pendingPushback.data;
  const notes = OAD._pendingPushback.notes;
  const reason = document.getElementById('f-pushback-reason')?.value.trim();
  if (!reason) { alert('Please provide the real reason.'); return; }
  OAD._pendingPushback = null;

  notes.push(`Coach Pushback Answered: ${reason}`);
  data.current_assumption = reason;
  data.assumption_verified = false;
  
  const isClosing = (data.status === 'closed' || data.closing_condition_met);
  
  OAD.updateThread(id, data);
  if (notes.length) OAD.addEvolution(id, notes.join('; '));
  OAD.closeModal();
  OAD.refreshActiveView();
  
  if (isClosing) {
    const panel = document.getElementById('detail-content');
    if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
    OAD.goBackToLastView();
  } else {
    OAD.renderDetail(id);
    
    // Optionally trigger AI Insight generation for the new context
    if (typeof OAD.genInsight === 'function' && (OAD.API_KEY || OAD.GEMINI_API_KEY)) {
       OAD.genInsight(OAD.getThread(id)).then(insight => {
         if (insight) {
           OAD.addInsight(id, insight, 'auto');
           OAD.renderDetail(id);
         }
       }).catch(console.error);
    }
  }

  // Hook: Tendency Evidence + Promotion (replaces the old single-thread "Persona Auto-Evolution").
  // Logs this pushback's "Real Blocking Reason" text as structured, cross-thread evidence — its
  // first real structured home (previously only reached current_assumption, overwritten every
  // time, and a generic evolution_log note mixed in with every other event type) — then checks
  // whether the resulting life_area cluster clears OAD.evaluateTendencyCandidates' statistical
  // gate BEFORE ever making an LLM call about it. Per the tendency-detection redesign: no path
  // from one excuse on one thread straight to a persona write.
  const t = OAD.getThread(id);
  if (t) OAD.logTendencyEvidence(t.uuid, 'pushback', reason);
  if (t && typeof OAD.characterizeTendencyCluster === 'function' && (OAD.API_KEY || OAD.GEMINI_API_KEY)) {
    const candidate = OAD.evaluateTendencyCandidates().find(function (c) { return c.life_area === t.life_area; });
    if (candidate) {
      OAD.characterizeTendencyCluster(candidate).then(lesson => {
        if (lesson && lesson.warrants_update) {
          // Mark this cluster's evidence consumed only once actually surfaced to the user — a
          // model that itself declines (warrants_update: false) leaves the evidence available to
          // accumulate further, rather than being silently discarded.
          const evidence = OAD.DB.persona.tendency_evidence || [];
          candidate.evidence_row_ids.forEach(function (rowId) {
            const row = evidence.find(function (r) { return r.id === rowId; });
            if (row) row.consumed = true;
          });
          OAD.saveDB();
          OAD.openPersonaUpdateModal(Object.assign({}, lesson, {
            evidence_strength: candidate.evidence_strength,
            occurrence_count: candidate.occurrence_count,
            distinct_thread_count: candidate.distinct_thread_count,
            span_days: candidate.span_days,
            evidence_thread_uuids: candidate.evidence_thread_uuids,
            first_observed: candidate.first_observed,
            last_observed: candidate.last_observed
          }));
        }
      }).catch(console.error);
    }
  }
};

// Pending lesson lives on OAD, not round-tripped through an inline onclick attribute —
// encodeURIComponent leaves apostrophes un-escaped (they're in its unreserved set), and this
// modal's whole content is LLM-generated natural language (coach_message/proposed_addition),
// which contains contractions and possessives constantly. Confirmed live: both Refute and Accept
// Update silently threw "missing ) after argument list" and did nothing — no dismissal, no
// logged pushback, no persona update, no visible error — the instant either field contained an
// apostrophe. Same failure mode already fixed for OAD._pendingPushback/OAD._pendingImport
// elsewhere in this file; this modal was just missed.
OAD._pendingPersonaLesson = null;

OAD.openPersonaUpdateModal = function (lesson) {
  OAD._pendingPersonaLesson = lesson;
  // evidence_strength is only present on cluster-derived lessons (OAD.characterizeTendencyCluster)
  // — never absent on those, since it's computed mechanically, not asked of the model. Labeled
  // explicitly as NOT a probability, matching the reasoning in OAD.tendencyEvidenceStrength
  // (js/engine.js), so this never reads as more rigorous than it is.
  const evidenceLine = (lesson.occurrence_count != null)
    ? `${lesson.occurrence_count} occurrences across ${lesson.distinct_thread_count} distinct threads over ${lesson.span_days} days — evidence strength ${lesson.evidence_strength.toFixed(2)} (how far past the minimum evidentiary bar this cluster sits, not a probability the trait is true)`
    : '';
  OAD.openModal(`
    <h2>Coach Observation</h2>
    <div id="coach-observation-content">
      <p style="margin-bottom: 16px; color: var(--text-muted);">${OAD.esc(lesson.coach_message)}</p>
      ${evidenceLine ? `<p class="text-muted text-sm" style="margin-bottom:16px">${OAD.esc(evidenceLine)}</p>` : ''}
      <div class="field" style="margin-bottom: 16px;">
        <label>Proposed Addition to <strong>${OAD.esc(lesson.target_list)}</strong>:</label>
        <div style="padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;">
          ${OAD.esc(lesson.proposed_addition)}
        </div>
      </div>
      ${lesson.suggested_adjustment ? `
      <div class="field" style="margin-bottom: 16px;">
        <label>Suggested Adjustment:</label>
        <div style="padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;">
          ${OAD.esc(lesson.suggested_adjustment)}
        </div>
      </div>` : ''}
      <div class="field" style="margin-bottom: 16px;">
        <label>Push Back / Provide Context (Optional):</label>
        <textarea id="coach-rebuttal" placeholder="If the coach lacks context (e.g., waiting on government bureaucracy), explain it here..." style="width:100%; height:60px; padding:8px; border:1px solid var(--border); border-radius:4px;"></textarea>
      </div>
      <div class="modal-footer">
        <button class="secondary" onclick="OAD._pendingPersonaLesson=null; OAD.closeModal()">Dismiss</button>
        <button class="primary" id="rebut-btn" onclick="OAD._rebutPersonaUpdate()">Refute</button>
        <button class="success" onclick="OAD._acceptPersonaUpdate()">Accept Update</button>
      </div>
    </div>
  `);
};

OAD._rebutPersonaUpdate = async function () {
  if (!OAD._pendingPersonaLesson) return;
  const rebuttal = document.getElementById('coach-rebuttal').value.trim();
  if (!rebuttal) {
    alert("Please provide context to refute the observation.");
    return;
  }

  const btn = document.getElementById('rebut-btn');
  btn.disabled = true;
  btn.textContent = 'Thinking...';

  try {
    const lesson = OAD._pendingPersonaLesson;
    const response = await OAD.refutePersonaLesson(lesson, rebuttal);

    let html = `<h2>Coach Response</h2>
      <p style="margin-bottom: 16px; color: ${response.conceded ? 'var(--success)' : 'var(--danger)'}; font-weight: 500;">${OAD.esc(response.coach_response)}</p>`;

    if (response.warrants_update && response.proposed_addition) {
       lesson.proposed_addition = response.proposed_addition;
       OAD._pendingPersonaLesson = lesson;
       html += `
       <div class="field" style="margin-bottom: 16px;">
        <label>Revised Addition to <strong>${OAD.esc(lesson.target_list)}</strong>:</label>
        <div style="padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;">
          ${OAD.esc(lesson.proposed_addition)}
        </div>
       </div>
       <div class="field" style="margin-bottom: 16px;">
        <label>Push Back / Provide Context (Optional):</label>
        <textarea id="coach-rebuttal" placeholder="If the coach still lacks context, explain further here..." style="width:100%; height:60px; padding:8px; border:1px solid var(--border); border-radius:4px;"></textarea>
       </div>
       <div class="modal-footer">
        <button class="secondary" onclick="OAD._pendingPersonaLesson=null; OAD.closeModal()">Dismiss</button>
        <button class="primary" id="rebut-btn" onclick="OAD._rebutPersonaUpdate()">Refute</button>
        <button class="success" onclick="OAD._acceptPersonaUpdate()">Accept Revised Update</button>
       </div>
       `;
    } else {
       OAD._pendingPersonaLesson = null;
       html += `<div class="modal-footer">
        <button class="secondary" onclick="OAD.closeModal()">Close</button>
       </div>`;
    }

    document.getElementById('coach-observation-content').innerHTML = html;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Refute';
    alert("Error processing rebuttal: " + e.message);
  }
};


// Writes a structured trait, not a bare string — the full evidentiary record (what threads, how
// many occurrences, what span, the mechanically-computed evidence_strength) travels with the
// trait itself, not just its text. OAD.personaTendencyText (js/data.js) reads .text back out for
// every consumer, so this coexists with any pre-redesign plain-string entries without a
// destructive migration. revalidate_after/expiry is a deliberately later phase — not implied here.
OAD._acceptPersonaUpdate = function () {
  if (!OAD._pendingPersonaLesson) return;
  const lesson = OAD._pendingPersonaLesson;
  const listName = lesson.target_list === 'what_is_not_working' ? 'what_is_not_working' : 'assumption_tendencies';
  OAD.DB.persona[listName] = OAD.DB.persona[listName] || [];
  OAD.DB.persona[listName].push({
    text: lesson.proposed_addition,
    suggested_adjustment: lesson.suggested_adjustment || '',
    evidence_strength: lesson.evidence_strength != null ? lesson.evidence_strength : null,
    evidence_thread_uuids: lesson.evidence_thread_uuids || [],
    occurrence_count: lesson.occurrence_count != null ? lesson.occurrence_count : null,
    first_observed: lesson.first_observed || null,
    last_observed: lesson.last_observed || null,
    source: 'auto-promoted',
    status: 'active',
    added: OAD.todayStr()
  });
  OAD._pendingPersonaLesson = null;
  OAD.saveDB();
  OAD.closeModal();
};

OAD.openThreadFromNotice = function (uuid) {
  var t = OAD.getThreadByUUID(uuid);
  if (!t) return;
  OAD.closeModal();
  OAD.selectThread(t.id);
};

OAD.openHealthThread = function (uuid) {
  OAD.openThreadFromNotice(uuid);
};

OAD.openHealthPanel = function () {
  var alerts = (typeof OAD.visibleHealthAlerts === 'function')
    ? OAD.visibleHealthAlerts()
    : (OAD.DB.health_alerts || []).filter(function (a) { return !a.dismissed; });
  if (!alerts.length) {
    OAD.openModal('<h2>Health</h2><p class="text-muted text-sm" style="margin-top:16px">No configuration issues detected.</p><div class="modal-footer"><button class="secondary" onclick="OAD.closeModal()">Close</button></div>');
    return;
  }

  var groups = [];
  var byUuid = {};
  alerts.forEach(function (a) {
    var key = a.thread_uuid || '';
    if (!byUuid[key]) {
      byUuid[key] = { uuid: key, title: a.thread_title || 'Untitled', alerts: [], critical: false };
      groups.push(byUuid[key]);
    }
    byUuid[key].alerts.push(a);
    if (a.severity === 'CRITICAL') byUuid[key].critical = true;
  });
  var severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  groups.forEach(function (group) {
    group.alerts.sort(function (a, b) {
      return (severityRank[a.severity] == null ? 9 : severityRank[a.severity]) -
        (severityRank[b.severity] == null ? 9 : severityRank[b.severity]);
    });
  });
  groups.sort(function (a, b) {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });

  var cards = groups.map(function (group) {
    var findings = group.alerts.map(function (a) {
      var sevClass = a.severity === 'CRITICAL' ? 'health-sev-critical' : a.severity === 'WARNING' ? 'health-sev-warning' : 'health-sev-info';
      var other = '';
      if (a.type === 'CHE-010' && a.related_uuid) {
        var otherThread = OAD.getThreadByUUID(a.related_uuid);
        var otherLabel = (otherThread && otherThread.title && otherThread.title !== a.thread_title)
          ? otherThread.title
          : 'the other copy';
        other = '<button type="button" class="ghost" onclick="OAD.openHealthThread(\'' + a.related_uuid + '\')">Open ' + OAD.esc(otherLabel) + '</button>';
      }
      return '<div class="health-finding">' +
        '<div class="health-sev ' + sevClass + '">' + OAD.esc(a.severity) + ' · ' + OAD.esc(a.type) + '</div>' +
        '<div class="health-desc">' + OAD.esc(a.description) + '</div>' +
        '<div class="health-actions">' +
          other +
          '<button type="button" class="ghost" onclick="OAD.dismissHealthAlert(\'' + a.id + '\');OAD._updateCHEBadge();OAD.openHealthPanel()">Dismiss</button>' +
        '</div>' +
      '</div>';
    }).join('');
    var titleBtn = group.uuid
      ? '<button type="button" class="health-title" onclick="OAD.openHealthThread(\'' + group.uuid + '\')">' + OAD.esc(group.title) + '</button>'
      : '<div class="health-title">' + OAD.esc(group.title) + '</div>';
    return '<div class="health-card">' + titleBtn + findings + '</div>';
  }).join('');

  var issueWord = alerts.length === 1 ? 'issue' : 'issues';
  var threadWord = groups.length === 1 ? 'thread' : 'threads';
  OAD.openModal(
    '<h2>Health</h2>' +
    '<p class="text-muted text-sm">' + alerts.length + ' ' + issueWord + ' across ' + groups.length + ' ' + threadWord + '. Open a thread to fix it.</p>' +
    cards +
    '<div class="modal-footer"><button class="secondary" onclick="OAD.closeModal()">Close</button></div>'
  );
};

OAD.openGraphIntelligencePanel = function (threadId) {
  var t = OAD.getThread(threadId);
  if (!t) return;
  var unconfirmed = (t.connections || []).filter(function (c) { return c.auto_generated && !c.confirmed_by_user; });
  if (!unconfirmed.length) {
    OAD.renderDetail(threadId);
    return;
  }
  var rows = unconfirmed.map(function (c) {
    var target = (OAD.DB.threads || []).find(function (x) { return x.uuid === c.to_uuid; });
    var targetTitle = target ? target.title : (c.to_label || c.to_uuid);
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
      '<div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px">' +
        OAD.esc(c.rule || 'ADE') + ' · ' + Math.round((c.confidence || 1) * 100) + '% confidence' +
      '</div>' +
      '<div style="font-size:13px;margin-bottom:8px">' +
        '<strong>' + OAD.esc(c.edge_type) + '</strong> → ' + OAD.esc(targetTitle) +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="success" style="font-size:12px;padding:4px 12px" ' +
          'onclick="OAD.confirmEdge(' + threadId + ',\'' + c.uuid + '\');OAD.openGraphIntelligencePanel(' + threadId + ')">✓ Confirm</button>' +
        '<button class="secondary" style="font-size:12px;padding:4px 12px" ' +
          'onclick="OAD.rejectEdge(' + threadId + ',\'' + c.uuid + '\');OAD.openGraphIntelligencePanel(' + threadId + ')">✗ Reject</button>' +
      '</div>' +
    '</div>';
  }).join('');
  OAD.openModal(
    '<h2>Graph Intelligence</h2>' +
    '<p class="text-muted text-sm" style="margin-bottom:16px">' + OAD.esc(t.title) + '</p>' +
    '<p style="margin-bottom:16px;font-size:13px">AI-inferred connections pending review. Confirm to keep, reject to suppress this suggestion permanently.</p>' +
    rows +
    '<div class="modal-footer">' +
      '<button class="secondary" onclick="OAD.closeModal();OAD.renderDetail(' + threadId + ')">Done</button>' +
    '</div>'
  );
};

OAD.checkDailyIntercept = async function () {
  const todayStr = OAD.todayStr();
  OAD.DB.persona = OAD.DB.persona || {};
  if (OAD.DB.persona.last_intercept_date === todayStr) return;
  
  if (!OAD.API_KEY && !OAD.GEMINI_API_KEY) return;
  
  OAD.openModal(`
    <div style="text-align: center; padding: 40px 20px;">
      <h2 style="margin-bottom: 16px;">Coach is reviewing your day...</h2>
      <div class="text-muted">Synthesizing load, cadences, and stalled threads.</div>
    </div>
  `);
  
  try {
    const briefing = await OAD.genDailyIntercept();
    OAD.DB.persona.last_intercept_date = todayStr;
    OAD.saveDB();
    
    OAD.openModal(`
      <h2>Morning Briefing</h2>
      <div class="field" style="margin-bottom: 16px;">
        <div style="font-weight: 600; color: var(--accent); margin-bottom: 4px;">Focus</div>
        <div>${OAD.esc(briefing.focus)}</div>
      </div>
      <div class="field" style="margin-bottom: 16px;">
        <div style="font-weight: 600; color: var(--critical); margin-bottom: 4px;">Avoidance</div>
        <div>${OAD.esc(briefing.avoidance)}</div>
      </div>
      <div class="field" style="margin-bottom: 24px;">
        <div style="font-weight: 600; color: var(--warning); margin-bottom: 4px;">Reality Check</div>
        <div>${OAD.esc(briefing.reality_check)}</div>
      </div>
      <div class="modal-footer">
        <button class="success" onclick="OAD.closeModal()">I'm on it</button>
      </div>
    `);
  } catch (err) {
    console.error(err);
    OAD.closeModal();
  }
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
  const edgeOpts = OAD.EDGE_TYPES.map(e => {
    const label = e === 'blocked_by' ? 'is blocked by' : e;
    return `<option value="${e}">${label}</option>`;
  }).join('');
  OAD.openModal(`
    <h2>Add Connection — ${OAD.esc(t.title)}</h2>
    <div class="field">
      <label>Edge Type</label>
      <select id="f-edge-type">${edgeOpts}</select>
    </div>
    <div class="field connection-picker">
      <label>Connected Thread</label>
      <div class="autocomplete-container">
        <input type="text" id="f-edge-search" placeholder="Type to search threads..." autocomplete="off" />
        <input type="hidden" id="f-edge-uuid" value="" />
        <div id="f-edge-count" class="connection-count"></div>
        <div id="f-edge-results" class="autocomplete-results"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveConnection(${id})">Add</button>
    </div>`);
  var box = document.querySelector('#modal-overlay .modal');
  if (box) box.classList.add('modal-connection');
  setTimeout(() => {
    document.getElementById('f-edge-search')?.focus();
    OAD._initConnectionAutocomplete(id);
  }, 50);
};

OAD._initConnectionAutocomplete = function (currentId) {
  const searchInput = document.getElementById('f-edge-search');
  const uuidInput = document.getElementById('f-edge-uuid');
  const resultsDiv = document.getElementById('f-edge-results');
  const countEl = document.getElementById('f-edge-count');
  if (!searchInput || !uuidInput || !resultsDiv) return;

  const threads = (OAD.DB.threads || [])
    .filter(x => x.id !== currentId && x.status !== 'closed')
    .sort((a, b) => a.title.localeCompare(b.title));

  let activeIndex = -1;

  function matches(t, q) {
    return (t.title || '').toLowerCase().includes(q) ||
           (t.life_area || '').toLowerCase().includes(q) ||
           (t.status || '').toLowerCase().includes(q) ||
           (t.description || '').toLowerCase().includes(q);
  }

  function renderList(query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = threads.filter(t => matches(t, q));
    if (countEl) {
      countEl.textContent = q
        ? (filtered.length + ' of ' + threads.length)
        : (threads.length + ' thread' + (threads.length === 1 ? '' : 's'));
    }

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div class="autocomplete-item text-muted">No threads found</div>';
      return filtered;
    }

    const selectedUuid = uuidInput.value;
    resultsDiv.innerHTML = filtered.map((t, idx) => {
      const activeClass = idx === activeIndex ? ' active' : '';
      const selectedClass = t.uuid === selectedUuid ? ' selected' : '';
      return `<div class="autocomplete-item${activeClass}${selectedClass}" data-uuid="${t.uuid}" data-title="${OAD.esc(t.title)}">
        <span class="item-title"><strong>${OAD.esc(t.title)}</strong></span>
        <span class="item-meta"><span class="item-area">${OAD.esc(t.life_area)}</span><span class="item-area">${OAD.esc(t.status)}</span></span>
      </div>`;
    }).join('');

    Array.from(resultsDiv.querySelectorAll('.autocomplete-item')).forEach((item, idx) => {
      item.addEventListener('click', () => {
        selectItem(filtered[idx]);
      });
    });

    return filtered;
  }

  function selectItem(thread) {
    if (!thread) return;
    searchInput.value = thread.title;
    uuidInput.value = thread.uuid;
    resultsDiv.style.display = 'flex';
    renderList(searchInput.value);
    const picked = resultsDiv.querySelector('.autocomplete-item.selected');
    if (picked) scrollItemIntoView(picked);
  }

  function showList() {
    resultsDiv.style.display = 'flex';
    renderList(searchInput.value);
  }

  searchInput.addEventListener('focus', () => {
    activeIndex = -1;
    showList();
  });

  searchInput.addEventListener('input', () => {
    activeIndex = -1;
    showList();
  });

  searchInput.addEventListener('keydown', (e) => {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = threads.filter(t => matches(t, q));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = (activeIndex + 1) % filtered.length;
        showList();
        scrollIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
        showList();
        scrollIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        selectItem(filtered[activeIndex]);
      } else if (filtered.length > 0) {
        selectItem(filtered[0]);
      }
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      uuidInput.value = '';
      activeIndex = -1;
      showList();
    }
  });

  showList();

  function scrollItemIntoView(activeEl) {
    if (!activeEl) return;
    const elRect = activeEl.getBoundingClientRect();
    const boxRect = resultsDiv.getBoundingClientRect();
    if (elRect.top < boxRect.top) resultsDiv.scrollTop -= (boxRect.top - elRect.top);
    else if (elRect.bottom > boxRect.bottom) resultsDiv.scrollTop += (elRect.bottom - boxRect.bottom);
  }

  function scrollIntoView() {
    scrollItemIntoView(resultsDiv.querySelector('.autocomplete-item.active'));
  }
};

OAD._saveConnection = function (id) {
  const t = OAD.getThread(id);
  if (!t) return;
  const edge_type = document.getElementById('f-edge-type')?.value;
  const to_uuid   = document.getElementById('f-edge-uuid')?.value;
  if (!to_uuid) { alert('Please select a target thread.'); return; }
  
  const target = OAD.DB.threads.find(x => x.uuid === to_uuid);
  if (!target) { alert('Invalid target thread.'); return; }
  
  const to_label = target.title;
  t.connections = t.connections || [];
  t.connections.push({
    uuid:              OAD._generateUUID(),
    to_uuid,
    to_label,
    edge_type,
    auto_generated:    false,
    rule:              null,
    confidence:        1.0,
    confirmed_by_user: true,
    created_at:        new Date().toISOString()
  });
  OAD.addEvolution(id, `Connection added: ${edge_type} → ${to_label}`);
  OAD.closeModal();
  OAD.refreshActiveView();
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
      <textarea id="f-not-working">${(p.what_is_not_working || []).map(OAD.personaTendencyText).join('\n')}</textarea>
    </div>
    <div class="field">
      <label>Assumption Tendencies (one per line)</label>
      <textarea id="f-tendencies">${(p.assumption_tendencies || []).map(OAD.personaTendencyText).join('\n')}</textarea>
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
  p.what_is_working = (document.getElementById('f-working')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  // what_is_not_working/assumption_tendencies reconcile against the existing array rather than
  // blindly replacing it — a naive re-split-and-replace (what this used to do) would silently
  // flatten every auto-promoted trait's evidence_strength/evidence_thread_uuids/source back to a
  // bare string the instant this modal was saved for any unrelated reason (e.g. just changing
  // Pressure Level). See OAD.reconcilePersonaTendencyList (js/data.js).
  p.what_is_not_working = OAD.reconcilePersonaTendencyList(p.what_is_not_working, document.getElementById('f-not-working')?.value);
  p.assumption_tendencies = OAD.reconcilePersonaTendencyList(p.assumption_tendencies, document.getElementById('f-tendencies')?.value);
  OAD.saveDB();
  OAD.closeModal();
  OAD.renderPersonaBar();
};

// ── Repeat editor ────────────────────────────────────────────────────
// One panel, inlined into the habit modal, the cadence modal, and the
// thread form. Math stays on OAD.Repeat in engine.js.

OAD.Repeat.remember = function (prefix) {
  OAD.Repeat._opened = OAD.Repeat._opened || {};
  OAD.Repeat._opened[prefix] = OAD.Repeat.readFields(prefix);
};

OAD.Repeat.syncFields = function (prefix, refresh) {
  var unitEl = document.getElementById(prefix + '-unit');
  var unit = unitEl ? unitEl.value : 'day';
  var week = document.getElementById(prefix + '-week-block');
  var month = document.getElementById(prefix + '-month-block');
  if (week) week.classList.toggle('hidden', unit !== 'week');
  if (month) month.classList.toggle('hidden', unit !== 'month');
  if (refresh !== false) OAD.Repeat.refreshChip(prefix);
};

OAD.Repeat.refreshChip = function (prefix) {
  var el = document.getElementById(prefix + '-repeat-chip');
  if (!el) return;
  el.textContent = OAD.Repeat.label(OAD.Repeat.parse(OAD.Repeat.readFields(prefix)));
};

OAD.Repeat.readFields = function (prefix) {
  var every = document.getElementById(prefix + '-every');
  var unit = document.getElementById(prefix + '-unit');
  var anchor = document.querySelector('input[name="' + prefix + '-anchor"]:checked');
  var days = [];
  document.querySelectorAll('.' + prefix + '-dow:checked').forEach(function (el) {
    days.push(parseInt(el.value, 10));
  });
  var month = document.getElementById(prefix + '-month-day');
  var endsOn = document.querySelector('input[name="' + prefix + '-ends"]:checked');
  var endsDate = document.getElementById(prefix + '-ends-date');
  return {
    every: every ? every.value : 1,
    unit: unit ? unit.value : 'day',
    anchor: anchor ? anchor.value : 'schedule',
    days_of_week: days,
    month_day: month ? month.value : 1,
    ends: (endsOn && endsOn.value === 'on' && endsDate && endsDate.value) ? endsDate.value : null
  };
};

OAD.Repeat._setDays = function (prefix, days) {
  document.querySelectorAll('.' + prefix + '-dow').forEach(function (box) {
    box.checked = days.indexOf(parseInt(box.value, 10)) !== -1;
  });
};

OAD.Repeat.applyPreset = function (prefix, name) {
  var every = document.getElementById(prefix + '-every');
  var unit = document.getElementById(prefix + '-unit');
  if (every) every.value = '1';
  if (name === 'day') {
    if (unit) unit.value = 'day';
  } else if (name === 'weekday') {
    if (unit) unit.value = 'week';
    OAD.Repeat._setDays(prefix, [1, 2, 3, 4, 5]);
  } else if (name === 'week') {
    if (unit) unit.value = 'week';
    var any = false;
    document.querySelectorAll('.' + prefix + '-dow').forEach(function (box) { if (box.checked) any = true; });
    if (!any) OAD.Repeat._setDays(prefix, [new Date().getDay()]);
  } else if (name === 'month') {
    if (unit) unit.value = 'month';
    var month = document.getElementById(prefix + '-month-day');
    var dateId = prefix === 'cd' ? 'cd-next-due' : (prefix + '-repeat-next');
    var dateEl = document.getElementById(dateId);
    var dayNum = (dateEl && dateEl.value && dateEl.value.length >= 10)
      ? parseInt(dateEl.value.slice(8, 10), 10)
      : (new Date().getDate());
    if (month && dayNum >= 1 && dayNum <= 31) month.value = String(dayNum);
  }
  OAD.Repeat.syncFields(prefix);
};

OAD._repeatDateId = function (prefix) {
  return prefix === 'cd' ? 'cd-next-due' : (prefix + '-repeat-next');
};

OAD._repeatFieldsHtml = function (prefix, repeat, nextDue, opts) {
  opts = opts || {};
  var rule = (OAD.Repeat && OAD.Repeat.parse(repeat)) || {
    every: 1, unit: 'day', days_of_week: [], month_day: 1, anchor: 'schedule', ends: null
  };
  var names = OAD._DAY_NAMES || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var dow = names.map(function (name, i) {
    var checked = rule.days_of_week.indexOf(i) !== -1 ? ' checked' : '';
    return '<label class="dow-checkbox"><input type="checkbox" class="' + prefix + '-dow" value="' + i + '"' + checked +
      ' onchange="OAD.Repeat.syncFields(\'' + prefix + '\')"> ' + name + '</label>';
  }).join('');
  var monthOpts = '';
  for (var d = 1; d <= 31; d++) {
    monthOpts += '<option value="' + d + '"' + (rule.month_day === d ? ' selected' : '') + '>' + d + '</option>';
  }
  monthOpts += '<option value="last"' + (rule.month_day === 'last' ? ' selected' : '') + '>Last day</option>';
  var chip = OAD.Repeat.label(OAD.Repeat.parse(repeat));
  var nextField = opts.omitDate ? '' : (
    '<div class="field">' +
      '<label>Next occurrence</label>' +
      '<input id="' + prefix + '-repeat-next" type="date" value="' + OAD.esc(nextDue || '') + '">' +
    '</div>'
  );
  return '<div class="repeat-panel">' +
    '<div class="repeat-presets">' +
      '<button type="button" class="secondary" onclick="OAD.Repeat.applyPreset(\'' + prefix + '\',\'day\')">Every day</button>' +
      '<button type="button" class="secondary" onclick="OAD.Repeat.applyPreset(\'' + prefix + '\',\'weekday\')">Every weekday</button>' +
      '<button type="button" class="secondary" onclick="OAD.Repeat.applyPreset(\'' + prefix + '\',\'week\')">Weekly</button>' +
      '<button type="button" class="secondary" onclick="OAD.Repeat.applyPreset(\'' + prefix + '\',\'month\')">Monthly</button>' +
    '</div>' +
    '<div class="field" style="margin-top:12px"><span id="' + prefix + '-repeat-chip" class="repeat-chip">' + OAD.esc(chip) + '</span></div>' +
    '<div class="field">' +
      '<label>Based on</label>' +
      '<div class="repeat-anchor">' +
        '<label class="dow-checkbox"><input type="radio" name="' + prefix + '-anchor" value="schedule"' + (rule.anchor !== 'completed' ? ' checked' : '') + ' onchange="OAD.Repeat.syncFields(\'' + prefix + '\')"> Scheduled date</label>' +
        '<label class="dow-checkbox"><input type="radio" name="' + prefix + '-anchor" value="completed"' + (rule.anchor === 'completed' ? ' checked' : '') + ' onchange="OAD.Repeat.syncFields(\'' + prefix + '\')"> Completed date</label>' +
      '</div>' +
    '</div>' +
    '<div class="field">' +
      '<label>Every</label>' +
      '<div class="repeat-every">' +
        '<input id="' + prefix + '-every" type="number" min="1" max="365" value="' + rule.every + '" oninput="OAD.Repeat.syncFields(\'' + prefix + '\')">' +
        '<select id="' + prefix + '-unit" onchange="OAD.Repeat.syncFields(\'' + prefix + '\')">' +
          '<option value="day"' + (rule.unit === 'day' ? ' selected' : '') + '>Days</option>' +
          '<option value="week"' + (rule.unit === 'week' ? ' selected' : '') + '>Weeks</option>' +
          '<option value="month"' + (rule.unit === 'month' ? ' selected' : '') + '>Months</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div class="field' + (rule.unit === 'week' ? '' : ' hidden') + '" id="' + prefix + '-week-block">' +
      '<label>On</label>' +
      '<div class="dow-picker">' + dow + '</div>' +
    '</div>' +
    '<div class="field' + (rule.unit === 'month' ? '' : ' hidden') + '" id="' + prefix + '-month-block">' +
      '<label>On day</label>' +
      '<select id="' + prefix + '-month-day" onchange="OAD.Repeat.syncFields(\'' + prefix + '\')">' + monthOpts + '</select>' +
    '</div>' +
    '<div class="field">' +
      '<label>Ends</label>' +
      '<div class="repeat-ends">' +
        '<label class="dow-checkbox"><input type="radio" name="' + prefix + '-ends" value="never"' + (!rule.ends ? ' checked' : '') + ' onchange="OAD.Repeat.syncFields(\'' + prefix + '\')"> Never</label>' +
        '<label class="dow-checkbox"><input type="radio" name="' + prefix + '-ends" value="on"' + (rule.ends ? ' checked' : '') + ' onchange="OAD.Repeat.syncFields(\'' + prefix + '\')"> On date</label>' +
        '<input id="' + prefix + '-ends-date" type="date" value="' + OAD.esc(rule.ends || '') + '" onchange="OAD.Repeat.syncFields(\'' + prefix + '\')">' +
      '</div>' +
    '</div>' +
    nextField +
  '</div>';
};

OAD._repeatCommitFromForm = function (base, prefix) {
  var dateEl = document.getElementById(OAD._repeatDateId(prefix));
  var typedValue = dateEl ? dateEl.value : '';
  var opened = OAD.Repeat._opened && OAD.Repeat._opened[prefix];
  return OAD.Repeat.commit(
    base,
    OAD.Repeat.readFields(prefix),
    typedValue,
    typedValue !== ((base && base.next_due) || ''),
    opened
  );
};

// ── Cadence modals ───────────────────────────────────────────────────

OAD._cadenceForm = function (c) {
  const areaOpts = OAD.LIFE_AREAS.map(function (a) {
    return '<option value="' + OAD.esc(a) + '" ' + (c.life_area === a ? 'selected' : '') + '>' + OAD.esc(a) + '</option>';
  }).join('');
  return `
    <div class="field">
      <label>Title <span style="color:var(--critical)">*</span></label>
      <input id="cd-title" type="text" value="${OAD.esc(c.title)}" placeholder="What must be done on this date?">
    </div>
    <div class="field">
      <label>Life Area</label>
      <select id="cd-area">${areaOpts}</select>
    </div>
    ${OAD._repeatFieldsHtml('cd', c.repeat, c.next_due, { omitDate: true })}
    <div class="field-row">
      <div class="field">
        <label>Next Due Date</label>
        <input id="cd-next-due" type="date" value="${OAD.esc(c.next_due || '')}">
      </div>
      <div class="field">
        <label>Last Completed</label>
        <input id="cd-last-completed" type="date" value="${OAD.esc(c.last_completed || '')}">
      </div>
    </div>
    <div class="field">
      <label>Notes</label>
      <input id="cd-notes" type="text" value="${OAD.esc(c.notes || '')}" placeholder="What specifically needs to happen?">
    </div>
    <div class="field">
      <label>Consequences if missed</label>
      <input id="cd-consequences" type="text" value="${OAD.esc(c.consequences || '')}" placeholder="What breaks if this is skipped?">
    </div>`;
};

OAD._readCadenceForm = function (base) {
  const title = document.getElementById('cd-title')?.value.trim();
  if (!title) { alert('Title is required.'); return null; }
  var committed = OAD._repeatCommitFromForm(base, 'cd');
  return Object.assign({}, base, {
    title,
    life_area:      document.getElementById('cd-area')?.value           || OAD.Config.defaultLifeArea,
    next_due:       committed.next_due,
    repeat:         committed.repeat,
    days_of_week:   committed.days_of_week,
    last_completed: document.getElementById('cd-last-completed')?.value || null,
    notes:          document.getElementById('cd-notes')?.value.trim()        || '',
    consequences:   document.getElementById('cd-consequences')?.value.trim() || '',
    _repeatNote:    committed.note
  });
};

OAD.openNewCadenceModal = function () {
  const blank = OAD.makeCadence();
  OAD.openModal(`
    <h2>New Cadence</h2>
    ${OAD._cadenceForm(blank)}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveNewCadence()">Create</button>
    </div>`);
  OAD.Repeat.syncFields('cd', false);
  OAD.Repeat.remember('cd');
  setTimeout(() => document.getElementById('cd-title')?.focus(), 50);
};

OAD._saveNewCadence = function () {
  const data = OAD._readCadenceForm(OAD.makeCadence());
  if (!data) return;
  var note = data._repeatNote || '';
  delete data._repeatNote;
  var added = OAD.addCadence(data);
  if (note) OAD.addEvolution(added.id, note);
  OAD.closeModal();
  OAD.renderCadencePanel();
};

OAD.openEditCadenceModal = function (id) {
  const c = OAD.getCadence(id);
  if (!c) return;
  OAD.openModal(`
    <h2>Edit Cadence</h2>
    ${OAD._cadenceForm(c)}
    <div class="modal-footer">
      <button class="danger" onclick="OAD._deleteCadence(${id})">Delete</button>
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveEditCadence(${id})">Save</button>
    </div>`);
  OAD.Repeat.syncFields('cd', false);
  OAD.Repeat.remember('cd');
};

OAD._saveEditCadence = function (id) {
  const c = OAD.getCadence(id);
  if (!c) return;
  const data = OAD._readCadenceForm(c);
  if (!data) return;
  var note = data._repeatNote || '';
  delete data._repeatNote;
  OAD.updateCadence(id, data);
  if (note) OAD.addEvolution(id, note);
  OAD.closeModal();
  OAD.renderCadencePanel();
};

OAD._deleteCadence = function (id) {
  const c = OAD.getCadence(id);
  if (!c) return;
  if (!confirm('Delete "' + c.title + '"? This cannot be undone.')) return;
  OAD.deleteCadence(id);
  OAD.closeModal();
  OAD.renderCadencePanel();
};

// ── Habit modals ─────────────────────────────────────────────────────

OAD._habitForm = function (h, editing) {
  var time = h.time_of_day || 'morning';
  var phase = h.phase || 'active';
  var phaseField = editing
    ? '<div class="field"><label>Phase</label><select id="hb-phase">' +
        ['active', 'check-in', 'dormant'].map(function (p) {
          return '<option value="' + p + '"' + (phase === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') +
      '</select></div>'
    : '';
  return '<div class="field">' +
      '<label>Title <span style="color:var(--critical)">*</span></label>' +
      '<input id="hb-title" type="text" value="' + OAD.esc(h.title || '') + '" placeholder="What are you checking in on?">' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Life Area</label><select id="hb-area">' + OAD._areaOptions(h.life_area) + '</select></div>' +
      '<div class="field"><label>Time of day</label><select id="hb-time">' +
        '<option value="morning"' + (time === 'morning' ? ' selected' : '') + '>Morning</option>' +
        '<option value="evening"' + (time === 'evening' ? ' selected' : '') + '>Evening</option>' +
        '<option value="flexible"' + (time === 'flexible' ? ' selected' : '') + '>Flexible</option>' +
      '</select></div>' +
    '</div>' +
    '<div class="field"><label>Why</label>' +
      '<textarea id="hb-why" placeholder="Why this matters">' + OAD.esc(h.why || '') + '</textarea>' +
    '</div>' +
    phaseField +
    OAD._repeatFieldsHtml('hb', h.repeat, h.next_due);
};

OAD.openNewHabitModal = function () {
  var blank = OAD.makeHabit({ title: '' });
  OAD.openModal(
    '<h2>New Habit</h2>' +
    OAD._habitForm(blank, false) +
    '<div class="modal-footer">' +
      '<button type="button" class="secondary" onclick="OAD.closeModal()">Cancel</button>' +
      '<button type="button" onclick="OAD._saveNewHabit()">Create</button>' +
    '</div>'
  );
  OAD.Repeat.syncFields('hb', false);
  OAD.Repeat.remember('hb');
  setTimeout(function () { var el = document.getElementById('hb-title'); if (el) el.focus(); }, 50);
};

OAD._saveNewHabit = function () {
  var titleEl = document.getElementById('hb-title');
  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) { alert('Title is required.'); return; }
  var blank = OAD.makeHabit({ title: title });
  var committed = OAD._repeatCommitFromForm(blank, 'hb');
  var habit = OAD.makeHabit({
    title: title,
    life_area: document.getElementById('hb-area')?.value || blank.life_area,
    time_of_day: document.getElementById('hb-time')?.value || 'morning',
    why: document.getElementById('hb-why')?.value.trim() || '',
    phase: 'active',
    repeat: committed.repeat,
    next_due: committed.next_due,
    days_of_week: committed.days_of_week
  });
  var added = OAD.addHabit(habit);
  if (committed.note) OAD.addEvolution(added.id, committed.note);
  OAD.closeModal();
  OAD.renderHabitPanel();
};

OAD.openEditHabitModal = function (id) {
  var h = OAD.getHabit(id);
  if (!h) return;
  if (OAD.Repeat && OAD.Repeat.ensure) OAD.Repeat.ensure(h);
  OAD.openModal(
    '<h2>Edit Habit</h2>' +
    OAD._habitForm(h, true) +
    '<div class="modal-footer">' +
      '<button type="button" class="secondary" onclick="OAD.closeModal()">Cancel</button>' +
      '<button type="button" onclick="OAD._saveEditHabit(' + id + ')">Save</button>' +
    '</div>'
  );
  OAD.Repeat.syncFields('hb', false);
  OAD.Repeat.remember('hb');
};

OAD._saveEditHabit = function (id) {
  var h = OAD.getHabit(id);
  if (!h) return;
  var titleEl = document.getElementById('hb-title');
  var title = titleEl ? titleEl.value.trim() : '';
  if (!title) { alert('Title is required.'); return; }
  var committed = OAD._repeatCommitFromForm(h, 'hb');
  var patch = {
    title: title,
    life_area: OAD.normalizeLifeArea(document.getElementById('hb-area')?.value || h.life_area),
    time_of_day: document.getElementById('hb-time')?.value || h.time_of_day,
    why: document.getElementById('hb-why')?.value.trim() || '',
    phase: document.getElementById('hb-phase')?.value || h.phase,
    repeat: committed.repeat,
    days_of_week: committed.days_of_week,
    next_due: committed.next_due
  };
  OAD.updateHabit(id, patch);
  if (committed.note) OAD.addEvolution(id, committed.note);
  OAD.closeModal();
  OAD.renderHabitPanel();
};

// ── Saved Views (Graph Views) ────────────────────────────────────────

OAD._SAVED_VIEW_EDGE_RULES = [
  { value: '', label: '— No edge rule —' },
  { value: 'blocked_by_open', label: 'Blocked by anything still open' },
  { value: 'has_blocks', label: 'Blocks other threads' },
  { value: 'no_blockers', label: 'Nothing blocking it' }
];

OAD._SAVED_VIEW_SORT_FIELDS = [
  { value: 'pressure', label: 'Pressure' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'next_action_date', label: 'Next Action Date' },
  { value: 'title', label: 'Title' }
];

OAD._savedViewForm = function (v) {
  const statusOpts = OAD.STATUSES.map(function (s) {
    const checked = (v.statuses || []).indexOf(s) !== -1 ? 'checked' : '';
    return '<label class="dow-checkbox"><input type="checkbox" class="sv-status" value="' + s + '" ' + checked + '> ' + s + '</label>';
  }).join('');
  const priorityOpts = OAD.PRIORITIES.map(function (p) {
    const checked = (v.priorities || []).indexOf(p) !== -1 ? 'checked' : '';
    return '<label class="dow-checkbox"><input type="checkbox" class="sv-priority" value="' + p + '" ' + checked + '> ' + p + '</label>';
  }).join('');
  const areaOpts = OAD.LIFE_AREAS.map(function (a) {
    const checked = (v.life_areas || []).indexOf(a) !== -1 ? 'checked' : '';
    return '<label class="dow-checkbox"><input type="checkbox" class="sv-life-area" value="' + OAD.esc(a) + '" ' + checked + '> ' + OAD.esc(a) + '</label>';
  }).join('');
  const edgeRuleOpts = OAD._SAVED_VIEW_EDGE_RULES.map(function (r) {
    const selected = (v.edge_rule && v.edge_rule.type) === r.value ? 'selected' : (!v.edge_rule && r.value === '' ? 'selected' : '');
    return '<option value="' + r.value + '" ' + selected + '>' + r.label + '</option>';
  }).join('');
  const sortFieldOpts = OAD._SAVED_VIEW_SORT_FIELDS.map(function (f) {
    return '<option value="' + f.value + '" ' + (v.sort_field === f.value ? 'selected' : '') + '>' + f.label + '</option>';
  }).join('');
  return `
    <div class="field">
      <label>Name <span style="color:var(--critical)">*</span></label>
      <input id="sv-name" type="text" value="${OAD.esc(v.name)}" placeholder="e.g. Blocked & Critical">
    </div>
    <div class="field">
      <label>Status</label>
      <div class="dow-picker">${statusOpts}</div>
    </div>
    <div class="field">
      <label>Priority</label>
      <div class="dow-picker">${priorityOpts}</div>
    </div>
    <div class="field">
      <label>Life Area</label>
      <div class="dow-picker">${areaOpts}</div>
    </div>
    <div class="field">
      <label>Graph Rule</label>
      <select id="sv-edge-rule">${edgeRuleOpts}</select>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Sort By</label>
        <select id="sv-sort-field">${sortFieldOpts}</select>
      </div>
      <div class="field">
        <label>Direction</label>
        <select id="sv-sort-dir">
          <option value="desc" ${v.sort_dir === 'desc' ? 'selected' : ''}>Descending</option>
          <option value="asc" ${v.sort_dir === 'asc' ? 'selected' : ''}>Ascending</option>
        </select>
      </div>
    </div>`;
};

OAD._readSavedViewForm = function (base) {
  const name = document.getElementById('sv-name')?.value.trim();
  if (!name) { alert('Name is required.'); return null; }
  const statuses = Array.from(document.querySelectorAll('.sv-status:checked')).map(function (el) { return el.value; });
  const priorities = Array.from(document.querySelectorAll('.sv-priority:checked')).map(function (el) { return el.value; });
  const life_areas = Array.from(document.querySelectorAll('.sv-life-area:checked')).map(function (el) { return el.value; });
  const edgeRuleType = document.getElementById('sv-edge-rule')?.value || '';
  return Object.assign({}, base, {
    name,
    statuses,
    priorities,
    life_areas,
    edge_rule: edgeRuleType ? { type: edgeRuleType } : null,
    sort_field: document.getElementById('sv-sort-field')?.value || 'pressure',
    sort_dir: document.getElementById('sv-sort-dir')?.value || 'desc'
  });
};

OAD.openNewSavedViewModal = function () {
  const blank = OAD.makeSavedView({});
  OAD.openModal(`
    <h2>New Graph View</h2>
    ${OAD._savedViewForm(blank)}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveNewSavedView()">Create</button>
    </div>`);
  setTimeout(() => document.getElementById('sv-name')?.focus(), 50);
};

OAD._saveNewSavedView = function () {
  const data = OAD._readSavedViewForm(OAD.makeSavedView({}));
  if (!data) return;
  OAD.addSavedView(data);
  OAD.closeModal();
  OAD.renderListView();
};

OAD.openEditSavedViewModal = function (id) {
  const v = OAD.getSavedView(id);
  if (!v) return;
  OAD.openModal(`
    <h2>Edit Graph View</h2>
    ${OAD._savedViewForm(v)}
    <div class="modal-footer">
      <button class="danger" onclick="OAD._deleteSavedView(${id})">Delete</button>
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveEditSavedView(${id})">Save</button>
    </div>`);
};

OAD._saveEditSavedView = function (id) {
  const v = OAD.getSavedView(id);
  if (!v) return;
  const data = OAD._readSavedViewForm(v);
  if (!data) return;
  OAD.updateSavedView(id, data);
  OAD.closeModal();
  OAD.renderListView();
};

OAD._deleteSavedView = function (id) {
  const v = OAD.getSavedView(id);
  if (!v) return;
  if (!confirm('Delete "' + v.name + '"? This cannot be undone.')) return;
  if (OAD._activeSavedViewId === id) OAD._activeSavedViewId = null;
  OAD.deleteSavedView(id);
  OAD.closeModal();
  OAD.renderListView();
};

OAD.openManageSavedViewsModal = function () {
  const rows = OAD.DB.saved_views.map(function (v) {
    return `
      <div class="field-row" style="align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); padding:8px 0;">
        <span>${OAD.esc(v.name)}</span>
        <div>
          <button class="ghost" onclick="OAD.openEditSavedViewModal(${v.id})">Edit</button>
          <button class="danger" onclick="OAD._deleteSavedView(${v.id})">Delete</button>
        </div>
      </div>`;
  }).join('') || '<div class="text-muted">No saved views yet.</div>';

  OAD.openModal(`
    <h2>Manage Graph Views</h2>
    <div>${rows}</div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Close</button>
      <button onclick="OAD.openNewSavedViewModal()">+ New View</button>
    </div>`);
};

// ── Import ────────────────────────────────────────────────────────────

OAD.openImportModal = function () {
  OAD.openModal(`
    <h2>Import Threads</h2>
    <p class="text-muted text-sm" style="margin-bottom:14px">
      Accepts the One-A-Day export JSON format. New threads (including cadences, habits, ideas —
      all just threads now) are created immediately. Existing threads, matched by uuid, will show
      a diff — you confirm before anything changes. Evolution logs are always appended, never
      overwritten.
    </p>
    <div class="field">
      <label>Select export file (.json)</label>
      <input id="import-file" type="file" accept=".json,application/json" style="padding:6px">
    </div>
    <div id="import-preview" style="margin-top:8px"></div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._readImportFile()">Preview</button>
    </div>`);
};

OAD._readImportFile = function () {
  const file = document.getElementById('import-file')?.files[0];
  if (!file) { alert('Select a file first.'); return; }
  const reader = new FileReader();
  reader.onload = function (e) { OAD._previewImport(e.target.result); };
  reader.readAsText(file);
};

OAD._previewImport = function (jsonString) {
  const results = OAD.parseImportFile(jsonString);
  if (results.error) { alert(results.error); return; }

  OAD._pendingImport = results;

  const { create, update, invalid } = results;
  let html = '';

  if (create.length) {
    html += '<div class="import-section-label">New threads (' + create.length + ') — will be created</div>';
    html += create.map(function (r) {
      return '<div class="import-row import-new">+ ' + OAD.esc(r.title) + '</div>';
    }).join('');
  }

  if (update.length) {
    html += '<div class="import-section-label" style="margin-top:12px">Existing threads (' + update.length + ') — review changes</div>';
    html += update.map(function (item, idx) {
      const diffs = OAD._diffImportItem(item);
      const diffHtml = diffs.length
        ? diffs.map(function (d) {
            return '<div class="import-diff-line">' +
              '<span class="import-diff-field">' + OAD.esc(d.field) + '</span> ' +
              '<span class="import-diff-old">' + OAD.esc(d.old || '—') + '</span>' +
              ' → <span class="import-diff-new">' + OAD.esc(d.new_ || '—') + '</span>' +
            '</div>';
          }).join('')
        : '<div class="text-muted text-sm">No field changes (evolution log may append)</div>';
      return '<div class="import-row import-update">' +
        '<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">' +
          '<input type="checkbox" class="import-confirm-cb" data-type="thread" data-idx="' + idx + '" ' +
            'style="margin-top:3px;width:auto;flex-shrink:0" checked>' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px;margin-bottom:4px">' + OAD.esc(item.incoming.title) + '</div>' +
            diffHtml +
          '</div>' +
        '</label>' +
      '</div>';
    }).join('');
  }

  if (invalid.length) {
    html += '<div class="import-section-label" style="margin-top:12px;color:var(--critical)">Skipped (' + invalid.length + ') — missing title</div>';
  }

  // Cadences (thread_kind:'cadence') no longer have a separate create/update/delete pipeline —
  // per ticket-flowqueue-data-model-migration.md Step 4 they're just threads, matched by uuid,
  // so a new or changed cadence already appears in the New/Existing threads sections above.
  // Deleting a cadence is still a genuine hard delete though (no "reopen a deleted cadence"
  // concept, unlike closing a regular thread) — that destructive step keeps its own explicit
  // "cannot be undone" confirmation here, same rigor the old cadence-delete flow had. Regular
  // thread closes (results.close) intentionally get NO preview section and auto-apply, matching
  // their original (pre-migration) silent behavior — only the newly-unified cadence-delete case
  // needs a confirmation UI, since that's the one destructive path that used to have one.
  const cadenceDeletes = (results.close || []).filter(function (t) { return t.thread_kind === 'cadence'; });
  if (cadenceDeletes.length) {
    html += '<div class="import-section-label" style="margin-top:12px;color:var(--critical)">Cadences to delete (' + cadenceDeletes.length + ') — cannot be undone</div>';
    html += cadenceDeletes.map(function (c) {
      return '<div class="import-row import-delete">' +
        '<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">' +
          '<input type="checkbox" class="import-confirm-cb" data-type="cadence-delete" data-id="' + c.id + '" ' +
            'style="margin-top:3px;width:auto;flex-shrink:0" checked>' +
          '<span>' + OAD.esc(c.title) + '</span>' +
        '</label>' +
      '</div>';
    }).join('');
  }

  if (!create.length && !update.length && !cadenceDeletes.length) {
    html = '<p class="text-muted text-sm">Nothing to import.</p>';
  }

  OAD.openModal(`
    <h2>Import Preview</h2>
    <div class="import-preview-scroll">${html}</div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.openImportModal()">← Back</button>
      <button class="success" onclick="OAD._confirmImport()">Apply Import</button>
    </div>`);
};

OAD._diffImportItem = function (item) {
  const fields = ['title', 'status', 'priority', 'closing_condition', 'next_action', 'next_action_date', 'day_impact', 'day_fit'];
  const diffs = [];
  fields.forEach(function (f) {
    const incoming = item.incoming[f] != null ? String(item.incoming[f]) : '';
    const existing = item.existing[f]  != null ? String(item.existing[f])  : '';
    if (incoming && incoming !== existing) {
      diffs.push({ field: f, old: existing, new_: incoming });
    }
  });
  return diffs;
};

// applyImport now makes exactly one awaited cloud save for the whole import (see its own
// comment in js/data.js) instead of one per row, so this handler has to wait for that save
// and report honestly on whether it actually landed, rather than declaring success the moment
// the in-memory mutations finish. On failure or conflict, nothing further runs (no ADE/CHE
// pass on data that was not confirmed to have saved), and the message says plainly that the
// cloud was not updated.
OAD._confirmImport = async function () {
  if (!OAD._pendingImport) return;
  const checkboxes = document.querySelectorAll('.import-confirm-cb');
  const confirmedUpdates = [];
  const confirmedDeleteIds = [];
  checkboxes.forEach(function (cb) {
    if (!cb.checked) return;
    if (cb.dataset.type === 'cadence-delete') {
      confirmedDeleteIds.push(parseInt(cb.dataset.id, 10));
    } else {
      confirmedUpdates.push(OAD._pendingImport.update[parseInt(cb.dataset.idx, 10)]);
    }
  });
  const result = await OAD.applyImport(OAD._pendingImport, confirmedUpdates, confirmedDeleteIds);
  OAD._pendingImport = null;
  OAD.closeModal();
  OAD.refreshActiveView();

  if (!result.saveOk) {
    var failMsg = 'Import built ' + result.created + ' created, ' + result.updated + ' updated, ' +
      result.closed + ' closed, ' + result.deleted + ' deleted in memory, but the cloud save ' +
      (result.saveConflict ? 'was rejected: newer data exists in the cloud.' : 'failed: ' + (result.saveError || 'unknown error') + '.') +
      ' The cloud was NOT updated. Reload before making further changes.';
    alert(failMsg);
    return;
  }

  const adeCount = typeof OAD.runADE === 'function' ? OAD.runADE() : 0;
  const cheCount = typeof OAD.runCHE === 'function' ? OAD.runCHE() : 0;
  OAD._updateCHEBadge();
  if (adeCount > 0 && typeof OAD.refreshActiveView === 'function') OAD.refreshActiveView();
  var msg = 'Import complete: ' + result.created + ' created, ' + result.updated + ' updated';
  if (result.closed > 0) msg += ', ' + result.closed + ' closed';
  if (result.deleted > 0) msg += ', ' + result.deleted + ' deleted';
  if (result.edges_merged > 0) msg += ', ' + result.edges_merged + ' edges restored';
  if (adeCount > 0) msg += ', ' + adeCount + ' AI edges inferred';
  if (cheCount > 0) msg += '. ' + cheCount + ' configuration issue' + (cheCount === 1 ? '' : 's') + ' found, review in Health Panel';
  alert(msg + '.');
};

// Unreferenced by any UI element as of ticket-dev-diagnostic-export.md — the Settings modal's
// export button now calls OAD._downloadDevExport() below instead. Kept, not deleted: this is
// still exactly the correct shape for a real future user-facing export (moat-safe field
// exclusions, already tested), the starting point the Product Vision Document's eventual
// narrower export should build from when there's ever a real second user — not this ticket's
// concern, but worth not losing.
OAD._downloadExport = function () {
  const json = OAD.exportThreads();
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'one-a-day-' + OAD.todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

OAD._downloadDevExport = function () {
  const json = OAD.exportDevDiagnostic();
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'one-a-day-DEV-' + OAD.todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

OAD.openSettingsModal = function () {
  OAD.loadApiKey();
  const count = (OAD.DB.threads || []).length;
  const theme = (OAD.DB.persona && OAD.DB.persona.theme) || 'dark';
  const signOutBtn = OAD._userId
    ? `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
         <button class="ghost" style="width:100%;color:var(--text-muted)" onclick="OAD.closeModal();OAD.openSignOutModal()">Sign Out</button>
       </div>`
    : '';
  OAD.openModal(`
    <h2>Settings</h2>
    <div class="field">
      <label>Theme</label>
      <select id="f-theme">
        <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark (Default)</option>
        <option value="light" ${theme === 'light' ? 'selected' : ''}>Light (Gravity Default)</option>
      </select>
    </div>
    <div class="field">
      <label>Language</label>
      <select id="f-locale">
        <option value="en" ${OAD.Config.currentLocale === 'en' ? 'selected' : ''}>English</option>
        <option value="es" ${OAD.Config.currentLocale === 'es' ? 'selected' : ''}>Español</option>
      </select>
    </div>
    <div class="field">
      <label>Greeting Title</label>
      <input id="f-greeting-title" type="text" value="${OAD.esc(OAD.Config.userGreetingTitle)}" ${!OAD.isSuperAdmin() ? 'disabled' : ''} placeholder="e.g. Chief" />
      ${!OAD.isSuperAdmin() ? '<span class="text-xs text-muted" style="margin-top:4px;display:block">Only SuperAdmin can modify this setting.</span>' : ''}
    </div>
    <div class="field">
      <label>Life Areas</label>
      <div id="life-areas-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;max-height:160px;overflow-y:auto;border:1px solid var(--border);padding:8px;border-radius:4px;background:var(--surface)">
        ${OAD.LIFE_AREAS.map((area, idx) => `
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" class="f-life-area-input" data-index="${idx}" value="${OAD.esc(area)}" ${!OAD.isSuperAdmin() ? 'disabled' : ''} style="flex:1" />
            <button type="button" class="danger" style="padding:4px 8px;font-size:12px;margin:0" onclick="event.stopPropagation(); OAD._deleteLifeArea(${idx})" ${!OAD.isSuperAdmin() ? 'disabled' : ''}>Delete</button>
          </div>
        `).join('')}
      </div>
      ${OAD.isSuperAdmin() ? `
        <div style="display:flex;gap:6px">
          <input type="text" id="f-new-life-area" placeholder="New life area..." style="flex:1" />
          <button type="button" class="success" style="padding:6px 12px;font-size:13px;margin:0" onclick="event.stopPropagation(); OAD._addLifeArea()">Add</button>
        </div>
      ` : '<span class="text-xs text-muted" style="margin-top:4px;display:block">Only SuperAdmin can manage Life Areas.</span>'}
    </div>
    <div class="field">
      <label>Inbox Scanning Filter</label>
      <input id="f-gmail-filter" type="text" value="${OAD.esc(OAD.Config.gmailSearchFilter)}" placeholder="is:unread ..." />
    </div>
    <div class="field">
      <label>AI Provider</label>
      <select id="f-ai-provider" onchange="OAD._toggleAiProviderFields(this.value)">
        <option value="anthropic" ${OAD.AI_PROVIDER === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
        <option value="gemini" ${OAD.AI_PROVIDER === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
        <option value="xai" ${OAD.AI_PROVIDER === 'xai' ? 'selected' : ''}>xAI (Grok)</option>
      </select>
    </div>
    <div class="field" id="f-claude-key-container" style="display: ${OAD.AI_PROVIDER === 'anthropic' ? 'block' : 'none'}">
      <label>Anthropic API Key</label>
      <input id="f-api-key" type="password" value="${OAD.esc(OAD.API_KEY)}" placeholder="sk-ant-…">
    </div>
    <div class="field" id="f-gemini-key-container" style="display: ${OAD.AI_PROVIDER === 'gemini' ? 'block' : 'none'}">
      <label>Gemini API Key</label>
      <input id="f-gemini-api-key" type="password" value="${OAD.esc(OAD.GEMINI_API_KEY)}" placeholder="AIza..." style="margin-bottom:8px">
      <label>Gemini Model</label>
      <select id="f-gemini-model">
        ${(window.OAD && OAD.Config && OAD.Config.aiConfig && OAD.Config.aiConfig.availableGeminiModels || []).map(m => 
          `<option value="${m}" ${OAD.GEMINI_MODEL === m ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
    </div>
    <div class="field" id="f-xai-key-container" style="display: ${OAD.AI_PROVIDER === 'xai' ? 'block' : 'none'}">
      <label>xAI API Key</label>
      <input id="f-xai-api-key" type="password" value="${OAD.esc(OAD.XAI_API_KEY || '')}" placeholder="xai-..." style="margin-bottom:8px">
      <label>Grok Model</label>
      <select id="f-xai-model">
        ${((window.OAD && OAD.Config && OAD.Config.aiConfig && OAD.Config.aiConfig.availableXaiModels) || ['grok-4.7']).map(m =>
          `<option value="${m}" ${OAD.XAI_MODEL === m ? 'selected' : ''}>${m}</option>`
        ).join('')}
      </select>
    </div>
    <p class="text-muted text-sm" id="ai-provider-info">Keys are stored in localStorage — never sent anywhere except to the selected provider.</p>
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px">
      <div class="field" style="margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="f-enterprise-mode" ${OAD.isEnterpriseMode() ? 'checked' : ''}>
          <div style="display:flex;flex-direction:column">
            <span>Enterprise Mode (HIPAA Compliance)</span>
            <span class="text-xs text-muted" style="font-weight:normal">Disables browser local storage caching for PHI protection.</span>
          </div>
        </label>
      </div>
      ${OAD._userId === 'demo-superadmin-id' ? `
      <div class="field" style="margin-bottom:0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="f-demo-mode" ${OAD.Config.demoMode ? 'checked' : ''}>
          <div style="display:flex;flex-direction:column">
            <span style="color:var(--critical)">SuperAdmin: Demo Mode</span>
            <span class="text-xs text-muted" style="font-weight:normal">Enables predefined mock logins to bypass network auth.</span>
          </div>
        </label>
      </div>
      ` : ''}
    </div>
    ${OAD.isSuperAdmin() ? `
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px">
      <h3 style="margin-top:0;margin-bottom:12px;font-size:14px">System Variables</h3>
      
      <div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">Runway Risk Benchmarks (weeks)</div>
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Federal Min</label>
            <input id="f-runway-fed-min" type="number" value="${OAD.Config.runwayBenchmarks.federal.minWeeks}">
          </div>
          <div class="field" style="flex:1">
            <label>Federal Max</label>
            <input id="f-runway-fed-max" type="number" value="${OAD.Config.runwayBenchmarks.federal.maxWeeks}">
          </div>
        </div>
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Commercial Min</label>
            <input id="f-runway-com-min" type="number" value="${OAD.Config.runwayBenchmarks.commercial.minWeeks}">
          </div>
          <div class="field" style="flex:1">
            <label>Commercial Max</label>
            <input id="f-runway-com-max" type="number" value="${OAD.Config.runwayBenchmarks.commercial.maxWeeks}">
          </div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">Week Load Weights</div>
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Edge Multiplier</label>
            <input id="f-weekload-edge" type="number" value="${OAD.Config.weekLoadWeights.edgeMultiplier}">
          </div>
          <div class="field" style="flex:1">
            <label>Cadence Weight</label>
            <input id="f-weekload-cadence" type="number" value="${OAD.Config.weekLoadWeights.cadenceWeight}">
          </div>
        </div>
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Busy Threshold</label>
            <input id="f-weekload-busy" type="number" value="${OAD.Config.weekLoadWeights.busyThreshold}">
          </div>
          <div class="field" style="flex:1">
            <label>Heavy Threshold</label>
            <input id="f-weekload-heavy" type="number" value="${OAD.Config.weekLoadWeights.heavyThreshold}">
          </div>
        </div>
      </div>

      <div>
        <div style="font-weight:600;font-size:13px;margin-bottom:4px">TRY Score Thresholds</div>
        <div class="field-row">
          <div class="field" style="flex:1">
            <label>Success (Green) &ge;</label>
            <input id="f-try-success" type="number" value="${OAD.Config.tryScoreThresholds.success}">
          </div>
          <div class="field" style="flex:1">
            <label>Warning (Orange) &ge;</label>
            <input id="f-try-warning" type="number" value="${OAD.Config.tryScoreThresholds.warning}">
          </div>
        </div>
      </div>
    </div>
    ` : ''}
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">DEV Export (${count} thread${count !== 1 ? 's' : ''})</div>
      <p class="text-muted text-sm" style="margin-bottom:10px">
        Internal QA/diagnostic export — title, status, priority, area, pressure, next action, deadline, closing condition, graph edges, assumption content, and evolution log, plus computed application state (temporal status per thread, data hygiene warnings, CHE health alerts, TOAT/Focus Now candidate detail, This Week membership, stale closed-thread edges).
        This is not the future real user-facing export — see ticket-dev-diagnostic-export.md.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="secondary" style="font-size:13px" onclick="OAD._downloadDevExport()">↓ DEV Export JSON</button>
        <button class="secondary" style="font-size:13px" onclick="OAD.closeModal();OAD.openImportModal()">↑ Import JSON</button>
      </div>
    </div>
    ${signOutBtn}
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._saveSettings()">Save</button>
    </div>`);

  // Enforce mutual exclusivity
  const entCb = document.getElementById('f-enterprise-mode');
  const demoCb = document.getElementById('f-demo-mode');
  if (entCb && demoCb) {
    entCb.addEventListener('change', () => { if (entCb.checked) demoCb.checked = false; });
    demoCb.addEventListener('change', () => { if (demoCb.checked) entCb.checked = false; });
  }
};

OAD._toggleAiProviderFields = function (provider) {
  var fields = {
    anthropic: 'f-claude-key-container',
    gemini: 'f-gemini-key-container',
    xai: 'f-xai-key-container'
  };
  Object.keys(fields).forEach(function (name) {
    var el = document.getElementById(fields[name]);
    if (el) el.style.display = name === provider ? 'block' : 'none';
  });
};

OAD._saveSettings = async function () {
  const provider = document.getElementById('f-ai-provider')?.value || 'anthropic';
  const claudeKey = document.getElementById('f-api-key')?.value.trim() || '';
  const geminiKey = document.getElementById('f-gemini-api-key')?.value.trim() || '';
  const geminiModel = document.getElementById('f-gemini-model')?.value.trim() || 'gemini-1.5-pro-latest';
  const xaiKey = document.getElementById('f-xai-api-key')?.value.trim() || '';
  const xaiModel = document.getElementById('f-xai-model')?.value.trim() || 'grok-4.7';
  OAD.setAiSettings(provider, claudeKey, geminiKey, geminiModel, xaiKey, xaiModel);
  
  const theme = document.getElementById('f-theme')?.value || 'dark';
  if (OAD.DB.persona) {
    OAD.DB.persona.theme = theme;
  }
  document.body.setAttribute('data-theme', theme);

  const enterpriseToggle = document.getElementById('f-enterprise-mode');
  if (enterpriseToggle) {
    localStorage.setItem('oad_enterprise_mode', enterpriseToggle.checked ? 'true' : 'false');
  }

  const demoToggle = document.getElementById('f-demo-mode');
  if (demoToggle) {
    OAD.Config.demoMode = demoToggle.checked;
    localStorage.setItem('oad_demo_mode', demoToggle.checked ? 'true' : 'false');
    OAD._updateDemoIndicator();
  }

  // Calling saveDB will respect the enterprise flag, clearing cache if turned on.
  OAD.saveDB();

  const selectedLocale = document.getElementById('f-locale')?.value || 'en';
  const oldLocale = OAD.Config.currentLocale;

  const greetingInput = document.getElementById('f-greeting-title');
  if (greetingInput && !greetingInput.disabled) {
    OAD.Config.userGreetingTitle = greetingInput.value.trim();
    localStorage.setItem('oad_greeting_title', OAD.Config.userGreetingTitle);
  }

  // Save edited life areas if user is SuperAdmin
  if (OAD.isSuperAdmin()) {
    OAD._saveLifeAreasFromDOM();
  }

  const gmailFilterInput = document.getElementById('f-gmail-filter');
  if (gmailFilterInput) {
    OAD.Config.gmailSearchFilter = gmailFilterInput.value.trim() || '';
    localStorage.setItem('oad_gmail_filter', OAD.Config.gmailSearchFilter);
  }

  // Save system variables if SuperAdmin
  if (OAD.isSuperAdmin()) {
    if (document.getElementById('f-runway-fed-min')) {
      OAD.Config.runwayBenchmarks.federal.minWeeks = parseInt(document.getElementById('f-runway-fed-min').value, 10) || 17;
      OAD.Config.runwayBenchmarks.federal.maxWeeks = parseInt(document.getElementById('f-runway-fed-max').value, 10) || 22;
      OAD.Config.runwayBenchmarks.commercial.minWeeks = parseInt(document.getElementById('f-runway-com-min').value, 10) || 6;
      OAD.Config.runwayBenchmarks.commercial.maxWeeks = parseInt(document.getElementById('f-runway-com-max').value, 10) || 8;
      localStorage.setItem('oad_runway_benchmarks', JSON.stringify(OAD.Config.runwayBenchmarks));
    }
    
    if (document.getElementById('f-weekload-edge')) {
      OAD.Config.weekLoadWeights.edgeMultiplier = parseFloat(document.getElementById('f-weekload-edge').value) || 2;
      OAD.Config.weekLoadWeights.cadenceWeight = parseFloat(document.getElementById('f-weekload-cadence').value) || 20;
      OAD.Config.weekLoadWeights.busyThreshold = parseFloat(document.getElementById('f-weekload-busy').value) || 50;
      OAD.Config.weekLoadWeights.heavyThreshold = parseFloat(document.getElementById('f-weekload-heavy').value) || 150;
      localStorage.setItem('oad_week_load_weights', JSON.stringify(OAD.Config.weekLoadWeights));
    }

    if (document.getElementById('f-try-success')) {
      OAD.Config.tryScoreThresholds.success = parseFloat(document.getElementById('f-try-success').value) || 80;
      OAD.Config.tryScoreThresholds.warning = parseFloat(document.getElementById('f-try-warning').value) || 60;
      localStorage.setItem('oad_try_score_thresholds', JSON.stringify(OAD.Config.tryScoreThresholds));
    }
  }

  if (selectedLocale !== oldLocale) {
    await OAD.loadLanguage(selectedLocale);
  } else {
    OAD.translateDOM();
  }
  
  OAD.closeModal();
  OAD.refreshActiveView();
};

OAD._updateDemoIndicator = function() {
  const brand = document.querySelector('.fq-navbar-brand');
  if (!brand) return;
  const existingSpan = brand.querySelector('.demo-indicator');
  if (OAD.Config.demoMode) {
    if (!existingSpan) {
      const span = document.createElement('span');
      span.className = 'demo-indicator';
      span.style.cssText = "font-size: 12px; font-weight: 800; color: var(--fq-text-muted); margin-left: 12px; opacity: 0.7; padding-top:4px; letter-spacing:1px;";
      span.textContent = 'DEMO';
      brand.appendChild(span);
    }
  } else {
    if (existingSpan) {
      existingSpan.remove();
    }
  }
};

OAD._saveLifeAreasFromDOM = function () {
  const inputs = document.querySelectorAll('.f-life-area-input');
  if (!inputs.length) return;
  const updatedAreas = [];
  inputs.forEach(input => {
    const val = OAD.normalizeLifeArea(input.value);
    if (val && !updatedAreas.includes(val)) {
      updatedAreas.push(val);
    }
  });
  OAD.Config.lifeAreas = updatedAreas;
  OAD.LIFE_AREAS = updatedAreas;
  localStorage.setItem('oad_life_areas', JSON.stringify(updatedAreas));
};

OAD._deleteLifeArea = function (index) {
  OAD._saveLifeAreasFromDOM();
  OAD.Config.lifeAreas.splice(index, 1);
  OAD.LIFE_AREAS = OAD.Config.lifeAreas;
  localStorage.setItem('oad_life_areas', JSON.stringify(OAD.Config.lifeAreas));
  OAD.openSettingsModal();
};

OAD._addLifeArea = function () {
  OAD._saveLifeAreasFromDOM();
  const input = document.getElementById('f-new-life-area');
  const val = input ? input.value.trim() : '';
  if (!val) return;
  const normalized = OAD.normalizeLifeArea(val);
  if (OAD.Config.lifeAreas.includes(normalized)) {
    alert('Life area already exists!');
    return;
  }
  OAD.Config.lifeAreas.push(normalized);
  OAD.LIFE_AREAS = OAD.Config.lifeAreas;
  localStorage.setItem('oad_life_areas', JSON.stringify(OAD.Config.lifeAreas));
  OAD.openSettingsModal();
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

  OAD.openModal(`
    ${OAD._wizardSteps(1)}
    <h2>Complete Action — <span style="color:var(--text-muted);font-weight:400;font-size:15px">${OAD.esc(t.title)}</span></h2>
    <div class="field">
      <label>What did you do? <span style="color:var(--critical)">*</span></label>
      <textarea id="ca-what-done" placeholder="Describe exactly what you did — this becomes the evolution log entry." style="min-height:90px">${OAD.esc(prev.what_done || '')}</textarea>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._cawStep1Next()">Next →</button>
    </div>`);
  setTimeout(function () { document.getElementById('ca-what-done')?.focus(); }, 50);
};

OAD._cawStep1Next = function () {
  const what_done = document.getElementById('ca-what-done')?.value.trim();
  if (!what_done) { alert('Describe what you did — this cannot be empty.'); return; }

  OAD._caw.step1 = { what_done: what_done };
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
        <label>Time <span class="text-muted" style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label>
        <input id="ca-time" type="time" value="${OAD.esc(prev.time || '')}">
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
        <input id="ca-ctg-date" type="date" value="${OAD.esc(prev.ctg_date !== undefined ? prev.ctg_date : (t.contingency_trigger_date || ''))}">
      </div>
      <div class="field">
        <label>Contingency action</label>
        <input id="ca-ctg-action" type="text" value="${OAD.esc(prev.ctg_action !== undefined ? prev.ctg_action : (t.contingency_action || ''))}" placeholder="If no response by that date…">
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
    time:       document.getElementById('ca-time')?.value        || '',
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
    next_action:              caw.step2.action,
    next_action_date:         caw.step2.date,
    next_action_time:         caw.step2.time || null,
    next_action_channel:      caw.step2.channel,
    next_action_contact:      caw.step2.contact,
    contingency_trigger_date: caw.step2.ctg_date,
    contingency_action:       caw.step2.ctg_action
  };

  if (caw.step1 && caw.step1.assumption_verified) {
    patch.assumption_verified = true;
  }

  if (t.deadline) patch.effortLogged = (t.effortLogged || 0) + 1;
  if (t.status === 'stalled') patch.status = 'open';

  OAD.updateThread(caw.id, patch);

  const logParts = ['Completed: ' + caw.step1.what_done];
  logParts.push('Next: ' + caw.step2.action + ' by ' + caw.step2.date + '.');
  OAD.addEvolution(caw.id, logParts.join(' '));

  OAD._caw = null;
  OAD.closeModal();
  OAD.refreshActiveView();
  OAD.renderDetail(caw.id);
};

// Save: YES path — thread closes immediately, no next action required
OAD._cawSaveClose = function () {
  const caw = OAD._caw;
  const t   = OAD.getThread(caw.id);
  if (!t) return;

  const patch = {
    status:                'closed',
    closing_condition_met: true
  };

  if (t.deadline) patch.effortLogged = (t.effortLogged || 0) + 1;

  const logNote = 'Completed: ' + caw.step1.what_done + '; Closing condition met — thread closed.';

  OAD._caw = null;
  OAD.closeModal();

  if (OAD.needsClosureWizard(t.id)) {
    OAD.openClosureWizard(t.id, patch, logNote);
  } else {
    OAD.updateThreadAndLog(t.id, patch, logNote);
    OAD.refreshActiveView();
    const panel = document.getElementById('detail-content');
    if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
    OAD.goBackToLastView();
  }
};

OAD.needsClosureWizard = function (threadId) {
  const t = OAD.getThread(threadId);
  if (!t) return false;

  // Active sub-threads
  const activeSubthreads = (OAD.DB.threads || []).filter(function (x) {
    return x.parent_uuid === t.uuid && x.status !== 'closed';
  });

  // Active outgoing connections
  const conns = t.connections || [];
  const activeOutgoing = conns.filter(function (c) {
    if (!c.to_uuid) return false;
    const target = OAD.DB.threads.find(function (x) { return x.uuid === c.to_uuid; });
    return target && target.status !== 'closed';
  });

  // Active incoming connections
  const activeIncoming = (OAD.DB.threads || []).filter(function (x) {
    if (x.id === t.id || x.status === 'closed') return false;
    return (x.connections || []).some(function (c) {
      return c.to_uuid === t.uuid;
    });
  });

  return activeSubthreads.length > 0 || activeOutgoing.length > 0 || activeIncoming.length > 0;
};

OAD.openClosureWizard = function (id, pendingPatch, logNote) {
  const t = OAD.getThread(id);
  if (!t) return;

  const activeSubthreads = (OAD.DB.threads || []).filter(function (x) {
    return x.parent_uuid === t.uuid && x.status !== 'closed';
  });

  const incoming = (OAD.DB.threads || []).filter(function (x) {
    if (x.id === t.id || x.status === 'closed') return false;
    return (x.connections || []).some(function (c) { return c.to_uuid === t.uuid; });
  });

  const outgoing = (t.connections || []).filter(function (c) {
    if (!c.to_uuid) return false;
    const target = OAD.DB.threads.find(function (x) { return x.uuid === c.to_uuid; });
    return target && target.status !== 'closed';
  });

  const otherActiveThreads = (OAD.DB.threads || []).filter(function (x) {
    return x.id !== t.id && x.parent_uuid !== t.uuid && x.status !== 'closed';
  });

  const otherOpts = otherActiveThreads.map(function (x) {
    return `<option value="${x.uuid}">${OAD.esc(x.title)}</option>`;
  }).join('');

  let subthreadsHtml = '';
  if (activeSubthreads.length > 0) {
    subthreadsHtml = `
      <div class="wizard-section-title">Active Sub-threads (${activeSubthreads.length})</div>
      <div class="wizard-list">
        ${activeSubthreads.map(function (sub) {
          return `
            <div class="wizard-row" style="margin-bottom:12px;padding:8px;background:var(--surface2);border-radius:6px">
              <div style="font-weight:600;font-size:14px;margin-bottom:6px">${OAD.esc(sub.title)}</div>
              <select id="sub-action-${sub.id}" onchange="document.getElementById('sub-parent-div-${sub.id}').style.display = this.value === 'reparent' ? 'block' : 'none'" style="width:100%">
                <option value="promote">Promote to main thread (clear parent)</option>
                <option value="close">Close this sub-thread too</option>
                ${otherActiveThreads.length ? '<option value="reparent">Reparent to another active thread</option>' : ''}
              </select>
              <div id="sub-parent-div-${sub.id}" style="display:none;margin-top:6px">
                <label style="font-size:12px;display:block;margin-bottom:2px">Select new parent:</label>
                <select id="sub-parent-${sub.id}" style="width:100%">${otherOpts}</select>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  let connsHtml = '';
  const totalConns = incoming.length + outgoing.length;
  if (totalConns > 0) {
    const parentThread = t.parent_uuid ? OAD.DB.threads.find(x => x.uuid === t.parent_uuid) : null;
    const parentOptHtml = parentThread ? `<option value="parent">Transfer to parent thread ("${OAD.esc(parentThread.title)}")</option>` : '';

    connsHtml = `
      <div class="wizard-section-title" style="margin-top:16px">Active Graph Connections (${totalConns})</div>
      <div class="wizard-list">
        ${incoming.map(function (src) {
          return `
            <div class="wizard-row" style="margin-bottom:10px;padding:8px;background:var(--surface2);border-radius:6px;font-size:13px">
              <div><strong>Incoming:</strong> "${OAD.esc(src.title)}" blocks this thread</div>
              <select class="wizard-conn-action" data-src-id="${src.id}" data-type="incoming" style="width:100%;margin-top:6px">
                <option value="delete">Delete this blocking relationship (clean break)</option>
                <option value="keep">Keep connection (legacy reference)</option>
                ${parentOptHtml}
              </select>
            </div>`;
        }).join('')}
        ${outgoing.map(function (c) {
          const tgt = OAD.DB.threads.find(x => x.uuid === c.to_uuid);
          return `
            <div class="wizard-row" style="margin-bottom:10px;padding:8px;background:var(--surface2);border-radius:6px;font-size:13px">
              <div><strong>Outgoing:</strong> This thread blocks "${OAD.esc(tgt ? tgt.title : c.to_label)}"</div>
              <select class="wizard-conn-action" data-tgt-uuid="${c.to_uuid}" data-type="outgoing" style="width:100%;margin-top:6px">
                <option value="delete">Delete this blocking relationship (clean break)</option>
                <option value="keep">Keep connection (legacy reference)</option>
                ${parentOptHtml}
              </select>
            </div>`;
        }).join('')}
      </div>`;
  }

  OAD.openModal(`
    <h2>Thread Closure Wizard</h2>
    <div style="font-size:14px;color:var(--text-muted);margin-bottom:16px">
      You are closing <strong>"${OAD.esc(t.title)}"</strong>. Select how to handle its active subtasks and relationships.
    </div>
    <div style="max-height:300px;overflow-y:auto;padding-right:4px">
      ${subthreadsHtml}
      ${connsHtml}
    </div>
    <div class="modal-footer" style="margin-top:16px">
      <button class="secondary" onclick="OAD.closeModal()">Cancel Closure</button>
      <button class="success" id="confirm-closure-btn">Confirm & Close Thread</button>
    </div>`);

  document.getElementById('confirm-closure-btn').onclick = function () {
    // Process sub-threads
    activeSubthreads.forEach(function (sub) {
      const act = document.getElementById(`sub-action-${sub.id}`)?.value;
      if (act === 'close') {
        OAD.updateThread(sub.id, { status: 'closed', closing_condition_met: true });
        OAD.addEvolution(sub.id, 'Closed automatically along with parent thread.');
      } else if (act === 'reparent') {
        const newParentUuid = document.getElementById(`sub-parent-${sub.id}`)?.value;
        OAD.updateThread(sub.id, { parent_uuid: newParentUuid });
        const parentT = OAD.DB.threads.find(x => x.uuid === newParentUuid);
        OAD.addEvolution(sub.id, `Reparented to "${parentT ? parentT.title : 'another thread'}" upon parent closure.`);
      } else {
        // promote
        OAD.updateThread(sub.id, { parent_uuid: null });
        OAD.addEvolution(sub.id, 'Promoted to main independent thread upon parent closure.');
      }
    });

    // Process connections
    const connSelects = document.querySelectorAll('.wizard-conn-action');
    connSelects.forEach(function (select) {
      const act = select.value;
      const type = select.getAttribute('data-type');
      if (type === 'incoming') {
        const srcId = parseInt(select.getAttribute('data-src-id'), 10);
        const src = OAD.getThread(srcId);
        if (src && src.connections) {
          if (act === 'delete') {
            src.connections = src.connections.filter(c => c.to_uuid !== t.uuid);
            OAD.saveDB();
          } else if (act === 'parent' && t.parent_uuid) {
            src.connections.forEach(c => {
              if (c.to_uuid === t.uuid) {
                c.to_uuid = t.parent_uuid;
                const parentT = OAD.DB.threads.find(x => x.uuid === t.parent_uuid);
                c.to_label = parentT ? parentT.title : '';
              }
            });
            OAD.saveDB();
          }
        }
      } else {
        // outgoing
        const tgtUuid = select.getAttribute('data-tgt-uuid');
        if (act === 'delete') {
          t.connections = t.connections.filter(c => c.to_uuid !== tgtUuid);
          OAD.saveDB();
        } else if (act === 'parent' && t.parent_uuid) {
          t.connections.forEach(c => {
            if (c.to_uuid === tgtUuid) {
              // Add blocking connection on the parent thread instead
              const parentT = OAD.DB.threads.find(x => x.uuid === t.parent_uuid);
              if (parentT) {
                parentT.connections = parentT.connections || [];
                const alreadyExists = parentT.connections.some(pc => pc.to_uuid === tgtUuid && pc.edge_type === 'blocks');
                if (!alreadyExists) {
                  parentT.connections.push({ to_uuid: tgtUuid, to_label: c.to_label, edge_type: 'blocks' });
                }
              }
            }
          });
          // Remove from this thread
          t.connections = t.connections.filter(c => c.to_uuid !== tgtUuid);
          OAD.saveDB();
        }
      }
    });

    // Close the parent thread
    OAD.updateThreadAndLog(id, pendingPatch, logNote || null);

    OAD.closeModal();
    OAD.refreshActiveView();
    const panel = document.getElementById('detail-content');
    if (panel) panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
    OAD.goBackToLastView();
  };
};

// ── Auth modal ────────────────────────────────────────────────────────

OAD.openSignInModal = function (opts) {
  opts = opts || {};
  const msg = opts.message ? `<div class="auth-message">${OAD.esc(opts.message)}</div>` : '';
  OAD.openModal(`
    <h2>Sign In to FlowQueue</h2>
    ${msg}
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
      <button class="ghost" style="border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:8px;" onclick="OAD._signInWithProvider('google')">
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Sign in with Google
      </button>
      <button class="ghost" style="border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:8px;" onclick="OAD._signInWithProvider('azure')">
        <svg width="18" height="18" viewBox="0 0 21 21"><path fill="#f25022" d="M0 0h10v10H0z"/><path fill="#7fba00" d="M11 0h10v10H11z"/><path fill="#00a4ef" d="M0 11h10v10H0z"/><path fill="#ffb900" d="M11 11h10v10H11z"/></svg>
        Sign in with Microsoft
      </button>
    </div>
    <div style="text-align:center; margin:8px 0; color:var(--text-muted); font-size:12px; text-transform:uppercase; letter-spacing:1px;">Or use Email</div>
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

OAD._signInWithProvider = async function (provider) {
  OAD._authError('');
  const scopes = provider === 'google' 
    ? 'https://www.googleapis.com/auth/calendar.readonly' 
    : 'Calendars.Read';
  
  const { data, error } = await OAD.supabase.auth.signInWithOAuth({
    provider: provider,
    options: {
      scopes: scopes,
      redirectTo: window.location.origin
    }
  });

  if (error) {
    OAD._authError(error.message);
  }
};

OAD._signIn = async function () {
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  if (!email || !password) { OAD._authError('Email and password are required.'); return; }
  OAD._authError('');
  const btn = document.querySelector('.modal .success');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  // SuperAdmin local login — credentials loaded from js/demo.config.js (gitignored).
  // If demo.config.js is absent (prod/local dev), this block never matches.
  const _dCfg = (typeof OAD.DemoConfig !== 'undefined') ? OAD.DemoConfig : null;
  if (_dCfg && _dCfg.superAdmin && email === _dCfg.superAdmin.email && password === _dCfg.superAdmin.password) {
    OAD._userId = 'demo-superadmin-id';
    OAD.closeModal();
    await OAD._bootAfterAuth();
    return;
  }

  // Demo role login — only active when demoMode is enabled and demo.config.js is present.
  if (OAD.Config.demoMode && _dCfg && Array.isArray(_dCfg.roles)) {
    const match = _dCfg.roles.find(function (r) { return r.email === email && r.password === password; });
    if (match) {
      OAD._userId = match.userId;
      if (typeof OAD.changeDemoRole === 'function') OAD.changeDemoRole(match.role);
      OAD.closeModal();
      await OAD._bootAfterAuth();
      return;
    }
  }

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

OAD.openCycleResolutionModal = function (threadId) {
  const t = OAD.getThread(threadId);
  if (!t) return;

  const cycles = OAD.detectCycles();
  const myCycles = cycles.filter(function (c) { return c.indexOf(t.id) !== -1; });

  if (myCycles.length === 0) {
    alert("This thread is not currently part of a dependency cycle.");
    return;
  }

  // Build HTML for each cycle this thread is part of
  let cyclesHtml = '';
  myCycles.forEach(function (cycle, cycleIdx) {
    const threadLoop = cycle.map(function (tid) { return OAD.getThread(tid); }).filter(Boolean);
    const loopNames = threadLoop.map(function (x) { return `<strong>${OAD.esc(x.title)}</strong>`; }).join(' ➔ ');
    
    // Find the actual connection edges that form this cycle
    const edges = [];
    for (let i = 0; i < threadLoop.length; i++) {
      const current = threadLoop[i];
      const next = threadLoop[(i + 1) % threadLoop.length];
      const conn = (current.connections || []).find(c => c.to_uuid === next.uuid && c.edge_type === 'blocks');
      if (conn) {
        edges.push({ from: current, to: next, conn: conn });
      }
    }

    cyclesHtml += `
      <div class="cycle-box" style="margin-bottom:20px;padding:12px;background:rgba(255,100,100,0.08);border:1px solid rgba(255,100,100,0.2);border-radius:8px">
        <div style="font-weight:600;color:var(--critical);margin-bottom:8px">Cycle #${cycleIdx + 1}: Deadlock Loop</div>
        <div style="font-size:13px;line-height:1.5;margin-bottom:12px">${loopNames} ➔ <em>(loop)</em></div>
        
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">Break the cycle by severing a blocking relationship:</div>
        <div class="cycle-edges-list">
          ${edges.map(function (edge) {
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                <div style="font-size:12px;flex-grow:1;color:var(--text-muted)">
                  <strong>${OAD.esc(edge.from.title)}</strong> blocks <strong>${OAD.esc(edge.to.title)}</strong>
                </div>
                <button class="danger btn-xs" onclick="OAD._severCycleEdge(${edge.from.id}, '${edge.to.uuid}')" style="padding:4px 8px;font-size:11px">Sever Link</button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  });

  OAD.openModal(`
    <h2>Resolve Dependency Cycle</h2>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.4">
      Circular dependencies create execution deadlocks where none of the tasks can be resolved. 
      Sever one of the links below to break the loop.
    </div>
    <div style="max-height:300px;overflow-y:auto;padding-right:4px">
      ${cyclesHtml}
    </div>
    <div class="modal-footer" style="margin-top:16px">
      <button class="secondary" onclick="OAD.closeModal()">Close Dialog</button>
    </div>`);
};

OAD._severCycleEdge = function (fromId, toUuid) {
  const fromThread = OAD.getThread(fromId);
  if (!fromThread) return;
  
  const target = OAD.DB.threads.find(x => x.uuid === toUuid);
  const targetTitle = target ? target.title : 'another thread';
  
  fromThread.connections = (fromThread.connections || []).filter(c => c.to_uuid !== toUuid);
  OAD.saveDB();
  OAD.addEvolution(fromId, `Severed cycle link: no longer blocks "${targetTitle}".`);
  
  const cycles = OAD.detectCycles();
  const myCycles = cycles.filter(function (c) { return c.indexOf(fromId) !== -1; });
  if (myCycles.length > 0) {
    OAD.openCycleResolutionModal(fromId);
  } else {
    OAD.closeModal();
  }
  OAD.refreshActiveView();
  const panel = document.getElementById('detail-content');
  if (panel && OAD._activeId) OAD.renderDetail(OAD._activeId);
};

OAD.loadTesseract = function (onLoaded, onError) {
  if (window.Tesseract) {
    onLoaded();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  script.onload = onLoaded;
  script.onerror = onError || (() => alert('Failed to load OCR scanner library (Tesseract.js). Please check your internet connection.'));
  document.head.appendChild(script);
};

OAD.openMailroomModal = function () {
  OAD.openModal(`
    <h2>📥 Mailroom Intake</h2>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.4">
      Upload a photo or document to scan locally. We will extract its text and dates to help you route or create a thread. No images are saved.
    </div>
    
    <div class="mailroom-dropzone" id="mailroom-dropzone" onclick="document.getElementById('mailroom-file-input').click()">
      <div class="mailroom-icon">📄</div>
      <div style="font-weight:600;font-size:14px">Drag & Drop Image Here</div>
      <div style="font-size:12px;color:var(--text-muted)">or click to browse files</div>
      <input type="file" id="mailroom-file-input" accept="image/*" />
    </div>
    
    <div class="modal-footer" style="margin-top:16px">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
    </div>
  `);

  const dropzone = document.getElementById('mailroom-dropzone');
  const fileInput = document.getElementById('mailroom-file-input');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      OAD._handleMailroomFileSelect(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      OAD._handleMailroomFileSelect(e.target.files[0]);
    }
  });
};

OAD._handleMailroomFileSelect = function (file) {
  OAD.openModal(`
    <h2>📥 Mailroom — Processing OCR</h2>
    <div class="mailroom-progress-container">
      <div class="mailroom-icon">🔍</div>
      <div style="font-weight:600" id="mailroom-status-text">Loading OCR engine...</div>
      <div class="mailroom-progress-bar-bg">
        <div class="mailroom-progress-bar-fill" id="mailroom-progress-bar" style="width: 0%"></div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">This process runs entirely locally in your browser.</div>
    </div>
  `);

  const updateProgress = (pct) => {
    const bar = document.getElementById('mailroom-progress-bar');
    const txt = document.getElementById('mailroom-status-text');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = `Analyzing document: ${pct}%`;
  };

  OAD.loadTesseract(async () => {
    try {
      const reader = new FileReader();
      reader.onload = async function () {
        try {
          const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
              if (m.status === 'recognizing') {
                updateProgress(Math.round(m.progress * 100));
              }
            }
          });
          const ret = await worker.recognize(reader.result);
          await worker.terminate();
          OAD._renderMailroomIntakeForm(ret.data.text);
        } catch (err) {
          console.error(err);
          alert('Error during OCR processing. Please make sure the file is a valid image.');
          OAD.openMailroomModal();
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert('Failed to read document file.');
      OAD.openMailroomModal();
    }
  }, () => {
    alert('Failed to load OCR scanner library (Tesseract.js).');
    OAD.openMailroomModal();
  });
};

OAD._renderMailroomIntakeForm = function (text) {
  const analysis = OAD.Mailroom.parseText(text);
  const recommendations = OAD.Mailroom.getRecommendations(text);

  const defaultTitle = analysis.suggestedTitle;
  const suggestedArea = analysis.suggestedLifeArea;
  const suggestedDate = analysis.dates.length > 0 ? analysis.dates[0] : '';

  const shouldRecommendAttach = recommendations.length > 0 && recommendations[0].score >= 5;
  const recommendedThreadUuid = shouldRecommendAttach ? recommendations[0].thread.uuid : '';

  const areas = OAD.LIFE_AREAS;
  const areaOpts = areas.map(a => `<option value="${a}" ${a === suggestedArea ? 'selected' : ''}>${a}</option>`).join('');

  const sortedActive = (OAD.DB.threads || [])
    .filter(t => t.status !== 'closed')
    .sort((a, b) => a.title.localeCompare(b.title));
  const threadOpts = sortedActive.map(t => {
    const isRec = recommendations.length > 0 && t.uuid === recommendations[0].thread.uuid;
    const recLabel = isRec ? ' ★ Suggested Match' : '';
    return `<option value="${t.uuid}" ${t.uuid === recommendedThreadUuid ? 'selected' : ''}>${OAD.esc(t.title)} (${OAD.esc(t.life_area)})${recLabel}</option>`;
  }).join('');

  OAD.openModal(`
    <h2 style="margin-bottom:8px">📥 Mailroom — Intake Form</h2>
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Review recommendations below. You can override any of these options.</div>
    
    <div class="mailroom-layout">
      <div class="mailroom-left">
        <label>Extracted Document Text</label>
        <div class="mailroom-raw-text">${OAD.esc(text)}</div>
      </div>
      
      <div class="mailroom-right">
        <div class="mailroom-options-group">
          <label class="mailroom-option">
            <input type="radio" name="mailroom-action" id="act-new" value="new" ${!shouldRecommendAttach ? 'checked' : ''} onchange="OAD._toggleMailroomActionFields()" />
            Create new Thread
          </label>
          <label class="mailroom-option">
            <input type="radio" name="mailroom-action" id="act-attach" value="attach" ${shouldRecommendAttach ? 'checked' : ''} onchange="OAD._toggleMailroomActionFields()" />
            Attach to existing Thread
          </label>
        </div>
        
        <div id="mailroom-new-fields" style="display: ${!shouldRecommendAttach ? 'block' : 'none'}">
          <div class="field" style="margin-bottom:12px">
            <label>Thread Title</label>
            <input type="text" id="m-title" value="${OAD.esc(defaultTitle)}" placeholder="e.g. IRS Notice 2026" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Description / Notes</label>
            <textarea id="m-desc" placeholder="Details extracted from document...">Extracted Text:\n${text.slice(0, 300)}...</textarea>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Life Area</label>
            <select id="m-area">${areaOpts}</select>
          </div>
          <div class="field-row" style="margin-bottom:12px">
            <div class="field">
              <label>Priority</label>
              <select id="m-priority">
                <option value="medium" selected>Medium</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div class="field">
              <label>Next Action Date</label>
              <input type="date" id="m-date" value="${suggestedDate}" />
            </div>
          </div>
        </div>
        
        <div id="mailroom-attach-fields" style="display: ${shouldRecommendAttach ? 'block' : 'none'}">
          <div class="field" style="margin-bottom:12px">
            <label>Select Thread</label>
            <select id="m-target-uuid">
              <option value="">-- Select a thread --</option>
              ${threadOpts}
            </select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Evolution Note to Append</label>
            <textarea id="m-evol-note" placeholder="Write a short update note...">Mail Intake: Received document. Extracted details:\n${text.slice(0, 150)}...</textarea>
          </div>
        </div>
      </div>
    </div>
    
    <div class="modal-footer" style="margin-top:20px">
      <button class="secondary" onclick="OAD.openMailroomModal()">Back</button>
      <button onclick="OAD._saveMailroomIntake()">Create / Update</button>
    </div>
  `, 'modal-lg');
};

OAD._toggleMailroomActionFields = function () {
  const isNew = document.getElementById('act-new')?.checked;
  const newFields = document.getElementById('mailroom-new-fields');
  const attachFields = document.getElementById('mailroom-attach-fields');
  if (newFields) newFields.style.display = isNew ? 'block' : 'none';
  if (attachFields) attachFields.style.display = isNew ? 'none' : 'block';
};

OAD._saveMailroomIntake = function () {
  const isNew = document.getElementById('act-new')?.checked;
  
  if (isNew) {
    const title = document.getElementById('m-title')?.value.trim();
    if (!title) { alert('Please enter a thread title.'); return; }
    
    const description = document.getElementById('m-desc')?.value.trim();
    const life_area = document.getElementById('m-area')?.value;
    const priority = document.getElementById('m-priority')?.value;
    const next_action_date = document.getElementById('m-date')?.value || null;

    // ARCHITECTURE_RULES.md Rule 5: no hand-built Thread objects. This used to construct the
    // record inline (Date.now() for id — inconsistent with OAD.nextId()'s sequential space —
    // and skipping every default field OAD.makeThread() sets), leaving a malformed thread until
    // the next _normalizeDB() backfill on reload. description is kept as an override — not part
    // of the canonical schema, but OAD.Mailroom.getRecommendations (js/mailroom.js) already reads
    // it for match-scoring, so dropping it here would silently break that.
    const newThread = OAD.addThread(OAD.makeThread({
      title,
      description,
      life_area,
      status: 'open',
      priority,
      next_action_date: next_action_date || ''
    }));
    OAD.addEvolution(newThread.id, 'Thread created via Mailroom Intake.');
    OAD.saveDB();
    OAD.refreshActiveView();
    OAD.closeModal();
    OAD.selectThread(newThread.id);
  } else {
    const targetUuid = document.getElementById('m-target-uuid')?.value;
    if (!targetUuid) { alert('Please select a target thread.'); return; }
    
    const thread = OAD.DB.threads.find(x => x.uuid === targetUuid);
    if (!thread) { alert('Selected thread not found.'); return; }
    
    const note = document.getElementById('m-evol-note')?.value.trim() || 'Received document via Mailroom Intake.';
    
    OAD.addEvolution(thread.id, note);
    OAD.saveDB();
    OAD.refreshActiveView();
    OAD.closeModal();
    OAD.selectThread(thread.id);
  }
};

OAD.openSchedulesModal = function() {
  const html = `
    <div class="modal-header">
      <h2>Employee Schedule Configuration</h2>
    </div>
    <div class="modal-body" style="padding: 24px; font-size: 14px;">
      <p style="color:var(--text-muted); margin-bottom:24px; line-height:1.5;">
        The Clinical Rules Engine cross-references these shift schedules during automatic thread generation to ensure granular SLAs (e.g., "Due in 48 hours") intelligently route around off-shift hours and weekends.
      </p>
      
      <table style="width:100%; border-collapse:collapse; background:var(--surface2); border-radius:8px; overflow:hidden; border:1px solid var(--border)">
        <thead>
          <tr style="text-align:left; border-bottom:1px solid var(--border); background:var(--surface)">
            <th style="padding:12px 16px; font-weight:600">Role / Name</th>
            <th style="padding:12px 16px; font-weight:600">Working Days</th>
            <th style="padding:12px 16px; font-weight:600">Shift Hours</th>
            <th style="padding:12px 16px; text-align:right; font-weight:600">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:12px 16px; font-weight:600">Director<br><span style="font-weight:400; color:var(--text-muted); font-size:12px">Jenkins, Kim, Clark</span></td>
            <td style="padding:12px 16px">Mon - Fri</td>
            <td style="padding:12px 16px; font-family:var(--mono); font-size:13px">09:00 - 17:00</td>
            <td style="padding:12px 16px; text-align:right"><span style="color:var(--success); font-weight:600; font-size:12px; background:rgba(var(--success-rgb), 0.1); padding:4px 8px; border-radius:4px">Active</span></td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:12px 16px; font-weight:600">Counselor<br><span style="font-weight:400; color:var(--text-muted); font-size:12px">Clinical Team</span></td>
            <td style="padding:12px 16px">Mon - Fri</td>
            <td style="padding:12px 16px; font-family:var(--mono); font-size:13px">08:00 - 16:00</td>
            <td style="padding:12px 16px; text-align:right"><span style="color:var(--success); font-weight:600; font-size:12px; background:rgba(var(--success-rgb), 0.1); padding:4px 8px; border-radius:4px">Active</span></td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:12px 16px; font-weight:600">Case Manager<br><span style="font-weight:400; color:var(--text-muted); font-size:12px">Placement & Ops</span></td>
            <td style="padding:12px 16px">Mon - Fri</td>
            <td style="padding:12px 16px; font-family:var(--mono); font-size:13px">09:00 - 17:00</td>
            <td style="padding:12px 16px; text-align:right"><span style="color:var(--success); font-weight:600; font-size:12px; background:rgba(var(--success-rgb), 0.1); padding:4px 8px; border-radius:4px">Active</span></td>
          </tr>
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:12px 16px; font-weight:600">Medical / Nurse<br><span style="font-weight:400; color:var(--text-muted); font-size:12px">24/7 Coverage</span></td>
            <td style="padding:12px 16px">Mon - Sun</td>
            <td style="padding:12px 16px; font-family:var(--mono); font-size:13px">24 Hours</td>
            <td style="padding:12px 16px; text-align:right"><span style="color:var(--success); font-weight:600; font-size:12px; background:rgba(var(--success-rgb), 0.1); padding:4px 8px; border-radius:4px">Active</span></td>
          </tr>
          <tr>
            <td style="padding:12px 16px; font-weight:600">Recovery Advocate (RA)<br><span style="font-weight:400; color:var(--text-muted); font-size:12px">Shift Rotation</span></td>
            <td style="padding:12px 16px">Mon - Sun</td>
            <td style="padding:12px 16px; font-family:var(--mono); font-size:13px">24 Hours</td>
            <td style="padding:12px 16px; text-align:right"><span style="color:var(--success); font-weight:600; font-size:12px; background:rgba(var(--success-rgb), 0.1); padding:4px 8px; border-radius:4px">Active</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Close</button>
      <button onclick="OAD.closeModal(); alert('Schedules locked. The Rules Engine will now enforce shift logic on all new admissions.')">Save Configuration</button>
    </div>
  `;
  OAD.openModal(html);
};

OAD.openAdmitClientModal = function() {
  const html = `
    <div class="modal-header">
      <h2>Simulate EHR Admission</h2>
    </div>
    <div class="modal-body" style="padding: 24px;">
      <p style="color:var(--text-muted); margin-bottom:20px; font-size:13px; line-height:1.5">
        In production, this event is triggered automatically via API when the client is entered into the EHR. For the demo, this manually triggers the <code>config/rules/hc_admission.json</code> Rules Engine to spawn all required threads.
      </p>
      <div class="input-group">
        <label>Client Name</label>
        <input type="text" id="f-client-name" placeholder="e.g. John Doe" value="Demo Client">
      </div>
      <div class="input-group" style="margin-top:16px;">
        <label>Primary Counselor</label>
        <select id="f-client-counselor">
          <option value="Counselor 1">Counselor 1</option>
          <option value="Counselor 2">Counselor 2</option>
          <option value="Counselor 3">Counselor 3</option>
        </select>
      </div>
      <div class="input-group" style="margin-top:16px;">
        <label>Track / Length of Stay</label>
        <select id="f-client-track">
          <option value="28">28-Day Residential Track</option>
          <option value="14">14-Day Short Track</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Cancel</button>
      <button onclick="OAD._executeAdmission()">Execute Payload</button>
    </div>
  `;
  OAD.openModal(html);
};

OAD._executeAdmission = async function() {
  const name = document.getElementById('f-client-name').value.trim() || 'Demo Client';
  const counselor = document.getElementById('f-client-counselor').value;
  const days = parseInt(document.getElementById('f-client-track').value) || 28;
  
  // 1. Add to Command Center Clients
  if (!OAD._demoClients) OAD._demoClients = [];
  const today = OAD.todayStr();
  OAD._demoClients.push({
    name: name,
    counselor: counselor,
    projected_days: days,
    total_planned_days: days,
    check_in_date: today,
    checkout_type: 'Active',
    total_stay_days: 1
  });

  // 2. Fetch and apply Rules Engine payload
  try {
    const res = await fetch('config/rules/hc_admission.json');
    if (res.ok) {
      const payload = await res.json();
      const now = new Date();
      let threadsAdded = 0;
      
      const pUuid = 'u-' + Math.random().toString(36).substr(2, 9);
      const dischargeDate = new Date(now);
      dischargeDate.setDate(dischargeDate.getDate() + days);

      OAD.DB.threads.push({
         id: OAD.nextId(),
         uuid: pUuid,
         title: `[Patient] ${name}`,
         status: 'open',
         priority: 'Medium',
         life_area: 'Patient',
         next_action: 'Discharge patient.',
         next_action_date: dischargeDate.toISOString().split('T')[0],
         closing_condition: 'Patient discharged.',
         evolution_log: [{date: now.toISOString().split('T')[0], note: 'Created'}],
         metadata: {
           counselor: counselor,
           check_in_date: today,
           discharge_date: dischargeDate.toISOString().split('T')[0],
           total_stay_days: days
         }
      });

      payload.triggers.forEach(trigger => {
        if (trigger.type === 'thread' || trigger.type === 'escalation') {
           let due = new Date(now);
           if (trigger.anchor === 'admission') {
             if (trigger.offset_days) due.setDate(due.getDate() + trigger.offset_days);
             if (trigger.offset_hours) due.setHours(due.getHours() + trigger.offset_hours);
           } else if (trigger.anchor === 'discharge') {
             due.setDate(due.getDate() + days); // add length of stay
             if (trigger.offset_days) due.setDate(due.getDate() + trigger.offset_days);
             if (trigger.offset_hours) due.setHours(due.getHours() + trigger.offset_hours);
           }
           
           OAD.DB.threads.push({
             id: OAD.nextId(),
             uuid: 'u-' + Math.random().toString(36).substr(2, 9),
             parent_uuid: pUuid,
             title: `[${trigger.owner_role}] ${trigger.name} - ${name}`,
             status: 'open',
             priority: trigger.priority || 'Normal',
             life_area: trigger.owner_role,
             pressure: trigger.priority === 'High' ? 8 : 5,
             next_action: trigger.mandatory ? 'Complete mandatory requirement.' : 'Complete task.',
             next_action_date: due.toISOString().split('T')[0],
             closing_condition: 'Documentation submitted.',
             evolution_log: [{date: now.toISOString().split('T')[0], note: 'Created'}],
             metadata: { counselor: counselor },
             created_at: now.toISOString(),
             updated_at: now.toISOString()
           });
           threadsAdded++;
        } else if (trigger.type === 'cadence') {
           if (trigger.interval_days) {
             let iteration = 1;
             for (let i = trigger.interval_days; i <= days; i += trigger.interval_days) {
               let due = new Date(now);
               due.setDate(due.getDate() + i);
               
               OAD.DB.threads.push({
                 id: OAD.nextId(),
                 uuid: 'u-' + Math.random().toString(36).substr(2, 9),
                 parent_uuid: pUuid,
                 title: `[${trigger.owner_role}] ${trigger.name} (Part ${iteration}) - ${name}`,
                 status: 'open',
                 priority: trigger.priority || 'Normal',
                 life_area: trigger.owner_role,
                 pressure: trigger.priority === 'High' ? 8 : 5,
                 next_action: trigger.mandatory ? 'Complete mandatory requirement.' : 'Complete task.',
                 next_action_date: due.toISOString().split('T')[0],
                 closing_condition: 'Documentation submitted.',
                 evolution_log: [{date: now.toISOString().split('T')[0], note: 'Created'}],
                 metadata: { counselor: counselor },
                 created_at: now.toISOString(),
                 updated_at: now.toISOString()
               });
               threadsAdded++;
               iteration++;
             }
           }
        }
      });
      alert(`ADMISSION SUCCESS:\\n${name} has been admitted.\\n\\nRules Engine parsed config/rules/hc_admission.json and instantly spawned ${threadsAdded} dependent clinical threads and cadences across the organization!`);
    } else {
      alert('Failed to load Rules Engine payload.');
    }
  } catch (e) {
    console.error("Rules engine failed:", e);
    alert('Failed to execute admission rules.');
  }

  OAD.saveDB();
  OAD.closeModal();
  if (OAD._lastView === 'CommandCenter' && typeof OAD.renderCommandCenter === 'function') OAD.renderCommandCenter();
  else if (OAD._lastView === 'Matrix') OAD.renderMatrixView();
  else OAD.renderListView();
};

// ── Catch Up (js/bulk.js OAD.Bulk.catchUpQueue) ─────────────────────────────────────────────
// One behind thread at a time, four decisions. The point is that a backlog becomes a queue you
// can clear, not a wall you avoid. Every action goes through OAD.Bulk.apply, so the buffer and
// bollard rules and the Closure Wizard guard all apply here too, and "Undo last" works.
OAD.openCatchUpModal = function () {
  OAD._catchUpDraft = null;
  OAD._catchUpSkipped = new Set();
  OAD._catchUpStats = { done: 0, dated: 0, parked: 0, dropped: 0 };
  OAD._renderCatchUp();
};

OAD._catchUpDefaultDate = function (t) {
  var opts = OAD.Bulk.dayOptions(t, new Date(), 7);
  var pick = opts.filter(function (o) { return o.suggested; })[0];
  if (pick) return pick.date;
  var tomorrow = OAD.Bulk._addDays(OAD.todayStr(), 1);
  if (t.deadline && t.deadline > OAD.todayStr()) {
    var dayBefore = OAD.Bulk._addDays(t.deadline, -1);
    return dayBefore < tomorrow ? OAD.todayStr() : tomorrow;
  }
  return tomorrow;
};

// What the user has typed on the current card survives a redraw (a failed action used to reset
// the date field to the default, losing the date they had just chosen).
OAD._catchUpDraftFor = function (t) {
  var d = OAD._catchUpDraft;
  if (d && d.uuid === t.uuid) return d;
  var date = OAD._catchUpDefaultDate(t);
  OAD._catchUpDraft = {
    uuid: t.uuid,
    date: date,
    deadline: OAD.Bulk.deadlinePassed(t) ? OAD.Bulk.suggestedDeadline(t, date) : '',
    deadlineTouched: false,
    trigger: '',
    error: '',
    errorField: ''
  };
  return OAD._catchUpDraft;
};

OAD._catchUpReadInputs = function () {
  var d = OAD._catchUpDraft;
  if (!d) return;
  var date = document.getElementById('catchup-date');
  var dl = document.getElementById('catchup-deadline');
  var trig = document.getElementById('catchup-trigger');
  if (date) d.date = date.value;
  if (dl) d.deadline = dl.value;
  if (trig) d.trigger = trig.value;
};

OAD._catchUpPickDate = function (ds) {
  OAD._catchUpReadInputs();
  var d = OAD._catchUpDraft;
  var t = d && OAD.getThreadByUUID(d.uuid);
  if (!t) return;
  d.date = ds;
  // Keep the suggested new deadline in step with the chosen date until the user edits it.
  if (OAD.Bulk.deadlinePassed(t) && !d.deadlineTouched) d.deadline = OAD.Bulk.suggestedDeadline(t, ds);
  d.error = ''; d.errorField = '';
  OAD._renderCatchUp();
  var btn = document.getElementById('catchup-date-btn');
  if (btn) btn.focus();
};

OAD._catchUpDayChipsHtml = function (t, selected) {
  var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return '<div class="catchup-days" id="catchup-days">' + OAD.Bulk.dayOptions(t, new Date(), 7).map(function (o) {
    var md = Number(o.date.slice(5, 7)) + '/' + Number(o.date.slice(8, 10));
    var cls = 'day-chip load-' + o.load + (o.date === selected ? ' is-selected' : '') + (o.suggested ? ' is-suggested' : '');
    var title = o.count + ' next action' + (o.count === 1 ? '' : 's') + ' already on this day, load ' + o.load +
      (o.notes.length ? '. ' + o.notes.join(', ') : '') + (o.afterDeadline ? '. On or after the deadline' : '');
    return '<button type="button" class="' + cls + '" data-date="' + o.date + '" ' + (o.afterDeadline ? 'disabled ' : '') +
      'title="' + OAD.esc(title) + '" onclick="OAD._catchUpPickDate(\'' + o.date + '\')">' +
      '<span class="day-chip-day">' + names[o.dow] + ' ' + md + (o.suggested ? ' ★' : '') + '</span>' +
      '<span class="day-chip-load">' + o.count + ' · ' + o.load + '</span>' +
      (o.notes.length ? '<span class="day-chip-note">' + OAD.esc(o.notes.join(', ')) + '</span>' : '') +
    '</button>';
  }).join('') + '</div>';
};

OAD._renderCatchUp = function () {
  var now = new Date();
  var queue = OAD.Bulk.catchUpQueue(now).filter(function (i) { return !OAD._catchUpSkipped.has(i.thread.uuid); });
  var st = OAD._catchUpStats;
  var undo = OAD.Bulk._lastBatch
    ? '<button class="ghost" onclick="OAD._catchUpUndo()">Undo last</button>'
    : '';

  if (!queue.length) {
    OAD._catchUpDraft = null;
    OAD.openModal(
      '<div class="modal-header"><h2>Catch Up</h2></div>' +
      '<div class="catchup-done" id="catchup-done">' +
        '<div style="font-size:28px">🎉</div>' +
        '<p><strong>Nothing left in the queue.</strong></p>' +
        '<p class="text-muted text-sm">Done ' + st.done + ' · Rescheduled ' + st.dated + ' · Parked ' + st.parked + ' · Dropped ' + st.dropped +
          (OAD._catchUpSkipped.size ? ' · Skipped ' + OAD._catchUpSkipped.size : '') + '</p>' +
      '</div>' +
      '<div class="modal-footer">' + undo + '<button onclick="OAD._closeCatchUp()">Close</button></div>'
    );
    return;
  }

  var item = queue[0];
  var t = item.thread;
  var d = OAD._catchUpDraftFor(t);
  var reasonText;
  if (item.reason === 'past_deadline') {
    var dl = -OAD.TemporalStatus.daysUntilDeadline(t, now);
    reasonText = 'Deadline was ' + OAD.formatDate(t.deadline) + ' (' + dl + ' day' + (dl === 1 ? '' : 's') + ' ago). Did it happen?';
  } else {
    var ago = OAD.TemporalStatus.daysSinceNextActionDate(t, now);
    reasonText = 'Next action was due ' + OAD.formatDate(t.next_action_date) + ' (' + ago + ' day' + (ago === 1 ? '' : 's') + ' ago)' +
      (t.deadline ? '. Deadline ' + OAD.formatDate(t.deadline) + '.' : '. No deadline.');
  }
  var wizardReasons = OAD.Bulk.wizardReasons(t);
  var needsWizard = wizardReasons.length > 0;
  var ctx = OAD.Bulk.captureContext(t);
  var ctxParts = [];
  if (ctx.capturedOn) ctxParts.push('Captured ' + OAD.formatDate(ctx.capturedOn) + (ctx.how ? ' ' + ctx.how : ''));
  if (ctx.source) ctxParts.push('Source: ' + ctx.source);
  if (ctx.lastNote) ctxParts.push('Last note (' + OAD.formatDate(ctx.lastDate) + '): ' + ctx.lastNote);
  if (!t.next_action && !t.closing_condition) ctxParts.push('No next action or closing condition was ever written down');
  var parent = t.parent_uuid ? OAD.getThreadByUUID(t.parent_uuid) : null;
  var pastDl = OAD.Bulk.deadlinePassed(t);
  var err = function (field) {
    return d.error && d.errorField === field ? '<div class="catchup-error" id="catchup-error">' + OAD.esc(d.error) + '</div>' : '';
  };

  var closeRow = needsWizard
    ? '<div class="catchup-action">' +
        '<button class="success" id="catchup-done-btn" onclick="OAD._catchUpWizard(\'done\')">✓ Done via Closure Wizard →</button>' +
        '<button class="ghost" id="catchup-drop-btn" onclick="OAD._catchUpWizard(\'drop\')">Drop via Closure Wizard →</button>' +
        '<div class="text-muted text-sm" style="flex-basis:100%">The wizard decides what happens to these. Reopen Catch Up afterward to continue.' +
          '<ul class="catchup-wizard-reasons" id="catchup-wizard-reasons">' + wizardReasons.map(function (r) { return '<li>' + OAD.esc(r) + '</li>'; }).join('') + '</ul></div>' +
      '</div>'
    : '<div class="catchup-action">' +
        '<button class="success" id="catchup-done-btn" onclick="OAD._catchUpAct(\'done\')">✓ Done → next</button>' +
        '<span class="text-muted text-sm">It happened. Close it.</span>' +
      '</div>';

  OAD.openModal(
    '<div class="modal-header"><h2>Catch Up <span class="text-muted text-sm" id="catchup-remaining">' + queue.length + ' left</span></h2></div>' +
    '<div class="catchup-card" data-uuid="' + OAD.esc(t.uuid) + '">' +
      '<div class="catchup-title" id="catchup-title">' + OAD.esc(OAD.formatDisplayTitle(t.title)) + '</div>' +
      '<div class="detail-badges" style="margin:6px 0">' +
        '<span class="pill ' + OAD.esc(t.status) + '">' + OAD.esc(t.status) + '</span> ' +
        '<span class="pill ' + OAD.esc(t.priority) + '">' + OAD.esc(t.priority) + '</span> ' +
        '<span class="text-muted text-sm">' + OAD.esc(t.life_area || '') + (parent ? ' · under ' + OAD.esc(parent.title) : '') + '</span>' +
      '</div>' +
      '<div class="catchup-reason ' + (item.reason === 'past_deadline' ? 'is-past-deadline' : '') + '">' + OAD.esc(reasonText) + '</div>' +
      (t.next_action ? '<div class="text-sm mt-8"><strong>Next action:</strong> ' + OAD.esc(t.next_action) + '</div>' : '') +
      (t.closing_condition ? '<div class="text-sm mt-8 text-muted"><strong>Closes when:</strong> ' + OAD.esc(t.closing_condition) + '</div>' : '') +
      (ctxParts.length ? '<div class="catchup-context text-sm" id="catchup-context">' + ctxParts.map(OAD.esc).join(' · ') + '</div>' : '') +
    '</div>' +
    '<div class="catchup-actions">' +
      closeRow + err('close') +
      '<div class="catchup-section">' +
        '<div class="text-sm"><strong>Still doing it.</strong> Pick the next action day. Numbers are next actions already on that day. ★ = suggested.</div>' +
        OAD._catchUpDayChipsHtml(t, d.date) +
        '<div class="catchup-action">' +
          '<label class="text-sm" for="catchup-date">Next action</label>' +
          '<input type="date" id="catchup-date" value="' + OAD.esc(d.date) + '" onkeydown="if (event.key === \'Enter\') OAD._catchUpAct(\'date\')">' +
          (pastDl
            ? '<label class="text-sm" for="catchup-deadline">New deadline</label>' +
              '<input type="date" id="catchup-deadline" value="' + OAD.esc(d.deadline) + '" oninput="OAD._catchUpDraft.deadlineTouched = true" onkeydown="if (event.key === \'Enter\') OAD._catchUpAct(\'date\')" title="The old deadline (' + OAD.esc(t.deadline) + ') has passed. Leave empty for no deadline.">'
            : '') +
          '<button class="secondary" id="catchup-date-btn" onclick="OAD._catchUpAct(\'date\')">Reschedule → next</button>' +
        '</div>' +
        (pastDl ? '<div class="text-muted text-sm">The old deadline (' + OAD.esc(OAD.formatDate(t.deadline)) + ') has passed, so set a new one, or clear it for no deadline.</div>' : '') +
        err('date') +
      '</div>' +
      '<div class="catchup-action">' +
        '<input type="text" id="catchup-trigger" value="' + OAD.esc(d.trigger) + '" placeholder="Not now. What would bring this back?" style="flex:1;min-width:160px" onkeydown="if (event.key === \'Enter\') OAD._catchUpAct(\'park\')">' +
        '<button class="secondary" id="catchup-park-btn" onclick="OAD._catchUpAct(\'park\')">Park → next</button>' +
      '</div>' + err('park') +
      (needsWizard ? '' :
      '<div class="catchup-action">' +
        '<button class="ghost" id="catchup-drop-btn" onclick="OAD._catchUpAct(\'drop\')">Drop → next</button>' +
        '<span class="text-muted text-sm">Not doing it. Close without claiming it was done.</span>' +
      '</div>') +
    '</div>' +
    '<div class="modal-footer">' +
      undo +
      '<button class="ghost" onclick="OAD.closeModal(); OAD.selectThread(' + t.id + ');">Open thread</button>' +
      '<button class="ghost" id="catchup-skip-btn" onclick="OAD._catchUpAct(\'skip\')">Skip for now → next</button>' +
      '<button onclick="OAD._closeCatchUp()">Close</button>' +
    '</div>'
  );
};

OAD._catchUpAct = function (action) {
  var card = document.querySelector('#modal-overlay .catchup-card');
  if (!card) return;
  var uuid = card.getAttribute('data-uuid');
  OAD._catchUpReadInputs();
  var d = OAD._catchUpDraft;
  d.error = ''; d.errorField = '';
  if (action === 'skip') {
    OAD._catchUpSkipped.add(uuid);
    OAD._catchUpDraft = null;
    OAD._renderCatchUp();
    return;
  }
  var t = OAD.getThreadByUUID(uuid);
  var op;
  if (action === 'done') op = { type: 'done' };
  else if (action === 'drop') op = { type: 'drop' };
  else if (action === 'park') op = { type: 'park', trigger: d.trigger };
  else if (action === 'date') {
    op = { type: 'setDate', date: d.date };
    if (OAD.Bulk.deadlinePassed(t)) op.newDeadline = d.deadline || '';
  }
  var r = OAD.Bulk.apply([uuid], op, 'Catch Up: ' + OAD.Bulk.describe(op).toLowerCase());
  var field = action === 'date' ? 'date' : action === 'park' ? 'park' : 'close';
  if (r.skipped.length) {
    d.error = r.skipped[0].reason; d.errorField = field;
  } else if (r.changed.length) {
    var key = { done: 'done', drop: 'dropped', park: 'parked', date: 'dated' }[action];
    OAD._catchUpStats[key]++;
    OAD._catchUpDraft = null;
    // A thread rescheduled to a date that is still in the past stays behind; move past it
    // rather than showing the same card again.
    if (OAD.Bulk.catchUpQueue(new Date()).some(function (i) { return i.thread.uuid === uuid; })) OAD._catchUpSkipped.add(uuid);
  } else if (action === 'date') {
    d.error = 'That is the date it already has. Pick another day, or Skip.'; d.errorField = 'date';
  }
  OAD._renderCatchUp();
};

// Threads with open sub-threads or a real dependency close through the existing Closure Wizard
// (cascade / reparent / transfer decisions live there), not a dead-end disabled button.
OAD._catchUpWizard = function (action) {
  var card = document.querySelector('#modal-overlay .catchup-card');
  if (!card) return;
  var t = OAD.getThreadByUUID(card.getAttribute('data-uuid'));
  if (!t) return;
  OAD._catchUpDraft = null;
  OAD.closeModal();
  var patch = action === 'done' ? { status: 'closed', closing_condition_met: true } : { status: 'closed' };
  var note = action === 'done' ? 'Catch Up: marked done (confirmed by user).' : 'Catch Up: dropped. No longer pursuing; closing condition not met.';
  OAD.openClosureWizard(t.id, patch, note);
};

OAD._catchUpUndo = function () {
  var last = OAD.Bulk._lastBatch;
  if (!last) return;
  last.entries.forEach(function (e) { OAD._catchUpSkipped.delete(e.uuid); });
  OAD.Bulk.undo();
  OAD._catchUpDraft = null;
  OAD._renderCatchUp();
};

// Closing Catch Up refreshes whatever is underneath: the List tab (so the Catch Up (N) count is
// current) or the open thread.
OAD._closeCatchUp = function () {
  OAD.closeModal();
  OAD.refreshActiveView();
  if (OAD._lastView === 'List' && document.getElementById('list-tab-threads')) {
    OAD.renderListView();
  } else if (OAD._activeId) {
    OAD.renderDetail(OAD._activeId);
  }
};

// ── Park / Reactivate Bollard ───────────────────────────────────────────────────────────────
OAD.openParkBollardModal = function (uuid) {
  var p = OAD.Bulk.parkPreview(uuid);
  if (!p) return;
  var rows = p.candidates.map(function (x) {
    return '<label class="park-row"><input type="checkbox" class="park-check" data-uuid="' + OAD.esc(x.uuid) + '" checked> ' +
      '<span>' + OAD.esc(x.title) + '</span> <span class="pill ' + OAD.esc(x.status) + '">' + OAD.esc(x.status) + '</span></label>';
  }).join('');
  OAD.openModal(
    '<div class="modal-header"><h2>Park Bollard</h2></div>' +
    '<p><strong>' + OAD.esc(p.bollard.title) + '</strong> goes dormant, along with the checked threads under it. ' +
    'Uncheck anything that has to keep moving regardless (a legal or financial obligation, say). ' +
    'Threads that are already dormant are left alone and will stay dormant when you reactivate.</p>' +
    '<div class="form-group"><label>Why is this on hold? What brings it back?</label>' +
    '<input type="text" id="park-reason" placeholder="e.g. Focusing on W-2 search. Revisit at the Nov 2 review."></div>' +
    '<div class="park-list">' + rows + '</div>' +
    '<div class="modal-footer">' +
      '<button class="ghost" onclick="OAD.closeModal()">Cancel</button>' +
      '<button id="park-confirm-btn" onclick="OAD._confirmParkBollard(\'' + OAD.esc(uuid) + '\')">Park</button>' +
    '</div>'
  );
};

OAD._confirmParkBollard = function (uuid) {
  var keep = Array.from(document.querySelectorAll('#modal-overlay .park-check'))
    .filter(function (c) { return !c.checked; })
    .map(function (c) { return c.getAttribute('data-uuid'); });
  var reasonEl = document.getElementById('park-reason');
  OAD.Bulk.parkBollard(uuid, { keepActive: keep, reason: reasonEl ? reasonEl.value : '' });
  OAD.closeModal();
  OAD.refreshActiveView();
  // refreshActiveView redraws the last list/dashboard view, not the open thread, so redraw the
  // thread explicitly (same as every other save path in this file).
  var b = OAD.getThreadByUUID(uuid);
  if (b) OAD.renderDetail(b.id);
};

OAD.openReactivateBollardModal = function (uuid) {
  var b = OAD.getThreadByUUID(uuid);
  if (!b) return;
  var parked = (OAD.DB.threads || []).filter(function (x) {
    return x.metadata && x.metadata.parked_by === uuid && x.status === 'dormant';
  });
  OAD.openModal(
    '<div class="modal-header"><h2>Reactivate Bollard</h2></div>' +
    '<p><strong>' + OAD.esc(b.title) + '</strong> and the ' + parked.length + ' thread' + (parked.length === 1 ? '' : 's') +
    ' parked with it come back to their previous status. Anything that fell behind while parked goes into Catch Up rather than all at once onto your list.</p>' +
    '<div class="park-list">' + parked.map(function (x) { return '<div class="park-row">' + OAD.esc(x.title) + '</div>'; }).join('') + '</div>' +
    '<div class="modal-footer">' +
      '<button class="ghost" onclick="OAD.closeModal()">Cancel</button>' +
      '<button id="reactivate-confirm-btn" onclick="OAD._confirmReactivateBollard(\'' + OAD.esc(uuid) + '\')">Reactivate</button>' +
    '</div>'
  );
};

OAD._confirmReactivateBollard = function (uuid) {
  var r = OAD.Bulk.reactivateBollard(uuid);
  OAD.closeModal();
  OAD.refreshActiveView();
  var b = OAD.getThreadByUUID(uuid);
  if (b) OAD.renderDetail(b.id);
  if (r.ok && r.behind) OAD.openCatchUpModal();
};
