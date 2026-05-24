// main.js — Minime Dashboard frontend logic
// All user-sourced text is rendered with textContent (never innerHTML).

const api = window.copilot;

// ── DOM refs ──

const selector = document.getElementById('project-selector');
const refreshBtn = document.getElementById('refresh-btn');
const tasksList = document.getElementById('tasks-list');
const wikiList = document.getElementById('wiki-list');
const actionsList = document.getElementById('actions-list');
const statusBar = document.getElementById('status-bar');
const onboarding = document.getElementById('onboarding');
const onboardingMsg = document.getElementById('onboarding-message');
const dashboardPanels = document.getElementById('dashboard-panels');

// ── State ──

let currentOrg = null;
let currentRepo = null;

// ── Helpers ──

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

function setStatus(msg) {
  statusBar.textContent = msg;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function emptyState(msg) {
  return el('div', { className: 'empty-state' }, [msg]);
}

function statusBadge(status) {
  const s = (status || 'unknown').toLowerCase();
  let cls = 'badge ';
  if (['done', 'implemented', 'merged'].includes(s)) cls += 'badge-done';
  else if (['planning'].includes(s)) cls += 'badge-planning';
  else if (['in_progress', 'implementing'].includes(s)) cls += 'badge-progress';
  else if (['blocked'].includes(s)) cls += 'badge-blocked';
  else cls += 'badge-stale';
  return el('span', { className: cls }, [s]);
}

function progressBar(done, total) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = el('div', { className: 'progress-bar' }, [
    el('div', { className: 'fill', style: `width: ${pct}%` }),
  ]);
  return bar;
}

// ── Rendering ──

function renderTasks(tasks) {
  clearChildren(tasksList);
  if (!tasks || tasks.length === 0) {
    tasksList.appendChild(emptyState('No tasks found'));
    return;
  }
  // Sort by date descending
  const sorted = [...tasks].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  for (const task of sorted) {
    const icon = el('span', { className: 'icon' }, [task.statusIcon || '📄']);
    const title = el('div', { className: 'title' }, [task.shortName || task.fileName || 'Untitled']);
    const done = task.checkedCriteria ?? task.criteriaDone ?? 0;
    const total = task.totalCriteria ?? task.criteriaTotal ?? 0;
    const meta = el('div', { className: 'meta' }, [
      `${task.date || 'no date'} · ${done}/${total} criteria`,
    ]);
    const details = el('div', { className: 'details' }, [title, meta]);
    const badge = statusBadge(task.status);
    const bar = progressBar(done, total);

    const card = el('div', { className: 'card' }, [icon, details, bar, badge]);
    tasksList.appendChild(card);
  }
}

function renderWiki(entries) {
  clearChildren(wikiList);
  if (!entries || entries.length === 0) {
    wikiList.appendChild(emptyState('No wiki entries found'));
    return;
  }
  for (const entry of entries) {
    const icon = el('span', { className: 'icon' }, ['📝']);
    const title = el('div', { className: 'title' }, [entry.name || 'Untitled']);
    const ruleParts = [];
    if (entry.rule) ruleParts.push(entry.rule.slice(0, 80) + (entry.rule.length > 80 ? '…' : ''));
    if (entry.scope) ruleParts.push(`📁 ${entry.scope}`);
    const meta = el('div', { className: 'meta' }, [
      ruleParts.join(' · ') || 'No rule text',
    ]);
    const details = el('div', { className: 'details' }, [title, meta]);
    const badge = el('span', {
      className: `badge ${entry.status === 'active' ? 'badge-active' : 'badge-stale'}`,
    }, [entry.status || 'unknown']);

    const card = el('div', { className: 'card' }, [icon, details, badge]);
    wikiList.appendChild(card);
  }
}

function typeIcon(type) {
  switch (type) {
    case 'url': return '🔗';
    case 'clear': return '🗑️';
    case 'command': return '⚙️';
    case 'script': return '▶️';
    default: return '▶️';
  }
}

function typeLabel(type) {
  switch (type) {
    case 'url': return 'Open';
    case 'clear': return 'Clear';
    case 'command': return 'Run';
    case 'script': return 'Run';
    default: return 'Run';
  }
}

function renderActions(actions) {
  clearChildren(actionsList);
  if (!actions || actions.length === 0) {
    actionsList.appendChild(emptyState('No actions discovered'));
    return;
  }

  // Pinned first, then allowed, then rest
  const sorted = [...actions].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const action of sorted) {
    const icon = el('span', { className: 'icon' }, [action.pinned ? '⭐' : typeIcon(action.type)]);
    const title = el('div', { className: 'title' }, [action.name]);
    const desc = action.type === 'url' ? action.url
      : action.type === 'clear' ? `Clear: ${(action.paths || []).join(', ')}`
      : action.type === 'command' ? (action.command || []).join(' ')
      : action.source ? `${action.source} · ${action.script || action.name}`
      : action.name;
    const bgTag = action.background ? ' [bg]' : '';
    const meta = el('div', { className: 'meta' }, [`${action.type || 'script'} · ${desc}${bgTag}`]);
    const details = el('div', { className: 'details' }, [title, meta]);

    let btn;
    if (action.type === 'clear' && action.allowed) {
      btn = el('button', {
        className: 'action-btn action-clear',
        onClick: () => confirmThenExecute(action.name, 'Clear these paths?'),
      }, ['Clear']);
    } else if (action.allowed) {
      btn = el('button', {
        className: 'action-btn',
        onClick: () => executeAction(action.name),
      }, [typeLabel(action.type)]);
    } else {
      btn = el('button', { className: 'action-btn read-only', disabled: 'true' }, ['Locked']);
    }

    const card = el('div', { className: 'card' }, [icon, details, btn]);
    actionsList.appendChild(card);
  }

  // Background processes section
  renderBackgroundProcesses();
}

async function renderBackgroundProcesses() {
  try {
    const procs = await api.getBackgroundProcesses();
    if (!procs || procs.length === 0) return;

    const header = el('div', { className: 'section-header' }, ['Background Processes']);
    actionsList.appendChild(header);

    for (const proc of procs) {
      const icon = el('span', { className: 'icon' }, [proc.running ? '🔄' : '⏹️']);
      const title = el('div', { className: 'title' }, [proc.id]);
      const status = proc.running ? 'running' : `exited (${proc.exitCode})`;
      const meta = el('div', { className: 'meta' }, [`PID ${proc.pid} · ${status}`]);
      const details = el('div', { className: 'details' }, [title, meta]);

      const viewBtn = el('button', {
        className: 'action-btn',
        onClick: () => viewProcessOutput(proc.id),
      }, ['View']);

      const children = [icon, details, viewBtn];

      if (proc.running) {
        const stopBtn = el('button', {
          className: 'action-btn action-clear',
          onClick: () => stopProcess(proc.id),
        }, ['Stop']);
        children.push(stopBtn);
      }

      const card = el('div', { className: 'card' }, children);
      actionsList.appendChild(card);
    }
  } catch {
    // Non-fatal — background process info is supplementary
  }
}

async function viewProcessOutput(id) {
  try {
    const data = await api.getProcessOutput(id);
    showOutputModal(id, {
      success: data.exitCode === 0 || data.running,
      stdout: data.output || 'No output yet',
      exitCode: data.exitCode,
    });
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function stopProcess(id) {
  try {
    await api.stopProcess(id);
    setStatus(`Stopped ${id}`);
    if (currentOrg && currentRepo) loadProjectData(currentOrg, currentRepo);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

function confirmThenExecute(name, message) {
  const overlay = el('div', { className: 'modal-overlay' });
  const cancelBtn = el('button', {
    className: 'action-btn',
    onClick: () => overlay.remove(),
  }, ['Cancel']);
  const confirmBtn = el('button', {
    className: 'action-btn action-clear',
    onClick: () => { overlay.remove(); executeAction(name); },
  }, ['Confirm']);
  const body = el('div', { className: 'modal-body' });
  body.textContent = message;
  const footer = el('div', { className: 'modal-footer' }, [cancelBtn, confirmBtn]);
  const modal = el('div', { className: 'modal' }, [
    el('div', { className: 'modal-header' }, [el('h3', {}, [`⚠️ ${name}`])]),
    body, footer,
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Actions ──

async function executeAction(name) {
  if (!currentOrg || !currentRepo) return;
  setStatus(`Running ${name}…`);
  try {
    const result = await api.runAction(currentOrg, currentRepo, name);
    if (result.message) {
      setStatus(`✅ ${result.message}`);
    } else if (result.pid) {
      setStatus(`✅ ${name} started (PID ${result.pid})`);
      // Refresh to show in background processes
      if (currentOrg && currentRepo) loadProjectData(currentOrg, currentRepo);
    } else if (result.results) {
      // Clear action results
      const ok = result.results.filter(r => r.deleted).length;
      const fail = result.results.filter(r => !r.deleted).length;
      setStatus(fail === 0 ? `✅ Cleared ${ok} path(s)` : `⚠️ ${ok} cleared, ${fail} failed`);
    } else {
      showOutputModal(name, result);
      setStatus(result.success ? `✅ ${name} completed` : `❌ ${name} failed (exit ${result.exitCode})`);
    }
  } catch (err) {
    setStatus(`❌ Error: ${err.message}`);
  }
}

function showOutputModal(actionName, result) {
  const overlay = el('div', { className: 'modal-overlay', onClick: (e) => {
    if (e.target === overlay) overlay.remove();
  }});
  const closeBtn = el('button', { className: 'modal-close', onClick: () => overlay.remove() }, ['✕']);
  const header = el('div', { className: 'modal-header' }, [
    el('h3', {}, [`${result.success ? '✅' : '❌'} ${actionName}`]),
    closeBtn,
  ]);
  const body = el('div', { className: 'modal-body' });
  // textContent only — safe against XSS
  body.textContent = [
    result.stdout ? `STDOUT:\n${result.stdout}` : '',
    result.stderr ? `STDERR:\n${result.stderr}` : '',
    result.error || '',
  ].filter(Boolean).join('\n\n') || 'No output';

  const modal = el('div', { className: 'modal' }, [header, body]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Data loading ──

async function loadProjects() {
  setStatus('Loading projects…');
  try {
    const projects = await api.getProjects();
    clearChildren(selector);

    if (!projects || projects.length === 0) {
      // Show onboarding
      const info = await api.getOnboardingInfo();
      onboardingMsg.textContent = info.message;
      onboarding.classList.remove('hidden');
      dashboardPanels.classList.add('hidden');
      setStatus('No minime data found');
      return;
    }

    onboarding.classList.add('hidden');
    dashboardPanels.classList.remove('hidden');

    // "All Projects" option
    const allOpt = el('option', { value: '__all' }, ['🌐 All Projects']);
    selector.appendChild(allOpt);

    for (const p of projects) {
      const opt = el('option', { value: `${p.org}/${p.repo}` }, [
        `${p.org}/${p.repo} (${p.taskCount}T / ${p.wikiCount}W)`,
      ]);
      selector.appendChild(opt);
    }

    selector.value = '__all';
    await loadScopeData();
    setStatus('Ready');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function loadScopeData() {
  const val = selector.value;
  if (val === '__all' || val === '__loading') {
    currentOrg = null;
    currentRepo = null;
    await loadAllData();
  } else {
    const [org, repo] = val.split('/');
    currentOrg = org;
    currentRepo = repo;
    await loadProjectData(org, repo);
  }
}

async function loadAllData() {
  setStatus('Loading all projects…');
  try {
    const data = await api.getAllData();
    renderTasks(data.tasks);
    renderWiki(data.wikiEntries);
    renderActions([]); // No actions in all-projects view
    setStatus(`${data.tasks.length} tasks, ${data.wikiEntries.length} wiki entries`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function loadProjectData(org, repo) {
  setStatus(`Loading ${org}/${repo}…`);
  try {
    const data = await api.getProjectData(org, repo);
    renderTasks(data.tasks);
    renderWiki(data.wikiEntries);
    renderActions(data.actions);
    setStatus(`${data.tasks.length} tasks, ${data.wikiEntries.length} wiki, ${data.actions.length} actions`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

// ── Events ──

selector.addEventListener('change', loadScopeData);
refreshBtn.addEventListener('click', () => loadProjects());

// ── Init ──

loadProjects();
