import React, { useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, Modal, fmtDateTime, Loader, Spinner } from '../../components/ui';
import { IcoPlus, IcoSearch, IcoTrash, IcoEdit } from '../../lib/icons';

const ROLE_BADGE: Record<string, string> = { admin: 'badge-accent', supervisor: 'badge-brand', member: 'badge-grey' };
const empty = { full_name: '', email: '', role: 'member', password: '', phone: '', title: '' };

export default function AdminUsers() {
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [editTeamIds, setEditTeamIds] = useState<number[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: usersData }, { data: teamsData }] = await Promise.all([
      api.get('/admin/users', { params: { q, role: roleFilter } }),
      api.get('/admin/teams'),
    ]);
    setUsers(usersData.users);
    setAllTeams(teamsData.teams);
    setLoading(false);
  };
  useEffect(() => { load(); }, [q, roleFilter]);

  const openEdit = async (u: any) => {
    setEdit({ ...u });
    if (u.role === 'member' || u.role === 'supervisor') {
      const { data } = await api.get(`/admin/users/${u.id}/teams`);
      setEditTeamIds(data.team_ids || []);
    } else {
      setEditTeamIds([]);
    }
  };

  const toggleTeam = (teamId: number) => {
    setEditTeamIds((ids) => (ids.includes(teamId) ? ids.filter((x) => x !== teamId) : [...ids, teamId]));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/users', form);
      toast('User created.', 'success');
      setOpen(false);
      setForm(empty);
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/admin/users/${edit.id}`, {
        full_name: edit.full_name,
        role: edit.role,
        phone: edit.phone,
        title: edit.title,
        status: edit.status,
      });
      if (edit.role === 'member' || edit.role === 'supervisor') {
        await api.put(`/admin/users/${edit.id}/teams`, { team_ids: editTeamIds });
      }
      toast('User updated.', 'success');
      setEdit(null);
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (u: any) => {
    if (!confirm(`Delete ${u.full_name}? This removes all their data.`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast('User deleted.', 'success');
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const teamLabel = (u: any) => {
    if (u.role === 'member') return u.teams || '—';
    if (u.role === 'supervisor') return u.supervised_teams || '—';
    return '—';
  };

  return (
    <div className="page">
      <div className="row between wrap">
        <div><h1 className="page-title">User Management</h1><p className="page-sub">Provision supervisors and members. Members and supervisors can belong to multiple teams.</p></div>
        <button className="btn btn-primary" onClick={() => { setForm(empty); setOpen(true); }}><IcoPlus size={16} /> Add user</button>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="row between wrap card-pad" style={{ paddingBottom: 0, gap: 10 }}>
          <div className="row" style={{ gap: 8, flex: 1, minWidth: 220 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
              <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-3)' }}><IcoSearch size={16} /></span>
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="pill-toggle">
            {['', 'admin', 'supervisor', 'member'].map((r) => (
              <button key={r} className={roleFilter === r ? 'active' : ''} onClick={() => setRoleFilter(r)}>{r === '' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}</button>
            ))}
          </div>
        </div>
        {loading ? <div className="card-pad"><Loader /></div> : (
          <div className="table-scroll">
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>User</th><th>Role</th><th>Teams</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={u.full_name} color={u.avatar_color} size="sm" /><div><div style={{ fontWeight: 600 }}>{u.full_name}</div><div className="tiny">{u.email}</div></div></div></td>
                  <td><span className={`badge ${ROLE_BADGE[u.role]}`} style={{ textTransform: 'capitalize' }}>{u.role}</span></td>
                  <td className="muted">{teamLabel(u)}</td>
                  <td><span className={`badge ${u.status === 'active' ? 'badge-green' : 'badge-grey'}`}>{u.status}</span></td>
                  <td className="muted">{fmtDateTime(u.last_login_at)}</td>
                  <td><div className="row" style={{ gap: 6 }}><button className="icon-btn" onClick={() => openEdit(u)}><IcoEdit size={15} /></button><button className="icon-btn" onClick={() => del(u)}><IcoTrash size={15} /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {open && (
        <Modal title="Add new user" onClose={() => setOpen(false)}
          footer={<><button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></>}>
          <form onSubmit={create}>
            <div className="field"><label className="label">Full name *</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
            <div className="field"><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div className="grid grid-2">
              <div className="field"><label className="label">Role *</label><select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="member">Member</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></div>
              <div className="field"><label className="label">Title</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            </div>
            <div className="grid grid-2">
              <div className="field"><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="field"><label className="label">Temp password *</label><input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 chars, letter & number" required /></div>
            </div>
            <p className="tiny muted">Assign teams after creating the user via Edit.</p>
          </form>
        </Modal>
      )}

      {edit && (
        <Modal title={`Edit ${edit.full_name}`} onClose={() => setEdit(null)} wide
          footer={<><button className="btn btn-primary" onClick={saveEdit} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></>}>
          <form onSubmit={saveEdit}>
            <div className="field"><label className="label">Full name</label><input className="input" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
            <div className="grid grid-2">
              <div className="field"><label className="label">Role</label><select className="select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="member">Member</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></div>
              <div className="field"><label className="label">Status</label><select className="select" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            </div>
            <div className="grid grid-2">
              <div className="field"><label className="label">Title</label><input className="input" value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
              <div className="field"><label className="label">Phone</label><input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            </div>

            {(edit.role === 'member' || edit.role === 'supervisor') && (
              <div className="field">
                <label className="label">
                  {edit.role === 'member' ? 'Team memberships' : 'Supervised teams'} ({editTeamIds.length} selected)
                </label>
                <p className="tiny muted" style={{ marginBottom: 8 }}>
                  {edit.role === 'member'
                    ? 'A member can belong to more than one team.'
                    : 'A supervisor can oversee more than one team.'}
                </p>
                <div className="grid grid-2" style={{ gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {allTeams.map((t) => (
                    <div
                      key={t.id}
                      className="card"
                      style={{
                        padding: 10,
                        cursor: 'pointer',
                        borderColor: editTeamIds.includes(t.id) ? 'var(--brand)' : 'var(--border)',
                        background: editTeamIds.includes(t.id) ? 'var(--brand-soft)' : 'var(--surface)',
                      }}
                      onClick={() => toggleTeam(t.id)}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div className="tiny muted">{t.supervisor_names || 'No supervisors'}</div>
                    </div>
                  ))}
                  {allTeams.length === 0 && <p className="tiny muted">Create teams first under Teams.</p>}
                </div>
              </div>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
