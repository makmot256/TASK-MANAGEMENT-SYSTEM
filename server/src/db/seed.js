import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';

const PW = 'Password@123';
const COLORS = ['#2563eb', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#9333ea', '#0891b2', '#ca8a04'];

const daysAgo = (d) => {
  const x = new Date(Date.now() - d * 864e5);
  return x.toISOString().slice(0, 19).replace('T', ' ');
};
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function reset() {
  const tables = [
    'notifications', 'activity_logs', 'engagement_scores', 'performance_scores',
    'supervisor_assessments', 'peer_assessments', 'evaluation_cycles',
    'report_comments', 'submission_files', 'submissions',
    'task_status_history', 'task_assignments', 'subtasks', 'tasks',
    'team_members', 'team_supervisors', 'teams', 'login_audit', 'password_resets',
  ];
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await pool.query(`DELETE FROM \`${t}\``);
  // keep admin, remove other users
  await pool.query(`DELETE FROM users WHERE role <> 'admin'`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function createUser(name, email, role, color, createdAt) {
  const hash = await bcrypt.hash(PW, 10);
  const [r] = await pool.execute(
    `INSERT INTO users (full_name, email, password_hash, role, status, avatar_color, title, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    [name, email, hash, role, color, role === 'supervisor' ? 'Team Lead' : 'Member', createdAt]
  );
  return r.insertId;
}

async function main() {
  console.log('> Resetting demo data...');
  await reset();

  console.log('> Creating users...');
  const sup1 = await createUser('Sarah Mukasa', 'sarah@tms.local', 'supervisor', '#2563eb', daysAgo(60));
  const sup2 = await createUser('David Okello', 'david@tms.local', 'supervisor', '#0d9488', daysAgo(60));

  const memberDefs = [
    ['Grace Achieng', 'grace@tms.local', 0.95],
    ['Brian Mugisha', 'brian@tms.local', 0.8],
    ['Patricia Nalwoga', 'patricia@tms.local', 0.6],
    ['Kevin Ssemwanga', 'kevin@tms.local', 0.3],   // will be at-risk
    ['Linda Auma', 'linda@tms.local', 0.85],
    ['Joseph Kato', 'joseph@tms.local', 0.2],       // will be at-risk
  ];
  const members = [];
  for (let i = 0; i < memberDefs.length; i++) {
    const [name, email, activity] = memberDefs[i];
    const id = await createUser(name, email, 'member', COLORS[i % COLORS.length], daysAgo(40));
    members.push({ id, name, email, activity });
  }

  console.log('> Creating teams...');
  const [t1] = await pool.execute(`INSERT INTO teams (name, description) VALUES (?, ?)`, [
    'Engineering Cohort A', 'Backend & data engineering interns',
  ]);
  const [t2] = await pool.execute(`INSERT INTO teams (name, description) VALUES (?, ?)`, [
    'Engineering Cohort B', 'Frontend & product interns',
  ]);
  const team1 = t1.insertId, team2 = t2.insertId;
  await pool.execute(`INSERT INTO team_supervisors (team_id, supervisor_id) VALUES (?, ?), (?, ?)`, [team1, sup1, team1, sup2]);
  await pool.execute(`INSERT INTO team_supervisors (team_id, supervisor_id) VALUES (?, ?), (?, ?)`, [team2, sup1, team2, sup2]);
  for (let i = 0; i < members.length; i++) {
    const primaryTeam = i < 3 ? team1 : team2;
    await pool.execute(`INSERT INTO team_members (team_id, member_id) VALUES (?, ?)`, [primaryTeam, members[i].id]);
    // Demo: first two members belong to both teams
    if (i < 2) {
      await pool.execute(`INSERT IGNORE INTO team_members (team_id, member_id) VALUES (?, ?)`, [
        i < 3 ? team2 : team1, members[i].id,
      ]);
    }
  }

  console.log('> Creating evaluation cycle...');
  await pool.execute(
    `INSERT INTO evaluation_cycles (name, start_date, end_date, status) VALUES (?, ?, ?, 'open')`,
    ['Sprint Cycle 1', daysAgo(14).slice(0, 10), daysAgo(-7).slice(0, 10)]
  );

  console.log('> Creating tasks, assignments, submissions, feedback...');
  const taskTitles = [
    'Design the database schema', 'Implement authentication API', 'Build the analytics dashboard',
    'Write unit tests for tasks module', 'Create the reports upload flow', 'Optimise SQL queries',
    'Document the REST API', 'Implement notification system',
  ];
  const priorities = ['High', 'Medium', 'Low'];
  const statuses = ['To-Do', 'In Progress', 'Under Review', 'Completed'];

  for (let i = 0; i < taskTitles.length; i++) {
    const creator = i % 2 === 0 ? sup1 : sup2;
    const team = i % 2 === 0 ? team1 : team2;
    const deadline = daysAgo(rand(-10, 7));
    const [tr] = await pool.execute(
      `INSERT INTO tasks (title, description, priority, start_date, deadline, team_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskTitles[i], `Detailed work for: ${taskTitles[i]}.`, pick(priorities), daysAgo(20).slice(0, 10), deadline, team, creator, daysAgo(20)]
    );
    const taskId = tr.insertId;

    // subtasks
    for (const st of ['Plan approach', 'Implement', 'Review & polish']) {
      await pool.execute(`INSERT INTO subtasks (task_id, title, is_done) VALUES (?, ?, ?)`, [taskId, st, rand(0, 1)]);
    }

    const assignees = members.filter((m) => (i % 2 === 0 ? m.id <= members[2].id : m.id > members[2].id));
    for (const m of assignees) {
      const status = Math.random() < m.activity ? pick(['Completed', 'Completed', 'Under Review', 'In Progress']) : pick(statuses);
      const completed = status === 'Completed';
      const onTime = completed ? (Math.random() < m.activity ? 1 : 0) : null;
      const [ar] = await pool.execute(
        `INSERT INTO task_assignments (task_id, member_id, status, assigned_at, started_at, completed_at, on_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [taskId, m.id, status, daysAgo(20), daysAgo(18), completed ? daysAgo(rand(1, 10)) : null, onTime]
      );
      await pool.execute(
        `INSERT INTO task_status_history (assignment_id, old_status, new_status, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)`,
        [ar.insertId, status, m.id, daysAgo(15)]
      );

      // submissions for completed / under review
      if (status === 'Completed' || status === 'Under Review') {
        const isLate = onTime === 0 ? 1 : 0;
        const [sr] = await pool.execute(
          `INSERT INTO submissions (task_id, assignment_id, member_id, content, kind, is_late, submitted_at)
           VALUES (?, ?, ?, ?, 'weekly_report', ?, ?)`,
          [taskId, ar.insertId, m.id, `Weekly progress report for ${taskTitles[i]}. Completed the core implementation and ran initial tests.`, isLate, daysAgo(rand(1, 9))]
        );
        const subId = sr.insertId;
        // supervisor feedback + assessment
        if (Math.random() < 0.7) {
          await pool.execute(
            `INSERT INTO report_comments (submission_id, author_id, body, created_at) VALUES (?, ?, ?, ?)`,
            [subId, creator, pick(['Great work, well structured.', 'Good progress. Please add more detail on testing.', 'Solid effort, address the edge cases next time.']), daysAgo(rand(1, 6))]
          );
          await pool.execute(
            `INSERT INTO supervisor_assessments (submission_id, member_id, supervisor_id, quality_score, responsiveness_score, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [subId, m.id, creator, rand(3, 5), pick([5, 3, 1]), daysAgo(rand(1, 6))]
          );
        }
      }
    }
  }

  console.log('> Creating peer & collaboration assessments...');
  const [cyc] = await pool.query(`SELECT id FROM evaluation_cycles ORDER BY id DESC LIMIT 1`);
  const cycleId = cyc[0].id;
  for (const assessor of members) {
    // active members submit peer reviews; low-activity members skip (=> penalty)
    if (assessor.activity < 0.4) continue;
    for (const assessee of members) {
      if (assessee.id === assessor.id) continue;
      if (Math.random() < 0.5) {
        await pool.execute(
          `INSERT IGNORE INTO peer_assessments (cycle_id, assessor_id, assessee_id, kind, score, comment, created_at)
           VALUES (?, ?, ?, 'peer_review', ?, ?, ?)`,
          [cycleId, assessor.id, assessee.id, rand(3, 5), pick(['Helpful contributor.', 'Strong technical work.', 'Reliable teammate.']), daysAgo(rand(1, 10))]
        );
      }
      if (Math.random() < 0.5) {
        await pool.execute(
          `INSERT IGNORE INTO peer_assessments (cycle_id, assessor_id, assessee_id, kind, score, comment, created_at)
           VALUES (?, ?, ?, 'collaboration', ?, ?, ?)`,
          [cycleId, assessor.id, assessee.id, rand(2, 5), pick(['Communicates well.', 'Always available to help.', 'Could engage more in standups.']), daysAgo(rand(1, 10))]
        );
      }
    }
  }

  console.log('> Generating activity logs (drives engagement scores)...');
  for (const m of members) {
    for (let d = 0; d < 21; d++) {
      // active members log in most days; inactive ones rarely
      if (Math.random() < m.activity) {
        await pool.execute(`INSERT INTO activity_logs (user_id, action_type, created_at) VALUES (?, 'login', ?)`, [m.id, daysAgo(d)]);
        if (Math.random() < m.activity) {
          await pool.execute(`INSERT INTO activity_logs (user_id, action_type, created_at) VALUES (?, 'task_update', ?)`, [m.id, daysAgo(d)]);
        }
      }
    }
  }

  console.log('> Computing initial scores...');
  const { recomputeAllPerformance } = await import('../services/performance.service.js');
  const { recomputeAllEngagement } = await import('../services/engagement.service.js');
  await recomputeAllPerformance();
  await recomputeAllEngagement();

  console.log('\n  Demo data seeded successfully!');
  console.log('  ----------------------------------------------------');
  console.log('  Login credentials (password for all demo users below):');
  console.log(`     Password: ${PW}`);
  console.log('  Admin:       admin@tms.local  (password from .env, default Admin@123)');
  console.log('  Supervisors: sarah@tms.local | david@tms.local');
  console.log('  Members:     grace@tms.local | brian@tms.local | patricia@tms.local');
  console.log('               kevin@tms.local | linda@tms.local | joseph@tms.local');
  console.log('  ----------------------------------------------------\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
