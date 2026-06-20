window.OAD = window.OAD || {};

OAD._demoClients = null;

OAD.loadDemoCsv = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map(h => h.trim());
    const clients = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < headers.length) continue;
      clients.push({
        name: parts[0],
        counselor: parts[1],
        projected_days: parseInt(parts[2]) || 0,
        total_planned_days: parseInt(parts[3]) || 0,
        check_in_date: parts[4],
        first_paperwork_due_date: parts[5],
        first_paperwork_completed_date: parts[6],
        checkout_date: parts[9],
        checkout_type: parts[10],
        total_stay_days: parseInt(parts[11]) || 0,
        notes: parts[12] || ''
      });
    }
    OAD._demoClients = clients;
    OAD.renderCommandCenter();
  };
  reader.readAsText(file);
};

OAD.maskName = function(fullName, role) {
  if (role && role.startsWith('Counselor')) return fullName; // Counselors see full names
  if (!fullName) return "***";
  const parts = fullName.split(' ');
  if (parts.length === 1) return parts[0].substring(0, 3) + "***";
  return parts[0] + ' ' + parts[parts.length-1].substring(0, 2) + "*****";
};

OAD._demoRole = 'CCO';
OAD.changeDemoRole = function(role) {
  OAD._demoRole = role;
  OAD.renderCommandCenter();
};

OAD.renderCommandCenter = function () {
  OAD._lastView = 'CommandCenter';
  OAD.highlightNav('renderCommandCenter');
  
  const panel = document.getElementById('detail-content');
  if (!panel) return;

  let clients = OAD._demoClients || [];

  if (clients.length === 0) {
    panel.innerHTML = `
      <div class="ds-panel" role="main" style="max-width: 900px; display:flex; flex-direction:column; align-items:center; justify-content:center; height:60vh">
        <h2>No Demo Data Loaded</h2>
        <p style="color:var(--text-muted); margin-bottom:24px">Please upload the demo_clients.csv file to view the Command Center.</p>
        <label class="success" style="cursor:pointer; padding:12px 24px; border-radius:8px; font-weight:600">
          Upload CSV
          <input type="file" accept=".csv" style="display:none" onchange="OAD.loadDemoCsv(event)">
        </label>
      </div>
    `;
    return;
  }

  // Filter based on demo role
  if (OAD._demoRole === 'Director A') {
    clients = clients.filter(c => c.counselor === 'Sarah Jenkins' || c.counselor === 'David Kim');
  } else if (OAD._demoRole === 'Director B') {
    clients = clients.filter(c => c.counselor === 'Emma Clark');
  } else if (OAD._demoRole === 'Counselor Jenkins') {
    clients = clients.filter(c => c.counselor === 'Sarah Jenkins');
  } else if (OAD._demoRole === 'Counselor Kim') {
    clients = clients.filter(c => c.counselor === 'David Kim');
  }

  const dischargedClients = clients.filter(c => c.checkout_type !== 'Active');
  
  let totalPlanned = 0;
  let totalRetained = 0;
  dischargedClients.forEach(c => {
    totalPlanned += c.total_planned_days;
    if (c.checkout_type === 'Standard') {
      totalRetained += c.total_stay_days;
    }
  });
  
  const tryScore = totalPlanned === 0 ? 0 : Math.round((totalRetained / totalPlanned) * 100);
  const tryColor = tryScore >= 80 ? 'var(--success)' : tryScore >= 60 ? 'orange' : 'var(--critical)';

  // Build the counselor breakdown
  const counselors = {};
  dischargedClients.forEach(c => {
    if (!counselors[c.counselor]) counselors[c.counselor] = { planned: 0, retained: 0, aca: 0, bnc: 0, standard: 0 };
    counselors[c.counselor].planned += c.total_planned_days;
    if (c.checkout_type === 'Standard') {
      counselors[c.counselor].retained += c.total_stay_days;
      counselors[c.counselor].standard++;
    } else if (c.checkout_type === 'ACA') {
      counselors[c.counselor].aca++;
    } else if (c.checkout_type === 'BNC') {
      counselors[c.counselor].bnc++;
    }
  });

  const counselorHtml = Object.keys(counselors).map(name => {
    const data = counselors[name];
    const score = Math.round((data.retained / data.planned) * 100);
    const color = score >= 80 ? 'var(--success)' : score >= 60 ? 'orange' : 'var(--critical)';
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px; border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600; font-size:15px; margin-bottom:4px;">${OAD.esc(name)}</div>
          <div style="font-size:12px; color:var(--text-muted)">${data.standard} Standard | ${data.aca} ACA | ${data.bnc} BNC</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px; font-weight:700; color:${color}">${score}%</div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px">TRY Score</div>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="ds-panel" role="main" style="max-width: 900px;">
      <header class="ds-header" style="display:flex; justify-content:space-between; align-items:center">
        <div>
          <h2 style="display:flex; align-items:center; gap:16px; margin-bottom:8px">
            My Team Command Center
            <label class="ghost" style="cursor:pointer; font-size:12px; padding:4px 8px; border:1px solid var(--border); font-weight:normal; border-radius:4px">
              ↻ Load new CSV
              <input type="file" accept=".csv" style="display:none" onchange="OAD.loadDemoCsv(event)">
            </label>
          </h2>
          <div style="display:flex; align-items:center; gap:12px">
            <span class="ds-date" style="margin:0">Demo Role:</span>
            <select style="font-size:13px; padding:4px 8px; border-radius:4px; background:var(--surface2); color:var(--text-main); border:1px solid var(--border)" onchange="OAD.changeDemoRole(this.value)">
              <option value="CCO" ${OAD._demoRole === 'CCO' ? 'selected' : ''}>CCO (All Staff)</option>
              <option value="Director A" ${OAD._demoRole === 'Director A' ? 'selected' : ''}>Director A (Jenkins & Kim)</option>
              <option value="Director B" ${OAD._demoRole === 'Director B' ? 'selected' : ''}>Director B (Clark)</option>
              <option value="Counselor Jenkins" ${OAD._demoRole === 'Counselor Jenkins' ? 'selected' : ''}>Counselor (Sarah Jenkins)</option>
              <option value="Counselor Kim" ${OAD._demoRole === 'Counselor Kim' ? 'selected' : ''}>Counselor (David Kim)</option>
            </select>
          </div>
        </div>
        <div style="background:var(--surface2); padding:12px 24px; border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; align-items:flex-end">
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:700">${OAD._demoRole.startsWith('Counselor') ? 'Personal TRY' : 'Team TRY'}</div>
          <div style="font-size:36px; font-weight:700; color:${tryColor}; line-height:1.2">${tryScore}%</div>
        </div>
      </header>

      ${OAD._demoRole.startsWith('Counselor') ? '' : `
      <div style="margin-top:24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
        <h3 style="margin-top:0; margin-bottom:8px; font-size:18px; display:flex; align-items:center; gap:8px">
          🎯 Targeted Retention Yield (TRY)
        </h3>
        <p style="font-size:14px; color:var(--text-muted); margin-bottom:24px; line-height:1.5;">
          The primary "Moneyball Metric" measuring the percentage of contracted clinical depth successfully retained. 
          Currently tracking <strong>${totalRetained}</strong> retained days out of <strong>${totalPlanned}</strong> planned days across <strong>${dischargedClients.length}</strong> discharges.
        </p>
        <div style="background:var(--surface2); border-radius:12px; overflow:hidden; border:1px solid var(--border)">
          ${counselorHtml}
        </div>
      </div>
      `}

      <div style="margin-top:24px; padding:24px; background:var(--surface); border:1px solid var(--border); border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h3 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px">
            🛡️ Active Clients
          </h3>
          ${OAD._demoRole.startsWith('Counselor') ? '' : '<span style="font-size:11px; background:var(--surface2); padding:4px 8px; border-radius:4px; color:var(--text-muted); font-weight:600; letter-spacing:0.5px">MINIMUM NECESSARY VIEW</span>'}
        </div>
        
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="text-align:left; border-bottom:1px solid var(--border); color:var(--text-muted)">
            <th style="padding-bottom:12px; font-weight:600">Patient</th>
            <th style="padding-bottom:12px; font-weight:600">Counselor</th>
            <th style="padding-bottom:12px; font-weight:600">Timeline</th>
            <th style="padding-bottom:12px; text-align:right; font-weight:600">Action</th>
          </tr>
          ${clients.filter(c => c.checkout_type === 'Active').map(c => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:16px 0; font-family:var(--mono); color:var(--text-main); font-weight:500">${OAD.esc(OAD.maskName(c.name, OAD._demoRole))}</td>
            <td style="padding:16px 0; color:var(--text-main)">${OAD.esc(c.counselor)}</td>
            <td style="padding:16px 0; color:var(--text-main)">Day ${c.total_stay_days} of ${c.projected_days}</td>
            <td style="padding:16px 0; text-align:right">
              ${OAD._demoRole.startsWith('Counselor') 
                ? `<button class="ghost" style="font-size:12px; padding:6px 12px; color:var(--primary); font-weight:600; border:1px solid rgba(var(--primary-rgb), 0.2)" onclick="alert('Loading clinical workspace for ${OAD.esc(c.name)}... (Full EHR integration arriving in Q3)')">View Details</button>`
                : `<button class="ghost" style="font-size:12px; padding:6px 12px; color:var(--accent); font-weight:600; border:1px solid rgba(var(--accent-rgb), 0.2)" onclick="alert('AUDIT LOG: User broken glass to view record for ${OAD.esc(c.name)}.')">🔓 Break Glass</button>`
              }
            </td>
          </tr>
          `).join('')}
        </table>
      </div>
    </div>
  `;
};
