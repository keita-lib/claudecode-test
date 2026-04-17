import { initDB, getAllProjects, getAllTasks, saveProject, saveTask, deleteTask, deleteProject, exportData, importData } from './db.js';
import { VoiceRecorder, parseDeadline, extractUrls, extractProject, isUndecided } from './voice.js';

const STAGES = [
  { key: 'todo',    label: '未着手',   badge: 'badge-stage-todo' },
  { key: 'doing',   label: '着手中',   badge: 'badge-stage-doing' },
  { key: 'waiting', label: '確認待ち', badge: 'badge-stage-waiting' },
  { key: 'done',    label: '完了',     badge: 'badge-stage-done' },
];

let projects = [];
let tasks = [];
let currentTab = 'all';
let expandedProjects = new Set();
let expandedTasks = new Set();
let settings = loadSettings();

// ─── Init ────────────────────────────────────────

async function init() {
  await initDB();
  [projects, tasks] = await Promise.all([getAllProjects(), getAllTasks()]);

  window.addEventListener('storage-not-persistent', () => {
    document.getElementById('storage-warning').classList.add('show');
  });

  renderTabs();
  renderTasks();
  setupVoice();
  setupEventListeners();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ─── Settings ────────────────────────────────────

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('settings') || '{}');
  } catch { return {}; }
}

function saveSettings(s) {
  settings = s;
  localStorage.setItem('settings', JSON.stringify(s));
}

// ─── Tabs ────────────────────────────────────────

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';

  const allBtn = makeTab('all', '全件');
  tabs.appendChild(allBtn);

  for (const p of projects) {
    tabs.appendChild(makeTab(String(p.id), p.name));
  }
}

function makeTab(id, label) {
  const btn = document.createElement('button');
  btn.className = 'tab' + (currentTab === id ? ' active' : '');
  btn.textContent = label;
  btn.dataset.tab = id;
  btn.addEventListener('click', () => {
    currentTab = id;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    renderTasks();
  });
  return btn;
}

// ─── Task list ───────────────────────────────────

function renderTasks() {
  const list = document.getElementById('task-list');
  list.innerHTML = '';

  const filteredProjects = currentTab === 'all'
    ? projects
    : projects.filter(p => String(p.id) === currentTab);

  let anyTask = false;

  for (const proj of filteredProjects) {
    const projTasks = tasks.filter(t => t.projectId === proj.id);
    if (projTasks.length === 0 && currentTab !== 'all') continue;
    anyTask = true;

    const group = document.createElement('div');
    group.className = 'project-group';

    const isOpen = expandedProjects.has(proj.id);
    const header = document.createElement('div');
    header.className = 'project-header' + (isOpen ? ' open' : '');
    header.innerHTML = `
      <svg class="project-chevron" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path fill-rule="evenodd" d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"/>
      </svg>
      <span class="project-name">📁 ${esc(proj.name)}</span>
      <span class="project-count">${projTasks.filter(t => t.stage !== 'done').length}件</span>
    `;

    const items = document.createElement('div');
    items.className = 'task-items';
    items.style.display = isOpen ? 'block' : 'none';

    header.addEventListener('click', () => {
      const open = !expandedProjects.has(proj.id);
      open ? expandedProjects.add(proj.id) : expandedProjects.delete(proj.id);
      header.classList.toggle('open', open);
      items.style.display = open ? 'block' : 'none';
    });

    for (const task of projTasks) {
      items.appendChild(renderTaskItem(task));
    }

    group.appendChild(header);
    group.appendChild(items);
    list.appendChild(group);
  }

  // Tasks with no project
  const orphans = tasks.filter(t => !t.projectId && (currentTab === 'all'));
  if (orphans.length) {
    anyTask = true;
    const group = document.createElement('div');
    group.className = 'project-group';
    const header = document.createElement('div');
    header.className = 'project-header open';
    header.innerHTML = `
      <svg class="project-chevron" style="transform:rotate(90deg)" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
        <path fill-rule="evenodd" d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"/>
      </svg>
      <span class="project-name">📋 未分類</span>
      <span class="project-count">${orphans.length}件</span>
    `;
    const items = document.createElement('div');
    items.className = 'task-items';
    for (const task of orphans) items.appendChild(renderTaskItem(task));
    group.appendChild(header);
    group.appendChild(items);
    list.appendChild(group);
  }

  if (!anyTask) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🎤</div>
        <p>マイクボタンを押して<br>タスクを話しかけてください</p>
      </div>`;
  }
}

function deadlineBadge(task) {
  if (!task.deadline) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(task.deadline);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return { cls: 'badge-overdue', label: `${Math.abs(diff)}日超過` };
  if (diff <= 3) return { cls: 'badge-soon',   label: `${diff}日後` };
  return { cls: 'badge-ok', label: formatDate(d) };
}

function renderTaskItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item' + (task.stage === 'done' ? ' done' : '');
  item.dataset.id = task.id;

  const stage = STAGES.find(s => s.key === (task.stage || 'todo'));
  const db = deadlineBadge(task);
  const isExpanded = expandedTasks.has(task.id);

  item.innerHTML = `
    <div class="task-row1">
      <div class="task-check ${task.stage === 'done' ? 'checked' : ''}" data-check></div>
      <span class="task-title">${esc(task.title)}${task.provisional ? ' <span class="badge badge-provisional">(仮)</span>' : ''}</span>
      <div class="task-badges">
        <span class="badge ${stage.badge}">${stage.label}</span>
        ${db ? `<span class="badge ${db.cls}">${db.label}</span>` : ''}
      </div>
    </div>
    ${task.nextAction ? `<div class="task-next-action">${esc(task.nextAction)}</div>` : ''}
    <div class="task-detail ${isExpanded ? 'open' : ''}">
      <div class="detail-section">
        <div class="detail-label">ステージ</div>
        <div class="stage-selector">
          ${STAGES.map(s => `<button class="stage-btn ${(task.stage||'todo')===s.key?'active':''}" data-stage="${s.key}">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-label">次のアクション</div>
        <input class="form-input next-action-input" type="text" value="${esc(task.nextAction || '')}" placeholder="例: 先方にメールで確認する">
      </div>
      <div class="detail-section">
        <div class="detail-label">📎 関連資料・URL</div>
        <ul class="ref-list" data-refs>
          ${(task.refs || []).map((r, i) => refItem(r, i)).join('')}
        </ul>
        <button class="detail-add-btn" data-add-url>+ URLを追加</button>
      </div>
      <div class="detail-section">
        <div class="detail-label">📝 備考</div>
        <textarea class="form-textarea memo-input" rows="2" placeholder="メモを入力...">${esc(task.memo || '')}</textarea>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn btn-secondary" data-edit-task>編集</button>
        <button class="btn btn-danger" data-delete-task style="flex:0;padding:12px 16px">🗑</button>
      </div>
    </div>
  `;

  // toggle detail panel
  item.querySelector('.task-row1').addEventListener('click', (e) => {
    if (e.target.closest('[data-check]')) return;
    const open = !expandedTasks.has(task.id);
    open ? expandedTasks.add(task.id) : expandedTasks.delete(task.id);
    item.querySelector('.task-detail').classList.toggle('open', open);
  });

  // check toggle
  item.querySelector('[data-check]').addEventListener('click', async (e) => {
    e.stopPropagation();
    task.stage = task.stage === 'done' ? 'todo' : 'done';
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
    renderTasks();
  });

  // stage buttons
  item.querySelectorAll('[data-stage]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      task.stage = btn.dataset.stage;
      await saveTask(task);
      tasks = tasks.map(t => t.id === task.id ? task : t);
      renderTasks();
    });
  });

  // next action input
  const naInput = item.querySelector('.next-action-input');
  naInput.addEventListener('change', async () => {
    task.nextAction = naInput.value.trim();
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
  });
  naInput.addEventListener('click', e => e.stopPropagation());

  // memo
  const memoInput = item.querySelector('.memo-input');
  memoInput.addEventListener('change', async () => {
    task.memo = memoInput.value.trim();
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
  });
  memoInput.addEventListener('click', e => e.stopPropagation());

  // add URL
  item.querySelector('[data-add-url]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = prompt('URLまたはファイル名を入力:');
    if (!url) return;
    task.refs = task.refs || [];
    task.refs.push(url.trim());
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
    renderTasks();
    expandedTasks.add(task.id);
  });

  // delete ref
  item.querySelectorAll('[data-del-ref]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      task.refs.splice(parseInt(btn.dataset.delRef), 1);
      await saveTask(task);
      tasks = tasks.map(t => t.id === task.id ? task : t);
      renderTasks();
      expandedTasks.add(task.id);
    });
  });

  // edit
  item.querySelector('[data-edit-task]').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditDialog(task);
  });

  // delete
  item.querySelector('[data-delete-task]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    await deleteTask(task.id);
    tasks = tasks.filter(t => t.id !== task.id);
    renderTasks();
  });

  return item;
}

function refItem(ref, i) {
  const isUrl = /^https?:\/\//.test(ref);
  return `<li class="ref-item">
    ${isUrl ? `🔗 <a href="${esc(ref)}" target="_blank" rel="noopener">${esc(ref)}</a>` : `📄 ${esc(ref)}`}
    <button class="icon-btn" data-del-ref="${i}" title="削除" style="width:24px;height:24px;margin-left:auto">✕</button>
  </li>`;
}

// ─── Voice ───────────────────────────────────────

let recorder;
let interimText = '';
let finalText = '';

function setupVoice() {
  recorder = new VoiceRecorder({
    onResult: (text, isFinal) => {
      interimText = text;
      const el = document.getElementById('interim-display');
      if (el) el.textContent = text;
      if (isFinal) {
        finalText = text;
        interimText = '';
      }
    },
    onError: (err) => {
      alert('音声認識エラー: ' + err);
      stopRecording();
    },
  });
}

function startRecording() {
  finalText = '';
  interimText = '';
  document.getElementById('mic-fab').classList.add('recording');
  document.getElementById('voice-wave').classList.add('show');
  recorder.start();
}

function stopRecording() {
  recorder.stop();
  document.getElementById('mic-fab').classList.remove('recording');
  document.getElementById('voice-wave').classList.remove('show');

  const text = (finalText || interimText).trim();
  if (text) openVoiceDialog(text);
}

// ─── Voice dialog ─────────────────────────────────

function openVoiceDialog(text) {
  const urls = extractUrls(text);
  const deadline = parseDeadline(text);
  const projName = extractProject(text);

  const overlay = document.getElementById('voice-overlay');
  overlay.classList.add('open');

  document.getElementById('vd-text').value = text;

  const vdProj = document.getElementById('vd-project');
  vdProj.innerHTML = '<option value="">未分類</option>' +
    projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const matchedProj = projName ? projects.find(p => p.name === projName) : null;
  vdProj.value = matchedProj ? matchedProj.id : '';

  const deadlineInput = document.getElementById('vd-deadline');
  const deadlineSection = document.getElementById('vd-deadline-section');
  const undecidedSection = document.getElementById('vd-undecided-section');

  if (deadline) {
    deadlineInput.value = toInputDate(deadline);
    deadlineSection.style.display = 'block';
    undecidedSection.style.display = 'none';
  } else {
    deadlineSection.style.display = 'none';
    undecidedSection.style.display = 'block';
    setSuggestedDeadline();
  }

  document.getElementById('vd-urls').innerHTML = urls.map(u =>
    `<div style="font-size:13px;color:var(--primary-light);margin-bottom:4px">🔗 ${esc(u)}</div>`
  ).join('');

  window._pendingUrls = urls;
}

function setSuggestedDeadline() {
  const days = parseInt(settings.defaultDeadlineDays || 14);
  const d = new Date();
  d.setDate(d.getDate() + days);
  document.getElementById('vd-suggested').textContent =
    `提案: ${formatDate(d)}（${days}日後）`;
  document.getElementById('vd-suggested-date').value = toInputDate(d);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});

function setupEventListeners() {
  // Mic FAB
  const fab = document.getElementById('mic-fab');
  let touching = false;
  fab.addEventListener('touchstart', () => { touching = true; startRecording(); });
  fab.addEventListener('touchend', () => { touching = false; stopRecording(); });
  fab.addEventListener('click', () => {
    if (touching) return;
    if (recorder.active) stopRecording(); else startRecording();
  });

  // Voice dialog
  document.getElementById('vd-use-suggested').addEventListener('click', () => {
    const date = document.getElementById('vd-suggested-date').value;
    document.getElementById('vd-deadline').value = date;
    document.getElementById('vd-deadline-section').style.display = 'block';
    document.getElementById('vd-undecided-section').style.display = 'none';
  });

  document.getElementById('vd-save').addEventListener('click', saveVoiceTask);
  document.getElementById('vd-cancel').addEventListener('click', () => {
    document.getElementById('voice-overlay').classList.remove('open');
  });

  // Edit dialog
  document.getElementById('ed-save').addEventListener('click', saveEditTask);
  document.getElementById('ed-cancel').addEventListener('click', () => {
    document.getElementById('edit-overlay').classList.remove('open');
  });

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('task-view').style.display = 'none';
    const ss = document.getElementById('settings-screen');
    ss.classList.add('show');
    document.getElementById('settings-email').value = settings.email || '';
    document.getElementById('settings-days').value = settings.defaultDeadlineDays || 14;
  });

  document.getElementById('settings-save').addEventListener('click', () => {
    saveSettings({
      email: document.getElementById('settings-email').value.trim(),
      defaultDeadlineDays: parseInt(document.getElementById('settings-days').value) || 14,
    });
    document.getElementById('settings-screen').classList.remove('show');
    document.getElementById('task-view').style.display = '';
    alert('設定を保存しました');
  });

  document.getElementById('settings-back').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.remove('show');
    document.getElementById('task-view').style.display = '';
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', async () => {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-${toInputDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Email
  document.getElementById('btn-email').addEventListener('click', sendEmail);

  // Import
  document.getElementById('settings-import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importData(text);
      [projects, tasks] = await Promise.all([getAllProjects(), getAllTasks()]);
      renderTabs();
      renderTasks();
      alert('インポートしました');
    } catch {
      alert('インポートに失敗しました。ファイルを確認してください。');
    }
    e.target.value = '';
  });
}

// ─── Save from voice dialog ───────────────────────

async function saveVoiceTask() {
  const title = document.getElementById('vd-text').value.trim();
  if (!title) { alert('タスク名を入力してください'); return; }

  const deadlineVal = document.getElementById('vd-deadline').value;
  if (!deadlineVal) { alert('期限を設定してください'); return; }

  let projectId = parseInt(document.getElementById('vd-project').value) || null;
  const newProjName = document.getElementById('vd-new-project').value.trim();

  if (newProjName) {
    const id = await saveProject({ name: newProjName });
    projects = await getAllProjects();
    projectId = id;
    renderTabs();
  }

  const provisional = document.getElementById('vd-undecided-section').style.display !== 'none'
    ? true
    : false;

  const task = {
    title,
    projectId,
    deadline: deadlineVal,
    provisional,
    stage: 'todo',
    refs: [...(window._pendingUrls || [])],
    nextAction: '',
    memo: '',
    createdAt: new Date().toISOString(),
  };

  const id = await saveTask(task);
  task.id = id;
  tasks.push(task);

  if (projectId) expandedProjects.add(projectId);

  renderTasks();
  document.getElementById('voice-overlay').classList.remove('open');
}

// ─── Edit dialog ─────────────────────────────────

function openEditDialog(task) {
  document.getElementById('edit-overlay').classList.add('open');
  document.getElementById('ed-id').value = task.id;
  document.getElementById('ed-title').value = task.title;
  document.getElementById('ed-deadline').value = task.deadline || '';
  document.getElementById('ed-next-action').value = task.nextAction || '';
  document.getElementById('ed-memo').value = task.memo || '';

  const sel = document.getElementById('ed-project');
  sel.innerHTML = '<option value="">未分類</option>' +
    projects.map(p => `<option value="${p.id}" ${task.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

async function saveEditTask() {
  const id = parseInt(document.getElementById('ed-id').value);
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  task.title = document.getElementById('ed-title').value.trim();
  task.deadline = document.getElementById('ed-deadline').value;
  task.nextAction = document.getElementById('ed-next-action').value.trim();
  task.memo = document.getElementById('ed-memo').value.trim();
  task.projectId = parseInt(document.getElementById('ed-project').value) || null;

  if (!task.title) { alert('タスク名を入力してください'); return; }
  if (!task.deadline) { alert('期限を設定してください'); return; }

  await saveTask(task);
  tasks = tasks.map(t => t.id === id ? task : t);
  renderTasks();
  document.getElementById('edit-overlay').classList.remove('open');
}

// ─── Email ───────────────────────────────────────

function sendEmail() {
  const to = settings.email || '';
  const today = formatDate(new Date());
  const subject = encodeURIComponent(`【タスク一覧】${today}`);

  let body = `タスク一覧 (${today})\n\n`;

  for (const proj of projects) {
    const pt = tasks.filter(t => t.projectId === proj.id && t.stage !== 'done');
    if (!pt.length) continue;
    body += `■ ${proj.name}\n`;
    for (const t of pt) {
      const stage = STAGES.find(s => s.key === (t.stage || 'todo')).label;
      const deadline = t.deadline ? `〆${formatDate(new Date(t.deadline))}` : '';
      const prov = t.provisional ? '(仮)' : '';
      body += `  ・${t.title} [${stage}] ${deadline}${prov}\n`;
      if (t.nextAction) body += `    → ${t.nextAction}\n`;
      for (const r of (t.refs || [])) body += `    📎 ${r}\n`;
      if (t.memo) body += `    📝 ${t.memo}\n`;
    }
    body += '\n';
  }

  const orphans = tasks.filter(t => !t.projectId && t.stage !== 'done');
  if (orphans.length) {
    body += '■ 未分類\n';
    for (const t of orphans) {
      const stage = STAGES.find(s => s.key === (t.stage || 'todo')).label;
      body += `  ・${t.title} [${stage}]\n`;
    }
  }

  window.location.href = `mailto:${to}?subject=${subject}&body=${encodeURIComponent(body)}`;
}

// ─── Helpers ─────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function toInputDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
