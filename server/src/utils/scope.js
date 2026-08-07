import { pool } from '../config/db.js';

// Returns team ids a supervisor is assigned to.
export async function teamIdsForSupervisor(supervisorId) {
  const [rows] = await pool.execute(
    `SELECT team_id AS id FROM team_supervisors WHERE supervisor_id = ?`,
    [supervisorId]
  );
  return rows.map((r) => r.id);
}

// Returns the list of member ids a supervisor is responsible for
// (members belonging to any team the supervisor is assigned to).
export async function memberIdsForSupervisor(supervisorId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT tm.member_id AS id
       FROM team_supervisors ts
       JOIN team_members tm ON tm.team_id = ts.team_id
      WHERE ts.supervisor_id = ?`,
    [supervisorId]
  );
  return rows.map((r) => r.id);
}

// True if the supervisor supervises the given member.
export async function supervises(supervisorId, memberId) {
  const ids = await memberIdsForSupervisor(supervisorId);
  return ids.includes(Number(memberId));
}

// Returns the list of member ids who share at least one team with the given
// member (excluding the member themselves). Peer reviews are scoped to these.
export async function teammateIds(memberId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT tm.member_id AS id
       FROM team_members tm
      WHERE tm.member_id <> ?
        AND tm.team_id IN (SELECT team_id FROM team_members WHERE member_id = ?)`,
    [memberId, memberId]
  );
  return rows.map((r) => r.id);
}

// True if the two members belong to at least one common team.
export async function areTeammates(memberA, memberB) {
  const ids = await teammateIds(memberA);
  return ids.includes(Number(memberB));
}

// Active teammates (same team) the member may give a collaboration rating to.
export async function collaborationCohortIds(memberId) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT tm.member_id AS id
       FROM team_members tm
       JOIN users u ON u.id = tm.member_id
      WHERE tm.member_id <> ?
        AND u.role = 'member' AND u.status = 'active'
        AND tm.team_id IN (SELECT team_id FROM team_members WHERE member_id = ?)`,
    [memberId, memberId]
  );
  return rows.map((r) => r.id);
}

// Collaboration ratings are team-scoped only.
export async function canCollaborateReview(assessorId, assesseeId) {
  if (Number(assessorId) === Number(assesseeId)) return false;
  const ids = await collaborationCohortIds(assessorId);
  return ids.includes(Number(assesseeId));
}

// Alias used by /users/cohort for collaboration UI.
export async function peerCollaboratorIds(memberId) {
  return collaborationCohortIds(memberId);
}
