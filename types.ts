export type TaskStatus = 'unassigned' | 'pending_confirmation' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
export type Role = 'coordinator' | 'helper';

export interface Member { id: number; name: string; username: string; role: Role }
export interface Me { id: number; name: string; username: string; role: Role }
export interface Availability { id: number; user_id: number; weekday: number; start_time: string; end_time: string; label: 'work' | 'other' }
export interface Medication { id: number; label: string; time: string }
export interface MedicationCheck { medication_id: number; date: string; checked_by: number; checked_at: string }
export interface CareEvent {
  id: number; title: string; starts_at: string; location: string; needs_transport: boolean; cancelled: boolean;
  created_by: number; created_at: string;
}
export interface Task {
  id: number; event_id: number | null; title: string; due_at: string | null; notes: string; status: TaskStatus;
  assignee_id: number | null; assigned_by: number | null; accepted_by: number | null; accepted_at: string | null;
  created_by: number; created_at: string; updated_at: string; version: number;
}
export type HistoryType =
  | 'created' | 'edited' | 'published' | 'assigned' | 'reassigned' | 'accepted' | 'declined'
  | 'claimed' | 'unassigned' | 'completed' | 'cancelled' | 'record_added';
export interface HistoryEntry {
  id: number; task_id: number; type: HistoryType; actor_id: number | null; target_id: number | null;
  from_status: TaskStatus | null; to_status: TaskStatus | null; reason: string | null; at: string;
}
export interface VisitRecord { id: number; task_id: number; author_id: number; note: string; photo_id: number | null; created_at: string }
export type NotificationType =
  | 'assigned' | 'accepted' | 'declined' | 'claimed' | 'completed' | 'cancelled' | 'unassigned'
  | 'needs_helper' | 'record_added' | 'edited';
export interface AppNotification {
  id: number; task_id: number | null; type: NotificationType; actor_id: number | null; reason: string | null;
  read_at: string | null; created_at: string;
}
export interface AppState {
  revision: number;
  me: Me;
  recipient: { id: number; name: string };
  members: Member[];
  availability: Availability[];
  medications: Medication[];
  medicationChecks: MedicationCheck[];
  events: CareEvent[];
  tasks: Task[];
  history: HistoryEntry[];
  records: VisitRecord[];
  notifications: AppNotification[];
}
