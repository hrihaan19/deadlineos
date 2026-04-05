/**
 * Demo / seed data for DeadlineOS.
 * Call loadDemoData(userId) to populate localStorage with realistic demo data.
 */

import { saveTasks, saveCompletions } from '../lib/storage.js';

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function uuid() {
  return crypto.randomUUID();
}

/** @returns {import('../lib/storage.js').Task[]} */
function buildDemoTasks(userId) {
  return [
    {
      id: 'task-calc-ps',
      userId,
      name: 'Problem Set 7',
      className: 'AP Calculus BC',
      dueDate: daysFromNow(3),
      estimatedHours: 2.5,
      priority: 'high',
      notes: 'Chain rule and implicit differentiation sections',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-lang-essay',
      userId,
      name: 'Rhetorical Analysis Essay',
      className: 'AP Lang',
      dueDate: daysFromNow(5),
      estimatedHours: 4,
      priority: 'high',
      notes: 'MLK "Letter from Birmingham Jail" — ethos, pathos, logos',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-hist-reading',
      userId,
      name: 'Reading Ch. 12–14',
      className: 'US History',
      dueDate: daysFromNow(4),
      estimatedHours: 1.5,
      priority: 'medium',
      notes: 'Focus on Reconstruction era main arguments',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-bio-lab',
      userId,
      name: 'Enzyme Kinetics Lab Report',
      className: 'AP Biology',
      dueDate: daysFromNow(7),
      estimatedHours: 3,
      priority: 'high',
      notes: 'Include Michaelis-Menten graph and error analysis',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-calc-test',
      userId,
      name: 'Unit 5 Test Prep',
      className: 'AP Calculus BC',
      dueDate: daysFromNow(9),
      estimatedHours: 5,
      priority: 'onfire',
      notes: 'Everything from integration by parts onward',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-photo-portfolio',
      userId,
      name: 'Portfolio Edit — Nature Series',
      className: 'Photography',
      dueDate: daysFromNow(10),
      estimatedHours: 2,
      priority: 'low',
      notes: 'Select 12 best shots from weekend shoot, edit in Lightroom',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-lang-seminar',
      userId,
      name: 'Socratic Seminar Prep',
      className: 'AP Lang',
      dueDate: daysFromNow(6),
      estimatedHours: 1,
      priority: 'medium',
      notes: 'Prepare 3 discussion questions and 2 quotes',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'task-hist-dbq',
      userId,
      name: 'DBQ Outline — Manifest Destiny',
      className: 'US History',
      dueDate: daysFromNow(12),
      estimatedHours: 2,
      priority: 'medium',
      notes: 'Contextualization + 3 body paragraphs with doc groupings',
      isComplete: false,
      completedHours: 0,
      createdAt: new Date().toISOString(),
    },
  ];
}

/**
 * Build 10 past completions with realistic procrastination patterns.
 * AP Calc: 1.3x | AP Lang: 1.8x | US History: 1.0x | AP Bio: 1.4x | Photography: 0.8x
 */
function buildDemoCompletions(userId) {
  const c = (id, taskId, className, taskName, plannedH, ratio, status, daysBack) => ({
    id,
    userId,
    taskId,
    className,
    taskName,
    plannedHours: plannedH,
    actualHours: Math.round(plannedH * ratio * 10) / 10,
    status,
    completionDate: daysAgo(daysBack),
    createdAt: new Date().toISOString(),
  });

  return [
    c('comp-1', 'hist-past-1', 'US History', 'Ch. 9–11 Reading', 1.5, 1.0, 'done', 14),
    c('comp-2', 'calc-past-1', 'AP Calculus BC', 'Problem Set 5', 2.0, 1.3, 'done', 13),
    c('comp-3', 'lang-past-1', 'AP Lang', 'Synthesis Essay Draft', 3.5, 1.8, 'done', 12),
    c('comp-4', 'bio-past-1', 'AP Biology', 'Cell Transport Notes', 2.0, 1.4, 'done', 11),
    c('comp-5', 'photo-past-1', 'Photography', 'Portrait Series Edit', 2.5, 0.8, 'done', 10),
    c('comp-6', 'hist-past-2', 'US History', 'Chapter 10 Quiz Prep', 1.0, 1.05, 'done', 7),
    c('comp-7', 'calc-past-2', 'AP Calculus BC', 'Related Rates WS', 1.5, 1.35, 'done', 6),
    c('comp-8', 'lang-past-2', 'AP Lang', 'Argument Essay Outline', 2.0, 1.75, 'partial', 5),
    c('comp-9', 'bio-past-2', 'AP Biology', 'Hardy-Weinberg Practice', 1.5, 1.4, 'done', 3),
    c('comp-10', 'photo-past-2', 'Photography', 'Composition Critique', 1.0, 0.8, 'done', 2),
  ];
}

/**
 * Populate localStorage with demo data for the given user.
 * @param {string} userId
 */
export function loadDemoData(userId) {
  saveTasks(userId, buildDemoTasks(userId));
  saveCompletions(userId, buildDemoCompletions(userId));
}
