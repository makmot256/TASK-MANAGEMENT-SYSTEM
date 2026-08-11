import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseAvailable, resetTestDatabase, dropTestDatabase,
  makeUser, makeTeam, addTeamMember, addTeamSupervisor,
} from './helpers/db.js';

// utils/scope.js is the authorization kernel: memberIdsForSupervisor drives the
// review queue, analytics, submissions and every supervisor-scoped list. A bug
// here is a data-leak bug everywhere, so these assert the boundaries directly.

let pool;
let scope;
// Resolved at module load, because `skip:` below is evaluated when each test is
// REGISTERED — before any before() hook has had a chance to run.
const available = await databaseAvailable();

before(async () => {
  if (!available) return;
  pool = await resetTestDatabase();
  scope = await import('../src/utils/scope.js');
});

after(async () => {
  if (pool) await pool.end();
  await dropTestDatabase();
});

beforeEach(async () => {
  if (!available) return;
  for (const t of ['team_members', 'team_supervisors', 'teams', 'users']) {
    await pool.query(`DELETE FROM \`${t}\``);
  }
});

const skip = () => (available ? false : 'no MySQL server reachable');

async function twoTeams() {
  const supA = await makeUser(pool, { name: 'Sup A', email: 'supa@t.local', role: 'supervisor' });
  const supB = await makeUser(pool, { name: 'Sup B', email: 'supb@t.local', role: 'supervisor' });
  const alice = await makeUser(pool, { name: 'Alice', email: 'alice@t.local' });
  const bob = await makeUser(pool, { name: 'Bob', email: 'bob@t.local' });
  const carol = await makeUser(pool, { name: 'Carol', email: 'carol@t.local' });

  const teamA = await makeTeam(pool, 'Team A');
  const teamB = await makeTeam(pool, 'Team B');
  await addTeamSupervisor(pool, teamA, supA);
  await addTeamSupervisor(pool, teamB, supB);
  await addTeamMember(pool, teamA, alice);
  await addTeamMember(pool, teamA, bob);
  await addTeamMember(pool, teamB, carol);

  return { supA, supB, alice, bob, carol, teamA, teamB };
}

test('a supervisor sees their own team members and nobody else', { skip: skip() }, async () => {
  const { supA, supB, alice, bob, carol } = await twoTeams();

  const seenByA = await scope.memberIdsForSupervisor(supA);
  assert.deepEqual(seenByA.sort(), [alice, bob].sort());
  assert.ok(!seenByA.includes(carol), 'must not see the other team');

  const seenByB = await scope.memberIdsForSupervisor(supB);
  assert.deepEqual(seenByB, [carol]);
});

test('a supervisor with no team sees nobody', { skip: skip() }, async () => {
  const lonely = await makeUser(pool, { name: 'Lonely', email: 'lonely@t.local', role: 'supervisor' });
  assert.deepEqual(await scope.memberIdsForSupervisor(lonely), []);
});

test('supervises() agrees with the id list, including the negative case', { skip: skip() }, async () => {
  const { supA, alice, carol } = await twoTeams();
  assert.equal(await scope.supervises(supA, alice), true);
  assert.equal(await scope.supervises(supA, carol), false);
  // String ids arrive from route params; the check must still hold.
  assert.equal(await scope.supervises(supA, String(alice)), true);
});

test('a member shared across teams is visible to both supervisors', { skip: skip() }, async () => {
  const { supA, supB, alice, teamB } = await twoTeams();
  await addTeamMember(pool, teamB, alice);
  assert.ok((await scope.memberIdsForSupervisor(supA)).includes(alice));
  assert.ok((await scope.memberIdsForSupervisor(supB)).includes(alice));
});

test('teammateIds excludes the member themselves and other teams', { skip: skip() }, async () => {
  const { alice, bob, carol } = await twoTeams();
  const mates = await scope.teammateIds(alice);
  assert.deepEqual(mates, [bob]);
  assert.ok(!mates.includes(alice), 'never yourself');
  assert.ok(!mates.includes(carol), 'never another team');
});

test('collaboration cohort excludes inactive members and non-members', { skip: skip() }, async () => {
  const { alice, bob, teamA } = await twoTeams();
  const inactive = await makeUser(pool, { name: 'Gone', email: 'gone@t.local', status: 'inactive' });
  const supervisorInTeam = await makeUser(pool, { name: 'Sup C', email: 'supc@t.local', role: 'supervisor' });
  await addTeamMember(pool, teamA, inactive);
  await addTeamMember(pool, teamA, supervisorInTeam);

  const cohort = await scope.collaborationCohortIds(alice);
  assert.deepEqual(cohort, [bob]);
  assert.ok(!cohort.includes(inactive), 'inactive accounts are not rateable');
  assert.ok(!cohort.includes(supervisorInTeam), 'collaboration is member-to-member');
});

test('canCollaborateReview refuses self-rating and cross-team rating', { skip: skip() }, async () => {
  const { alice, bob, carol } = await twoTeams();
  assert.equal(await scope.canCollaborateReview(alice, bob), true);
  assert.equal(await scope.canCollaborateReview(alice, alice), false, 'no self-rating');
  assert.equal(await scope.canCollaborateReview(alice, carol), false, 'no cross-team rating');
});

test('teamIdsForSupervisor returns only owned teams', { skip: skip() }, async () => {
  const { supA, teamA, teamB } = await twoTeams();
  const ids = await scope.teamIdsForSupervisor(supA);
  assert.deepEqual(ids, [teamA]);
  assert.ok(!ids.includes(teamB));
});
