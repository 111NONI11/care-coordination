import type { AppState, Task } from './types';
import { localTime } from './format';

export type AvailabilityStatus =
  | { kind: 'free' }
  | { kind: 'block'; label: 'work' | 'other'; start: string; end: string }
  | { kind: 'task'; task: Task }
  | { kind: 'unknown' };

const HOUR = 3600_000;

/**
 * Availability of a member for a task, based on their weekly busy blocks
 * ("Dostupnosť podľa kalendára") and their other active tasks.
 * The task occupies [deadline, event start + 1h] or one hour from the deadline.
 */
export function availabilityFor(state: AppState, userId: number, task: Task): AvailabilityStatus {
  if (!task.due_at) return { kind: 'unknown' };
  const start = new Date(task.due_at);
  const ev = task.event_id ? state.events.find((e) => e.id === task.event_id) : undefined;
  const end = ev ? new Date(Math.max(new Date(ev.starts_at).getTime() + HOUR, start.getTime() + HOUR)) : new Date(start.getTime() + HOUR);

  const other = state.tasks.find((t) => {
    if (t.id === task.id || t.assignee_id !== userId || !t.due_at) return false;
    if (t.status !== 'accepted' && t.status !== 'pending_confirmation') return false;
    const ts = new Date(t.due_at).getTime();
    return ts < end.getTime() && ts + HOUR > start.getTime();
  });
  if (other) return { kind: 'task', task: other };

  // Weekly blocks are in local wall-clock time; only same-day overlaps are considered.
  const wd = start.getDay();
  const s = localTime(start);
  const e = end.toDateString() === start.toDateString() ? localTime(end) : '23:59';
  const block = state.availability.find((b) => b.user_id === userId && b.weekday === wd && b.start_time < e && b.end_time > s);
  if (block) return { kind: 'block', label: block.label, start: block.start_time, end: block.end_time };
  return { kind: 'free' };
}
