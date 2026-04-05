/**
 * Scheduling algorithm for DeadlineOS.
 * Inputs: tasks[], settings { dailyHourCap, workDays }
 * Output: { schedule: { [dateStr]: ScheduleBlock[] }, conflicts: Task[] }
 *
 * @typedef {{ taskId: string, taskName: string, className: string,
 *   hoursAllocated: number, priority: string, dueDate: string, isOverdue: boolean }} ScheduleBlock
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIORITY_MULT = { low: 0.5, medium: 1, high: 1.5, onfire: 2 };

/**
 * Build a 7-day (+ lookahead) optimized schedule.
 * @param {import('./storage.js').Task[]} tasks
 * @param {import('./storage.js').Settings} settings
 * @returns {{ schedule: Object, conflicts: Object[] }}
 */
export function buildSchedule(tasks, settings) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { dailyHourCap, workDays } = settings;

  // Active tasks with remaining hours
  const activeTasks = tasks
    .filter((t) => !t.isComplete)
    .map((t) => ({
      ...t,
      dueDateObj: new Date(t.dueDate + 'T00:00:00'),
      remaining: Math.max(t.estimatedHours - (t.completedHours || 0), 0),
    }))
    .filter((t) => t.remaining > 0);

  // Score tasks
  const totalRemaining = activeTasks.reduce((s, t) => s + t.remaining, 0) || 1;

  const scored = activeTasks
    .map((t) => {
      const daysUntilDue = Math.max((t.dueDateObj - today) / 86400000, 0.5);
      const urgencyScore = 1 / daysUntilDue;
      const loadScore = t.remaining / totalRemaining;
      const pMult = PRIORITY_MULT[t.priority] || 1;
      const finalScore = (urgencyScore * 0.6 + loadScore * 0.4) * pMult;
      return { ...t, finalScore, daysUntilDue };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  // Build available workdays for next 60 days
  const availableDays = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (workDays.includes(DAY_NAMES[d.getDay()])) {
      availableDays.push(d);
    }
  }

  // Day capacity tracker
  const dayCapacity = {};
  availableDays.forEach((d) => {
    dayCapacity[d.toISOString().slice(0, 10)] = dailyHourCap;
  });

  const schedule = {};
  const conflicts = [];

  for (const task of scored) {
    let remaining = task.remaining;
    const deadline = task.dueDateObj.toISOString().slice(0, 10);
    const isOverdue = task.dueDateObj < today;

    const validDays = isOverdue
      ? [] // overdue tasks can't be scheduled forward
      : availableDays.filter((d) => d.toISOString().slice(0, 10) <= deadline);

    for (const day of validDays) {
      if (remaining <= 0.05) break;
      const dateStr = day.toISOString().slice(0, 10);
      const avail = dayCapacity[dateStr] || 0;
      if (avail <= 0) continue;

      // Don't put more than 3h of one task on a single day (split it)
      const hoursToday = Math.round(Math.min(remaining, avail, 3) * 10) / 10;
      dayCapacity[dateStr] = Math.round((avail - hoursToday) * 10) / 10;
      remaining = Math.round((remaining - hoursToday) * 10) / 10;

      if (!schedule[dateStr]) schedule[dateStr] = [];
      schedule[dateStr].push({
        taskId: task.id,
        taskName: task.name,
        className: task.className,
        hoursAllocated: hoursToday,
        priority: task.priority,
        dueDate: task.dueDate,
        isOverdue,
      });
    }

    if (remaining > 0.05 || isOverdue) {
      conflicts.push({ ...task, unscheduledHours: remaining });
    }
  }

  return { schedule, conflicts };
}

/**
 * Get the ISO date strings for the current week (Mon–Sun based on a reference date).
 * @param {Date} [refDate]
 * @returns {string[]} 7 ISO date strings
 */
export function getWeekDates(refDate) {
  const ref = refDate ? new Date(refDate) : new Date();
  ref.setHours(0, 0, 0, 0);
  // Find Monday of this week
  const day = ref.getDay(); // 0=Sun, 1=Mon ...
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Format a date string as "Mon 12" style label.
 * @param {string} dateStr ISO date string
 * @returns {string}
 */
export function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

/**
 * Today's ISO date string.
 * @returns {string}
 */
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Yesterday's ISO date string.
 * @returns {string}
 */
export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
