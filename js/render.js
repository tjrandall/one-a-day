window.OAD = window.OAD || {};

OAD._activeId = null;

OAD.renderList = function () {
  const query   = (document.getElementById('search-input')?.value || '').toLowerCase();
  const threads = OAD.DB.threads
    .filter(t => !query || (t.title || '').toLowerCase().includes(query) || (t.life_area || '').toLowerCase().includes(query))
    .map(t => ({ ...t, _score: OAD.pressure(t) }))
    .sort((a, b) => b._score - a._score);

  const container = document.getElementById('thread-list');
  if (!container) return;

  if (!threads.length) {
    container.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center;font-size:14px;">No threads yet. Add one above.</div>';
    return;
  }

  container.innerHTML = threads.map(t => {
    const pc = OAD.pressureClass(t._score);
    const active = t.id === OAD._activeId ? ' active' : '';
    const ds = t.deadline ? OAD.deadlineState(t) : null;
    const atRisk = ds && !ds.onTrack;
    const riskClass = atRisk ? ' is-at-risk' : '';

    let deadlineLineHtml = '';
    if (ds) {
      const days = ds.daysRemaining;
      const timeText = days <= 0 ? 'Past deadline'
        : ds.weeksRemaining > 0
          ? ds.weeksRemaining + 'w remaining'
          : days + 'd remaining';
      const sessText = ds.sessionsRemaining != null
        ? ' · ' + ds.sessionsRemaining + ' session' + (ds.sessionsRemaining !== 1 ? 's' : '') + ' left'
        : '';
      const riskText = atRisk
        ? ' <span class="deadline-behind">⚑ ' + ds.behindBy + ' behind</span>'
        : '';
      deadlineLineHtml = '<div class="deadline-line">' +
        '<span class="deadline-tag">' + OAD.esc(timeText + sessText) + '</span>' +
        riskText +
        '</div>';
    }

    return `
      <div class="thread-item${active}${riskClass}" data-id="${t.id}" onclick="OAD.selectThread(${t.id})">
        <div class="thread-item-top">
          <div class="thread-title">${OAD.esc(t.title)}</div>
          <div class="pressure-badge ${pc}">${t._score}</div>
        </div>
        <div class="thread-item-meta">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span>${OAD.esc(t.life_area)}</span>
        </div>
        ${deadlineLineHtml}
      </div>`;
  }).join('');

  OAD.renderPersonaBar();
};

OAD.renderPersonaBar = function () {
  const bar = document.getElementById('persona-bar');
  if (!bar) return;

  const threads = OAD.DB.threads;
  const open    = threads.filter(t => t.status !== 'closed').length;
  const stalled = threads.filter(t => t.status === 'stalled').length;
  const scores  = threads.map(t => OAD.pressure(t));
  const avg     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgCls  = avg >= 60 ? 'pressure-high' : avg >= 30 ? 'pressure-mid' : 'pressure-low';
  const p = OAD.DB.persona;
  const dl = p.life_context.hard_deadline ? OAD.formatDate(p.life_context.hard_deadline) : '—';

  bar.innerHTML = `
    <div class="persona-stat"><span class="text-muted text-sm">Active</span><span class="val">${open}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Stalled</span><span class="val" style="color:var(--stalled)">${stalled}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Avg Pressure</span><span class="val ${avgCls}">${avg}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Pressure Level</span><span class="val">${OAD.esc(p.life_context.pressure_level)}</span></div>
    <div class="persona-stat"><span class="text-muted text-sm">Hard Deadline</span><span class="val">${OAD.esc(dl)}</span></div>
    <div style="margin-left:auto">
      <button class="ghost" style="font-size:12px;padding:5px 10px" onclick="OAD.openPersonaModal()">Edit Persona</button>
    </div>`;
};

OAD.selectThread = function (id) {
  OAD._activeId = id;
  OAD.renderList();
  OAD.renderDetail(id);
};

OAD.renderDetail = function (id) {
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const t = OAD.getThread(id);
  if (!t) {
    panel.innerHTML = '<div class="detail-empty">Select a thread to view details</div>';
    return;
  }

  const score   = OAD.pressure(t);
  const pc      = OAD.pressureClass(score);
  const lastInsight = (t.ai_insights || []).slice(-1)[0] || null;

  const contingencyDays = OAD.daysUntil(t.contingency_trigger_date);
  const contingencyClass = contingencyDays !== null && contingencyDays < 3 ? 'contingency-urgent'
    : contingencyDays !== null && contingencyDays < 7 ? 'contingency-warn' : '';

  const gctx = OAD.getGraphContext(t.id);

  function graphRow(icon, label, thread) {
    const pressureHtml = thread && thread.status !== 'closed'
      ? '<span class="graph-row-pressure ' + OAD.pressureClass(OAD.pressure(thread)) + '">' + OAD.pressure(thread) + '</span>'
      : '';
    const clickable = thread
      ? ' role="button" onclick="OAD.selectThread(' + thread.id + ')" style="cursor:pointer"'
      : '';
    return '<div class="graph-row"' + clickable + '>' +
      '<span class="graph-row-icon">' + icon + '</span>' +
      '<span class="graph-row-label">' + OAD.esc(label) + '</span>' +
      pressureHtml +
    '</div>';
  }

  const blocksRows    = gctx.blocks.map(function (e)    { return graphRow('→', e.label, e.thread); });
  const blockedByRows = gctx.blockedBy.map(function (t) { return graphRow('←', t.title, t); });
  const enablesRows   = gctx.enables.map(function (e)   { return graphRow('↗', e.label, e.thread); });
  const relatesRows   = gctx.relates.map(function (e)   { return graphRow('~', e.label, e.thread); });

  const allRows = blockedByRows.concat(blocksRows).concat(enablesRows).concat(relatesRows);
  const connectionsHtml = allRows.length
    ? '<div class="graph-legend">' +
        (blockedByRows.length  ? '<span class="graph-legend-item"><span class="graph-row-icon">←</span> blocked by</span>' : '') +
        (blocksRows.length     ? '<span class="graph-legend-item"><span class="graph-row-icon">→</span> blocks</span>' : '') +
        (enablesRows.length    ? '<span class="graph-legend-item"><span class="graph-row-icon">↗</span> enables</span>' : '') +
        (relatesRows.length    ? '<span class="graph-legend-item"><span class="graph-row-icon">~</span> relates</span>'  : '') +
      '</div>' +
      '<div class="graph-list">' + allRows.join('') + '</div>'
    : '<span class="text-muted text-sm">No connections — add one to wire this thread into the graph</span>';

  const deadlineHtml = (function () {
    if (!t.deadline) return '';
    const ds = OAD.deadlineState(t);
    const days = ds.daysRemaining;
    const countdownText = days > 0
      ? (ds.weeksRemaining > 0
          ? ds.weeksRemaining + ' week' + (ds.weeksRemaining !== 1 ? 's' : '')
          : days + ' day' + (days !== 1 ? 's' : '')) + ' remaining'
      : 'Past deadline';
    const sessText = ds.sessionsRemaining != null
      ? ', ' + ds.sessionsRemaining + ' session' + (ds.sessionsRemaining !== 1 ? 's' : '') + ' remaining'
      : '';
    const statusBadge = ds.onTrack
      ? '<span class="on-track-badge">On Track</span>'
      : '<span class="at-risk-badge">⚑ ' + ds.behindBy + ' session' + (ds.behindBy !== 1 ? 's' : '') + ' behind</span>';
    const effortLine = t.effortEstimate != null
      ? '<div class="text-sm text-muted mt-8">' + (t.effortLogged || 0) + ' of ' + t.effortEstimate + ' sessions complete</div>'
      : '';
    const commitLine = t.weeklyCommitment
      ? ' · ' + t.weeklyCommitment + ' session' + (t.weeklyCommitment !== 1 ? 's' : '') + '/week'
      : '';
    return '<div class="card deadline-card">' +
      '<div class="card-title">Deadline Tracking</div>' +
      '<div class="deadline-row">' +
        '<div class="deadline-countdown">' + OAD.esc(countdownText + sessText) + '</div>' +
        statusBadge +
      '</div>' +
      '<div class="deadline-due">Due ' + OAD.esc(OAD.formatDate(t.deadline)) + OAD.esc(commitLine) + '</div>' +
      effortLine +
      '</div>';
  }());

  const evoHtml = (t.evolution_log || []).length
    ? `<div class="evo-log">${[...(t.evolution_log)].reverse().map(e => `
        <div class="evo-entry">
          <span class="evo-date">${OAD.esc(e.date)}</span>
          <span class="evo-note">${OAD.esc(e.note)}</span>
        </div>`).join('')}</div>`
    : '<span class="text-muted text-sm">No history yet</span>';

  const insightHtml = lastInsight
    ? `<div class="insight-text">${OAD.esc(lastInsight.observation)}</div>
       ${lastInsight.blind_spot ? `<div class="mt-8 text-sm text-muted"><strong>Blind spot:</strong> ${OAD.esc(lastInsight.blind_spot)}</div>` : ''}
       ${lastInsight.challenge  ? `<div class="insight-challenge">"${OAD.esc(lastInsight.challenge)}"</div>` : ''}
       ${lastInsight.next_move  ? `<div class="mt-8 text-sm"><strong>Next move:</strong> ${OAD.esc(lastInsight.next_move)}</div>` : ''}
       <div class="text-muted text-sm mt-8">${OAD.esc(lastInsight.date || '')}</div>`
    : '<div class="insight-loading text-muted">No insight yet — click Generate Insight</div>';

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-title">${OAD.esc(t.title)}</div>
        <div class="detail-badges">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span class="pill" style="background:var(--surface2);color:var(--text-muted)">${OAD.esc(t.life_area)}</span>
          <span class="pressure-badge ${pc}" style="font-size:13px;padding:3px 8px">Pressure: ${score}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="success" onclick="OAD.openCompleteActionModal(${t.id})">Complete Action</button>
        <button class="secondary" onclick="OAD.openEditModal(${t.id})">Edit</button>
        <button class="ghost" onclick="OAD.openLogModal(${t.id})">+ Log</button>
        <button onclick="OAD.generateInsight(${t.id})" id="insight-btn-${t.id}">Insight</button>
      </div>
    </div>

    <div class="card next-action-card">
      <div class="card-title">Next Action</div>
      <div class="next-action-text">${OAD.esc(t.next_action) || '<span class="text-muted">Not set</span>'}</div>
      <div class="next-action-meta">
        ${t.next_action_date    ? `<span>By ${OAD.formatDate(t.next_action_date)}</span>` : ''}
        ${t.next_action_channel ? `<span>via ${OAD.esc(t.next_action_channel)}</span>` : ''}
        ${t.next_action_contact ? `<span>with ${OAD.esc(t.next_action_contact)}</span>` : ''}
      </div>
      ${t.next_action_channel && t.next_action_channel.toLowerCase().includes('email')
        ? `<button class="ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="OAD.draftEmailModal(${t.id})">Draft Email</button>`
        : ''}
    </div>

    ${deadlineHtml}

    <div class="card insight-card">
      <div class="insight-header">
        <div class="card-title" style="margin:0">AI Insight</div>
      </div>
      <div id="insight-body-${t.id}">${insightHtml}</div>
    </div>

    <div class="card">
      <div class="card-title">Closing Condition</div>
      <div class="${t.closing_condition_met ? 'closing-met' : 'closing-unmet'}">
        ${t.closing_condition_met ? '✓ Met — ' : '○ '}${OAD.esc(t.closing_condition) || '<span class="text-muted">Not defined</span>'}
      </div>
      <div class="text-muted text-sm mt-8">Type: ${OAD.esc(t.closing_condition_type)}</div>
    </div>

    <div class="card">
      <div class="card-title">Current Assumption</div>
      <div class="${t.assumption_verified ? 'assumption-verified' : 'assumption-unverified'}">
        ${t.assumption_verified ? '✓ Verified — ' : '⚠ Unverified — '}${OAD.esc(t.current_assumption) || '<span class="text-muted">None stated</span>'}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Contingency</div>
      ${t.contingency_trigger_date ? `
        <div class="${contingencyClass}">Trigger: ${OAD.formatDate(t.contingency_trigger_date)}${contingencyDays !== null ? ` (${contingencyDays}d)` : ''}</div>
        <div class="text-sm mt-8">${OAD.esc(t.contingency_action) || '—'}</div>
        ${t.contingency_escalation ? `<div class="text-muted text-sm mt-8">Escalation: ${OAD.esc(t.contingency_escalation)}</div>` : ''}
      ` : '<span class="text-muted text-sm">No contingency set</span>'}
    </div>

    <div class="card graph-card">
      <div class="card-title">Graph</div>
      ${connectionsHtml}
      <button class="ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="OAD.openConnectionModal(${t.id})">+ Add Connection</button>
    </div>

    <div class="card">
      <div class="card-title">Evolution Log</div>
      ${evoHtml}
    </div>

    ${t.status !== 'closed' ? `
    <button class="complete-cta" onclick="OAD.openCompleteActionModal(${t.id})">
      ✓ Complete Action
    </button>` : ''}`;
};

OAD.generateInsight = async function (id) {
  const btn  = document.getElementById(`insight-btn-${id}`);
  const body = document.getElementById(`insight-body-${id}`);
  const t    = OAD.getThread(id);
  if (!t || !body) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
  if (body) body.innerHTML = '<div class="insight-loading">Generating insight…</div>';

  try {
    const insight = await OAD.genInsight(t);
    OAD.addInsight(id, insight);
    OAD.renderDetail(id);
  } catch (err) {
    if (body) body.innerHTML = `<div class="insight-loading" style="color:var(--critical)">${OAD.esc(err.message)}</div>`;
    if (btn)  { btn.disabled = false; btn.textContent = 'Insight'; }
  }
};

OAD.renderOverdueBanner = function () {
  const overdue = OAD.DB.cadences.filter(function (c) { return OAD.cadenceOverdue(c); });
  let banner = document.getElementById('overdue-banner');

  if (!overdue.length) {
    if (banner) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'overdue-banner';
    const detailPanel = document.getElementById('detail-panel');
    if (!detailPanel) return;
    detailPanel.insertBefore(banner, detailPanel.firstChild);
  }

  banner.innerHTML = overdue.map(function (c) {
    return '<div class="overdue-item">' +
      '<span class="overdue-label">OVERDUE</span>' +
      '<strong>' + OAD.esc(c.title) + '</strong>' +
      (c.consequences ? '<span class="overdue-consequence"> — ' + OAD.esc(c.consequences) + '</span>' : '') +
      '<button class="danger" style="margin-left:auto;font-size:12px;padding:5px 12px" onclick="OAD.markCadenceDone(' + c.id + ')">Mark Done</button>' +
      '</div>';
  }).join('');
};

OAD.markCadenceDone = function (id) {
  const c = OAD.getCadence(id);
  if (!c) return;
  c.last_completed = new Date().toISOString().slice(0, 10);
  c.next_due = OAD.nextCadenceDue(c.recurrence, c.last_completed);
  OAD.renderOverdueBanner();
  if (!OAD._activeId) OAD.renderCadencePanel();
};

OAD.renderCadencePanel = function () {
  OAD._activeId = null;
  OAD.renderList();
  OAD.renderOverdueBanner();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const cadences = OAD.DB.cadences;
  const today    = new Date().toISOString().slice(0, 10);

  const items = cadences.length ? cadences.map(function (c) {
    const overdue        = OAD.cadenceOverdue(c);
    const dueToday       = !overdue && c.next_due === today;
    const prevDue        = OAD.prevCadenceDue(c.recurrence);
    const doneThisPeriod = !overdue && !dueToday && c.last_completed && prevDue && c.last_completed >= prevDue;
    const itemClass      = overdue ? 'is-overdue' : dueToday ? 'is-due-today' : doneThisPeriod ? 'is-done' : '';

    const dueDateHtml = '<div class="cadence-due-row">' +
      '<span class="cadence-due-label">Next due:</span>' +
      '<input type="date" class="cadence-due-input" value="' + OAD.esc(c.next_due || '') + '" ' +
        'onchange="OAD._adjustCadenceDue(' + c.id + ', this.value)">' +
    '</div>';

    let statusHtml;
    if (overdue) {
      statusHtml = '<div class="cadence-overdue-badge">OVERDUE</div>' +
        '<button class="success" style="font-size:13px;padding:8px 14px" onclick="OAD.markCadenceDone(' + c.id + ')">Mark Done</button>';
    } else if (doneThisPeriod) {
      statusHtml = '<span class="cadence-done-badge">✓ Done</span>';
    } else {
      const label = dueToday ? 'Due today' : 'Due ' + OAD.esc(OAD.formatDate(c.next_due));
      statusHtml = '<div class="text-sm text-muted" style="margin-bottom:8px">' + label + '</div>' +
        '<button class="secondary" style="font-size:13px" onclick="OAD.markCadenceDone(' + c.id + ')">Mark Done</button>';
    }

    return '<div class="cadence-item ' + itemClass + '">' +
      '<div class="cadence-info">' +
        '<div class="cadence-title">' + OAD.esc(c.title) + '</div>' +
        '<div class="cadence-meta">' + OAD.esc(c.recurrence) + ' · ' + OAD.esc(c.life_area) + '</div>' +
        (c.notes ? '<div class="cadence-notes">' + OAD.esc(c.notes) + '</div>' : '') +
        (c.consequences ? '<div class="cadence-consequences">If missed: ' + OAD.esc(c.consequences) + '</div>' : '') +
        dueDateHtml +
      '</div>' +
      '<div class="cadence-actions">' +
        statusHtml +
        '<div class="cadence-edit-btns">' +
          '<button class="ghost" style="font-size:12px;padding:4px 10px" onclick="OAD.openEditCadenceModal(' + c.id + ')">Edit</button>' +
          '<button class="ghost" style="font-size:12px;padding:4px 10px;color:var(--critical)" onclick="OAD._deleteCadence(' + c.id + ')">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') : '<p class="text-muted text-sm">No cadences yet. Add one below.</p>';

  panel.innerHTML = '<div class="cadence-panel">' +
    '<div class="cadence-panel-header">' +
      '<h2>Cadences</h2>' +
      '<button onclick="OAD.openNewCadenceModal()">+ Add Cadence</button>' +
    '</div>' +
    '<p class="text-muted text-sm cadence-subtitle">Date-anchored obligations that recur on a fixed schedule. Missing one is a failure state.</p>' +
    items +
    '</div>';
};

OAD._adjustCadenceDue = function (id, dateValue) {
  OAD.updateCadence(id, { next_due: dateValue || null });
};

// ── Idea panel ───────────────────────────────────────────────────────

OAD.renderIdeaPanel = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const ideas = OAD.DB.ideas || [];
  if (!ideas.length) {
    panel.innerHTML = '<div class="detail-empty">No ideas yet.</div>';
    return;
  }

  const spotlight = OAD.ideaOfTheWeek();

  function ideaCard(idea, highlighted) {
    const typeBadge  = '<span class="idea-type-badge idea-type-' + OAD.esc(idea.type) + '">' + OAD.esc(idea.type) + '</span>';
    const energyBadge = '<span class="idea-energy idea-energy-' + OAD.esc(idea.energy_required) + '">' + OAD.esc(idea.energy_required) + ' energy</span>';
    const sourceHtml  = idea.source ? '<div class="idea-source">' + OAD.esc(idea.source) + '</div>' : '';
    const notesHtml   = idea.notes  ? '<div class="idea-notes">'  + OAD.esc(idea.notes)  + '</div>' : '';
    const cls = highlighted ? 'idea-card idea-card-spotlight' : 'idea-card';
    return '<div class="' + cls + '">' +
      '<div class="idea-card-header">' +
        '<div class="idea-title">' + OAD.esc(idea.title) + '</div>' +
        '<div class="idea-badges">' + typeBadge + energyBadge + '</div>' +
      '</div>' +
      sourceHtml +
      notesHtml +
      '<div class="idea-actions">' +
        '<button class="idea-promote-btn" onclick="OAD.openPromoteIdeaModal(' + idea.id + ')">→ Promote to Thread</button>' +
        '<button class="ghost" style="font-size:12px;padding:4px 10px" onclick="OAD._deleteIdeaConfirm(' + idea.id + ')">Remove</button>' +
      '</div>' +
    '</div>';
  }

  // Group remaining ideas by type (exclude spotlight from groups to avoid duplication)
  const groups = { creative: [], book: [], other: [] };
  ideas.forEach(function (idea) {
    if (idea.type === 'creative')     groups.creative.push(idea);
    else if (idea.type === 'book')    groups.book.push(idea);
    else                              groups.other.push(idea);
  });

  function groupSection(label, list) {
    if (!list.length) return '';
    return '<div class="idea-group">' +
      '<div class="idea-group-label">' + OAD.esc(label) + ' <span class="idea-group-count">(' + list.length + ')</span></div>' +
      list.map(function (i) { return ideaCard(i, false); }).join('') +
    '</div>';
  }

  const spotlightHtml = spotlight
    ? '<div class="idea-spotlight-section">' +
        '<div class="idea-spotlight-label">✦ Idea of the Week</div>' +
        ideaCard(spotlight, true) +
      '</div>'
    : '';

  panel.innerHTML =
    '<div class="idea-panel">' +
      '<div class="idea-panel-header">' +
        '<h2>Ideas</h2>' +
      '</div>' +
      '<p class="text-muted text-sm idea-subtitle">A holding area for what matters but isn\'t ready. An idea becomes a thread only when you consciously decide to act on it.</p>' +
      spotlightHtml +
      groupSection('Creative', groups.creative) +
      groupSection('Books', groups.book) +
      groupSection('Other', groups.other) +
    '</div>';
};

OAD._deleteIdeaConfirm = function (id) {
  const idea = OAD.getIdea(id);
  if (!idea) return;
  if (!confirm('Remove "' + idea.title + '" from the incubation list?')) return;
  OAD.deleteIdea(id);
  OAD.renderIdeaPanel();
};

// ── Proposals panel ──────────────────────────────────────────────────

OAD.renderProposalsPanel = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const proposals = OAD.DB.proposals || [];
  if (!proposals.length) {
    panel.innerHTML = '<div class="detail-empty">No proactive proposals. The AI will generate them based on your life graph.</div>';
    return;
  }

  function proposalCard(p) {
    return '<div class="idea-card">' +
      '<div class="idea-card-header">' +
        '<div class="idea-title">' + OAD.esc(p.title) + '</div>' +
        '<div class="idea-badges"><span class="pill" style="background:var(--surface2);color:var(--text-muted)">' + OAD.esc(p.life_area) + '</span></div>' +
      '</div>' +
      '<div class="idea-source" style="color:var(--accent)"><strong>Rationale:</strong> ' + OAD.esc(p.rationale) + '</div>' +
      '<div class="idea-notes"><strong>Closing condition:</strong> ' + OAD.esc(p.closing_condition) + '</div>' +
      '<div class="idea-actions">' +
        '<button class="idea-promote-btn" onclick="OAD._acceptProposal(\'' + OAD.esc(p.uuid) + '\')">✓ Accept & Promote</button>' +
        '<button class="ghost" style="font-size:12px;padding:4px 10px;color:var(--critical)" onclick="OAD._rejectProposal(\'' + OAD.esc(p.uuid) + '\')">✗ Reject</button>' +
      '</div>' +
    '</div>';
  }

  panel.innerHTML =
    '<div class="idea-panel">' +
      '<div class="idea-panel-header">' +
        '<h2>Proactive Counsel Proposals</h2>' +
      '</div>' +
      '<p class="text-muted text-sm idea-subtitle">AI-synthesized threads surfaced from your life graph heat and stalled patterns.</p>' +
      proposals.map(proposalCard).join('') +
    '</div>';
};

OAD._acceptProposal = function(uuid) {
  OAD.acceptProposal(uuid);
  OAD.renderProposalsPanel();
};

OAD._rejectProposal = function(uuid) {
  OAD.rejectProposal(uuid);
  OAD.renderProposalsPanel();
};

// ── Habit panel ──────────────────────────────────────────────────────

OAD._habitShowButtons = new Set(); // habits whose "Change" was clicked

OAD.renderHabitPanel = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const habits = OAD.DB.habits || [];
  if (!habits.length) {
    panel.innerHTML = '<div class="detail-empty">No habits configured.</div>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const items = habits.map(function (h) {
    const checkedToday = h.last_checked_in === today;
    const showButtons  = !checkedToday || OAD._habitShowButtons.has(h.id);

    // Days since last check-in (for "not yet started" / missing 3+ days note)
    const daysSince = h.last_checked_in
      ? Math.round((new Date(today) - new Date(h.last_checked_in + 'T00:00:00')) / 86400000)
      : null;
    let missingHtml = '';
    if (!checkedToday) {
      if (daysSince === null) {
        missingHtml = '<div class="habit-missing">Not yet started</div>';
      } else if (daysSince >= 3) {
        missingHtml = '<div class="habit-missing">Last checked in ' + daysSince + ' day' + (daysSince !== 1 ? 's' : '') + ' ago</div>';
      }
    }

    const streakHtml = h.current_streak > 0
      ? '<span class="habit-streak">🔥 ' + h.current_streak + '</span>'
      : '<span class="habit-streak-zero">0</span>';

    let checkInHtml;
    if (showButtons) {
      checkInHtml =
        '<div class="habit-checkin-row">' +
          '<button class="habit-yes" onclick="OAD._checkIn(' + h.id + ', true)">✓ Yes</button>' +
          '<button class="habit-no"  onclick="OAD._checkIn(' + h.id + ', false)">✗ No</button>' +
          '<input class="habit-note-input" id="habit-note-' + h.id + '" type="text" ' +
            'placeholder="One-line reflection…" maxlength="140" ' +
            'value="' + OAD.esc(h.last_check_in_note || '') + '">' +
        '</div>';
    } else if (h.last_check_in_done) {
      checkInHtml =
        '<div class="checkin-done">' +
          '<span class="checkin-yes-label">✓ Done</span>' +
          (h.last_check_in_note ? '<span class="checkin-note">“' + OAD.esc(h.last_check_in_note) + '”</span>' : '') +
          '<button class="ghost" style="font-size:12px;padding:3px 8px;margin-left:auto" onclick="OAD._showHabitButtons(' + h.id + ')">Change</button>' +
        '</div>';
    } else {
      checkInHtml =
        '<div class="checkin-missed">' +
          '<span class="checkin-no-label">— Missed</span>' +
          (h.last_check_in_note ? '<span class="checkin-note">“' + OAD.esc(h.last_check_in_note) + '”</span>' : '') +
          '<button class="ghost" style="font-size:12px;padding:3px 8px;margin-left:auto" onclick="OAD._showHabitButtons(' + h.id + ')">Change</button>' +
        '</div>';
    }

    return '<div class="habit-card" id="habit-card-' + h.id + '">' +
      '<div class="habit-header">' +
        '<div class="habit-title">' + OAD.esc(h.title) + '</div>' +
        streakHtml +
      '</div>' +
      '<div class="habit-meta">' + OAD.esc(h.frequency) + ' · ' + OAD.esc(h.time_of_day) + '</div>' +
      missingHtml +
      checkInHtml +
    '</div>';
  }).join('');

  panel.innerHTML =
    '<div class="habit-panel">' +
      '<div class="habit-panel-header">' +
        '<h2>Habits</h2>' +
        '<span class="habit-date">' + OAD.esc(todayLabel) + '</span>' +
      '</div>' +
      '<p class="text-muted text-sm habit-subtitle">How is this going in your life right now?</p>' +
      items +
    '</div>';
};

OAD._checkIn = function (id, done) {
  const note = document.getElementById('habit-note-' + id)?.value.trim() || '';
  OAD._habitShowButtons.delete(id);
  OAD.checkInHabit(id, done, note);
  OAD.renderHabitPanel();
};

OAD._showHabitButtons = function (id) {
  OAD._habitShowButtons.add(id);
  OAD.renderHabitPanel();
};

OAD.draftEmailModal = async function (id) {
  const t = OAD.getThread(id);
  if (!t) return;

  OAD.openModal(`
    <h2>Drafting Email…</h2>
    <p class="text-muted text-sm">Calling Claude to draft an email for <strong>${OAD.esc(t.title)}</strong></p>
    <div id="email-draft-body" style="margin-top:16px;color:var(--text-muted);font-size:14px">Generating…</div>
    <div class="modal-footer">
      <button class="secondary" onclick="OAD.closeModal()">Close</button>
    </div>`);

  try {
    const draft = await OAD.draftEmail(id);
    const el = document.getElementById('email-draft-body');
    if (el) el.innerHTML = `<pre style="white-space:pre-wrap;font-size:13px;font-family:var(--mono);background:var(--surface2);padding:12px;border-radius:8px;line-height:1.6">${OAD.esc(draft)}</pre>`;
  } catch (err) {
    const el = document.getElementById('email-draft-body');
    if (el) el.innerHTML = `<span style="color:var(--critical)">${OAD.esc(err.message)}</span>`;
  }
};

// ── Daily Summary View ───────────────────────────────────────────────


OAD.renderTodayView = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed'; })
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });

  const activeByUUID = {};
  active.forEach(function (t) { activeByUUID[t.uuid] = t; });

  const childrenByParentUUID = {};
  active.forEach(function (t) {
    if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
      if (!childrenByParentUUID[t.parent_uuid]) childrenByParentUUID[t.parent_uuid] = [];
      childrenByParentUUID[t.parent_uuid].push(t);
    }
  });
  const suppressedUUIDs = new Set();
  Object.keys(childrenByParentUUID).forEach(function (puuid) {
    childrenByParentUUID[puuid].forEach(function (c) { suppressedUUIDs.add(c.uuid); });
  });

  const filteredActive  = active.filter(function (t) { return !suppressedUUIDs.has(t.uuid); });

  const q1Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q1');
  const q2Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q2');
  const q3Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q3');
  const q4Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q4');

  // ── Cadences ───────────────────────────────────────────────────────
  const cads = OAD.DB.cadences || [];
  const in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
  const in7Str = in7Dt.toISOString().slice(0, 10);
  
  const overdueCadences = cads.filter(function (c) { return OAD.cadenceOverdue(c); });
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr; });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str; });

  // ── Habits ─────────────────────────────────────────────────────────
  const activeHabits = (OAD.DB.habits || []).filter(function (h) { return h.phase !== 'dormant'; });
  function daysSince(h) {
    if (!h.last_checked_in) return 999;
    return Math.round((todayDt - new Date(h.last_checked_in + 'T00:00:00')) / 86400000);
  }
  const overdueHabits = activeHabits.filter(function (h) { return daysSince(h) >= 3; });
  const dailyFreqs    = ['daily', 'every workday', 'every-other-day'];
  const todayHabits   = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.last_checked_in === todayStr) return false;
    return dailyFreqs.indexOf(h.frequency) !== -1;
  });
  const weekHabits = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.frequency !== 'weekly') return false;
    return daysSince(h) >= 6;
  });

  function threadRow(t, context) {
    const pc = OAD.pressureClass(t._score);
    var badge = '';
    const isOverdue = t.next_action_date && t.next_action_date < todayStr;
    const isToday = t.next_action_date === todayStr;
    
    if (isOverdue) badge = '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>';
    else if (isToday) badge = '<span class="ds-status-badge ds-badge-today" aria-label="Due today">TODAY</span>';
    
    const daysOver = isOverdue
      ? Math.round((todayDt - new Date(t.next_action_date + 'T00:00:00')) / 86400000)
      : null;
    const metaHtml = daysOver !== null
      ? '<span class="ds-meta-tag">' + daysOver + 'd ago</span>'
      : (t.next_action_date > todayStr
          ? '<span class="ds-meta-tag">' + OAD.esc(OAD.formatDate(t.next_action_date)) + '</span>'
          : '');

    const children = childrenByParentUUID[t.uuid] || [];
    var childSummaryHtml = '';
    if (children.length) {
      const topChild = children.reduce(function (best, c) { return c._score > best._score ? c : best; }, children[0]);
      const overdueCount = children.filter(function (c) { return c.next_action_date && c.next_action_date < todayStr; }).length;
      const overdueTag = overdueCount ? '<span class="ds-child-overdue">' + overdueCount + ' overdue</span>' : '';
      childSummaryHtml =
        '<div class="ds-children-summary">' +
          '<span class="ds-child-count">' + children.length + ' subtask' + (children.length !== 1 ? 's' : '') + '</span>' +
          overdueTag +
          (topChild.next_action ? '<span class="ds-child-next">Next: ' + OAD.esc(topChild.next_action) + '</span>' : '') +
        '</div>';
    }

    const rowClass = 'ds-row ds-thread ds-row-' + context + (children.length ? ' ds-row-parent' : '');
    return '<div class="' + rowClass + '" role="button" aria-label="' + OAD.esc(t.title) + '" onclick="OAD.selectThread(' + t.id + ')">' +
      '<div class="ds-row-main">' +
        '<span class="pressure-badge ' + pc + '" aria-label="Pressure ' + t._score + '">' + t._score + '</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(t.title) + badge + '</div>' +
          (t.next_action ? '<div class="ds-row-sub">' + OAD.esc(t.next_action) + '</div>' : '<div class="ds-row-sub ds-no-action">No next action set</div>') +
          childSummaryHtml +
        '</div>' +
        metaHtml +
      '</div>' +
    '</div>';
  }

  function cadenceRow(c) {
    const isOverdue = OAD.cadenceOverdue(c);
    const badge = isOverdue ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>' : '';
    const rowClass = 'ds-row ds-cadence ds-row-' + (isOverdue ? 'overdue' : 'today');
    return '<div class="' + rowClass + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-cadence" aria-label="Cadence">📅 cadence</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(c.title) + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(c.recurrence) +
            (isOverdue && c.consequences ? ' — ' + OAD.esc(c.consequences) : '') + '</div>' +
        '</div>' +
        '<button class="success" style="font-size:12px;padding:5px 12px;flex-shrink:0" ' +
          'aria-label="Mark ' + OAD.esc(c.title) + ' done" ' +
          'onclick="event.stopPropagation();OAD._dailyMarkCadenceDone(' + c.id + ')">Mark Done</button>' +
      '</div>' +
    '</div>';
  }

  function habitRow(h) {
    const ds = daysSince(h);
    const subText = ds >= 3
      ? (ds >= 999 ? 'Never checked in' : 'Last checked in ' + ds + ' days ago')
      : h.frequency;
    const badge = ds >= 3 ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>' : '';
    const streakHtml = h.current_streak > 0 ? '<span class="ds-streak" aria-label="Streak ' + h.current_streak + ' days"> 🔥 ' + h.current_streak + '</span>' : '';
    const rowClass = 'ds-row ds-habit ds-row-' + (ds >= 3 ? 'overdue' : 'today');
    return '<div class="' + rowClass + '" id="ds-habit-' + h.id + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-habit" aria-label="Habit">✦ habit</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(h.title) + streakHtml + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(subText) + '</div>' +
        '</div>' +
        '<div class="ds-habit-btns">' +
          '<input class="ds-note-input" id="ds-note-' + h.id + '" type="text" ' +
            'aria-label="Reflection note for ' + OAD.esc(h.title) + '" ' +
            'placeholder="Note…" maxlength="120" onclick="event.stopPropagation()">' +
          '<button class="habit-yes" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="Yes, completed ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', true)">✓ Yes</button>' +
          '<button class="habit-no" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="No, did not complete ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', false)">✗ No</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bucket(id, icon, label, items) {
    if (!items.length) return '';
    return '<section class="ds-bucket ds-bucket-' + id + '" aria-label="' + label + '">' +
      '<h3 class="ds-bucket-header">' +
        '<span class="ds-bucket-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="ds-bucket-label">' + label + '</span>' +
        '<span class="ds-bucket-count" aria-label="' + items.length + ' items">' + items.length + '</span>' +
      '</h3>' +
      items.join('') +
    '</section>';
  }

  const q1Items = q1Threads.map(t => threadRow(t, 'q1'));
  const q2Items = q2Threads.map(t => threadRow(t, 'q2'));
  const q3Items = q3Threads.map(t => threadRow(t, 'q3'));
  const q4Items = q4Threads.map(t => threadRow(t, 'q4'));

  const habitItems = overdueHabits.concat(todayHabits).concat(weekHabits).map(habitRow);
  const cadenceItems = overdueCadences.concat(todayCadences).concat(weekCadences).map(cadenceRow);
  
  const bottomBucketsHtml = bucket('q1', '🔥', 'Do First (Q1)', q1Items) +
                            bucket('q2', '📅', 'Schedule (Q2)', q2Items) +
                            bucket('q3', '🗣️', 'Delegate (Q3)', q3Items) +
                            bucket('q4', '🗑️', 'Eliminate (Q4)', q4Items) +
                            bucket('habits', '✦', 'Active Habits', habitItems) +
                            bucket('cadences', '📅', 'Upcoming Cadences', cadenceItems);

  const focusThread = OAD.selectFocusThread();
  var focusCardHtml = '';
  if (focusThread) {
    const fpc   = OAD.pressureClass(focusThread._score);
    const freason = OAD.focusReason(focusThread);
    const fctx  = OAD.getGraphContext(focusThread.id);
    const blockedByHtml = fctx.blockedBy.length
      ? '<div class="focus-blocked-by">Blocked by: ' +
          fctx.blockedBy.map(function (b) { return OAD.esc(b.title); }).join(', ') +
        '</div>'
      : '';
    focusCardHtml =
      '<div class="focus-card" role="button" onclick="OAD.selectThread(' + focusThread.id + ')" ' +
          'aria-label="Focus: ' + OAD.esc(focusThread.title) + '">' +
        '<div class="focus-card-header">' +
          '<span class="focus-label">FOCUS NOW</span>' +
          '<span class="pressure-badge ' + fpc + ' focus-pressure">' + focusThread._score + '</span>' +
        '</div>' +
        '<div class="focus-title">' + OAD.esc(focusThread.title) + '</div>' +
        '<div class="focus-meta">' + OAD.esc(focusThread.life_area) + ' · ' + OAD.esc(focusThread.priority) + '</div>' +
        '<div class="focus-reason">' + OAD.esc(freason) + '</div>' +
        (focusThread.next_action
          ? '<div class="focus-next"><span class="focus-next-label">Next:</span> ' + OAD.esc(focusThread.next_action) + '</div>'
          : '') +
        blockedByHtml +
      '</div>';
  }

  panel.innerHTML =
    '<div class="ds-panel" role="main" style="max-width: 900px;">' +
      '<header class="ds-header">' +
        '<h2>Today</h2>' +
        '<p class="ds-date">' + OAD.esc(dateLabel) + '</p>' +
      '</header>' +
      focusCardHtml +
      bottomBucketsHtml +
    '</div>';
};

OAD.renderDailyView = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
  const in7Str = in7Dt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed'; })
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });

  // ── Parent/child grouping ──────────────────────────────────────────
  // Children with an active parent are suppressed from appearing as independent
  // rows. The parent card surfaces child count and highest-pressure child's next action.
  // Effective date for a parent = earliest of its own date and any child dates,
  // so an overdue child pulls its parent into the overdue bucket.
  const activeByUUID = {};
  active.forEach(function (t) { activeByUUID[t.uuid] = t; });

  const childrenByParentUUID = {};
  active.forEach(function (t) {
    if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
      if (!childrenByParentUUID[t.parent_uuid]) childrenByParentUUID[t.parent_uuid] = [];
      childrenByParentUUID[t.parent_uuid].push(t);
    }
  });
  const suppressedUUIDs = new Set();
  Object.keys(childrenByParentUUID).forEach(function (puuid) {
    childrenByParentUUID[puuid].forEach(function (c) { suppressedUUIDs.add(c.uuid); });
  });

  function effectiveDate(t) {
    var d = t.next_action_date || '';
    (childrenByParentUUID[t.uuid] || []).forEach(function (c) {
      if (c.next_action_date && (!d || c.next_action_date < d)) d = c.next_action_date;
    });
    return d;
  }

  const filteredActive  = active.filter(function (t) { return !suppressedUUIDs.has(t.uuid); });
  const overdueThreads  = filteredActive.filter(function (t) { var ed = effectiveDate(t); return ed && ed < todayStr; });
  const todayThreads    = filteredActive.filter(function (t) { var ed = effectiveDate(t); return ed === todayStr; });
  const weekThreads     = filteredActive.filter(function (t) { var ed = effectiveDate(t); return ed > todayStr && ed <= in7Str; });
  const scheduledSet    = new Set(overdueThreads.concat(todayThreads).concat(weekThreads).map(function (t) { return t.id; }));
  const undatedThreads  = filteredActive.filter(function (t) { return !scheduledSet.has(t.id); });

  // ── Cadences ───────────────────────────────────────────────────────
  const cads = OAD.DB.cadences || [];
  const overdueCadences = cads.filter(function (c) { return OAD.cadenceOverdue(c); });
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr; });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str; });

  // ── Habits ─────────────────────────────────────────────────────────
  const activeHabits = (OAD.DB.habits || []).filter(function (h) { return h.phase !== 'dormant'; });

  function daysSince(h) {
    if (!h.last_checked_in) return 999;
    return Math.round((todayDt - new Date(h.last_checked_in + 'T00:00:00')) / 86400000);
  }

  const overdueHabits = activeHabits.filter(function (h) { return daysSince(h) >= 3; });
  const dailyFreqs    = ['daily', 'every workday', 'every-other-day'];
  const todayHabits   = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.last_checked_in === todayStr) return false;
    return dailyFreqs.indexOf(h.frequency) !== -1;
  });
  const weekHabits = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.frequency !== 'weekly') return false;
    return daysSince(h) >= 6;
  });

  // ── Row renderers — ADA: icon + text label + border style, not color alone ──

  function threadRow(t, context) {
    const pc = OAD.pressureClass(t._score);
    // ADA badge: text tag surfacing urgency state independently of color
    var badge = '';
    if (context === 'overdue') badge = '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>';
    if (context === 'today')   badge = '<span class="ds-status-badge ds-badge-today"   aria-label="Due today">TODAY</span>';
    const daysOver = (context === 'overdue' && t.next_action_date)
      ? Math.round((todayDt - new Date(t.next_action_date + 'T00:00:00')) / 86400000)
      : null;
    const metaHtml = daysOver !== null
      ? '<span class="ds-meta-tag">' + daysOver + 'd ago</span>'
      : (t.next_action_date > todayStr
          ? '<span class="ds-meta-tag">' + OAD.esc(OAD.formatDate(t.next_action_date)) + '</span>'
          : '');

    // If this thread has active children, show a summary row beneath the title
    const children = childrenByParentUUID[t.uuid] || [];
    var childSummaryHtml = '';
    if (children.length) {
      const topChild = children.reduce(function (best, c) { return c._score > best._score ? c : best; }, children[0]);
      const overdueCount = children.filter(function (c) { return c.next_action_date && c.next_action_date < todayStr; }).length;
      const overdueTag = overdueCount ? '<span class="ds-child-overdue">' + overdueCount + ' overdue</span>' : '';
      childSummaryHtml =
        '<div class="ds-children-summary">' +
          '<span class="ds-child-count">' + children.length + ' subtask' + (children.length !== 1 ? 's' : '') + '</span>' +
          overdueTag +
          (topChild.next_action ? '<span class="ds-child-next">Next: ' + OAD.esc(topChild.next_action) + '</span>' : '') +
        '</div>';
    }

    const rowClass = 'ds-row ds-thread ds-row-' + (context || 'active') + (children.length ? ' ds-row-parent' : '');
    return '<div class="' + rowClass + '" role="button" aria-label="' + OAD.esc(t.title) + '" onclick="OAD.selectThread(' + t.id + ')">' +
      '<div class="ds-row-main">' +
        '<span class="pressure-badge ' + pc + '" aria-label="Pressure ' + t._score + '">' + t._score + '</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(t.title) + badge + '</div>' +
          (t.next_action ? '<div class="ds-row-sub">' + OAD.esc(t.next_action) + '</div>' : '<div class="ds-row-sub ds-no-action">No next action set</div>') +
          childSummaryHtml +
        '</div>' +
        metaHtml +
      '</div>' +
    '</div>';
  }

  function cadenceRow(c) {
    const isOverdue = OAD.cadenceOverdue(c);
    const badge = isOverdue ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>' : '';
    const rowClass = 'ds-row ds-cadence ds-row-' + (isOverdue ? 'overdue' : 'today');
    return '<div class="' + rowClass + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-cadence" aria-label="Cadence">📅 cadence</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(c.title) + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(c.recurrence) +
            (isOverdue && c.consequences ? ' — ' + OAD.esc(c.consequences) : '') + '</div>' +
        '</div>' +
        '<button class="success" style="font-size:12px;padding:5px 12px;flex-shrink:0" ' +
          'aria-label="Mark ' + OAD.esc(c.title) + ' done" ' +
          'onclick="event.stopPropagation();OAD._dailyMarkCadenceDone(' + c.id + ')">Mark Done</button>' +
      '</div>' +
    '</div>';
  }

  function habitRow(h) {
    const ds = daysSince(h);
    const subText = ds >= 3
      ? (ds >= 999 ? 'Never checked in' : 'Last checked in ' + ds + ' days ago')
      : h.frequency;
    const badge = ds >= 3 ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>' : '';
    const streakHtml = h.current_streak > 0 ? '<span class="ds-streak" aria-label="Streak ' + h.current_streak + ' days"> 🔥 ' + h.current_streak + '</span>' : '';
    const rowClass = 'ds-row ds-habit ds-row-' + (ds >= 3 ? 'overdue' : 'today');
    return '<div class="' + rowClass + '" id="ds-habit-' + h.id + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-habit" aria-label="Habit">✦ habit</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(h.title) + streakHtml + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(subText) + '</div>' +
        '</div>' +
        '<div class="ds-habit-btns">' +
          '<input class="ds-note-input" id="ds-note-' + h.id + '" type="text" ' +
            'aria-label="Reflection note for ' + OAD.esc(h.title) + '" ' +
            'placeholder="Note…" maxlength="120" onclick="event.stopPropagation()">' +
          '<button class="habit-yes" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="Yes, completed ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', true)">✓ Yes</button>' +
          '<button class="habit-no" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="No, did not complete ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', false)">✗ No</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // icon + text label in bucket header — not color alone
  function bucket(id, icon, label, items) {
    if (!items.length) return '';
    return '<section class="ds-bucket ds-bucket-' + id + '" aria-label="' + label + '">' +
      '<h3 class="ds-bucket-header">' +
        '<span class="ds-bucket-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="ds-bucket-label">' + label + '</span>' +
        '<span class="ds-bucket-count" aria-label="' + items.length + ' items">' + items.length + '</span>' +
      '</h3>' +
      items.join('') +
    '</section>';
  }

  const overdueItems = overdueThreads.map(function (t) { return threadRow(t, 'overdue'); })
    .concat(overdueCadences.map(cadenceRow))
    .concat(overdueHabits.map(habitRow));

  const todayItems = todayThreads.map(function (t) { return threadRow(t, 'today'); })
    .concat(todayCadences.map(cadenceRow))
    .concat(todayHabits.map(habitRow));

  const weekItems = weekThreads.map(function (t) { return threadRow(t, 'week'); })
    .concat(weekCadences.map(cadenceRow))
    .concat(weekHabits.map(habitRow));

  const activeItems = undatedThreads.map(function (t) { return threadRow(t, 'active'); });

  // ── Focus Now card ─────────────────────────────────────────────────
  const focusThread = OAD.selectFocusThread();
  var focusCardHtml = '';
  if (focusThread) {
    const fpc   = OAD.pressureClass(focusThread._score);
    const freason = OAD.focusReason(focusThread);
    const fctx  = OAD.getGraphContext(focusThread.id);
    const blockedByHtml = fctx.blockedBy.length
      ? '<div class="focus-blocked-by">Blocked by: ' +
          fctx.blockedBy.map(function (b) { return OAD.esc(b.title); }).join(', ') +
        '</div>'
      : '';
    focusCardHtml =
      '<div class="focus-card" role="button" onclick="OAD.selectThread(' + focusThread.id + ')" ' +
          'aria-label="Focus: ' + OAD.esc(focusThread.title) + '">' +
        '<div class="focus-card-header">' +
          '<span class="focus-label">FOCUS NOW</span>' +
          '<span class="pressure-badge ' + fpc + ' focus-pressure">' + focusThread._score + '</span>' +
        '</div>' +
        '<div class="focus-title">' + OAD.esc(focusThread.title) + '</div>' +
        '<div class="focus-meta">' + OAD.esc(focusThread.life_area) + ' · ' + OAD.esc(focusThread.priority) + '</div>' +
        '<div class="focus-reason">' + OAD.esc(freason) + '</div>' +
        (focusThread.next_action
          ? '<div class="focus-next"><span class="focus-next-label">Next:</span> ' + OAD.esc(focusThread.next_action) + '</div>'
          : '') +
        blockedByHtml +
      '</div>';
  }

  // ── Life-area heat map ──────────────────────────────────────────────
  const areaHeat = OAD.getLifeAreaHeat();
  var heatMapHtml = '';
  if (areaHeat.length) {
    heatMapHtml = '<div class="area-heat-map" role="list" aria-label="Life area heat">' +
      areaHeat.map(function (a) {
        const heat = a.avgPressure >= 60 ? 'hot' : a.avgPressure >= 30 ? 'warm' : 'cool';
        const stalledTag = a.stalled ? '<span class="area-stalled">' + a.stalled + ' stalled</span>' : '';
        return '<div class="area-chip area-chip-' + heat + '" role="listitem" ' +
          'aria-label="' + OAD.esc(a.name) + ' ' + a.count + ' threads avg pressure ' + a.avgPressure + '">' +
          '<span class="area-chip-name">' + OAD.esc(a.name) + '</span>' +
          '<span class="area-chip-score">' + a.avgPressure + '</span>' +
          stalledTag +
        '</div>';
      }).join('') +
    '</div>';
  }

  // ── This Week's Load ───────────────────────────────────────────────
  // One line per day for the next 7 days: date + item count + text label.
  // Text label (Clear / Busy / Heavy) is the primary signal — color is secondary.
  const weekLoadHtml = (function () {
    var rows = '';
    for (var di = 0; di < 7; di++) {
      var dayDt = new Date(todayDt);
      dayDt.setDate(dayDt.getDate() + di);
      var dayStr = dayDt.toISOString().slice(0, 10);
      var threadCount  = active.filter(function (t) { return t.next_action_date === dayStr; }).length;
      var cadenceCount = cads.filter(function (c)  { return c.next_due === dayStr; }).length;
      var total = threadCount + cadenceCount;
      var label    = total >= 3 ? 'Heavy' : total === 2 ? 'Busy' : 'Clear';
      var labelCls = total >= 3 ? 'load-row-heavy' : total === 2 ? 'load-row-busy' : 'load-row-clear';
      var dayLabel = di === 0 ? 'Today' : dayDt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      rows +=
        '<div class="load-row ' + labelCls + '" aria-label="' +
            OAD.esc(dayLabel) + ': ' + total + ' item' + (total !== 1 ? 's' : '') + ', ' + label + '">' +
          '<span class="load-day">'   + OAD.esc(dayLabel) + '</span>' +
          '<span class="load-count">' + total + (total === 1 ? ' item' : ' items') + '</span>' +
          '<span class="load-label">' + OAD.esc(label) + '</span>' +
        '</div>';
    }
    return '<section class="ds-week-load" aria-label="This week\'s load">' +
      '<h3 class="ds-bucket-header">' +
        '<span class="ds-bucket-icon" aria-hidden="true">▤</span>' +
        '<span class="ds-bucket-label">This Week\'s Load</span>' +
      '</h3>' +
      rows +
    '</section>';
  }());

  panel.innerHTML =
    '<div class="ds-panel" role="main">' +
      '<header class="ds-header">' +
        '<h2>Daily Summary</h2>' +
        '<p class="ds-date">' + OAD.esc(dateLabel) + '</p>' +
      '</header>' +
      focusCardHtml +
      heatMapHtml +
      bucket('overdue', '⚠', 'Overdue', overdueItems) +
      bucket('today',   '▶', 'Today',   todayItems)   +
      bucket('week',    '○', 'This Week', weekItems)   +
      bucket('active',  '◇', 'Active — no date set', activeItems) +
      weekLoadHtml +
      (!overdueItems.length && !todayItems.length && !weekItems.length && !activeItems.length
        ? '<div class="ds-all-clear" role="status">✓ All clear — nothing overdue, nothing due today or this week.</div>'
        : '') +
    '</div>';
};


OAD.renderMatrixView = function () {
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.DB.threads || [])
    .filter(function (t) { return t.status !== 'closed'; })
    .map(function (t) { return Object.assign({}, t, { _score: OAD.pressure(t) }); })
    .sort(function (a, b) { return b._score - a._score; });

  const activeByUUID = {};
  active.forEach(function (t) { activeByUUID[t.uuid] = t; });

  const childrenByParentUUID = {};
  active.forEach(function (t) {
    if (t.parent_uuid && activeByUUID[t.parent_uuid]) {
      if (!childrenByParentUUID[t.parent_uuid]) childrenByParentUUID[t.parent_uuid] = [];
      childrenByParentUUID[t.parent_uuid].push(t);
    }
  });
  const suppressedUUIDs = new Set();
  Object.keys(childrenByParentUUID).forEach(function (puuid) {
    childrenByParentUUID[puuid].forEach(function (c) { suppressedUUIDs.add(c.uuid); });
  });

  const filteredActive  = active.filter(function (t) { return !suppressedUUIDs.has(t.uuid); });

  // Eisenhower Matrix Categorization
  const q1Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q1');
  const q2Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q2');
  const q3Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q3');
  const q4Threads = filteredActive.filter(t => OAD.getEisenhowerQuadrant(t) === 'Q4');

  // ── Cadences ───────────────────────────────────────────────────────
  const cads = OAD.DB.cadences || [];
  const in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
  const in7Str = in7Dt.toISOString().slice(0, 10);
  
  const overdueCadences = cads.filter(function (c) { return OAD.cadenceOverdue(c); });
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr; });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str; });

  // ── Habits ─────────────────────────────────────────────────────────
  const activeHabits = (OAD.DB.habits || []).filter(function (h) { return h.phase !== 'dormant'; });
  function daysSince(h) {
    if (!h.last_checked_in) return 999;
    return Math.round((todayDt - new Date(h.last_checked_in + 'T00:00:00')) / 86400000);
  }
  const overdueHabits = activeHabits.filter(function (h) { return daysSince(h) >= 3; });
  const dailyFreqs    = ['daily', 'every workday', 'every-other-day'];
  const todayHabits   = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.last_checked_in === todayStr) return false;
    return dailyFreqs.indexOf(h.frequency) !== -1;
  });
  const weekHabits = activeHabits.filter(function (h) {
    if (overdueHabits.indexOf(h) !== -1) return false;
    if (h.frequency !== 'weekly') return false;
    return daysSince(h) >= 6;
  });

  // ── Row renderers ──

  function threadRow(t, context) {
    const pc = OAD.pressureClass(t._score);
    var badge = '';
    const isOverdue = t.next_action_date && t.next_action_date < todayStr;
    const isToday = t.next_action_date === todayStr;
    
    if (isOverdue) badge = '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">⚠ OVERDUE</span>';
    else if (isToday) badge = '<span class="ds-status-badge ds-badge-today" aria-label="Due today">▶ TODAY</span>';
    
    const daysOver = isOverdue
      ? Math.round((todayDt - new Date(t.next_action_date + 'T00:00:00')) / 86400000)
      : null;
    const metaHtml = daysOver !== null
      ? '<span class="ds-meta-tag">' + daysOver + 'd ago</span>'
      : (t.next_action_date > todayStr
          ? '<span class="ds-meta-tag">' + OAD.esc(OAD.formatDate(t.next_action_date)) + '</span>'
          : '');

    const children = childrenByParentUUID[t.uuid] || [];
    var childSummaryHtml = '';
    if (children.length) {
      const topChild = children.reduce(function (best, c) { return c._score > best._score ? c : best; }, children[0]);
      const overdueCount = children.filter(function (c) { return c.next_action_date && c.next_action_date < todayStr; }).length;
      const overdueTag = overdueCount ? '<span class="ds-child-overdue">' + overdueCount + ' overdue</span>' : '';
      childSummaryHtml =
        '<div class="ds-children-summary">' +
          '<span class="ds-child-count">' + children.length + ' subtask' + (children.length !== 1 ? 's' : '') + '</span>' +
          overdueTag +
          (topChild.next_action ? '<span class="ds-child-next">Next: ' + OAD.esc(topChild.next_action) + '</span>' : '') +
        '</div>';
    }

    const rowClass = 'ds-row ds-thread ds-row-' + context + (children.length ? ' ds-row-parent' : '');
    return '<div class="' + rowClass + '" role="button" aria-label="' + OAD.esc(t.title) + '" onclick="OAD.selectThread(' + t.id + ')">' +
      '<div class="ds-row-main">' +
        '<span class="pressure-badge ' + pc + '" aria-label="Pressure ' + t._score + '">' + t._score + '</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(t.title) + badge + '</div>' +
          (t.next_action ? '<div class="ds-row-sub">' + OAD.esc(t.next_action) + '</div>' : '<div class="ds-row-sub ds-no-action">No next action set</div>') +
          childSummaryHtml +
        '</div>' +
        metaHtml +
      '</div>' +
    '</div>';
  }

  function cadenceRow(c) {
    const isOverdue = OAD.cadenceOverdue(c);
    const badge = isOverdue ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">⚠ OVERDUE</span>' : '';
    const rowClass = 'ds-row ds-cadence ds-row-' + (isOverdue ? 'q1' : 'q2');
    return '<div class="' + rowClass + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-cadence" aria-label="Cadence">📅 cadence</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(c.title) + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(c.recurrence) +
            (isOverdue && c.consequences ? ' — ' + OAD.esc(c.consequences) : '') + '</div>' +
        '</div>' +
        '<button class="success" style="font-size:12px;padding:5px 12px;flex-shrink:0" ' +
          'aria-label="Mark ' + OAD.esc(c.title) + ' done" ' +
          'onclick="event.stopPropagation();OAD._dailyMarkCadenceDone(' + c.id + ')">Mark Done</button>' +
      '</div>' +
    '</div>';
  }

  function habitRow(h) {
    const ds = daysSince(h);
    const subText = ds >= 3
      ? (ds >= 999 ? 'Never checked in' : 'Last checked in ' + ds + ' days ago')
      : h.frequency;
    const badge = ds >= 3 ? '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">⚠ OVERDUE</span>' : '';
    const streakHtml = h.current_streak > 0 ? '<span class="ds-streak" aria-label="Streak ' + h.current_streak + ' days"> 🔥 ' + h.current_streak + '</span>' : '';
    const rowClass = 'ds-row ds-habit ds-row-' + (ds >= 3 ? 'q1' : 'q2');
    return '<div class="' + rowClass + '" id="ds-habit-' + h.id + '">' +
      '<div class="ds-row-main">' +
        '<span class="ds-type-tag ds-type-habit" aria-label="Habit">✦ habit</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(h.title) + streakHtml + badge + '</div>' +
          '<div class="ds-row-sub">' + OAD.esc(subText) + '</div>' +
        '</div>' +
        '<div class="ds-habit-btns">' +
          '<input class="ds-note-input" id="ds-note-' + h.id + '" type="text" ' +
            'aria-label="Reflection note for ' + OAD.esc(h.title) + '" ' +
            'placeholder="Note…" maxlength="120" onclick="event.stopPropagation()">' +
          '<button class="habit-yes" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="Yes, completed ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', true)">✓ Yes</button>' +
          '<button class="habit-no" style="font-size:12px;padding:4px 12px" ' +
            'aria-label="No, did not complete ' + OAD.esc(h.title) + '" ' +
            'onclick="event.stopPropagation();OAD._dailyCheckIn(' + h.id + ', false)">✗ No</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bucket(id, icon, label, items) {
    if (!items.length) return '';
    return '<section class="ds-bucket ds-bucket-' + id + '" aria-label="' + label + '">' +
      '<h3 class="ds-bucket-header">' +
        '<span class="ds-bucket-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="ds-bucket-label">' + label + '</span>' +
        '<span class="ds-bucket-count" aria-label="' + items.length + ' items">' + items.length + '</span>' +
      '</h3>' +
      items.join('') +
    '</section>';
  }

  const q1Items = q1Threads.map(t => threadRow(t, 'q1'));
  const q2Items = q2Threads.map(t => threadRow(t, 'q2'));
  const q3Items = q3Threads.map(t => threadRow(t, 'q3'));
  const q4Items = q4Threads.map(t => threadRow(t, 'q4'));

  function quadrantHtml(id, label, items, desc) {
    return '<div class="matrix-quadrant matrix-' + id + '">' +
      '<div class="matrix-q-header">' +
        '<div class="matrix-q-title">' + label + ' <span class="matrix-q-count">' + items.length + '</span></div>' +
        '<div class="matrix-q-desc">' + desc + '</div>' +
      '</div>' +
      '<div class="matrix-q-body">' + (items.length ? items.join('') : '<div class="text-muted text-sm" style="padding: 10px;">None</div>') + '</div>' +
    '</div>';
  }

  const matrixHtml = '<div class="eisenhower-matrix">' +
    quadrantHtml('q1', 'Do First', q1Items, 'Urgent & Important') +
    quadrantHtml('q2', 'Schedule', q2Items, 'Important, Not Urgent') +
    quadrantHtml('q3', 'Delegate / Assess', q3Items, 'Urgent, Not Important') +
    quadrantHtml('q4', 'Eliminate / Ignore', q4Items, 'Not Urgent, Not Important') +
  '</div>';

  const habitItems = overdueHabits.concat(todayHabits).concat(weekHabits).map(habitRow);
  const cadenceItems = overdueCadences.concat(todayCadences).concat(weekCadences).map(cadenceRow);
  
  const bottomBucketsHtml = bucket('habits', '✦', 'Active Habits', habitItems) +
                            bucket('cadences', '📅', 'Upcoming Cadences', cadenceItems);

  // ── Focus Now card ─────────────────────────────────────────────────
  const focusThread = OAD.selectFocusThread();
  var focusCardHtml = '';
  if (focusThread) {
    const fpc   = OAD.pressureClass(focusThread._score);
    const freason = OAD.focusReason(focusThread);
    const fctx  = OAD.getGraphContext(focusThread.id);
    const blockedByHtml = fctx.blockedBy.length
      ? '<div class="focus-blocked-by">Blocked by: ' +
          fctx.blockedBy.map(function (b) { return OAD.esc(b.title); }).join(', ') +
        '</div>'
      : '';
    focusCardHtml =
      '<div class="focus-card" role="button" onclick="OAD.selectThread(' + focusThread.id + ')" ' +
          'aria-label="Focus: ' + OAD.esc(focusThread.title) + '">' +
        '<div class="focus-card-header">' +
          '<span class="focus-label">FOCUS NOW</span>' +
          '<span class="pressure-badge ' + fpc + ' focus-pressure">' + focusThread._score + '</span>' +
        '</div>' +
        '<div class="focus-title">' + OAD.esc(focusThread.title) + '</div>' +
        '<div class="focus-meta">' + OAD.esc(focusThread.life_area) + ' · ' + OAD.esc(focusThread.priority) + '</div>' +
        '<div class="focus-reason">' + OAD.esc(freason) + '</div>' +
        (focusThread.next_action
          ? '<div class="focus-next"><span class="focus-next-label">Next:</span> ' + OAD.esc(focusThread.next_action) + '</div>'
          : '') +
        blockedByHtml +
      '</div>';
  }

  panel.innerHTML =
    '<div class="ds-panel" role="main" style="max-width: 1000px;">' +
      '<header class="ds-header">' +
        '<h2>Eisenhower Matrix</h2>' +
        '<p class="ds-date">' + OAD.esc(dateLabel) + '</p>' +
      '</header>' +
      focusCardHtml +
      matrixHtml +
      '<div style="margin-top: 32px;">' +
        bottomBucketsHtml +
      '</div>' +
    '</div>';
};

OAD._dailyMarkCadenceDone = function (id) {
  OAD.markCadenceDone(id);
  OAD.renderDailyView();
};

OAD._dailyCheckIn = function (id, done) {
  const note = document.getElementById('ds-note-' + id)?.value.trim() || '';
  OAD.checkInHabit(id, done, note);
  OAD.renderDailyView();
};
