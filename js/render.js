window.OAD = window.OAD || {};

OAD._activeId = null;

OAD.renderHeaderActions = function () {
  const header = document.querySelector('.header-actions');
  if (header && header.children.length === 0) {
    header.innerHTML = `
      <div class="nav-dropdown">
        <button class="ghost" style="font-weight:600" data-i18n="views">Views</button>
        <div class="nav-dropdown-content">
          <button onclick="OAD.renderDailyView()" data-i18n="dailySummary">Daily Summary</button>
          <button onclick="OAD.renderListView()" data-i18n="list">List</button>
          <button onclick="OAD.renderTodayView()" data-i18n="today">Today</button>
          <button onclick="OAD.renderMatrixView()" data-i18n="matrix">Matrix</button>
          <button id="nav-graph-btn" onclick="OAD.renderGraphView()" data-i18n="graph">Graph</button>
        </div>
      </div>
      
      <div class="nav-dropdown">
        <button class="ghost" style="font-weight:600" data-i18n="queues">Queues</button>
        <div class="nav-dropdown-content">
          <button onclick="OAD.renderIdeaPanel()" data-i18n="ideas">Ideas</button>
          <button onclick="OAD.renderHabitPanel()" data-i18n="habits">Habits</button>
          <button onclick="OAD.renderCadencePanel()" data-i18n="cadences">Cadences</button>
          <button onclick="OAD.renderProposalsPanel()" data-i18n="proposals">Proposals</button>
          <button onclick="OAD.openMailroomModal()" style="color:var(--accent);font-weight:600" data-i18n="scanMail">📥 Scan Mail</button>
        </div>
      </div>

      <div class="nav-dropdown">
        <button class="ghost" style="font-weight:600">Operations</button>
        <div class="nav-dropdown-content">
          <button onclick="window.location.href='modules/cic/index.html'">Map View</button>
          <button onclick="window.location.href='modules/cic/index.html'">Bed Scan View</button>
        </div>
      </div>

      <button class="ghost" onclick="OAD.renderCommandCenter()" style="font-weight:600;color:var(--primary)" data-i18n="myTeam">My Team</button>
      <button class="ghost" onclick="OAD.openSettingsModal()" data-i18n="settings">Settings</button>
      <button id="che-badge" class="ghost" onclick="OAD.openHealthPanel()" style="display:none;font-size:12px;padding:4px 10px;font-weight:600"></button>
    `;
    if (typeof OAD.translateDOM === 'function') {
      OAD.translateDOM();
    }
  }
};


OAD.renderList = function () {
  const query   = (document.getElementById('search-input')?.value || '').toLowerCase();
  const threads = OAD.getVisibleThreads()
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

  const threads = OAD.getVisibleThreads();
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

OAD.refreshActiveView = function () {
  OAD.renderList();

  if (OAD._lastView === 'Graph') {
    OAD.renderGraphView();
  } else if (OAD._lastView === 'Matrix') {
    OAD.renderMatrixView();
  } else if (OAD._lastView === 'Daily') {
    OAD.renderDailyView();
  } else if (OAD._lastView === 'Today') {
    OAD.renderTodayView();
  } else if (OAD._lastView === 'List') {
    OAD.filterListTab();
  } else if (OAD._lastView === 'Ideas') {
    OAD.renderIdeaPanel();
  } else if (OAD._lastView === 'Habits') {
    OAD.renderHabitPanel();
  } else if (OAD._lastView === 'Cadences') {
    OAD.renderCadencePanel();
  } else if (OAD._lastView === 'Proposals') {
    OAD.renderProposalsPanel();
  }
};

OAD.renderDetail = function (id) {
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const t = OAD.getThread(id);
  if (!t) {
    panel.innerHTML = '<div class="detail-empty">' + OAD.esc(OAD.t('selectThreadToView')) + '</div>';
    return;
  }

  var backBtnHtml = '';
  if (OAD._lastView) {
    var label = 'Back';
    if (OAD._lastView === 'Graph') label = 'Back to Graph';
    else if (OAD._lastView === 'Matrix') label = 'Back to Matrix';
    else if (OAD._lastView === 'Daily') label = 'Back to Daily Summary';
    else if (OAD._lastView === 'Today') label = 'Back to Today';
    else if (OAD._lastView === 'List') label = 'Back to List';
    else if (OAD._lastView === 'Ideas') label = 'Back to Ideas';
    else if (OAD._lastView === 'Habits') label = 'Back to Habits';
    else if (OAD._lastView === 'Cadences') label = 'Back to Cadences';
    else if (OAD._lastView === 'Proposals') label = 'Back to Proposals';
    
    var backFn = '';
    if (OAD._lastView === 'Graph') backFn = 'OAD.renderGraphView()';
    else if (OAD._lastView === 'Matrix') backFn = 'OAD.renderMatrixView()';
    else if (OAD._lastView === 'Daily') backFn = 'OAD.renderDailyView()';
    else if (OAD._lastView === 'Today') backFn = 'OAD.renderTodayView()';
    else if (OAD._lastView === 'List') backFn = 'OAD.renderListView()';
    else if (OAD._lastView === 'Ideas') backFn = 'OAD.renderIdeaPanel()';
    else if (OAD._lastView === 'Habits') backFn = 'OAD.renderHabitPanel()';
    else if (OAD._lastView === 'Cadences') backFn = 'OAD.renderCadencePanel()';
    else if (OAD._lastView === 'Proposals') backFn = 'OAD.renderProposalsPanel()';
    
    backBtnHtml = `<button class="ghost" onclick="${backFn}" style="margin-right:auto;display:flex;align-items:center;gap:6px">← ${label}</button>`;
  }

  const score   = OAD.pressure(t);
  const pc      = OAD.pressureClass(score);
  const lastInsight = (t.ai_insights || []).slice(-1)[0] || null;

  const contingencyDays = OAD.daysUntil(t.contingency_trigger_date);
  const contingencyClass = contingencyDays !== null && contingencyDays < 3 ? 'contingency-urgent'
    : contingencyDays !== null && contingencyDays < 7 ? 'contingency-warn' : '';

  const gctx = OAD.getGraphContext(t.id);

  function graphRow(icon, label, thread) {
    const displayLabel = thread ? thread.title : label;
    const pressureHtml = thread && thread.status !== 'closed'
      ? '<span class="graph-row-pressure ' + OAD.pressureClass(OAD.pressure(thread)) + '">' + OAD.pressure(thread) + '</span>'
      : '';
    const clickable = thread
      ? ' role="button" onclick="OAD.selectThread(' + thread.id + ')" style="cursor:pointer"'
      : '';
    return '<div class="graph-row"' + clickable + '>' +
      '<span class="graph-row-icon">' + icon + '</span>' +
      '<span class="graph-row-label">' + OAD.esc(displayLabel) + '</span>' +
      pressureHtml +
    '</div>';
  }

  const blocksRows    = gctx.blocks.map(function (e)    { return graphRow('→', e.label, e.thread); });
  const blockedByRows = gctx.blockedBy.map(function (t) { return graphRow('←', t.title, t); });
  const enablesRows   = gctx.enables.map(function (e)   { return graphRow('↗', e.label, e.thread); });
  const relatesRows   = gctx.relates.map(function (e)   { return graphRow('~', e.label, e.thread); });

  const allRows = blockedByRows.concat(blocksRows).concat(enablesRows).concat(relatesRows);
  const unconfirmedCount = (t.connections || []).filter(function (c) { return c.auto_generated && !c.confirmed_by_user; }).length;
  const unconfirmedBadge = unconfirmedCount
    ? '<span style="display:inline-block;background:var(--accent);color:#fff;font-size:10px;font-weight:700;border-radius:10px;padding:1px 7px;margin-left:8px;vertical-align:middle">' + unconfirmedCount + ' pending</span>'
    : '';
  const reviewBtn = unconfirmedCount
    ? '<button class="ghost mt-8" style="font-size:12px;padding:5px 10px;color:var(--accent);border-color:var(--accent)" onclick="OAD.openGraphIntelligencePanel(' + t.id + ')">⚡ Review AI suggestions</button>'
    : '';
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
        <div class="detail-title">${OAD.esc(OAD.formatDisplayTitle(t.title))}</div>
        <div class="detail-badges">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span class="pill" style="background:var(--surface2);color:var(--text-muted)">${OAD.esc(t.life_area)}</span>
          <span class="pressure-badge ${pc}" style="font-size:13px;padding:3px 8px">Pressure: ${score}</span>
        </div>
      </div>
      <div class="detail-actions">
        ${backBtnHtml}
        <button class="success" onclick="OAD.openCompleteActionModal(${t.id})">${OAD.esc(OAD.t('completeAction'))}</button>
        <button class="secondary" onclick="OAD.openEditModal(${t.id})">${OAD.esc(OAD.t('edit'))}</button>
        <button class="ghost" onclick="OAD.openLogModal(${t.id})">${OAD.esc(OAD.t('plusLog'))}</button>
        <button onclick="OAD.generateInsight(${t.id})" id="insight-btn-${t.id}">${OAD.esc(OAD.t('insight'))}</button>
      </div>
    </div>

    <div class="card next-action-card">
      <div class="card-title">${OAD.esc(OAD.t('nextAction'))}</div>
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
        <div class="card-title" style="margin:0">${OAD.esc(OAD.t('aiInsight'))}</div>
      </div>
      <div id="insight-body-${t.id}">${insightHtml}</div>
    </div>

    <div class="card">
      <div class="card-title">${OAD.esc(OAD.t('closingCondition'))}</div>
      <div class="${t.closing_condition_met ? 'closing-met' : 'closing-unmet'}">
        ${t.closing_condition_met ? '✓ Met — ' : '○ '}${OAD.esc(t.closing_condition) || '<span class="text-muted">Not defined</span>'}
      </div>
      <div class="text-muted text-sm mt-8">Type: ${OAD.esc(t.closing_condition_type)}</div>
    </div>

    <div class="card">
      <div class="card-title">${OAD.esc(OAD.t('currentAssumption'))}</div>
      <div class="${t.assumption_verified ? 'assumption-verified' : 'assumption-unverified'}">
        ${t.assumption_verified ? '✓ Verified — ' : '⚠ Unverified — '}${OAD.esc(t.current_assumption) || '<span class="text-muted">None stated</span>'}
      </div>
    </div>

    <div class="card">
      <div class="card-title">${OAD.esc(OAD.t('contingency'))}</div>
      ${t.contingency_trigger_date ? `
        <div class="${contingencyClass}">Trigger: ${OAD.formatDate(t.contingency_trigger_date)}${contingencyDays !== null ? ` (${contingencyDays}d)` : ''}</div>
        <div class="text-sm mt-8">${OAD.esc(t.contingency_action) || '—'}</div>
        ${t.contingency_escalation ? `<div class="text-muted text-sm mt-8">Escalation: ${OAD.esc(t.contingency_escalation)}</div>` : ''}
      ` : '<span class="text-muted text-sm">No contingency set</span>'}
    </div>

    <div class="card graph-card">
      <div class="card-title">${OAD.esc(OAD.t('graph'))}${unconfirmedBadge}</div>
      ${connectionsHtml}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ghost mt-8" style="font-size:12px;padding:5px 10px" onclick="OAD.openConnectionModal(${t.id})">+ Add Connection</button>
        ${reviewBtn}
      </div>
    </div>

    <div class="card">
      <div class="card-title">${OAD.esc(OAD.t('evolutionLog'))}</div>
      ${evoHtml}
    </div>

    ${t.status !== 'closed' ? `
    <button class="complete-cta" onclick="OAD.openCompleteActionModal(${t.id})">
      ✓ ${OAD.esc(OAD.t('completeAction'))}
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
  c.next_due = OAD.nextCadenceDue(c.recurrence, c.last_completed, c.days_of_week);
  OAD.saveDB();
  OAD.renderOverdueBanner();
  if (!OAD._activeId) OAD.renderCadencePanel();
};

OAD.renderCadencePanel = function () {
  OAD._lastView = 'Cadences';
  OAD.highlightNav('renderCadencePanel');
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
    const prevDue        = OAD.prevCadenceDue(c.recurrence, c.days_of_week);
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
        '<div class="cadence-meta">' + OAD.esc(OAD.formatRecurrence(c)) + ' · ' + OAD.esc(c.life_area) + '</div>' +
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
  OAD._lastView = 'Ideas';
  OAD.highlightNav('renderIdeaPanel');
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
  OAD._lastView = 'Proposals';
  OAD.highlightNav('renderProposalsPanel');
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
  OAD._lastView = 'Habits';
  OAD.highlightNav('renderHabitPanel');
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
  OAD._lastView = 'Today';
  OAD.highlightNav('renderTodayView');
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.getVisibleThreads() || [])
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
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr && !OAD.cadenceDoneThisPeriod(c); });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str && !OAD.cadenceDoneThisPeriod(c); });

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

  const cycles = OAD.detectCycles();
  const cycleThreadIds = new Set(cycles.flat());

  function threadRow(t, context) {
    const pc = OAD.pressureClass(t._score);
    var badge = '';
    const isOverdue = t.next_action_date && t.next_action_date < todayStr;
    const isToday = t.next_action_date === todayStr;
    
    if (isOverdue) badge = '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">OVERDUE</span>';
    else if (isToday) badge = '<span class="ds-status-badge ds-badge-today" aria-label="Due today">TODAY</span>';

    if (t.next_action_date && window.OAD && window.OAD.Config && window.OAD.Config.demoMode && window.OAD._demoRole && window.OAD.isOffDay && window.OAD.isOffDay(t.next_action_date, window.OAD._demoRole)) {
      badge += ' <span class="ds-status-badge" style="color:var(--critical);border:1px solid var(--critical);background:rgba(243,139,168,0.1)" aria-label="Shift Collision">⚠ SHIFT COLLISION</span>';
    }

    const inCycle = cycleThreadIds.has(t.id);
    const cycleBadge = inCycle 
      ? `<span class="cycle-warning-badge" style="margin-left: 6px; cursor: pointer;" title="Click to resolve circular dependency" onclick="event.stopPropagation(); OAD.openCycleResolutionModal(${t.id})">🔄 Cycle</span>` 
      : '';
    
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
          '<div class="ds-row-title">' + OAD.esc(t.title) + badge + cycleBadge + '</div>' +
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
          '<div class="ds-row-sub">' + OAD.esc(OAD.formatRecurrence(c)) +
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
        '<div class="focus-title">' + OAD.esc(OAD.formatDisplayTitle(focusThread.title)) + '</div>' +
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
  OAD._lastView = 'Daily';
  OAD.highlightNav('renderDailyView');
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.getVisibleThreads() || [])
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

  // Filter threads into the standard buckets
  const overdueThreads = filteredActive.filter(t => t.next_action_date && t.next_action_date < todayStr);
  const todayThreads   = filteredActive.filter(t => t.next_action_date === todayStr);
  const in7Dt = new Date(todayDt); in7Dt.setDate(in7Dt.getDate() + 7);
  const in7Str = in7Dt.toISOString().slice(0, 10);
  const weekThreads    = filteredActive.filter(t => t.next_action_date > todayStr && t.next_action_date <= in7Str);
  const activeThreads  = filteredActive.filter(t => !t.next_action_date);

  // Cycle detection
  const cycles = OAD.detectCycles();
  const cycleThreadIds = new Set(cycles.flat());

  // ── Cadences ───────────────────────────────────────────────────────
  const cads = OAD.DB.cadences || [];
  
  const overdueCadences = cads.filter(function (c) { return OAD.cadenceOverdue(c); });
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr && !OAD.cadenceDoneThisPeriod(c); });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str && !OAD.cadenceDoneThisPeriod(c); });

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
    
    if (t.next_action_date && window.OAD && window.OAD.Config && window.OAD.Config.demoMode && window.OAD._demoRole && window.OAD.isOffDay && window.OAD.isOffDay(t.next_action_date, window.OAD._demoRole)) {
      badge += ' <span class="ds-status-badge" style="color:var(--critical);border:1px solid var(--critical);background:rgba(243,139,168,0.1)" aria-label="Shift Collision">⚠ SHIFT COLLISION</span>';
    }
    
    const inCycle = cycleThreadIds.has(t.id);
    const cycleBadge = inCycle 
      ? `<span class="cycle-warning-badge" style="margin-left: 6px; cursor: pointer;" title="Click to resolve circular dependency" onclick="event.stopPropagation(); OAD.openCycleResolutionModal(${t.id})">🔄 Cycle</span>` 
      : '';

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
    const displayTitle = OAD.formatDisplayTitle(t.title);

    return '<div class="' + rowClass + '" role="button" aria-label="' + OAD.esc(t.title) + '" onclick="OAD.selectThread(' + t.id + ')">' +
      '<div class="ds-row-main">' +
        '<span class="pressure-badge ' + pc + '" aria-label="Pressure ' + t._score + '">' + t._score + '</span>' +
        '<div class="ds-row-text">' +
          '<div class="ds-row-title">' + OAD.esc(displayTitle) + badge + cycleBadge + '</div>' +
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
          '<div class="ds-row-sub">' + OAD.esc(OAD.formatRecurrence(c)) +
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

  const overdueItems = overdueThreads.map(t => threadRow(t, 'overdue'));
  const todayItems   = todayThreads.map(t => threadRow(t, 'today'));
  const weekItems    = weekThreads.map(t => threadRow(t, 'week'));
  const activeItems  = activeThreads.map(t => threadRow(t, 'active'));

  const habitItems = overdueHabits.concat(todayHabits).concat(weekHabits).map(habitRow);
  const cadenceItems = overdueCadences.concat(todayCadences).concat(weekCadences).map(cadenceRow);

  // ── The One Annoying Thing (TOAT) ──────────────────────────────────
  const toatThread = OAD.getDailyToat();
  var toatWidgetHtml = '';
  if (toatThread) {
    const tpc = OAD.pressureClass(OAD.pressure(toatThread));
    const openThreads = (OAD.getVisibleThreads() || []).filter(t => t.status !== 'closed');
    const frictionThreads = openThreads.filter(t => t.status === 'stalled' || t.status === 'waiting');
    frictionThreads.sort((a, b) => a.id - b.id);
    openThreads.sort((a, b) => a.id - b.id);

    let explanation = '';
    if (toatThread.status === 'stalled') {
      const stalledThreads = openThreads.filter(t => t.status === 'stalled');
      stalledThreads.sort((a, b) => a.id - b.id);
      const idx = stalledThreads.findIndex(t => t.id === toatThread.id) + 1;
      explanation = 'Selected because it is <strong>STALLED</strong> and is the oldest of ' + stalledThreads.length + ' such tasks (Rank ' + idx + '/' + stalledThreads.length + ' by creation age).';
    } else {
      const overdueThreads = openThreads.filter(t => t.next_action_date && t.next_action_date < todayStr);
      overdueThreads.sort((a, b) => a.id - b.id);
      const idx = overdueThreads.findIndex(t => t.id === toatThread.id) + 1;
      explanation = 'Selected because it is <strong>OVERDUE</strong> and is the oldest of ' + overdueThreads.length + ' such tasks (Rank ' + idx + '/' + overdueThreads.length + ' by creation age).';
    }

    toatWidgetHtml =
      '<div class="toat-widget" style="margin-bottom:20px;padding:16px;background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.25);border-radius:12px;display:flex;flex-direction:column;gap:8px" role="region" aria-label="The One Annoying Thing">' +
        '<div style="display:flex;align-items:center;justify-content:space-between">' +
          '<span style="font-size:11px;font-weight:700;color:orange;letter-spacing:1px;text-transform:uppercase">⚠️ THE ONE ANNOYING THING (TOAT)</span>' +
          '<span class="pressure-badge ' + tpc + '" style="font-size:11px;padding:2px 6px">' + OAD.pressure(toatThread) + '</span>' +
        '</div>' +
        '<div style="font-size:15px;font-weight:600;color:var(--text-main)">' + OAD.esc(OAD.formatDisplayTitle(toatThread.title)) + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);line-height:1.4">' + explanation + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:4px">' +
          '<button class="success btn-sm" style="font-size:11px;padding:4px 10px" onclick="OAD.selectThread(' + toatThread.id + ')">View Details</button>' +
          '<button class="secondary btn-sm" style="font-size:11px;padding:4px 10px" onclick="OAD.openCompleteActionModal(' + toatThread.id + ')">Resolve Friction</button>' +
        '</div>' +
      '</div>';
  } else {
    toatWidgetHtml =
      '<div class="toat-widget toat-clean" style="margin-bottom:20px;padding:16px;background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);border-radius:12px;display:flex;align-items:center;gap:12px" role="region" aria-label="No Annoying Things">' +
        '<span style="font-size:20px" aria-hidden="true">🎉</span>' +
        '<div>' +
          '<div style="font-size:14px;font-weight:600;color:var(--text-main)">' + OAD.t('no_toats_title', 'No TOATs to see here') + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' + OAD.t('no_toats_desc', 'All tasks are on track. Focus Now!') + '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Focus Now card ─────────────────────────────────────────────────
  const focusThread = OAD.selectFocusThread();
  var focusCardHtml = '';
  if (focusThread) {
    const fpc   = OAD.pressureClass(focusThread._score);
    const freason = OAD.focusReason(focusThread);
    const fctx  = OAD.getGraphContext(focusThread.id);
    const blockedByHtml = fctx.blockedBy.length
      ? '<div class="focus-blocked-by"><span class="block-tag">Blocked by:</span> ' +
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
        '<div class="focus-title">' + OAD.esc(OAD.formatDisplayTitle(focusThread.title)) + '</div>' +
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
    heatMapHtml = '<section class="ds-area-heat-section" aria-label="Life Area Status">' +
      '<h3 class="ds-bucket-header"><span class="ds-bucket-icon" aria-hidden="true">🗂</span><span class="ds-bucket-label">Life Areas Heat</span></h3>' +
      '<div class="area-heat-map" role="list" aria-label="Life area heat">' +
        areaHeat.map(function (a) {
          const heat = a.avgPressure >= 60 ? 'hot' : a.avgPressure >= 30 ? 'warm' : 'cool';
          const stalledTag = a.stalled ? '<span class="area-stalled">' + a.stalled + ' stalled</span>' : '';
          return '<div class="area-chip area-chip-' + heat + '" role="listitem" ' +
            'aria-label="' + OAD.esc(a.name) + ' ' + a.count + ' threads avg pressure ' + a.avgPressure + '">' +
            '<span class="area-chip-name">' + OAD.esc(a.name) + '</span>' +
            '<div class="area-chip-stats">' +
              '<span class="area-chip-score">' + a.avgPressure + '</span>' +
              stalledTag +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>';
  }

  // ── This Week's Load ───────────────────────────────────────────────
  const weekLoadHtml = (function () {
    var rows = '';
    for (var di = 0; di < 7; di++) {
      var dayDt = new Date(todayDt);
      dayDt.setDate(dayDt.getDate() + di);
      var dayStr = dayDt.toISOString().slice(0, 10);
      var threadCount  = active.filter(function (t) { return t.next_action_date === dayStr; }).length;
      var cadenceCount = cads.filter(function (c)  { return c.next_due === dayStr; }).length;
      var total = threadCount + cadenceCount;
      var labelKey = total >= 3 ? 'heavy' : total === 2 ? 'busy' : 'clear';
      var label    = total >= 3 ? OAD.t('heavy', 'Heavy') : total === 2 ? OAD.t('busy', 'Busy') : OAD.t('clear', 'Clear');
      var labelCls = total >= 3 ? 'load-row-heavy' : total === 2 ? 'load-row-busy' : 'load-row-clear';
      var dayLabel = di === 0 ? 'Today' : dayDt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      
      var shiftStr = '';
      var isOffDay = false;
      if (window.OAD && OAD.Config && OAD.Config.demoMode && OAD._demoRole && OAD.isOffDay) {
        isOffDay = OAD.isOffDay(dayStr, OAD._demoRole);
        if (OAD._demoRole.includes('Counselor')) {
          if (isOffDay) shiftStr = ' (OFF)';
          else shiftStr = ' (8-4:30pm)';
        } else if (OAD._demoRole.includes('Director') || OAD._demoRole.includes('Case Manager')) {
          if (isOffDay) shiftStr = ' (OFF)';
          else shiftStr = ' (9-5pm)';
        } else if (OAD._demoRole === 'Medical' || OAD._demoRole === 'RA') {
          shiftStr = ' (12hr Shift)';
        }
      }
      
      if (isOffDay && total > 0) {
        labelCls = 'load-row-danger';
        label = OAD.t('shiftCollision', '⚠ Shift Collision');
      }
      
      const pct = Math.min((total / 4) * 100, 100);
      rows +=
        '<div class="load-row ' + labelCls + '" aria-label="' +
            OAD.esc(dayLabel) + ': ' + total + ' item' + (total !== 1 ? 's' : '') + ', ' + label + '">' +
          '<div class="load-row-details">' +
            '<span class="load-day">'   + OAD.esc(dayLabel) + '<span style="color:var(--text-muted);font-weight:400;font-size:11px;margin-left:4px">' + shiftStr + '</span></span>' +
            '<span class="load-count">' + total + (total === 1 ? ' item' : ' items') + '</span>' +
            '<span class="load-label">' + OAD.esc(label) + '</span>' +
          '</div>' +
          '<div class="load-progress-bar">' +
            '<div class="load-progress-fill" style="width: ' + pct + '%"></div>' +
          '</div>' +
        '</div>';
    }
    return '<section class="ds-week-load" aria-label="This week\'s load">' +
      '<h3 class="ds-bucket-header">' +
        '<span class="ds-bucket-icon" aria-hidden="true">▤</span>' +
        '<span class="ds-bucket-label">This Week\'s Load</span>' +
      '</h3>' +
      '<div class="ds-week-load-body">' + rows + '</div>' +
    '</section>';
  }());

  // ── Salutation & Metrics calculation ──────────────────────────────
  const hours = new Date().getHours();
  const salutationKey = hours < 12 ? 'goodMorning' : hours < 18 ? 'goodAfternoon' : 'goodEvening';
  const salutation = OAD.t(salutationKey);
  const persona = OAD.DB.persona;
  const userName = OAD.Config.userGreetingTitle || (persona && persona.name) || 'Chief';
  
  const scores = active.map(t => t._score);
  const avgPressure = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgCls = OAD.pressureClass(avgPressure);
  const pressureLevel = (persona && persona.life_context && persona.life_context.pressure_level) || 'moderate';
  let hardDeadlineStr = (persona && persona.life_context && persona.life_context.hard_deadline) 
    ? OAD.formatDate(persona.life_context.hard_deadline) 
    : '—';
    
  if (hardDeadlineStr === '—' && window.OAD && OAD._demoRole) {
    const endOfQuarter = new Date();
    endOfQuarter.setMonth(Math.floor(endOfQuarter.getMonth() / 3) * 3 + 3, 0); // Last day of current quarter
    hardDeadlineStr = OAD.formatDate(endOfQuarter.toISOString().slice(0,10));
  }

  // ── Render HTML to panel ──────────────────────────────────────────
  panel.innerHTML =
    '<div class="ds-dashboard" role="main">' +
      '<header class="ds-hero">' +
        '<div class="ds-greeting-info">' +
          '<h1>' + salutation + ', <span class="ds-username">' + OAD.esc(userName) + '</span></h1>' +
          '<p class="ds-subtitle">' + OAD.esc(dateLabel) + '</p>' +
        '</div>' +
        '<div class="ds-quick-actions">' +
          '<button class="success" onclick="OAD.openNewThreadModal()">+ New Task</button>' +
        '</div>' +
      '</header>' +

      '<div class="ds-metrics-grid">' +
        '<div class="ds-metric-card" role="button" onclick="OAD.renderListView()">' +
          '<div class="ds-metric-title">Active Tasks</div>' +
          '<div class="ds-metric-value">' + active.length + '</div>' +
          '<div class="ds-metric-desc">In progress</div>' +
        '</div>' +
        '<div class="ds-metric-card" role="button" onclick="OAD._activeListStatus=\'stalled\'; OAD.renderListView();">' +
          '<div class="ds-metric-title">Stalled Tasks</div>' +
          '<div class="ds-metric-value stalled">' + active.filter(t => t.status === 'stalled').length + '</div>' +
          '<div class="ds-metric-desc">Need attention</div>' +
        '</div>' +
        '<div class="ds-metric-card">' +
          '<div class="ds-metric-title">Avg Pressure</div>' +
          '<div class="ds-metric-value ' + avgCls + '">' + avgPressure + '</div>' +
          '<div class="ds-metric-desc">Level: ' + OAD.esc(pressureLevel) + '</div>' +
        '</div>' +
        ((window.OAD && window.OAD.Config && window.OAD.Config.demoMode && window.OAD._demoRole && !['CCO', 'Director Alpha', 'Director Beta'].includes(window.OAD._demoRole)) ? '' :
        '<div class="ds-metric-card">' +
          '<div class="ds-metric-title">Hard Deadline</div>' +
          '<div class="ds-metric-value deadline">' + OAD.esc(hardDeadlineStr) + '</div>' +
          '<div class="ds-metric-desc">Target milestone</div>' +
        '</div>') +
      '</div>' +

      '<div class="ds-main-grid">' +
        '<div class="ds-col-left">' +
          toatWidgetHtml +
          focusCardHtml +
          heatMapHtml +
          weekLoadHtml +
        '</div>' +
        '<div class="ds-col-right">' +
          bucket('overdue', '⚠', 'Overdue Tasks', overdueItems) +
          bucket('today',   '▶', 'Due Today',   todayItems)   +
          bucket('habits',  '✦', 'Active Habits', habitItems)   +
          bucket('cadences','📅', 'Upcoming Cadences', cadenceItems) +
          bucket('week',    '○', 'This Week', weekItems)   +
          bucket('active',  '◇', 'Active — no date set', activeItems) +
          (!overdueItems.length && !todayItems.length && !weekItems.length && !activeItems.length && !habitItems.length && !cadenceItems.length
            ? '<div class="ds-all-clear" role="status">✓ All clear — nothing overdue, due today, or active.</div>'
            : '') +
        '</div>' +
      '</div>' +
    '</div>';
};



OAD.renderMatrixView = function () {
  OAD._lastView = 'Matrix';
  OAD.highlightNav('renderMatrixView');
  OAD._activeId = null;
  OAD.renderList();

  const panel = document.getElementById('detail-content');
  if (!panel) return;

  const todayDt = new Date(); todayDt.setHours(0, 0, 0, 0);
  const todayStr = todayDt.toISOString().slice(0, 10);
  const dateLabel = todayDt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Threads ────────────────────────────────────────────────────────
  const active = (OAD.getVisibleThreads() || [])
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
  const todayCadences   = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due === todayStr && !OAD.cadenceDoneThisPeriod(c); });
  const weekCadences    = cads.filter(function (c) { return !OAD.cadenceOverdue(c) && c.next_due > todayStr && c.next_due <= in7Str && !OAD.cadenceDoneThisPeriod(c); });

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

  const cycles = OAD.detectCycles();
  const cycleThreadIds = new Set(cycles.flat());

  function threadRow(t, context) {
    const pc = OAD.pressureClass(t._score);
    var badge = '';
    const isOverdue = t.next_action_date && t.next_action_date < todayStr;
    const isToday = t.next_action_date === todayStr;
    
    if (isOverdue) badge = '<span class="ds-status-badge ds-badge-overdue" aria-label="Overdue">⚠ OVERDUE</span>';
    else if (isToday) badge = '<span class="ds-status-badge ds-badge-today" aria-label="Due today">▶ TODAY</span>';

    if (t.next_action_date && window.OAD && window.OAD.Config && window.OAD.Config.demoMode && window.OAD._demoRole && window.OAD.isOffDay && window.OAD.isOffDay(t.next_action_date, window.OAD._demoRole)) {
      badge += ' <span class="ds-status-badge" style="color:var(--critical);border:1px solid var(--critical);background:rgba(243,139,168,0.1)" aria-label="Shift Collision">⚠ SHIFT COLLISION</span>';
    }

    const inCycle = cycleThreadIds.has(t.id);
    const cycleBadge = inCycle 
      ? `<span class="cycle-warning-badge" style="margin-left: 6px; cursor: pointer;" title="Click to resolve circular dependency" onclick="event.stopPropagation(); OAD.openCycleResolutionModal(${t.id})">🔄 Cycle</span>` 
      : '';
    
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
          '<div class="ds-row-title">' + OAD.esc(t.title) + badge + cycleBadge + '</div>' +
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
          '<div class="ds-row-sub">' + OAD.esc(OAD.formatRecurrence(c)) +
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
        '<div class="focus-title">' + OAD.esc(OAD.formatDisplayTitle(focusThread.title)) + '</div>' +
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
  OAD.refreshActiveView();
};

OAD._dailyCheckIn = function (id, done) {
  const note = document.getElementById('ds-note-' + id)?.value.trim() || '';
  OAD.checkInHabit(id, done, note);
  OAD.refreshActiveView();
};

// ── CHE Badge ─────────────────────────────────────────────────────────

OAD._updateCHEBadge = function () {
  var badge = document.getElementById('che-badge');
  if (!badge) return;
  var alerts = (OAD.DB.health_alerts || []).filter(function (a) { return !a.dismissed; });
  var criticals = alerts.filter(function (a) { return a.severity === 'CRITICAL'; });
  if (!alerts.length) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'inline-flex';
  badge.textContent = (criticals.length ? '⚠ ' : 'ℹ ') + alerts.length + ' issue' + (alerts.length === 1 ? '' : 's');
  badge.style.color = criticals.length ? 'var(--danger, #e53e3e)' : 'var(--text-muted)';
};

// ── Graph Visualizer Implementation ───────────────────────────────────

OAD.highlightNav = function (actionName) {
  var btns = document.querySelectorAll('.header-actions button');
  btns.forEach(function (btn) {
    var onclickStr = btn.getAttribute('onclick') || '';
    if (onclickStr.indexOf(actionName) !== -1) {
      btn.style.background = 'var(--accent)';
      btn.style.color = '#fff';
      btn.classList.remove('ghost');
    } else {
      btn.style.background = '';
      btn.style.color = '';
      btn.classList.add('ghost');
    }
  });
};

OAD.goBackToLastView = function () {
  const lv = OAD._lastView;
  if (lv === 'Graph') OAD.renderGraphView();
  else if (lv === 'Matrix') OAD.renderMatrixView();
  else if (lv === 'Daily') OAD.renderDailyView();
  else if (lv === 'Today') OAD.renderTodayView();
  else if (lv === 'List') OAD.renderListView();
  else if (lv === 'Ideas') OAD.renderIdeaPanel();
  else if (lv === 'Habits') OAD.renderHabitPanel();
  else if (lv === 'Cadences') OAD.renderCadencePanel();
  else if (lv === 'Proposals') OAD.renderProposalsPanel();
  else OAD.renderDailyView();
};

OAD.getGraphDataForArea = function (areaFilter) {
  var threads = (OAD.getVisibleThreads() || []).filter(function (t) { return t.status !== 'closed'; });
  
  if (!areaFilter || areaFilter === 'All Areas') {
    var nodes = threads;
    var edges = [];
    var edgeSet = new Set();
    
    nodes.forEach(function (t) {
      var conns = t.connections || [];
      conns.forEach(function (c) {
        var target = null;
        if (c.to_uuid) {
          target = threads.find(function (x) { return x.uuid === c.to_uuid; });
        }
        if (!target && c.to_label) {
          var lbl = c.to_label.toLowerCase();
          target = threads.find(function (x) { return x.id !== t.id && (x.title || '').toLowerCase() === lbl; });
        }
        
        if (target) {
          var edgeSource = t.uuid;
          var edgeTarget = target.uuid;
          var edgeType = c.edge_type;
          
          if (edgeType === 'blocked_by') {
            edgeSource = target.uuid;
            edgeTarget = t.uuid;
            edgeType = 'blocks';
          }
          
          var key = edgeSource + '->' + edgeTarget + ':' + edgeType;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              source: edgeSource,
              target: edgeTarget,
              type: edgeType,
              is_suggested: !!c.is_suggested
            });
          }
        }
      });
    });
    
    return { nodes: nodes, edges: edges };
  }
  
  var lowerFilter = areaFilter.toLowerCase();
  var targetNodes = threads.filter(function (t) {
    return (t.life_area || '').toLowerCase() === lowerFilter;
  });
  
  var targetUuids = new Set(targetNodes.map(function (t) { return t.uuid; }));
  var neighborNodes = [];
  var neighborUuids = new Set();
  
  function connectsToTarget(t) {
    var conns = t.connections || [];
    for (var i = 0; i < conns.length; i++) {
      var c = conns[i];
      if (c.to_uuid && targetUuids.has(c.to_uuid)) return true;
      if (c.to_label) {
        var lbl = c.to_label.toLowerCase();
        var match = targetNodes.find(function (tn) { return (tn.title || '').toLowerCase() === lbl; });
        if (match) return true;
      }
    }
    return false;
  }
  
  function targetConnectsTo(t) {
    for (var i = 0; i < targetNodes.length; i++) {
      var tn = targetNodes[i];
      var conns = tn.connections || [];
      for (var j = 0; j < conns.length; j++) {
        var c = conns[j];
        if (c.to_uuid && c.to_uuid === t.uuid) return true;
        if (c.to_label && (t.title || '').toLowerCase() === c.to_label.toLowerCase()) return true;
      }
    }
    return false;
  }
  
  threads.forEach(function (t) {
    if ((t.life_area || '').toLowerCase() === lowerFilter) return;
    
    if (connectsToTarget(t) || targetConnectsTo(t)) {
      neighborNodes.push(t);
      neighborUuids.add(t.uuid);
    }
  });
  
  var allNodes = targetNodes.concat(neighborNodes);
  var edges = [];
  var edgeSet = new Set();
  
  allNodes.forEach(function (t) {
    var conns = t.connections || [];
    conns.forEach(function (c) {
      var target = null;
      if (c.to_uuid) {
        target = allNodes.find(function (x) { return x.uuid === c.to_uuid; });
      }
      if (!target && c.to_label) {
        var lbl = c.to_label.toLowerCase();
        target = allNodes.find(function (x) { return x.id !== t.id && (x.title || '').toLowerCase() === lbl; });
      }
      
      if (target) {
        var edgeSource = t.uuid;
        var edgeTarget = target.uuid;
        var edgeType = c.edge_type;
        
        if (edgeType === 'blocked_by') {
          edgeSource = target.uuid;
          edgeTarget = t.uuid;
          edgeType = 'blocks';
        }
        
        var key = edgeSource + '->' + edgeTarget + ':' + edgeType;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            source: edgeSource,
            target: edgeTarget,
            type: edgeType,
            is_suggested: !!c.is_suggested
          });
        }
      }
    });
  });
  
  return { nodes: allNodes, edges: edges };
};

OAD.renderGraphView = function () {
  OAD._lastView = 'Graph';
  OAD.highlightNav('renderGraphView');
  OAD._activeId = null;
  OAD.renderList();
  
  const panel = document.getElementById('detail-content');
  if (!panel) return;
  
  var activeArea = OAD._activeGraphArea || 'All Areas';
  var activeLayout = OAD._activeGraphLayout || 'cose';
  
  var dynamicAreas = new Set();
  (OAD.DB.threads || []).forEach(t => { if (t.life_area && t.status !== 'closed') dynamicAreas.add(t.life_area); });
  var areas = ["All Areas"].concat(Array.from(dynamicAreas).sort());
  var areaOptionsHtml = areas.map(function (a) {
    var sel = a === activeArea ? ' selected' : '';
    return '<option value="' + a + '"' + sel + '>' + a + '</option>';
  }).join('');
  
  var layouts = [
    { value: 'cose', label: 'Force-Directed' },
    { value: 'concentric', label: 'Concentric' },
    { value: 'circle', label: 'Circle' },
    { value: 'grid', label: 'Grid' }
  ];
  var layoutOptionsHtml = layouts.map(function (l) {
    var sel = l.value === activeLayout ? ' selected' : '';
    return '<option value="' + l.value + '"' + sel + '>' + l.label + '</option>';
  }).join('');
  
  panel.innerHTML =
    '<div class="graph-panel">' +
      '<div class="graph-panel-header">' +
        '<h2>Life Graph</h2>' +
      '</div>' +
      '<p class="text-muted text-sm graph-subtitle">A visual map of active threads and cross-area dependencies. High-pressure nodes are larger.</p>' +
      
      '<div class="graph-controls">' +
        '<div class="control-group">' +
          '<label for="graph-area-select">Area: </label>' +
          '<select id="graph-area-select" onchange="OAD._updateGraph()">' +
            areaOptionsHtml +
          '</select>' +
        '</div>' +
        '<div class="control-group">' +
          '<label for="graph-layout-select">Layout: </label>' +
          '<select id="graph-layout-select" onchange="OAD._updateGraph()">' +
            layoutOptionsHtml +
          '</select>' +
        '</div>' +
      '</div>' +
      
      '<div class="graph-viewport-container">' +
        '<div id="graph-viewport"></div>' +
      '</div>' +
    '</div>';
    
  OAD._updateGraph();
};

OAD._updateGraph = function () {
  var areaSelect = document.getElementById('graph-area-select');
  var layoutSelect = document.getElementById('graph-layout-select');
  if (!areaSelect || !layoutSelect) return;
  
  var area = areaSelect.value;
  var layout = layoutSelect.value;
  
  OAD._activeGraphArea = area;
  OAD._activeGraphLayout = layout;
  
  var data = OAD.getGraphDataForArea(area);
  
  if (!window.cytoscape) {
    OAD._renderGraphFallback(data);
    return;
  }
  
  var cyElements = [];
  var areaColors = {
    'career': '#4fc3f7',
    'health': '#ff8a80',
    'finance': '#81c784',
    'relationships': '#ffd54f',
    'education': '#ba68c8',
    'housing': '#ffb74d',
    'legal': '#90a4ae',
    'personal growth': '#a1887f',
    'other': '#8888aa'
  };
  
  var cycles = OAD.detectCycles();
  var cycleThreadIds = new Set(cycles.flat());
  var cycleEdgesSet = new Set();
  cycles.forEach(function (cycle) {
    for (var i = 0; i < cycle.length; i++) {
      var sourceId = cycle[i];
      var targetId = cycle[(i + 1) % cycle.length];
      cycleEdgesSet.add(sourceId + '->' + targetId);
    }
  });

  data.nodes.forEach(function (t) {
    var areaLower = (t.life_area || 'other').toLowerCase();
    var color = areaColors[areaLower] || areaColors['other'];
    var pressure = OAD.pressure(t);
    var size = 20 + Math.round(pressure * 0.25); // 20px to 45px
    
    var nodeClasses = [];
    if (cycleThreadIds.has(t.id)) {
      nodeClasses.push('cycle-node');
    }
    
    cyElements.push({
      group: 'nodes',
      data: {
        id: t.uuid,
        label: t.title + ' (' + pressure + ')',
        color: color,
        size: size,
        threadId: t.id
      },
      classes: nodeClasses.join(' ')
    });
  });
  
  data.edges.forEach(function (e) {
    var sourceThread = OAD.getThreadByUUID(e.source);
    var targetThread = OAD.getThreadByUUID(e.target);
    var isCycleEdge = false;
    if (sourceThread && targetThread) {
      if (cycleEdgesSet.has(sourceThread.id + '->' + targetThread.id)) {
        isCycleEdge = true;
      }
    }

    var edgeClasses = ['edge-' + e.type];
    if (isCycleEdge) {
      edgeClasses.push('cycle-edge');
    }

    cyElements.push({
      group: 'edges',
      data: {
        id: e.source + '-' + e.target + '-' + e.type,
        source: e.source,
        target: e.target,
        type: e.type
      },
      classes: edgeClasses.join(' ')
    });
  });
  
  OAD._drawCytoscape(cyElements, layout);
};

OAD._cyInstance = null;

OAD._drawCytoscape = function (elements, layoutName) {
  var container = document.getElementById('graph-viewport');
  if (!container) return;
  
  if (OAD._cyInstance) {
    OAD._cyInstance.destroy();
    OAD._cyInstance = null;
  }
  
  var theme = document.body.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme') || 'dark';
  var labelColor = theme === 'light' ? '#212529' : '#e8e8f0';
  var nodeBgColor = theme === 'light' ? '#ffffff' : '#16161e';
  var edgeColor = theme === 'light' ? '#cccccc' : '#444455';
  
  OAD._cyInstance = window.cytoscape({
    container: container,
    elements: elements,
    maxZoom: 1.2, // Prevents massive labels/nodes on small graphs
    minZoom: 0.15,
    wheelSensitivity: 0.15,
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'color': labelColor,
          'font-size': '11px',
          'font-weight': '600',
          'font-family': 'Inter, system-ui, sans-serif',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': '8px',
          'background-color': nodeBgColor,
          'border-width': '3px',
          'border-color': 'data(color)',
          'width': 'data(size)',
          'height': 'data(size)',
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'text-outline-color': nodeBgColor,
          'text-outline-width': '2.5px',
          'text-outline-opacity': 1.0
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': '4.5px',
          'border-color': '#6c63ff',
          'background-color': theme === 'light' ? '#ebf0fb' : '#1e1e38',
          'text-outline-color': theme === 'light' ? '#ebf0fb' : '#1e1e38'
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': edgeColor,
          'target-arrow-color': edgeColor,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 1.15
        }
      },
      {
        selector: 'edge.edge-blocks',
        style: {
          'line-color': '#f38ba8',
          'target-arrow-color': '#f38ba8',
          'width': 3
        }
      },
      {
        selector: 'edge.edge-enables',
        style: {
          'line-color': '#a6e3a1',
          'target-arrow-color': '#a6e3a1',
          'width': 2.5
        }
      },
      {
        selector: 'edge.edge-relates',
        style: {
          'line-color': '#6c63ff',
          'target-arrow-color': '#6c63ff',
          'line-style': 'dashed',
          'width': 2
        }
      },
      {
        selector: '.highlighted',
        style: {
          'opacity': 1.0
        }
      },
      {
        selector: 'node.cycle-node',
        style: {
          'border-width': '5px',
          'border-color': '#ff4d6d',
          'border-style': 'double'
        }
      },
      {
        selector: 'edge.cycle-edge',
        style: {
          'line-color': '#ff4d6d',
          'target-arrow-color': '#ff4d6d',
          'width': 4
        }
      },
      {
        selector: '.dimmed',
        style: {
          'opacity': 0.18
        }
      }
    ],
    layout: (function() {
      var cfg = {
        name: layoutName,
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 80,
        spacingFactor: 2.2 // Spreads nodes out significantly to prevent label overlaps
      };
      if (layoutName === 'cose') {
        cfg.nodeRepulsion = function() { return 120000; };
        cfg.idealEdgeLength = function() { return 150; };
        cfg.nodeOverlap = 50;
        cfg.refresh = 20;
        cfg.randomize = true;
      }
      return cfg;
    })()
  });
  
  var cy = OAD._cyInstance;
  
  cy.on('tap', 'node', function (evt) {
    var node = evt.target;
    var threadId = node.data('threadId');
    
    var neighborhood = node.closedNeighborhood();
    cy.elements().addClass('dimmed').removeClass('highlighted');
    neighborhood.addClass('highlighted').removeClass('dimmed');
    
    OAD.selectThread(threadId);
  });
  
  cy.on('tap', function (evt) {
    if (evt.target === cy) {
      cy.elements().removeClass('dimmed').removeClass('highlighted');
    }
  });
  
  cy.on('dbltap', 'node', function (evt) {
    var node = evt.target;
    var threadId = node.data('threadId');
    OAD.openEditModal(threadId);
  });
};

OAD._renderGraphFallback = function (data) {
  var viewportContainer = document.querySelector('.graph-viewport-container');
  if (!viewportContainer) return;
  
  var warningHtml = 
    '<div class="graph-fallback-warning">' +
      '<strong>Offline Fallback Mode:</strong> Could not load the interactive visual graph library (Cytoscape.js). Exposing connections in list form below.' +
    '</div>';
  
  var cardsHtml = data.nodes.map(function (t) {
    var conns = t.connections || [];
    var threads = OAD.getVisibleThreads() || [];
    
    var blocks = [];
    var blockedBy = [];
    var enables = [];
    var relates = [];
    
    conns.forEach(function (c) {
      var target = null;
      if (c.to_uuid) target = threads.find(function (x) { return x.uuid === c.to_uuid; });
      if (target) {
        var link = '<a href="#" onclick="OAD.selectThread(' + target.id + '); return false;">' + OAD.esc(target.title) + '</a>';
        if (c.edge_type === 'blocks') {
          if (blocks.indexOf(link) === -1) blocks.push(link);
        } else if (c.edge_type === 'blocked_by') {
          if (blockedBy.indexOf(link) === -1) blockedBy.push(link);
        } else if (c.edge_type === 'enables') {
          if (enables.indexOf(link) === -1) enables.push(link);
        } else if (c.edge_type === 'relates') {
          if (relates.indexOf(link) === -1) relates.push(link);
        }
      }
    });
    
    threads.forEach(function (ot) {
      if (ot.id === t.id || ot.status === 'closed') return;
      var oconns = ot.connections || [];
      oconns.forEach(function (oc) {
        if (oc.to_uuid === t.uuid) {
          var link = '<a href="#" onclick="OAD.selectThread(' + ot.id + '); return false;">' + OAD.esc(ot.title) + '</a>';
          if (oc.edge_type === 'blocks') {
            if (blockedBy.indexOf(link) === -1) blockedBy.push(link);
          } else if (oc.edge_type === 'blocked_by') {
            if (blocks.indexOf(link) === -1) blocks.push(link);
          }
        }
      });
    });
    
    var blocksHtml = blocks.length ? '<div><strong>Blocks:</strong> ' + blocks.join(', ') + '</div>' : '';
    var blockedByHtml = blockedBy.length ? '<div><strong>Blocked By:</strong> ' + blockedBy.join(', ') + '</div>' : '';
    var enablesHtml = enables.length ? '<div><strong>Enables:</strong> ' + enables.join(', ') + '</div>' : '';
    var relatesHtml = relates.length ? '<div><strong>Relates:</strong> ' + relates.join(', ') + '</div>' : '';
    
    var pressure = OAD.pressure(t);
    var pClass = OAD.pressureClass(pressure);
    
    return '<div class="graph-fallback-card" onclick="OAD.selectThread(' + t.id + ')">' +
      '<div class="graph-fallback-title">' + OAD.esc(t.title) + '</div>' +
      '<div class="thread-item-meta" style="margin-bottom: 8px;">' +
        '<span class="pill ' + t.priority + '">' + t.priority + '</span>' +
        '<span class="pressure-badge ' + pClass + '">' + pressure + ' score</span>' +
        '<span class="pill ' + t.status + '">' + t.status + '</span>' +
      '</div>' +
      '<div class="graph-fallback-list text-sm">' +
        blocksHtml +
        blockedByHtml +
        enablesHtml +
        relatesHtml +
      '</div>' +
    '</div>';
  }).join('');
  
  viewportContainer.innerHTML = 
    '<div class="graph-fallback-container">' +
      warningHtml +
      '<div class="graph-fallback-grid">' +
        (cardsHtml || '<div class="detail-empty">No threads found for this filter.</div>') +
      '</div>' +
    '</div>';
};

OAD.renderListView = function () {
  OAD._lastView = 'List';
  OAD.highlightNav('renderListView');
  
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  if (OAD._activeListSearch === undefined) OAD._activeListSearch = '';
  if (OAD._activeListStatus === undefined) OAD._activeListStatus = 'all';

  const threads = OAD.getVisibleThreads();
  const openCount = threads.filter(t => t.status !== 'closed').length;
  const stalledCount = threads.filter(t => t.status === 'stalled').length;
  const scores = threads.map(t => OAD.pressure(t));
  const avgPressure = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgCls = avgPressure >= 60 ? 'pressure-high' : avgPressure >= 30 ? 'pressure-mid' : 'pressure-low';
  const persona = OAD.DB.persona;
  const hardDeadlineStr = (persona && persona.life_context && persona.life_context.hard_deadline) 
    ? OAD.formatDate(persona.life_context.hard_deadline) 
    : '—';
  const pressureLevel = (persona && persona.life_context && persona.life_context.pressure_level) || 'moderate';

  const statusOptions = ['all', 'open', 'stalled', 'waiting', 'closed'].map(s => {
    const label = s === 'all' ? 'All States' : s.charAt(0).toUpperCase() + s.slice(1);
    const selected = s === OAD._activeListStatus ? 'selected' : '';
    return `<option value="${s}" ${selected}>${label}</option>`;
  }).join('');

  panel.innerHTML = `
    <div class="list-tab-container">
      <div class="list-tab-header">
        <h2>All Tasks</h2>
        <div id="list-tab-persona-bar" class="persona-bar" style="border:1px solid var(--border); border-radius:var(--radius-lg); padding:12px 16px; margin:0; width:100%; box-sizing:border-box;">
          <div class="persona-stat"><span class="text-muted text-sm">Active</span><span class="val">${openCount}</span></div>
          <div class="persona-stat"><span class="text-muted text-sm">Stalled</span><span class="val" style="color:var(--stalled)">${stalledCount}</span></div>
          <div class="persona-stat"><span class="text-muted text-sm">Avg Pressure</span><span class="val ${avgCls}">${avgPressure}</span></div>
          <div class="persona-stat"><span class="text-muted text-sm">Pressure Level</span><span class="val">${OAD.esc(pressureLevel)}</span></div>
          <div class="persona-stat"><span class="text-muted text-sm">Hard Deadline</span><span class="val">${OAD.esc(hardDeadlineStr)}</span></div>
          <div style="margin-left:auto">
            <button class="ghost" style="font-size:12px;padding:5px 10px" onclick="OAD.openPersonaModal()">Edit Persona</button>
          </div>
        </div>
      </div>

      <div class="list-tab-toolbar">
        <input type="text" id="list-tab-search" placeholder="Search tasks by title or life area…" value="${OAD.esc(OAD._activeListSearch)}" oninput="OAD.filterListTab()">
        <select id="list-tab-status" onchange="OAD.filterListTab()">
          ${statusOptions}
        </select>
        <button onclick="OAD.openNewThreadModal()">+ New Thread</button>
      </div>

      <div id="list-tab-threads" class="list-tab-grid"></div>
    </div>
  `;

  OAD.filterListTab();
};

OAD.filterListTab = function () {
  const searchInput = document.getElementById('list-tab-search');
  const statusSelect = document.getElementById('list-tab-status');
  
  if (searchInput) OAD._activeListSearch = searchInput.value;
  if (statusSelect) OAD._activeListStatus = statusSelect.value;

  const query = (OAD._activeListSearch || '').toLowerCase();
  const statusFilter = OAD._activeListStatus || 'all';

  const cycles = OAD.detectCycles();
  const cycleThreadIds = new Set(cycles.flat());

  const threads = OAD.getVisibleThreads()
    .filter(t => {
      const matchesSearch = !query || (t.title || '').toLowerCase().includes(query) || (t.life_area || '').toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .map(t => ({ ...t, _score: OAD.pressure(t) }))
    .sort((a, b) => b._score - a._score);

  const container = document.getElementById('list-tab-threads');
  if (!container) return;

  if (!threads.length) {
    container.innerHTML = '<div class="detail-empty" style="grid-column:1/-1; padding:48px; text-align:center;">No tasks found matching current filters.</div>';
    return;
  }

  container.innerHTML = threads.map(t => {
    const pc = OAD.pressureClass(t._score);
    const ds = t.deadline ? OAD.deadlineState(t) : null;
    const atRisk = ds && !ds.onTrack;
    
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

    const inCycle = cycleThreadIds.has(t.id);
    const cycleBadge = inCycle 
      ? `<span class="cycle-warning-badge" style="cursor: pointer;" title="Click to resolve circular dependency" onclick="event.stopPropagation(); OAD.openCycleResolutionModal(${t.id})">🔄 Cycle</span>` 
      : '';

    return `
      <div class="list-tab-card" onclick="OAD.selectThread(${t.id})">
        <div class="list-tab-card-header">
          <div class="list-tab-card-title">${OAD.esc(OAD.formatDisplayTitle(t.title))}</div>
          <div class="pressure-badge ${pc}">${t._score}</div>
        </div>
        <div class="list-tab-card-meta">
          <span class="pill ${OAD.esc(t.status)}">${OAD.esc(t.status)}</span>
          <span class="pill ${OAD.esc(t.priority)}">${OAD.esc(t.priority)}</span>
          <span>${OAD.esc(t.life_area)}</span>
          ${cycleBadge}
        </div>
        ${deadlineLineHtml ? `<div style="margin-top: 4px;">${deadlineLineHtml}</div>` : ''}
        <div class="list-tab-card-footer">
          <span>Next: ${t.next_action ? OAD.esc(t.next_action) : '<span class="text-muted">None</span>'}</span>
          <span>${t.next_action_date ? OAD.esc(OAD.formatDate(t.next_action_date)) : ''}</span>
        </div>
      </div>
    `;
  }).join('');
};
