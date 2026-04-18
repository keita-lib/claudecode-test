import { initDB, getAllProjects, getAllTasks, saveProject, saveTask, deleteTask, exportData, importData } from './db.js';
import { VoiceRecorder, parseDeadline, extractUrls, extractProject } from './voice.js';
import { decomposeTask } from './gemini.js';

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
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', () => init().catch(console.error));

// ─── Settings ────────────────────────────────────

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('settings') || '{}'); }
  catch { return {}; }
}

function saveSettings(s) {
  settings = s;
  localStorage.setItem('settings', JSON.stringify(s));
}

// ─── Tabs ────────────────────────────────────────

function renderTabs() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  tabs.appendChild(makeTab('all', '全件'));
  for (const p of projects) tabs.appendChild(makeTab(String(p.id), p.name));
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

  const filteredProjects = currentTab === 'all' ? projects : projects.filter(p => String(p.id) === currentTab);
  let anyTask = false;

  for (const proj of filteredProjects) {
    const projTasks = tasks.filter(t => t.projectId === proj.id);
    if (!projTasks.length) continue;
    anyTask = true;
    list.appendChild(renderProjectGroup(proj, projTasks));
  }

  const orphans = tasks.filter(t => !t.projectId && currentTab === 'all');
  if (orphans.length) {
    anyTask = true;
    list.appendChild(renderProjectGroup(null, orphans));
  }

  if (!anyTask) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">🎤</div>
      <p>マイクボタンで話しかけるか<br>＋ボタンでタスクを追加してください</p>
    </div>`;
  }
}

function renderProjectGroup(proj, projTasks) {
  const group = document.createElement('div');
  group.className = 'project-group';

  const projId = proj ? proj.id : 0;
  const isOpen = expandedProjects.has(projId);

  const header = document.createElement('div');
  header.className = 'project-header' + (isOpen ? ' open' : '');
  header.innerHTML = `
    <svg class="project-chevron" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path fill-rule="evenodd" d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"/>
    </svg>
    <span class="project-name">${proj ? '📁 ' + esc(proj.name) : '📋 未分類'}</span>
    <span class="project-count">${projTasks.filter(t => t.stage !== 'done').length}件</span>
  `;

  const items = document.createElement('div');
  items.className = 'task-items';
  items.style.display = isOpen ? 'block' : 'none';

  header.addEventListener('click', () => {
    const open = !expandedProjects.has(projId);
    open ? expandedProjects.add(projId) : expandedProjects.delete(projId);
    header.classList.toggle('open', open);
    items.style.display = open ? 'block' : 'none';
  });

  for (const task of projTasks) items.appendChild(renderTaskItem(task));
  group.appendChild(header);
  group.appendChild(items);
  return group;
}

function deadlineBadge(task) {
  if (!task.deadline) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(task.deadline);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return { cls: 'badge-overdue', label: `${Math.abs(diff)}日超過` };
  if (diff <= 3) return { cls: 'badge-soon',    label: diff === 0 ? '今日' : `${diff}日後` };
  return { cls: 'badge-ok', label: formatDate(d) };
}

function renderTaskItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item' + (task.stage === 'done' ? ' done' : '');

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
        <div class="detail-label">📋 サブタスク（WBS）</div>
        <ul class="subtask-list">
          ${(task.subtasks || []).map((s, i) => subtaskItem(s, i)).join('')}
        </ul>
        ${settings.geminiApiKey
          ? `<button class="detail-add-btn" data-ai>✨ AIでWBS分解</button>`
          : `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">設定にGemini APIキーを入れるとAI分解が使えます</div>`}
      </div>
      <div class="detail-section">
        <div class="detail-label">📎 関連資料・URL</div>
        <ul class="ref-list">
          ${(task.refs || []).map((r, i) => refItem(r, i)).join('')}
        </ul>
        <button class="detail-add-btn" data-add-url>+ URLを追加</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-secondary" data-edit-task>✏️ 編集</button>
        <button class="btn btn-danger" data-delete-task style="flex:0;padding:12px 16px">🗑</button>
      </div>
    </div>
  `;

  item.querySelector('.task-row1').addEventListener('click', (e) => {
    if (e.target.closest('[data-check]')) return;
    const open = !expandedTasks.has(task.id);
    open ? expandedTasks.add(task.id) : expandedTasks.delete(task.id);
    item.querySelector('.task-detail').classList.toggle('open', open);
  });

  item.querySelector('[data-check]').addEventListener('click', async (e) => {
    e.stopPropagation();
    task.stage = task.stage === 'done' ? 'todo' : 'done';
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
    renderTasks();
  });

  item.querySelectorAll('[data-stage]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      task.stage = btn.dataset.stage;
      await saveTask(task);
      tasks = tasks.map(t => t.id === task.id ? task : t);
      renderTasks();
    });
  });

  item.querySelector('[data-add-url]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = prompt('URLまたはファイル名を入力:');
    if (!url) return;
    task.refs = task.refs || [];
    task.refs.push(url.trim());
    await saveTask(task);
    tasks = tasks.map(t => t.id === task.id ? task : t);
    expandedTasks.add(task.id);
    renderTasks();
  });

  item.querySelectorAll('[data-del-ref]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      task.refs.splice(parseInt(btn.dataset.delRef), 1);
      await saveTask(task);
      tasks = tasks.map(t => t.id === task.id ? task : t);
      expandedTasks.add(task.id);
      renderTasks();
    });
  });

  item.querySelector('[data-edit-task]').addEventListener('click', (e) => {
    e.stopPropagation();
    openTaskDialog(task);
  });

  item.querySelector('[data-delete-task]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    await deleteTask(task.id);
    tasks = tasks.filter(t => t.id !== task.id);
    renderTasks();
  });

  const aiBtn = item.querySelector('[data-ai]');
  if (aiBtn) {
    aiBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      aiBtn.textContent = '✨ AI分析中...';
      aiBtn.disabled = true;
      try {
        const proj = projects.find(p => p.id === task.projectId);
        const result = await decomposeTask({ apiKey: settings.geminiApiKey, title: task.title, projectName: proj?.name, deadline: task.deadline });
        task.subtasks = (result.subtasks || []).map((t, i) => ({ id: i, title: t, done: false }));
        if (result.nextAction) task.nextAction = result.nextAction;
        if (result.improvedTitle && result.improvedTitle !== task.title) {
          if (confirm(`タイトル改善案:\n「${result.improvedTitle}」\n適用しますか？`)) task.title = result.improvedTitle;
        }
        await saveTask(task);
        tasks = tasks.map(t => t.id === task.id ? task : t);
        expandedTasks.add(task.id);
        renderTasks();
        showToast('AI分解が完了しました');
      } catch (err) {
        alert('AI分解エラー: ' + err.message);
        aiBtn.textContent = '✨ AIでWBS分解';
        aiBtn.disabled = false;
      }
    });
  }

  item.querySelectorAll('[data-subtask-check]').forEach(cb => {
    cb.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(cb.dataset.subtaskCheck);
      task.subtasks[idx].done = !task.subtasks[idx].done;
      await saveTask(task);
      tasks = tasks.map(t => t.id === task.id ? task : t);
      expandedTasks.add(task.id);
      renderTasks();
    });
  });

  return item;
}

function subtaskItem(s, i) {
  return `<li class="subtask-item ${s.done ? 'done' : ''}">
    <div class="task-check ${s.done ? 'checked' : ''}" data-subtask-check="${i}"></div>
    <span>${esc(s.title)}</span>
  </li>`;
}

function refItem(ref, i) {
  const isUrl = /^https?:\/\//.test(ref);
  return `<li class="ref-item">
    ${isUrl ? `🔗 <a href="${esc(ref)}" target="_blank" rel="noopener">${esc(ref)}</a>` : `📄 ${esc(ref)}`}
    <button class="icon-btn" data-del-ref="${i}" title="削除" style="width:24px;height:24px;margin-left:auto">✕</button>
  </li>`;
}

// ─── Task Dialog (作成・編集共通) ─────────────────

function openTaskDialog(task = null) {
  const isEdit = !!task;
  document.getElementById('task-dialog-title').textContent = isEdit ? '✏️ タスクを編集' : '📝 タスクを登録';
  document.getElementById('td-save').textContent = isEdit ? '保存' : '登録';
  document.getElementById('td-id').value = task?.id || '';
  document.getElementById('td-title').value = task?.title || '';
  document.getElementById('td-deadline').value = task?.deadline || '';
  document.getElementById('td-next-action').value = task?.nextAction || '';
  document.getElementById('td-memo').value = task?.memo || '';
  document.getElementById('td-new-project').value = '';

  const provisional = task?.provisional || false;
  document.getElementById('td-provisional-note').style.display = provisional ? 'block' : 'none';
  document.getElementById('task-overlay').dataset.provisional = provisional ? '1' : '0';

  const sel = document.getElementById('td-project');
  sel.innerHTML = '<option value="">未分類</option>' +
    projects.map(p => `<option value="${p.id}" ${task?.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

  document.getElementById('voice-wave').classList.remove('show');
  document.getElementById('task-overlay').classList.add('open');
}

function openVoiceDialog(text) {
  openTaskDialog(null);

  document.getElementById('td-title').value = text;

  const deadline = parseDeadline(text);
  if (deadline) {
    document.getElementById('td-deadline').value = toInputDate(deadline);
    document.getElementById('td-provisional-note').style.display = 'none';
    document.getElementById('task-overlay').dataset.provisional = '0';
  }

  const projName = extractProject(text);
  if (projName) {
    const matched = projects.find(p => p.name === projName);
    if (matched) document.getElementById('td-project').value = matched.id;
  }

  const urls = extractUrls(text);
  if (urls.length) document.getElementById('td-memo').value = urls.join('\n');
}

async function saveTaskDialog() {
  const title = document.getElementById('td-title').value.trim();
  if (!title) { showToast('タスク内容を入力してください', 'error'); return; }

  const deadline = document.getElementById('td-deadline').value;
  if (!deadline) { showToast('期限を入力してください（未定なら「未定（仮）」ボタンを押してください）', 'error'); return; }

  const provisional = document.getElementById('task-overlay').dataset.provisional === '1';
  const existingId = parseInt(document.getElementById('td-id').value) || null;

  let projectId = parseInt(document.getElementById('td-project').value) || null;
  const newProjName = document.getElementById('td-new-project').value.trim();
  if (newProjName) {
    const id = await saveProject({ name: newProjName });
    projects = await getAllProjects();
    projectId = id;
    renderTabs();
  }

  const memo = document.getElementById('td-memo').value.trim();
  const refs = memo ? memo.split('\n').map(s => s.trim()).filter(Boolean) : [];

  const taskData = {
    title,
    projectId,
    deadline,
    provisional,
    stage: 'todo',
    nextAction: document.getElementById('td-next-action').value.trim(),
    refs,
    memo: '',
    createdAt: new Date().toISOString(),
  };

  if (existingId) {
    const existing = tasks.find(t => t.id === existingId);
    Object.assign(existing, taskData, { id: existingId, stage: existing.stage, subtasks: existing.subtasks, createdAt: existing.createdAt });
    await saveTask(existing);
    tasks = tasks.map(t => t.id === existingId ? existing : t);
    showToast('タスクを更新しました');
  } else {
    const id = await saveTask(taskData);
    taskData.id = id;
    tasks.push(taskData);
    if (projectId) expandedProjects.add(projectId);
    else expandedProjects.add(0);
    showToast(`「${title}」を登録しました`);
  }

  document.getElementById('task-overlay').classList.remove('open');
  renderTasks();
}

// ─── Voice ───────────────────────────────────────

let recorder;
let interimText = '';
let finalText = '';

function setupVoice() {
  recorder = new VoiceRecorder({
    onResult: (text, isFinal) => {
      interimText = text;
      if (isFinal) { finalText = text; interimText = ''; }
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
  else openTaskDialog(null);
}

// ─── Event listeners ─────────────────────────────

function setupEventListeners() {
  // ＋ ボタン（手動入力）
  document.getElementById('add-fab').addEventListener('click', () => openTaskDialog(null));

  // マイクボタン
  const fab = document.getElementById('mic-fab');
  let touching = false;
  fab.addEventListener('touchstart', (e) => { e.preventDefault(); touching = true; startRecording(); });
  fab.addEventListener('touchend', (e) => { e.preventDefault(); touching = false; stopRecording(); });
  fab.addEventListener('click', () => {
    if (touching) return;
    if (recorder.active) stopRecording(); else startRecording();
  });

  // タスクダイアログ
  document.getElementById('td-save').addEventListener('click', saveTaskDialog);
  document.getElementById('td-cancel').addEventListener('click', () => {
    document.getElementById('task-overlay').classList.remove('open');
  });

  // 未定（仮）ボタン
  document.getElementById('td-undecided').addEventListener('click', () => {
    const days = parseInt(settings.defaultDeadlineDays || 14);
    const d = new Date();
    d.setDate(d.getDate() + days);
    document.getElementById('td-deadline').value = toInputDate(d);
    document.getElementById('td-provisional-note').style.display = 'block';
    document.getElementById('task-overlay').dataset.provisional = '1';
  });

  // 期限を手動で変えたら仮フラグを解除
  document.getElementById('td-deadline').addEventListener('change', () => {
    document.getElementById('td-provisional-note').style.display = 'none';
    document.getElementById('task-overlay').dataset.provisional = '0';
  });

  // 設定
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('task-view').style.display = 'none';
    document.getElementById('settings-screen').classList.add('show');
    document.getElementById('settings-email').value = settings.email || '';
    document.getElementById('settings-days').value = settings.defaultDeadlineDays || 14;
    document.getElementById('settings-gemini-key').value = settings.geminiApiKey || '';
  });

  document.getElementById('settings-save').addEventListener('click', () => {
    saveSettings({
      email: document.getElementById('settings-email').value.trim(),
      defaultDeadlineDays: parseInt(document.getElementById('settings-days').value) || 14,
      geminiApiKey: document.getElementById('settings-gemini-key').value.trim(),
    });
    document.getElementById('settings-screen').classList.remove('show');
    document.getElementById('task-view').style.display = '';
    showToast('設定を保存しました');
  });

  document.getElementById('settings-back').addEventListener('click', () => {
    document.getElementById('settings-screen').classList.remove('show');
    document.getElementById('task-view').style.display = '';
  });

  // エクスポート
  document.getElementById('btn-export').addEventListener('click', async () => {
    const json = await exportData();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `tasks-${toInputDate(new Date())}.json`;
    a.click();
  });

  // メール
  document.getElementById('btn-email').addEventListener('click', sendEmail);

  // インポート
  document.getElementById('settings-import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importData(await file.text());
      [projects, tasks] = await Promise.all([getAllProjects(), getAllTasks()]);
      renderTabs(); renderTasks();
      showToast('インポートしました');
    } catch { alert('インポートに失敗しました'); }
    e.target.value = '';
  });
}

// ─── Email ───────────────────────────────────────

function sendEmail() {
  const to = settings.email || '';
  const today = formatDate(new Date());
  let body = `タスク一覧 (${today})\n\n`;

  for (const proj of projects) {
    const pt = tasks.filter(t => t.projectId === proj.id && t.stage !== 'done');
    if (!pt.length) continue;
    body += `■ ${proj.name}\n`;
    for (const t of pt) {
      const stage = STAGES.find(s => s.key === (t.stage || 'todo')).label;
      body += `  ・${t.title} [${stage}]${t.deadline ? ' 〆' + formatDate(new Date(t.deadline)) : ''}${t.provisional ? '(仮)' : ''}\n`;
      if (t.nextAction) body += `    → ${t.nextAction}\n`;
      for (const r of (t.refs || [])) body += `    📎 ${r}\n`;
    }
    body += '\n';
  }

  const orphans = tasks.filter(t => !t.projectId && t.stage !== 'done');
  if (orphans.length) {
    body += '■ 未分類\n';
    for (const t of orphans) body += `  ・${t.title}\n`;
  }

  window.location.href = `mailto:${to}?subject=${encodeURIComponent(`【タスク一覧】${today}`)}&body=${encodeURIComponent(body)}`;
}

// ─── Helpers ─────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function toInputDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '110px', left: '50%', transform: 'translateX(-50%)',
    background: type === 'error' ? '#ef4444' : '#10b981',
    color: '#fff', padding: '10px 20px', borderRadius: '999px',
    fontSize: '14px', fontWeight: '600', zIndex: '9999',
    whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,.3)',
    maxWidth: '90vw', textAlign: 'center', transition: 'opacity .4s',
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2500);
}
