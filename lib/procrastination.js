/**
 * Procrastination stats calculations for DeadlineOS.
 *
 * @typedef {{ procrastinationScore: number, perClass: Object[], mostDelayed: string,
 *   bestSubject: string, streak: number, weeklyTrend: Object[] }} ProcrastinationStats
 */

/**
 * Calculate all procrastination stats from tasks and completions.
 * @param {import('./storage.js').Task[]} tasks
 * @param {import('./storage.js').Completion[]} completions
 * @returns {ProcrastinationStats}
 */
export function calculateStats(tasks, completions) {
  if (!completions.length) {
    return {
      procrastinationScore: null,
      perClass: [],
      mostDelayed: null,
      bestSubject: null,
      streak: 0,
      weeklyTrend: [],
      hasData: false,
    };
  }

  // Only use 'done' and 'partial' completions with valid hours
  const valid = completions.filter(
    (c) => (c.status === 'done' || c.status === 'partial') && c.actualHours > 0 && c.plannedHours > 0
  );

  // Overall procrastination score = avg(actual / planned)
  const overallScore =
    valid.length > 0
      ? valid.reduce((s, c) => s + c.actualHours / c.plannedHours, 0) / valid.length
      : null;

  // Per-class accuracy
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));

  const byClass = {};
  for (const c of valid) {
    const task = taskMap[c.taskId];
    // Use className from completion record directly (works for demo data and past tasks)
    const cls = c.className || task?.className;
    if (!cls) continue;
    if (!byClass[cls]) byClass[cls] = { planned: 0, actual: 0, count: 0 };
    byClass[cls].planned += c.plannedHours;
    byClass[cls].actual += c.actualHours;
    byClass[cls].count += 1;
  }

  const perClass = Object.entries(byClass).map(([name, data]) => ({
    name,
    planned: Math.round(data.planned * 10) / 10,
    actual: Math.round(data.actual * 10) / 10,
    ratio: Math.round((data.actual / data.planned) * 100) / 100,
    count: data.count,
  }));

  const mostDelayed = perClass.length
    ? perClass.reduce((a, b) => (a.ratio > b.ratio ? a : b)).name
    : null;
  const bestSubject = perClass.length
    ? perClass.reduce((a, b) => (Math.abs(a.ratio - 1) < Math.abs(b.ratio - 1) ? a : b)).name
    : null;

  // Streak: consecutive days with at least one completion
  const streak = calculateStreak(completions);

  // Weekly trend: group completions by ISO week
  const weeklyTrend = calculateWeeklyTrend(completions);

  return {
    procrastinationScore: overallScore !== null ? Math.round(overallScore * 100) / 100 : null,
    perClass,
    mostDelayed,
    bestSubject,
    streak,
    weeklyTrend,
    hasData: valid.length > 0,
  };
}

function calculateStreak(completions) {
  if (!completions.length) return 0;

  const doneByDate = {};
  for (const c of completions) {
    if (c.status !== 'skipped') {
      doneByDate[c.completionDate] = true;
    }
  }

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (doneByDate[dateStr]) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function getISOWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function calculateWeeklyTrend(completions) {
  const weekMap = {};
  for (const c of completions) {
    if (c.status === 'skipped' || !c.actualHours) continue;
    const wk = getISOWeek(c.completionDate);
    if (!weekMap[wk]) weekMap[wk] = { week: wk, planned: 0, actual: 0 };
    weekMap[wk].planned += c.plannedHours || 0;
    weekMap[wk].actual += c.actualHours || 0;
  }

  return Object.values(weekMap)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-8) // last 8 weeks
    .map((w) => ({
      week: w.week.replace(/(\d{4})-W(\d+)/, 'Wk $2'),
      planned: Math.round(w.planned * 10) / 10,
      actual: Math.round(w.actual * 10) / 10,
    }));
}
