/**
 * localStorage adapter — mirrors Supabase client interface for easy future swap.
 * All data scoped by user ID.
 *
 * @typedef {{ id: string, email: string, name: string }} User
 * @typedef {{ id: string, userId: string, name: string, className: string, dueDate: string,
 *   estimatedHours: number, priority: 'low'|'medium'|'high'|'onfire', notes: string,
 *   isComplete: boolean, completedHours: number, createdAt: string }} Task
 * @typedef {{ id: string, userId: string, taskId: string, plannedHours: number,
 *   actualHours: number, status: 'done'|'partial'|'skipped', completionDate: string }} Completion
 * @typedef {{ dailyHourCap: number, workDays: string[], classes: string[],
 *   claudeApiKey: string }} Settings
 */

const KEYS = {
  tasks: (uid) => `deadlineos_tasks_${uid}`,
  completions: (uid) => `deadlineos_completions_${uid}`,
  settings: (uid) => `deadlineos_settings_${uid}`,
  user: () => `deadlineos_user`,
  onboarding: (uid) => `deadlineos_onboarding_${uid}`,
  nudge: (uid) => `deadlineos_nudge_${uid}`,
};

function uid() {
  return crypto.randomUUID();
}

function readJSON(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── User ──────────────────────────────────────────────────────────────────
export function getUser() {
  return readJSON(KEYS.user(), null);
}

export function saveUser(user) {
  writeJSON(KEYS.user(), user);
}

export function signUp(email, password, name) {
  const existing = getAllUsers().find((u) => u.email === email);
  if (existing) throw new Error('Email already registered.');
  const user = { id: uid(), email, name, passwordHash: btoa(password), createdAt: new Date().toISOString() };
  const users = getAllUsers();
  users.push(user);
  writeJSON('deadlineos_users', users);
  const { passwordHash: _, ...safe } = user;
  saveUser(safe);
  return safe;
}

export function signIn(email, password) {
  const user = getAllUsers().find((u) => u.email === email && u.passwordHash === btoa(password));
  if (!user) throw new Error('Invalid email or password.');
  const { passwordHash: _, ...safe } = user;
  saveUser(safe);
  return safe;
}

export function signOut() {
  localStorage.removeItem(KEYS.user());
}

function getAllUsers() {
  return readJSON('deadlineos_users', []);
}

// ── Tasks ─────────────────────────────────────────────────────────────────
export function getTasks(userId) {
  return readJSON(KEYS.tasks(userId), []);
}

export function saveTasks(userId, tasks) {
  writeJSON(KEYS.tasks(userId), tasks);
}

export function addTask(userId, taskData) {
  const tasks = getTasks(userId);
  const task = {
    id: uid(),
    userId,
    completedHours: 0,
    isComplete: false,
    createdAt: new Date().toISOString(),
    ...taskData,
  };
  tasks.push(task);
  saveTasks(userId, tasks);
  return task;
}

export function updateTask(userId, taskId, updates) {
  const tasks = getTasks(userId).map((t) => (t.id === taskId ? { ...t, ...updates } : t));
  saveTasks(userId, tasks);
  return tasks.find((t) => t.id === taskId);
}

export function deleteTask(userId, taskId) {
  const tasks = getTasks(userId).filter((t) => t.id !== taskId);
  saveTasks(userId, tasks);
}

// ── Completions ───────────────────────────────────────────────────────────
export function getCompletions(userId) {
  return readJSON(KEYS.completions(userId), []);
}

export function saveCompletions(userId, completions) {
  writeJSON(KEYS.completions(userId), completions);
}

export function addCompletion(userId, data) {
  const completions = getCompletions(userId);
  const c = { id: uid(), userId, createdAt: new Date().toISOString(), ...data };
  completions.push(c);
  saveCompletions(userId, completions);
  return c;
}

// ── Settings ──────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  dailyHourCap: 3,
  workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  classes: ['AP Calculus BC', 'AP Lang', 'US History', 'AP Biology', 'Photography'],
  claudeApiKey: '',
};

export function getSettings(userId) {
  return { ...DEFAULT_SETTINGS, ...readJSON(KEYS.settings(userId), {}) };
}

export function saveSettings(userId, settings) {
  writeJSON(KEYS.settings(userId), settings);
}

// ── Onboarding ────────────────────────────────────────────────────────────
export function isOnboardingComplete(userId) {
  return localStorage.getItem(KEYS.onboarding(userId)) === 'true';
}

export function markOnboardingComplete(userId) {
  localStorage.setItem(KEYS.onboarding(userId), 'true');
}

// ── Daily nudge cache ─────────────────────────────────────────────────────
export function getNudgeCache(userId) {
  return readJSON(KEYS.nudge(userId), null);
}

export function saveNudgeCache(userId, nudge) {
  writeJSON(KEYS.nudge(userId), { text: nudge, date: new Date().toISOString().slice(0, 10) });
}

// ── Reset ─────────────────────────────────────────────────────────────────
export function resetAllData(userId) {
  localStorage.removeItem(KEYS.tasks(userId));
  localStorage.removeItem(KEYS.completions(userId));
  localStorage.removeItem(KEYS.onboarding(userId));
  localStorage.removeItem(KEYS.nudge(userId));
}
