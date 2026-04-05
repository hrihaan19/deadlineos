/**
 * Claude prompt templates for DeadlineOS.
 * All prompts are defined here — never inline in components.
 */

export const SYSTEM_CONFLICT_RESOLVER = `You are DeadlineOS, a brutally honest but supportive student scheduler. You speak directly, use dry humor, and never sugarcoat. Keep responses under 150 words.`;

export const SYSTEM_WEEKLY_INSIGHT = `You are DeadlineOS. You analyze student productivity data and give sharp, specific, actionable insights. You are not a cheerleader. You tell students exactly what their data says. Under 200 words.`;

export const SYSTEM_DAILY_NUDGE = `You are DeadlineOS. You give one-sentence motivational nudges that are honest, slightly snarky, and specific to the student's situation. Never generic. Never "You've got this!" Respond with exactly one sentence.`;

/**
 * @param {Object[]} tasks
 * @param {number} dailyHourCap
 * @param {Object[]} conflicts
 * @returns {string}
 */
export function conflictResolverPrompt(tasks, dailyHourCap, conflicts) {
  const taskList = tasks
    .filter((t) => !t.isComplete)
    .map(
      (t) =>
        `- ${t.name} (${t.className}): due ${t.dueDate}, ${t.estimatedHours}h estimated, ${t.priority} priority`
    )
    .join('\n');

  const conflictList = conflicts
    .map((t) => `- ${t.name}: ${t.unscheduledHours || t.estimatedHours}h can't fit before ${t.dueDate}`)
    .join('\n');

  return `Here is my current task list with due dates and estimated hours:\n${taskList}\n\nMy daily hour cap: ${dailyHourCap} hours\n\nThese tasks cannot fit in my schedule before their due dates:\n${conflictList}\n\nSuggest a specific rebalancing plan. Which tasks should I prioritize? Should I request extensions? Should I reduce scope on anything? Give me a numbered action list, not a paragraph.`;
}

/**
 * @param {Object[]} completionData
 * @returns {string}
 */
export function weeklyInsightPrompt(completionData) {
  const lines = completionData
    .map(
      (c) =>
        `- ${c.taskName} (${c.className}): planned ${c.plannedHours}h, actual ${c.actualHours}h, status: ${c.status}`
    )
    .join('\n');

  return `Here is my completion data for this week:\n${lines}\n\nTell me:\n1. My biggest underestimation pattern this week\n2. One specific thing I should do differently next week\n3. My honest procrastination score for this week (calculate it)\nBe specific. Use my actual numbers. Don't be generic.`;
}

/**
 * @param {string} dayOfWeek
 * @param {number} tasksToday
 * @param {number} hoursToday
 * @param {string} urgentTask
 * @param {number} daysUntilDue
 * @param {number|null} score
 * @returns {string}
 */
export function dailyNudgePrompt(dayOfWeek, tasksToday, hoursToday, urgentTask, daysUntilDue, score) {
  const scoreText = score !== null ? `Their procrastination score is ${score}.` : 'No procrastination score yet.';
  return `Today is ${dayOfWeek}. The student has ${tasksToday} tasks scheduled totaling ${hoursToday} hours. Their most urgent deadline is "${urgentTask}" due in ${daysUntilDue} days. ${scoreText} Give them today's nudge.`;
}
