/**
 * DeadlineOS — Main Application
 * Vanilla JS SPA, no framework.
 */

import * as Storage from './lib/storage.js';
import { buildSchedule, getWeekDates, formatDayLabel, todayStr, yesterdayStr } from './lib/scheduler.js';
import { calculateStats } from './lib/procrastination.js';
import { callClaude, getMockResponse } from './lib/claude.js';
import {
  SYSTEM_CONFLICT_RESOLVER, SYSTEM_WEEKLY_INSIGHT, SYSTEM_DAILY_NUDGE,
  conflictResolverPrompt, weeklyInsightPrompt, dailyNudgePrompt,
} from './lib/prompts.js';
import { loadDemoData } from './data/demo.js';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  tasks: [],
  completions: [],
  settings: {},
  schedule: {},
  conflicts: [],
  currentView: 'dashboard',
  weekOffset: 0,          // 0 = current week, -1 = last week, +1 = next week
  graveyardOpen: false,
  onboardingStep: 0,
  editingTaskId: null,
  detailTaskId: null,
  checkinSelections: {},  // taskId → { status, actualHours }
  charts: {},             // Chart.js instances
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const user = Storage.getUser();
  if (user) {
    loginSuccess(user);
  } else {
    show('auth-screen');
  }
  bindGlobalEvents();
});

function loginSuccess(user) {
  state.user = user;
  state.tasks = Storage.getTasks(user.id);
  state.completions = Storage.getCompletions(user.id);
  state.settings = Storage.getSettings(user.id);

  hide('auth-screen');
  show('app-shell');
  $('nav-user-label').textContent = user.name || user.email;

  recalcSchedule();
  // Always render the view so the dashboard is ready behind any overlay
  renderCurrentView();

  if (!Storage.isOnboardingComplete(user.id) && state.tasks.length === 0) {
    openOnboarding();
  } else {
    showDailyNudge();
  }
}

// ─── Recalculate & re-render ──────────────────────────────────────────────────
function recalcSchedule() {
  const result = buildSchedule(state.tasks, state.settings);
  state.schedule = result.schedule;
  state.conflicts = result.conflicts;
}

function renderCurrentView() {
  if (state.currentView === 'dashboard') {
    renderDashboard();
  } else {
    renderStats();
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  updateConflictBanner();
  updateCheckinBanner();
  renderWeekGrid();
  renderGraveyard();
}

function updateConflictBanner() {
  const n = state.conflicts.length;
  if (n > 0) {
    $('conflict-count').textContent = n;
    show('conflict-banner');
    // update nav badge
    const link = document.querySelector('[data-view="dashboard"] .badge');
    if (!link) {
      const navLink = document.querySelector('[data-view="dashboard"]');
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = n;
      navLink.appendChild(badge);
    } else {
      link.textContent = n;
    }
  } else {
    hide('conflict-banner');
    const badge = document.querySelector('[data-view="dashboard"] .badge');
    if (badge) badge.remove();
  }
}

function updateCheckinBanner() {
  const yesterday = yesterdayStr();
  const yBlocks = state.schedule[yesterday] || [];
  // Check if already checked in for yesterday
  const alreadyDone = state.completions.some((c) => c.completionDate === yesterday);
  if (yBlocks.length > 0 && !alreadyDone) {
    const d = new Date(yesterday + 'T00:00:00');
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    $('checkin-day-label').textContent = dayNames[d.getDay()];
    show('checkin-banner');
  } else {
    hide('checkin-banner');
  }
}

function renderWeekGrid() {
  const today = todayStr();
  const refDate = new Date();
  refDate.setDate(refDate.getDate() + state.weekOffset * 7);
  const weekDates = getWeekDates(refDate);

  // Week range label
  const start = new Date(weekDates[0] + 'T00:00:00');
  const end = new Date(weekDates[6] + 'T00:00:00');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('week-range-label').textContent = `${fmt(start)} – ${fmt(end)}`;

  const grid = $('week-grid');
  grid.innerHTML = '';

  for (const dateStr of weekDates) {
    const blocks = state.schedule[dateStr] || [];
    const isToday = dateStr === today;
    const isPast = dateStr < today;
    const dayLabel = formatDayLabel(dateStr);
    const totalHours = blocks.reduce((s, b) => s + b.hoursAllocated, 0);
    const cap = state.settings.dailyHourCap || 3;
    const loadPct = Math.min(totalHours / cap, 1);
    const loadClass = loadPct < 0.5 ? 'load-low' : loadPct < 0.85 ? 'load-mid' : 'load-high';

    const col = document.createElement('div');
    col.className = `day-col${isToday ? ' is-today' : ''}`;
    col.innerHTML = `
      <div class="day-header">
        <div class="day-header-top">
          <span class="day-name">${dayLabel}</span>
          <span class="day-hours font-mono">${totalHours > 0 ? totalHours.toFixed(1) + 'h' : ''}</span>
        </div>
        <div class="load-bar-wrap">
          <div class="load-bar-fill ${loadClass}" style="width:${Math.round(loadPct*100)}%"></div>
        </div>
      </div>
      <div class="day-tasks" id="tasks-${dateStr}">
        ${blocks.length === 0 ? `<div class="day-empty">${isPast ? '—' : 'Free'}</div>` : ''}
      </div>
    `;

    grid.appendChild(col);

    const tasksContainer = col.querySelector('.day-tasks');
    for (const block of blocks) {
      const taskCard = buildTaskCard(block, dateStr);
      tasksContainer.appendChild(taskCard);
    }
  }
}

function buildTaskCard(block, dateStr) {
  const today = todayStr();
  const isOverdue = block.isOverdue || (block.dueDate < today);
  const card = document.createElement('div');
  card.className = `task-card priority-${block.priority}${isOverdue ? ' overdue' : ''}`;
  card.dataset.taskId = block.taskId;
  card.dataset.dateStr = dateStr;

  const priorityLabel = { low: 'Low', medium: 'Med', high: 'High', onfire: '🔥' };
  card.innerHTML = `
    <div class="task-card-name">${esc(block.taskName)}${isOverdue ? ' ⚠' : ''}</div>
    <div class="task-card-class">${esc(block.className)}</div>
    <div class="task-card-meta">
      <span class="task-card-hours">${block.hoursAllocated}h today</span>
      <span class="priority-badge ${block.priority}">${priorityLabel[block.priority] || block.priority}</span>
    </div>
  `;
  card.addEventListener('click', () => openTaskDetail(block.taskId));
  return card;
}

function renderGraveyard() {
  const today = todayStr();
  const overdue = state.tasks.filter((t) => !t.isComplete && t.dueDate < today);
  if (overdue.length === 0) {
    hide('graveyard');
    return;
  }
  show('graveyard');
  $('graveyard-title').textContent = `Overdue & Abandoned (${overdue.length})`;
  const body = $('graveyard-body');
  body.style.display = state.graveyardOpen ? 'flex' : 'none';
  $('graveyard-chevron').textContent = state.graveyardOpen ? '▴' : '▾';

  if (state.graveyardOpen) {
    if (overdue.length === 0) {
      body.innerHTML = `<div class="graveyard-empty">Nothing here. You're either very organized or very good at denial.</div>`;
    } else {
      body.innerHTML = overdue.map((t) => `
        <div class="graveyard-item">
          <span>💀</span>
          <span class="graveyard-item-name">${esc(t.name)}</span>
          <span class="graveyard-item-class">${esc(t.className)}</span>
          <span class="text-xs text-muted">Due ${t.dueDate}</span>
          <button class="btn btn-ghost btn-sm" onclick="window.app.openTaskDetail('${t.id}')">View</button>
        </div>
      `).join('');
    }
  }
}

// ─── Stats View ───────────────────────────────────────────────────────────────
function renderStats() {
  const stats = calculateStats(state.tasks, state.completions);

  if (!stats.hasData) {
    show('stats-empty');
    hide('stats-charts-wrap');
    hide('stats-kpi');
    return;
  }

  hide('stats-empty');
  show('stats-charts-wrap');
  show('stats-kpi');

  renderKPIs(stats);
  renderAccuracyChart(stats.perClass);
  renderTrendChart(stats.weeklyTrend);
}

function renderKPIs(stats) {
  const score = stats.procrastinationScore;
  const scoreClass = score === null ? '' : score < 1.2 ? 'stat-score-good' : score < 1.6 ? 'stat-score-ok' : 'stat-score-bad';
  const scoreLabel = score === null ? '—' : score < 1.2 ? 'Sharp 🎯' : score < 1.6 ? 'Getting there' : 'Habitual underestimator';

  $('stats-kpi').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">Procrastination Score</div>
      <div class="stat-card-value ${scoreClass}">${score !== null ? score.toFixed(2) + 'x' : '—'}</div>
      <div class="stat-card-sub">${scoreLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Most Delayed</div>
      <div class="stat-card-value" style="font-size:1.2rem;color:var(--accent)">${stats.mostDelayed || '—'}</div>
      <div class="stat-card-sub">Biggest underestimation gap</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Best Subject</div>
      <div class="stat-card-value" style="font-size:1.2rem;color:var(--success)">${stats.bestSubject || '—'}</div>
      <div class="stat-card-sub">Most accurate estimates</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Check-in Streak</div>
      <div class="streak-display">
        <span class="streak-num">${stats.streak}</span>
        <span style="font-size:1.4rem">${stats.streak >= 7 ? '🔥' : stats.streak >= 3 ? '⚡' : '📅'}</span>
      </div>
      <div class="stat-card-sub">day${stats.streak !== 1 ? 's' : ''} in a row</div>
    </div>
  `;
}

function renderAccuracyChart(perClass) {
  const ctx = document.getElementById('chart-accuracy');
  if (!ctx) return;

  if (state.charts.accuracy) {
    state.charts.accuracy.destroy();
  }

  if (!perClass.length) return;

  state.charts.accuracy = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: perClass.map((c) => c.name.replace(/^AP /, '')),
      datasets: [
        {
          label: 'Planned hrs',
          data: perClass.map((c) => c.planned),
          backgroundColor: 'rgba(0,113,227,0.18)',
          borderColor: 'rgba(0,113,227,0.85)',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'Actual hrs',
          data: perClass.map((c) => c.actual),
          backgroundColor: 'rgba(255,69,58,0.15)',
          borderColor: 'rgba(255,69,58,0.85)',
          borderWidth: 2,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#6e6e73', font: { family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif', size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}h`,
            afterDatasetsDraw: undefined,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#6e6e73', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: {
          ticks: { color: '#6e6e73', font: { size: 11 }, callback: (v) => v + 'h' },
          grid: { color: 'rgba(0,0,0,0.06)' },
          beginAtZero: true,
        },
      },
    },
  });
}

function renderTrendChart(weeklyTrend) {
  const ctx = document.getElementById('chart-trend');
  if (!ctx) return;

  if (state.charts.trend) {
    state.charts.trend.destroy();
  }

  if (!weeklyTrend.length) return;

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: weeklyTrend.map((w) => w.week),
      datasets: [
        {
          label: 'Planned hrs',
          data: weeklyTrend.map((w) => w.planned),
          borderColor: 'rgba(0,113,227,0.85)',
          backgroundColor: 'rgba(0,113,227,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: 'rgba(0,113,227,1)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
        {
          label: 'Actual hrs',
          data: weeklyTrend.map((w) => w.actual),
          borderColor: 'rgba(255,69,58,0.85)',
          backgroundColor: 'rgba(255,69,58,0.06)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: 'rgba(255,69,58,1)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#6e6e73', font: { family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif', size: 11 } } },
      },
      scales: {
        x: { ticks: { color: '#6e6e73', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.06)' } },
        y: {
          ticks: { color: '#6e6e73', font: { size: 11 }, callback: (v) => v + 'h' },
          grid: { color: 'rgba(0,0,0,0.06)' },
          beginAtZero: true,
        },
      },
    },
  });
}

// ─── Task Modal ───────────────────────────────────────────────────────────────
function openNewTask() {
  state.editingTaskId = null;
  $('task-modal-title').textContent = 'New Assignment';
  $('task-edit-id').value = '';
  $('task-name').value = '';
  $('task-class').value = state.settings.classes[0] || '';
  $('task-due').value = '';
  $('task-hours').value = '';
  $('task-notes').value = '';
  $('task-priority').value = 'medium';
  $('task-save-btn').textContent = 'Add Assignment';
  hide('task-delete-btn');

  // Set min date to today
  $('task-due').min = todayStr();

  selectPriority('medium');
  populateClassDropdown('task-class');
  clearErrors(['task-name-err','task-due-err','task-hours-err']);
  openModal('modal-task');
  setTimeout(() => $('task-name').focus(), 50);
}

function openEditTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  state.editingTaskId = taskId;
  $('task-modal-title').textContent = 'Edit Assignment';
  $('task-edit-id').value = taskId;
  $('task-name').value = task.name;
  $('task-due').value = task.dueDate;
  $('task-hours').value = task.estimatedHours;
  $('task-notes').value = task.notes || '';
  $('task-priority').value = task.priority;
  $('task-save-btn').textContent = 'Save Changes';
  show('task-delete-btn');

  $('task-due').min = '';
  selectPriority(task.priority);
  populateClassDropdown('task-class', task.className);
  clearErrors(['task-name-err','task-due-err','task-hours-err']);
  openModal('modal-task');
  // Close detail modal if open
  closeModal('modal-task-detail');
  setTimeout(() => $('task-name').focus(), 50);
}

function saveTask() {
  const name = $('task-name').value.trim();
  const dueDate = $('task-due').value;
  const hours = parseFloat($('task-hours').value);
  const className = $('task-class').value;
  const priority = $('task-priority').value;
  const notes = $('task-notes').value.trim();

  let hasError = false;
  if (!name) { show('task-name-err'); hasError = true; } else hide('task-name-err');
  if (!dueDate || (dueDate < todayStr() && !state.editingTaskId)) {
    show('task-due-err'); hasError = true;
  } else hide('task-due-err');
  if (!hours || hours <= 0) { show('task-hours-err'); hasError = true; } else hide('task-hours-err');
  if (hasError) return;

  const taskData = { name, className, dueDate, estimatedHours: hours, priority, notes };

  if (state.editingTaskId) {
    Storage.updateTask(state.user.id, state.editingTaskId, taskData);
    toast('Assignment updated', 'success');
  } else {
    Storage.addTask(state.user.id, taskData);
    toast('Assignment added', 'success');
  }

  state.tasks = Storage.getTasks(state.user.id);
  recalcSchedule();
  closeModal('modal-task');
  renderCurrentView();
}

function deleteTask(taskId) {
  if (!confirm('Delete this assignment? This cannot be undone.')) return;
  Storage.deleteTask(state.user.id, taskId);
  state.tasks = Storage.getTasks(state.user.id);
  recalcSchedule();
  closeModal('modal-task');
  closeModal('modal-task-detail');
  renderCurrentView();
  toast('Assignment deleted', 'info');
}

function selectPriority(priority) {
  document.querySelectorAll('.priority-pill').forEach((p) => {
    p.classList.toggle('selected', p.dataset.priority === priority);
  });
  $('task-priority').value = priority;
}

function populateClassDropdown(selectId, selectedClass) {
  const sel = $(selectId);
  sel.innerHTML = state.settings.classes
    .map((c) => `<option value="${esc(c)}"${c === selectedClass ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');
}

// ─── Task Detail ──────────────────────────────────────────────────────────────
function openTaskDetail(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  state.detailTaskId = taskId;

  const dueColor = task.dueDate < todayStr() ? 'var(--accent)' : 'var(--text)';
  const priorityLabel = { low: 'Low', medium: 'Medium', high: 'High', onfire: '🔥 On Fire' };

  $('task-detail-body').innerHTML = `
    <div class="task-detail">
      <div class="task-detail-header">
        <div class="task-detail-name">${esc(task.name)}</div>
        <span class="priority-badge ${task.priority}">${priorityLabel[task.priority]}</span>
      </div>
      <div class="task-meta-row">
        <div class="task-meta-item">
          <span class="task-meta-label">Class</span>
          <span class="task-meta-value">${esc(task.className)}</span>
        </div>
        <div class="task-meta-item">
          <span class="task-meta-label">Due Date</span>
          <span class="task-meta-value" style="color:${dueColor}">${task.dueDate}</span>
        </div>
        <div class="task-meta-item">
          <span class="task-meta-label">Estimated</span>
          <span class="task-meta-value font-mono">${task.estimatedHours}h</span>
        </div>
        <div class="task-meta-item">
          <span class="task-meta-label">Completed</span>
          <span class="task-meta-value font-mono">${task.completedHours || 0}h</span>
        </div>
      </div>
      ${task.notes ? `<div class="form-group"><div class="form-label">Notes</div><div style="font-size:.857rem;color:var(--muted);line-height:1.6">${esc(task.notes)}</div></div>` : ''}
      ${task.isComplete ? `<div style="padding:8px 12px;background:rgba(22,199,154,0.1);border:1px solid rgba(22,199,154,0.3);border-radius:var(--radius);font-size:.857rem;color:var(--success);">✓ Completed</div>` : ''}
    </div>
  `;

  $('detail-complete-btn').style.display = task.isComplete ? 'none' : '';
  $('detail-delete-btn').dataset.taskId = taskId;
  $('detail-edit-btn').dataset.taskId = taskId;
  $('detail-complete-btn').dataset.taskId = taskId;

  openModal('modal-task-detail');
}

function markComplete(taskId) {
  Storage.updateTask(state.user.id, taskId, { isComplete: true });
  state.tasks = Storage.getTasks(state.user.id);
  recalcSchedule();
  closeModal('modal-task-detail');
  renderCurrentView();
  toast('Marked complete! 🎉', 'success');
}

// ─── Check-in ─────────────────────────────────────────────────────────────────
function openCheckin() {
  const yesterday = yesterdayStr();
  const blocks = state.schedule[yesterday] || [];
  state.checkinSelections = {};

  const d = new Date(yesterday + 'T00:00:00');
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  $('checkin-date-label').textContent = dayNames[d.getDay()];
  $('checkin-modal-title').textContent = `Check-in — ${dayNames[d.getDay()]}`;

  const list = $('checkin-tasks-list');
  if (blocks.length === 0) {
    list.innerHTML = '';
    show('checkin-no-tasks');
  } else {
    hide('checkin-no-tasks');
    list.innerHTML = blocks.map((block) => {
      const task = state.tasks.find((t) => t.id === block.taskId);
      return `
        <div class="checkin-task" data-task-id="${block.taskId}">
          <div class="checkin-task-name">${esc(block.taskName)}</div>
          <div class="checkin-task-meta">${esc(block.className)} · Planned: ${block.hoursAllocated}h</div>
          <div class="checkin-buttons">
            <button class="checkin-btn" data-status="done" data-task="${block.taskId}">✅ Done</button>
            <button class="checkin-btn" data-status="partial" data-task="${block.taskId}">🔄 Partial</button>
            <button class="checkin-btn" data-status="skipped" data-task="${block.taskId}">❌ Skipped</button>
          </div>
          <div class="actual-hours-row hidden" id="actual-${block.taskId}">
            <label>Actual hours spent:</label>
            <input type="number" class="form-input actual-hours-input" data-task="${block.taskId}"
              value="${block.hoursAllocated}" min="0" step="0.5">
          </div>
        </div>
      `;
    }).join('');

    // Bind checkin button clicks
    list.querySelectorAll('.checkin-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const taskId = btn.dataset.task;
        const status = btn.dataset.status;
        const row = btn.closest('.checkin-task');

        row.querySelectorAll('.checkin-btn').forEach((b) => {
          b.className = 'checkin-btn';
        });
        btn.classList.add(`selected-${status}`);

        const actualRow = document.getElementById(`actual-${taskId}`);
        if (status === 'done' || status === 'partial') {
          actualRow.classList.remove('hidden');
        } else {
          actualRow.classList.add('hidden');
        }

        if (!state.checkinSelections[taskId]) state.checkinSelections[taskId] = {};
        state.checkinSelections[taskId].status = status;
      });
    });
  }

  openModal('modal-checkin');
}

function submitCheckin() {
  const yesterday = yesterdayStr();
  const blocks = state.schedule[yesterday] || [];

  let saved = 0;
  for (const block of blocks) {
    const sel = state.checkinSelections[block.taskId];
    if (!sel || !sel.status) continue;

    const actualInput = document.querySelector(`.actual-hours-input[data-task="${block.taskId}"]`);
    const actualHours = actualInput ? parseFloat(actualInput.value) || block.hoursAllocated : block.hoursAllocated;

    Storage.addCompletion(state.user.id, {
      taskId: block.taskId,
      taskName: block.taskName,
      className: block.className,
      plannedHours: block.hoursAllocated,
      actualHours: sel.status === 'skipped' ? 0 : actualHours,
      status: sel.status,
      completionDate: yesterday,
    });

    // Update task remaining hours
    if (sel.status === 'done') {
      Storage.updateTask(state.user.id, block.taskId, { isComplete: true });
    } else if (sel.status === 'partial') {
      const task = state.tasks.find((t) => t.id === block.taskId);
      if (task) {
        const newCompleted = Math.min((task.completedHours || 0) + actualHours, task.estimatedHours);
        Storage.updateTask(state.user.id, block.taskId, { completedHours: newCompleted });
      }
    }
    saved++;
  }

  state.tasks = Storage.getTasks(state.user.id);
  state.completions = Storage.getCompletions(state.user.id);
  recalcSchedule();
  closeModal('modal-checkin');
  renderDashboard();
  if (saved > 0) toast(`Check-in saved! ${saved} task${saved > 1 ? 's' : ''} logged.`, 'success');
  else toast('No selections made — check-in skipped.', 'info');
}

// ─── Conflict Resolver ────────────────────────────────────────────────────────
async function openConflictResolver() {
  $('conflict-stream-text').textContent = '';
  show('conflict-cursor');
  openModal('modal-conflict');

  const prompt = conflictResolverPrompt(state.tasks, state.settings.dailyHourCap, state.conflicts);
  const textEl = $('conflict-stream-text');

  try {
    await callClaude(SYSTEM_CONFLICT_RESOLVER, prompt, {
      apiKey: state.settings.claudeApiKey,
      onChunk: (text) => {
        textEl.textContent += text;
      },
    });
  } catch (err) {
    console.warn('Claude API unavailable, using mock:', err.message);
    const mockText = getMockResponse('conflict');
    // Simulate typewriter for mock
    for (let i = 0; i < mockText.length; i++) {
      textEl.textContent += mockText[i];
      await sleep(12);
    }
  } finally {
    hide('conflict-cursor');
  }
}

// ─── Weekly Insight ───────────────────────────────────────────────────────────
async function getWeeklyInsight() {
  const insightCard = $('weekly-insight-card');
  insightCard.style.display = '';
  const textEl = $('insight-text');
  textEl.className = 'insight-text loading';
  textEl.textContent = 'Analyzing your week…';

  // Build completion data for this week
  const weekStart = getWeekDates()[0];
  const weekCompletions = state.completions.filter((c) => c.completionDate >= weekStart);

  if (!weekCompletions.length) {
    textEl.className = 'insight-text';
    textEl.textContent = 'No completions logged this week yet. Do your check-ins first!';
    return;
  }

  const prompt = weeklyInsightPrompt(weekCompletions);
  textEl.className = 'insight-text';
  textEl.textContent = '';

  try {
    await callClaude(SYSTEM_WEEKLY_INSIGHT, prompt, {
      apiKey: state.settings.claudeApiKey,
      onChunk: (text) => { textEl.textContent += text; },
    });
  } catch {
    textEl.textContent = getMockResponse('insight');
  }
}

// ─── Daily Nudge ─────────────────────────────────────────────────────────────
async function showDailyNudge() {
  const today = todayStr();
  const cached = Storage.getNudgeCache(state.user.id);
  if (cached && cached.date === today) {
    $('nudge-text').textContent = cached.text;
    show('nudge-widget');
    return;
  }

  show('nudge-widget');
  $('nudge-text').textContent = 'Loading today\'s nudge…';

  const todayBlocks = state.schedule[today] || [];
  const hoursToday = todayBlocks.reduce((s, b) => s + b.hoursAllocated, 0);
  const urgentTask = state.conflicts.length > 0
    ? state.conflicts[0]
    : state.tasks.filter((t) => !t.isComplete).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayOfWeek = dayNames[new Date().getDay()];
  const daysUntilDue = urgentTask
    ? Math.ceil((new Date(urgentTask.dueDate + 'T00:00:00') - new Date()) / 86400000)
    : 7;
  const taskName = urgentTask ? urgentTask.name : 'nothing urgent';
  const stats = calculateStats(state.tasks, state.completions);

  const prompt = dailyNudgePrompt(dayOfWeek, todayBlocks.length, hoursToday, taskName, daysUntilDue, stats.procrastinationScore);

  try {
    const text = await callClaude(SYSTEM_DAILY_NUDGE, prompt, { apiKey: state.settings.claudeApiKey });
    $('nudge-text').textContent = text;
    Storage.saveNudgeCache(state.user.id, text);
  } catch {
    const fallback = getMockResponse('nudge');
    $('nudge-text').textContent = fallback;
    Storage.saveNudgeCache(state.user.id, fallback);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function openSettings() {
  const s = state.settings;
  const DAY_ABBREVS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  $('settings-body').innerHTML = `
    <div class="settings-section">
      <h3>Schedule</h3>
      <div class="settings-row">
        <label>Daily hour cap</label>
        <div class="settings-control">
          <div class="range-wrap">
            <input type="range" id="cap-slider" min="1" max="8" step="0.5" value="${s.dailyHourCap}">
            <span class="range-val" id="cap-val">${s.dailyHourCap}h</span>
          </div>
        </div>
      </div>
      <div class="settings-row">
        <label>Work days</label>
        <div class="settings-control">
          <div class="workday-btns">
            ${DAY_ABBREVS.map((d) => `<button class="workday-btn${s.workDays.includes(d) ? ' active' : ''}" data-day="${d}">${d[0]}</button>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Classes</h3>
      <div class="class-tags" id="class-tags">
        ${s.classes.map((c) => `<span class="class-tag">${esc(c)}<button class="class-tag-remove" data-class="${esc(c)}">×</button></span>`).join('')}
      </div>
      <div class="flex gap-2">
        <input id="new-class-input" type="text" class="form-input" placeholder="Add a class…" style="max-width:220px">
        <button class="btn btn-secondary btn-sm" id="add-class-btn">Add</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>Claude AI</h3>
      <div class="settings-row">
        <label>API Key <span class="text-muted text-xs">(stored locally)</span></label>
      </div>
      <input id="claude-key-input" type="password" class="form-input" placeholder="sk-ant-api03-…" value="${s.claudeApiKey || ''}" autocomplete="off">
      <p class="text-xs text-muted mt-2">Needed for Conflict Resolver, Weekly Insight, and Daily Nudge. Without it, mock responses are shown. <a href="https://console.anthropic.com" target="_blank" style="color:var(--secondary)">Get a key →</a></p>
    </div>
  `;

  // Bind slider
  const slider = $('cap-slider');
  const capVal = $('cap-val');
  slider.addEventListener('input', () => { capVal.textContent = slider.value + 'h'; });

  // Bind workday toggles
  document.querySelectorAll('.workday-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // Bind class remove
  document.querySelectorAll('.class-tag-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cls = btn.dataset.class;
      s.classes = s.classes.filter((c) => c !== cls);
      openSettings();
    });
  });

  // Bind class add
  $('add-class-btn').addEventListener('click', () => {
    const val = $('new-class-input').value.trim();
    if (val && !s.classes.includes(val)) {
      s.classes.push(val);
      openSettings();
    }
  });
  $('new-class-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('add-class-btn').click();
  });

  openModal('modal-settings');
}

function saveSettings() {
  const cap = parseFloat($('cap-slider').value) || 3;
  const workDays = [...document.querySelectorAll('.workday-btn.active')].map((b) => b.dataset.day);
  const claudeKey = $('claude-key-input').value.trim();

  state.settings = {
    ...state.settings,
    dailyHourCap: cap,
    workDays: workDays.length ? workDays : ['Mon','Tue','Wed','Thu','Fri'],
    claudeApiKey: claudeKey,
  };

  Storage.saveSettings(state.user.id, state.settings);
  recalcSchedule();
  closeModal('modal-settings');
  renderCurrentView();
  toast('Settings saved', 'success');
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
const ONBOARDING_STEPS = [
  {
    title: 'What classes are you taking?',
    render: () => `
      <p class="text-muted text-sm mb-4">Add the classes you're currently enrolled in. You can always change these in Settings.</p>
      <div class="class-tags" id="ob-class-tags">
        ${(state.settings.classes || []).map((c) => `<span class="class-tag">${esc(c)}<button class="class-tag-remove ob-remove" data-class="${esc(c)}">×</button></span>`).join('')}
      </div>
      <div class="flex gap-2 mt-2">
        <input id="ob-class-input" type="text" class="form-input" placeholder="e.g. AP Physics" style="max-width:240px">
        <button class="btn btn-secondary" id="ob-add-class">Add</button>
      </div>
    `,
    afterRender: () => {
      $('ob-add-class').addEventListener('click', () => {
        const val = $('ob-class-input').value.trim();
        if (val && !state.settings.classes.includes(val)) {
          state.settings.classes.push(val);
          renderOnboardingStep();
        }
        $('ob-class-input').value = '';
      });
      $('ob-class-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ob-add-class').click(); });
      document.querySelectorAll('.ob-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.settings.classes = state.settings.classes.filter((c) => c !== btn.dataset.class);
          renderOnboardingStep();
        });
      });
    },
  },
  {
    title: 'How many hours can you study per day?',
    render: () => `
      <p class="text-muted text-sm mb-4">Be realistic — DeadlineOS will spread work across days within this cap.</p>
      <div class="range-wrap" style="gap:16px;align-items:center;margin-top:24px;">
        <input type="range" id="ob-cap-slider" min="1" max="8" step="0.5" value="${state.settings.dailyHourCap || 3}" style="width:100%">
        <div style="text-align:center;min-width:80px">
          <div class="stat-card-value font-mono" id="ob-cap-val" style="font-size:2.5rem;color:var(--accent)">${state.settings.dailyHourCap || 3}</div>
          <div class="text-muted text-sm">hours / day</div>
        </div>
      </div>
      <div class="mt-4">
        <p class="text-xs text-muted">Work days: use Settings to customize (default Mon–Fri)</p>
      </div>
    `,
    afterRender: () => {
      const slider = $('ob-cap-slider');
      slider.addEventListener('input', () => {
        state.settings.dailyHourCap = parseFloat(slider.value);
        $('ob-cap-val').textContent = slider.value;
      });
    },
  },
  {
    title: 'Add your first assignment',
    render: () => `
      <p class="text-muted text-sm mb-4">Let's add your first assignment so DeadlineOS can build your schedule.</p>
      <div class="form-group">
        <label class="form-label">Assignment Name *</label>
        <input id="ob-task-name" type="text" class="form-input" placeholder="e.g. Chapter 3 Problem Set">
      </div>
      <div class="form-group">
        <label class="form-label">Class</label>
        <select id="ob-task-class" class="form-select">
          ${state.settings.classes.map((c) => `<option>${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input id="ob-task-due" type="date" class="form-input" min="${todayStr()}">
        </div>
        <div class="form-group">
          <label class="form-label">Est. Hours</label>
          <input id="ob-task-hours" type="number" class="form-input" placeholder="2" min="0.5" step="0.5">
        </div>
      </div>
      <button class="btn btn-ghost btn-sm mt-2" id="ob-skip-task">Skip — I'll add tasks later</button>
    `,
    afterRender: () => {
      $('ob-skip-task').addEventListener('click', () => finishOnboarding(true));
      setTimeout(() => $('ob-task-name').focus(), 50);
    },
  },
];

function openOnboarding() {
  state.onboardingStep = 0;
  renderOnboardingStep();
  openModal('modal-onboarding');
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[state.onboardingStep];
  $('onboarding-title').textContent = step.title;

  // Step dots
  $('onboarding-steps-indicator').innerHTML = ONBOARDING_STEPS.map((_, i) => {
    const cls = i < state.onboardingStep ? 'done' : i === state.onboardingStep ? 'active' : '';
    return `<div class="onboarding-step-dot ${cls}"></div>`;
  }).join('');

  $('onboarding-body').innerHTML = step.render();
  step.afterRender && step.afterRender();

  $('onboarding-next-btn').textContent = state.onboardingStep === ONBOARDING_STEPS.length - 1 ? 'Finish →' : 'Next →';
  state.onboardingStep === 0 ? hide('onboarding-back-btn') : show('onboarding-back-btn');
}

function onboardingNext() {
  if (state.onboardingStep === ONBOARDING_STEPS.length - 1) {
    finishOnboarding(false);
  } else {
    state.onboardingStep++;
    renderOnboardingStep();
  }
}

function finishOnboarding(skippedTask) {
  // Save settings from onboarding
  Storage.saveSettings(state.user.id, state.settings);

  // Save first task if provided
  if (!skippedTask) {
    const name = $('ob-task-name')?.value?.trim();
    const className = $('ob-task-class')?.value;
    const dueDate = $('ob-task-due')?.value;
    const hours = parseFloat($('ob-task-hours')?.value);
    if (name && className && dueDate && hours > 0) {
      Storage.addTask(state.user.id, { name, className, dueDate, estimatedHours: hours, priority: 'medium', notes: '' });
      state.tasks = Storage.getTasks(state.user.id);
    }
  }

  Storage.markOnboardingComplete(state.user.id);
  recalcSchedule();
  closeModal('modal-onboarding');
  renderCurrentView();
  showDailyNudge();
  toast('Welcome to DeadlineOS! 🎯', 'success');
}

// ─── Demo data ────────────────────────────────────────────────────────────────
function triggerLoadDemo() {
  if (!confirm('This will replace your current data with demo data. Continue?')) return;
  // Close any open modal (e.g. onboarding) before loading
  document.querySelectorAll('.modal-overlay').forEach((m) => closeModal(m.id));
  loadDemoData(state.user.id);
  state.tasks = Storage.getTasks(state.user.id);
  state.completions = Storage.getCompletions(state.user.id);
  recalcSchedule();
  Storage.markOnboardingComplete(state.user.id);
  renderCurrentView();
  showDailyNudge();
  toast('Demo data loaded! Check My Patterns for stats.', 'success');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function bindAuthEvents() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      which === 'signin' ? (show('auth-form-signin'), hide('auth-form-signup')) : (hide('auth-form-signin'), show('auth-form-signup'));
    });
  });

  $('signin-btn').addEventListener('click', () => {
    const email = $('signin-email').value.trim();
    const pass = $('signin-password').value;
    try {
      const user = Storage.signIn(email, pass);
      loginSuccess(user);
    } catch (e) {
      $('signin-error').textContent = e.message;
      show('signin-error');
    }
  });

  $('signup-btn').addEventListener('click', () => {
    const name = $('signup-name').value.trim();
    const email = $('signup-email').value.trim();
    const pass = $('signup-password').value;
    if (!name || !email || !pass) {
      $('signup-error').textContent = 'All fields required.';
      show('signup-error');
      return;
    }
    try {
      const user = Storage.signUp(email, pass, name);
      loginSuccess(user);
    } catch (e) {
      $('signup-error').textContent = e.message;
      show('signup-error');
    }
  });

  $('demo-login-btn').addEventListener('click', () => {
    let user;
    try {
      user = Storage.signIn('demo@deadlineos.app', 'demo1234');
    } catch {
      user = Storage.signUp('demo@deadlineos.app', 'demo1234', 'Demo Student');
    }
    loginSuccess(user);
  });

  // Enter key in auth forms
  [$('signin-email'), $('signin-password')].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signin-btn').click(); });
  });
  [$('signup-name'), $('signup-email'), $('signup-password')].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('signup-btn').click(); });
  });
}

// ─── Global Event Bindings ────────────────────────────────────────────────────
function bindGlobalEvents() {
  bindAuthEvents();

  // Nav view switching
  document.querySelectorAll('.nav-link[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentView = btn.dataset.view;
      document.querySelectorAll('.nav-link[data-view]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('[id^="view-"]').forEach((v) => hide(v.id));
      show(`view-${state.currentView}`);
      renderCurrentView();
    });
  });

  // Nav buttons
  $('new-task-btn').addEventListener('click', openNewTask);
  $('settings-btn').addEventListener('click', openSettings);
  $('signout-btn').addEventListener('click', () => {
    Storage.signOut();
    location.reload();
  });

  // Dashboard controls
  $('conflict-resolver-link').addEventListener('click', openConflictResolver);
  $('open-checkin-btn').addEventListener('click', openCheckin);
  $('refresh-nudge-btn').addEventListener('click', () => {
    Storage.saveNudgeCache(state.user.id, ''); // clear cache to force refresh
    showDailyNudge();
  });
  $('conflict-dismiss').addEventListener('click', () => hide('conflict-banner'));
  $('load-demo-btn').addEventListener('click', triggerLoadDemo);

  // Week navigation
  $('prev-week-btn').addEventListener('click', () => { state.weekOffset--; renderWeekGrid(); });
  $('next-week-btn').addEventListener('click', () => { state.weekOffset++; renderWeekGrid(); });
  $('today-btn').addEventListener('click', () => { state.weekOffset = 0; renderWeekGrid(); });

  // Graveyard toggle
  $('graveyard-toggle').addEventListener('click', () => {
    state.graveyardOpen = !state.graveyardOpen;
    renderGraveyard();
  });

  // Task modal
  $('task-save-btn').addEventListener('click', saveTask);
  $('task-delete-btn').addEventListener('click', () => deleteTask(state.editingTaskId));
  document.querySelectorAll('.priority-pill').forEach((pill) => {
    pill.addEventListener('click', () => selectPriority(pill.dataset.priority));
  });

  // Task detail
  $('detail-edit-btn').addEventListener('click', () => openEditTask(state.detailTaskId));
  $('detail-delete-btn').addEventListener('click', () => deleteTask(state.detailTaskId));
  $('detail-complete-btn').addEventListener('click', () => markComplete(state.detailTaskId));

  // Check-in
  $('checkin-submit-btn').addEventListener('click', submitCheckin);

  // Conflict resolver retry
  $('conflict-retry-btn').addEventListener('click', () => {
    openConflictResolver();
  });

  // Settings
  $('settings-save-btn').addEventListener('click', saveSettings);
  $('reset-data-btn').addEventListener('click', () => {
    if (confirm('This will permanently delete ALL your tasks, completions, and settings. Are you absolutely sure?')) {
      Storage.resetAllData(state.user.id);
      state.tasks = [];
      state.completions = [];
      state.settings = Storage.getSettings(state.user.id);
      recalcSchedule();
      closeModal('modal-settings');
      renderCurrentView();
      toast('All data reset.', 'info');
    }
  });

  // Onboarding
  $('onboarding-next-btn').addEventListener('click', onboardingNext);
  $('onboarding-back-btn').addEventListener('click', () => {
    if (state.onboardingStep > 0) { state.onboardingStep--; renderOnboardingStep(); }
  });

  // Stats
  $('get-insight-btn').addEventListener('click', getWeeklyInsight);
  $('stats-load-demo-btn')?.addEventListener('click', triggerLoadDemo);

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Click outside modal to close
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const openModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    if (e.key === 'Escape') {
      openModals.forEach((m) => closeModal(m.id));
      return;
    }
    if (openModals.length > 0) return;

    if (e.key === 'n' || e.key === 'N') openNewTask();
    if (e.key === 'c' || e.key === 'C') openCheckin();
    if (e.key === '?') openModal('modal-shortcuts');
  });

  // Enter to submit signin
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const taskModal = document.querySelector('#modal-task:not(.hidden)');
      if (taskModal) saveTask();
    }
  });
}

// ─── Expose for inline onclick ────────────────────────────────────────────────
window.app = { openTaskDetail };

// ─── 3D Tilt effect on task cards ────────────────────────────────────────────
function attachTilt(card) {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);   // -1 to 1
    const dy = (e.clientY - cy) / (rect.height / 2);  // -1 to 1
    const rx = (-dy * 8).toFixed(2);   // tilt on X axis (up/down)
    const ry = (dx * 10).toFixed(2);   // tilt on Y axis (left/right)
    card.style.setProperty('--rx', rx + 'deg');
    card.style.setProperty('--ry', ry + 'deg');
  });
  card.addEventListener('mouseleave', () => {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
}

// Re-attach tilt after each render (called after renderWeekGrid)
function attachAllTilts() {
  document.querySelectorAll('.task-card:not([data-tilt])').forEach((card) => {
    card.dataset.tilt = '1';
    attachTilt(card);
  });
}

// Patch renderDashboard to call attachAllTilts after grid renders
const _origRenderDashboard = window._renderDashboard;
// We hook via a MutationObserver on #week-grid instead
const _weekGridObserver = new MutationObserver(() => {
  attachAllTilts();
});
_weekGridObserver.observe(document.getElementById('week-grid') || document.body, {
  childList: true, subtree: true,
});

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  show(id);
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  hide(id);
  // Only restore scroll if no other modals open
  const open = document.querySelectorAll('.modal-overlay:not(.hidden)');
  if (open.length === 0) document.body.style.overflow = '';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Utility helpers ──────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { const el = typeof id === 'string' ? $(id) : id; el && el.classList.remove('hidden'); }
function hide(id) { const el = typeof id === 'string' ? $(id) : id; el && el.classList.add('hidden'); }
function esc(str) { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function clearErrors(ids) { ids.forEach((id) => hide(id)); }
