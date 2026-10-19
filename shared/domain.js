// Shared domain rules for care tasks. Imported by the server (authoritative)
// and by the client (to decide which actions to show).

export const TASK_STATUSES = /** @type {const} */ ([
  'unassigned',
  'pending_confirmation',
  'accepted',
  'rejected',
  'completed',
  'cancelled',
]);

/**
 * Every allowed status change, keyed by action.
 *
 *  assign    unassigned | rejected | pending_confirmation -> pending_confirmation
 *            (coordinator/creator picks a helper; re-picking while pending = reassign)
 *  assign_self  same sources -> accepted (assigning yourself needs no confirmation)
 *  claim     unassigned | rejected -> accepted  ("Beriem to" on the task board)
 *  accept    pending_confirmation -> accepted   (only the assignee)
 *  decline   pending_confirmation -> rejected   (only the assignee, optional reason)
 *  unassign  pending_confirmation | rejected -> unassigned (back to the board)
 *  complete  accepted -> completed              (assignee or coordinator)
 *  cancel    any non-terminal -> cancelled      (coordinator/creator)
 *
 * Accepting a task never completes it; completed and cancelled are terminal.
 */
export const TRANSITIONS = {
  assign: { from: ['unassigned', 'rejected', 'pending_confirmation'], to: 'pending_confirmation' },
  assign_self: { from: ['unassigned', 'rejected', 'pending_confirmation'], to: 'accepted' },
  claim: { from: ['unassigned', 'rejected'], to: 'accepted' },
  accept: { from: ['pending_confirmation'], to: 'accepted' },
  decline: { from: ['pending_confirmation'], to: 'rejected' },
  unassign: { from: ['pending_confirmation', 'rejected'], to: 'unassigned' },
  complete: { from: ['accepted'], to: 'completed' },
  cancel: { from: ['unassigned', 'pending_confirmation', 'accepted', 'rejected'], to: 'cancelled' },
};

export const TERMINAL_STATUSES = ['completed', 'cancelled'];
/** Tasks shown on the board / "without a helper". */
export const NEEDS_HELPER_STATUSES = ['unassigned', 'rejected'];

/** Actions that must not happen once the deadline has passed. */
const DEADLINE_BOUND = ['assign', 'assign_self', 'claim', 'accept'];

/**
 * @param {string} action
 * @param {string} status
 */
export function canTransition(action, status) {
  const t = TRANSITIONS[action];
  return !!t && t.from.includes(status);
}

/**
 * Checks whether `actor` may perform `action` on `task`.
 * Returns null when allowed, otherwise an error code (translated by the client).
 *
 * @param {string} action
 * @param {{status:string, assignee_id:number|null, created_by:number, due_at:string|null}} task
 * @param {{id:number, role:string}} actor
 * @param {Date} [now]
 */
export function checkAction(action, task, actor, now = new Date()) {
  if (!TRANSITIONS[action]) return 'invalid_action';
  if (!canTransition(action, task.status)) return 'invalid_transition';
  const isCoordinator = actor.role === 'coordinator' || task.created_by === actor.id;
  const isAssignee = task.assignee_id === actor.id;
  if (DEADLINE_BOUND.includes(action) && isExpired(task, now)) return 'deadline_passed';
  switch (action) {
    case 'assign':
    case 'assign_self':
    case 'unassign':
    case 'cancel':
      return isCoordinator ? null : 'forbidden';
    case 'accept':
    case 'decline':
      return isAssignee ? null : 'not_assignee';
    case 'complete':
      return isAssignee || isCoordinator ? null : 'forbidden';
    case 'claim':
      return null;
    default:
      return 'invalid_action';
  }
}

/** @param {{status:string, due_at:string|null}} task */
export function isExpired(task, now = new Date()) {
  if (!task.due_at || TERMINAL_STATUSES.includes(task.status)) return false;
  return new Date(task.due_at).getTime() < now.getTime();
}

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const LIMITS = { title: 120, note: 2000, reason: 500, location: 160, name: 60 };
