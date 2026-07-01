export type Role = 'admin' | 'supervisor' | 'member';

export interface User {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  avatar_color: string;
  phone?: string;
  title?: string;
  status?: string;
  last_login_at?: string;
  created_at?: string;
  teams?: string;
}

export type TaskStatus = 'To-Do' | 'In Progress' | 'Under Review' | 'Completed';

export interface Performance {
  member_id: number;
  tp: number; pe: number; sa: number; pi: number;
  timeliness: number; penalty_applied: number;
  base_tp?: number;
  reviewer_penalties?: {
    missed_reviews: number;
    vulgar_comments: number;
    tp_deduction: number;
  };
}

export interface Engagement {
  member_id: number;
  score: number | null;
  status: 'on_track' | 'moderate' | 'at_risk' | 'insufficient_data';
  login_frequency: number;
  task_update_frequency: number;
  submission_timeliness: number;
  is_flagged: number;
}
