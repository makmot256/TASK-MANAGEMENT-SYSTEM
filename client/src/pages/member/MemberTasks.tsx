import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { PriorityBadge, fmtDate, Loader } from '../../components/ui';
import type { TaskStatus } from '../../types';

const COLUMNS: TaskStatus[] = ['To-Do', 'In Progress', 'Under Review', 'Completed'];
const COLORS: Record<string, string> = { 'To-Do': 'var(--grey)', 'In Progress': 'var(--brand)', 'Under Review': 'var(--amber)', Completed: 'var(--green)' };

export default function MemberTasks() {
  const toast = useToast();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await api.get('/tasks');
    setTasks(data.tasks);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const move = async (task: any, status: TaskStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.patch(`/tasks/${task.id}/status`, { status });
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, status } : t)));
      toast(`Moved to ${status}`, 'success');
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const nextStatus = (s: TaskStatus): TaskStatus | null => {
    const i = COLUMNS.indexOf(s);
    return i < COLUMNS.length - 1 ? COLUMNS[i + 1] : null;
  };

  return (
    <div className="page">
      <h1 className="page-title">My Tasks</h1>
      <p className="page-sub">Track your work across the board. Update a status as you progress.</p>

      {loading ? <div style={{ marginTop: 22 }}><Loader /></div> : (
        <div className="kanban" style={{ marginTop: 22 }}>
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="kcol">
                <div className="kcol-head">
                  <span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: COLORS[col] }} /> {col}</span>
                  <span className="badge badge-grey">{items.length}</span>
                </div>
                {items.map((t) => {
                  const next = nextStatus(col);
                  const overdue = t.deadline && col !== 'Completed' && new Date(t.deadline) < new Date();
                  return (
                    <div key={t.id} className="kcard" onClick={() => nav(`/tasks/${t.id}`)}>
                      <div className="row between" style={{ marginBottom: 8 }}>
                        <PriorityBadge priority={t.priority} />
                        {overdue && <span className="badge badge-red">Overdue</span>}
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
                      <div className="tiny" style={{ marginBottom: 10 }}>Due {fmtDate(t.deadline)} · by {t.created_by_name}</div>
                      {next && <button className="btn btn-ghost btn-sm btn-block" onClick={(e) => move(t, next, e)}>Move to {next} →</button>}
                    </div>
                  );
                })}
                {items.length === 0 && <p className="tiny" style={{ textAlign: 'center', padding: 16 }}>No tasks</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
