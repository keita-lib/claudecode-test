const DB_NAME = 'taskmanager';
const DB_VERSION = 1;
const STORE_TASKS = 'tasks';
const STORE_PROJECTS = 'projects';

let db = null;

export async function initDB() {
  if (db) return db;

  if ('storage' in navigator && 'persist' in navigator.storage) {
    const persistent = await navigator.storage.persist();
    if (!persistent) {
      window.dispatchEvent(new CustomEvent('storage-not-persistent'));
    }
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_PROJECTS)) {
        const ps = d.createObjectStore(STORE_PROJECTS, { keyPath: 'id', autoIncrement: true });
        ps.createIndex('name', 'name', { unique: false });
      }
      if (!d.objectStoreNames.contains(STORE_TASKS)) {
        const ts = d.createObjectStore(STORE_TASKS, { keyPath: 'id', autoIncrement: true });
        ts.createIndex('projectId', 'projectId', { unique: false });
        ts.createIndex('deadline', 'deadline', { unique: false });
        ts.createIndex('stage', 'stage', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}

// Projects

export function getAllProjects() {
  return new Promise((resolve, reject) => {
    const req = tx(STORE_PROJECTS).objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function saveProject(project) {
  return new Promise((resolve, reject) => {
    const t = tx(STORE_PROJECTS, 'readwrite');
    const req = project.id
      ? t.objectStore(STORE_PROJECTS).put(project)
      : t.objectStore(STORE_PROJECTS).add(project);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteProject(id) {
  return new Promise((resolve, reject) => {
    const req = tx(STORE_PROJECTS, 'readwrite').objectStore(STORE_PROJECTS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Tasks

export function getAllTasks() {
  return new Promise((resolve, reject) => {
    const req = tx(STORE_TASKS).objectStore(STORE_TASKS).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getTask(id) {
  return new Promise((resolve, reject) => {
    const req = tx(STORE_TASKS).objectStore(STORE_TASKS).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function saveTask(task) {
  return new Promise((resolve, reject) => {
    const t = tx(STORE_TASKS, 'readwrite');
    const req = task.id
      ? t.objectStore(STORE_TASKS).put(task)
      : t.objectStore(STORE_TASKS).add(task);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteTask(id) {
  return new Promise((resolve, reject) => {
    const req = tx(STORE_TASKS, 'readwrite').objectStore(STORE_TASKS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Export / Import

export async function exportData() {
  const [projects, tasks] = await Promise.all([getAllProjects(), getAllTasks()]);
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), projects, tasks }, null, 2);
}

export async function importData(jsonStr) {
  const data = JSON.parse(jsonStr);
  await initDB();
  const t = db.transaction([STORE_PROJECTS, STORE_TASKS], 'readwrite');
  const ps = t.objectStore(STORE_PROJECTS);
  const ts = t.objectStore(STORE_TASKS);
  ps.clear();
  ts.clear();
  for (const p of data.projects) ps.put(p);
  for (const task of data.tasks) ts.put(task);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
