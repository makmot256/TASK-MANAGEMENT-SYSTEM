import React, { useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, Modal, Loader, EmptyState, Spinner } from '../../components/ui';
import { IcoPlus, IcoTeam, IcoTrash, IcoX, IcoEdit, IcoShield } from '../../lib/icons';

const emptySup = { full_name: '', email: '', password: '', phone: '', title: '' };

function SupervisorPicker({
  supers,
  selected,
  onToggle,
}: {
  supers: any[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <div className="grid grid-2" style={{ gap: 8, maxHeight: 200, overflowY: 'auto' }}>
      {supers.map((s) => (
        <div
          key={s.id}
          className="card"
          style={{
            padding: 10,
            cursor: 'pointer',
            borderColor: selected.includes(s.id) ? 'var(--brand)' : 'var(--border)',
            background: selected.includes(s.id) ? 'var(--brand-soft)' : 'var(--surface)',
          }}
          onClick={() => onToggle(s.id)}
        >
          <div className="row" style={{ gap: 8 }}>
            <Avatar name={s.full_name} color={s.avatar_color} size="sm" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{s.full_name}</span>
          </div>
        </div>
      ))}
      {supers.length === 0 && <p className="tiny muted">Add a supervisor first.</p>}
    </div>
  );
}

function PeopleList({ people, emptyLabel }: { people: any[]; emptyLabel: string }) {
  if (!people?.length) {
    return <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>{emptyLabel}</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {people.map((p) => (
        <div key={p.id} className="row" style={{ gap: 8 }}>
          <Avatar name={p.full_name} color={p.avatar_color} size="sm" />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminTeams() {
  const toast = useToast();
  const [teams, setTeams] = useState<any[]>([]);
  const [supers, setSupers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: '', description: '', supervisor_ids: [] as number[] });
  const [manage, setManage] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [supOpen, setSupOpen] = useState(false);
  const [supForm, setSupForm] = useState<any>(emptySup);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [t, u] = await Promise.all([api.get('/admin/teams'), api.get('/admin/users')]);
    setTeams(t.data.teams);
    setSupers(u.data.users.filter((x: any) => x.role === 'supervisor'));
    setMembers(u.data.users.filter((x: any) => x.role === 'member'));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleSupervisor = (ids: number[], id: number, setter: (v: any) => void, state: any) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setter({ ...state, supervisor_ids: next });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supervisor_ids.length) {
      toast('Select at least one supervisor for the team.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/teams', form);
      toast('Team created.', 'success');
      setOpen(false);
      setForm({ name: '', description: '', supervisor_ids: [] });
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit.supervisor_ids?.length) {
      toast('Select at least one supervisor for the team.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/teams/${edit.id}`, {
        name: edit.name,
        description: edit.description,
        supervisor_ids: edit.supervisor_ids,
      });
      toast('Team updated.', 'success');
      setEdit(null);
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const createSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/users', { ...supForm, role: 'supervisor' });
      toast('Supervisor added.', 'success');
      setSupOpen(false);
      setSupForm(emptySup);
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    if (!confirm('Delete this team?')) return;
    await api.delete(`/admin/teams/${id}`);
    toast('Team deleted.', 'success');
    load();
  };

  const openManage = async (team: any) => {
    setManage(team);
    const { data } = await api.get(`/admin/teams/${team.id}/members`);
    setTeamMembers(data.members);
  };
  const addMember = async (memberId: number) => {
    await api.post(`/admin/teams/${manage.id}/members`, { member_id: memberId });
    const { data } = await api.get(`/admin/teams/${manage.id}/members`);
    setTeamMembers(data.members);
    load();
  };
  const removeMember = async (memberId: number) => {
    await api.delete(`/admin/teams/${manage.id}/members/${memberId}`);
    setTeamMembers((t) => t.filter((m) => m.id !== memberId));
    load();
  };

  return (
    <div className="page">
      <div className="row between wrap">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-sub">
            Group members under one or more supervisors. Members can belong to multiple teams.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setSupForm(emptySup); setSupOpen(true); }}><IcoShield size={16} /> Add supervisor</button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}><IcoPlus size={16} /> New team</button>
        </div>
      </div>

      {loading ? <div style={{ marginTop: 22 }}><Loader /></div> : teams.length === 0 ? (
        <div className="card card-pad" style={{ marginTop: 22 }}><EmptyState icon={<IcoTeam size={56} />} title="No teams yet" sub="Create a team and assign supervisors." /></div>
      ) : (
        <div className="grid grid-3" style={{ marginTop: 22 }}>
          {teams.map((t) => (
            <div key={t.id} className="card card-pad">
              <div className="row between">
                <h3 style={{ fontSize: 16 }}>{t.name}</h3>
                <div className="row" style={{ gap: 6 }}>
                  <button className="icon-btn" title="Edit team" onClick={() => setEdit({
                    id: t.id,
                    name: t.name,
                    description: t.description || '',
                    supervisor_ids: t.supervisor_ids || [],
                  })}><IcoEdit size={15} /></button>
                  <button className="icon-btn" title="Delete team" onClick={() => del(t.id)}><IcoTrash size={15} /></button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>{t.description || 'No description'}</p>
              <div className="divider" />
              <div className="row between wrap" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 14 }}>Supervisors</span>
                <span className="badge badge-brand">{(t.supervisors || []).length}</span>
              </div>
              <PeopleList people={t.supervisors || []} emptyLabel="No supervisors assigned" />
              <div className="row between wrap" style={{ gap: 6, marginTop: 14 }}>
                <span className="muted" style={{ fontSize: 14 }}>Members</span>
                <span className="badge badge-grey">{(t.members || []).length}</span>
              </div>
              <PeopleList people={t.members || []} emptyLabel="No members yet" />
              <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 14 }} onClick={() => openManage(t)}>Manage members</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title="Create team" onClose={() => setOpen(false)} wide
          footer={<><button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></>}>
          <form onSubmit={create}>
            <div className="field"><label className="label">Team name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="field"><label className="label">Description</label><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="field">
              <label className="label">Supervisors * ({form.supervisor_ids.length} selected)</label>
              <p className="tiny muted" style={{ marginBottom: 8 }}>Select one or more supervisors for this team.</p>
              <SupervisorPicker
                supers={supers}
                selected={form.supervisor_ids}
                onToggle={(id) => toggleSupervisor(form.supervisor_ids, id, setForm, form)}
              />
            </div>
          </form>
        </Modal>
      )}

      {manage && (
        <Modal title={`Manage members: ${manage.name}`} onClose={() => setManage(null)} wide>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Members can belong to multiple teams. Adding here does not remove them from other teams.
          </p>
          <h4 style={{ marginBottom: 10 }}>Current members ({teamMembers.length})</h4>
          {teamMembers.length === 0 ? <p className="muted" style={{ marginBottom: 14 }}>No members yet.</p> : (
            <div className="grid grid-2" style={{ marginBottom: 18 }}>
              {teamMembers.map((m) => (
                <div key={m.id} className="card" style={{ padding: 10 }}>
                  <div className="row between"><div className="row" style={{ gap: 8 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name}</span></div><button className="icon-btn" onClick={() => removeMember(m.id)}><IcoX size={14} /></button></div>
                </div>
              ))}
            </div>
          )}
          <div className="divider" />
          <h4 style={{ marginBottom: 10 }}>Add members</h4>
          <div className="grid grid-2">
            {members.filter((m) => !teamMembers.some((tm) => tm.id === m.id)).map((m) => (
              <div key={m.id} className="card" style={{ padding: 10, cursor: 'pointer' }} onClick={() => addMember(m.id)}>
                <div className="row between"><div className="row" style={{ gap: 8 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name}</span></div><IcoPlus size={16} /></div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {edit && (
        <Modal title={`Edit team: ${edit.name}`} onClose={() => setEdit(null)} wide
          footer={<><button className="btn btn-primary" onClick={saveEdit} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></>}>
          <form onSubmit={saveEdit}>
            <div className="field"><label className="label">Team name *</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></div>
            <div className="field"><label className="label">Description</label><textarea className="textarea" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
            <div className="field">
              <label className="label">Supervisors * ({edit.supervisor_ids.length} selected)</label>
              <SupervisorPicker
                supers={supers}
                selected={edit.supervisor_ids}
                onToggle={(id) => toggleSupervisor(edit.supervisor_ids, id, setEdit, edit)}
              />
            </div>
          </form>
        </Modal>
      )}

      {supOpen && (
        <Modal title="Add new supervisor" onClose={() => setSupOpen(false)}
          footer={<><button className="btn btn-primary" onClick={createSupervisor} disabled={busy}>{busy ? <Spinner /> : 'Save'}</button><button className="btn btn-ghost" onClick={() => setSupOpen(false)}>Cancel</button></>}>
          <form onSubmit={createSupervisor}>
            <div className="field"><label className="label">Full name *</label><input className="input" value={supForm.full_name} onChange={(e) => setSupForm({ ...supForm, full_name: e.target.value })} required /></div>
            <div className="field"><label className="label">Email *</label><input className="input" type="email" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} required /></div>
            <div className="grid grid-2">
              <div className="field"><label className="label">Title</label><input className="input" value={supForm.title} onChange={(e) => setSupForm({ ...supForm, title: e.target.value })} placeholder="e.g. Engineering Lead" /></div>
              <div className="field"><label className="label">Phone</label><input className="input" value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} /></div>
            </div>
            <div className="field"><label className="label">Temp password *</label><input className="input" type="text" value={supForm.password} onChange={(e) => setSupForm({ ...supForm, password: e.target.value })} placeholder="Min 8 chars, letter & number" required /></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
