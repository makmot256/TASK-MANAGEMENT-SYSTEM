# Issues & Remediation

Findings from a read of the codebase as of commit `dc6698e` (branch `main`). Each entry
gives the evidence, what actually goes wrong, and a concrete fix.

Nothing here is fixed — this is a work list, not a changelog.

## Severity scale

| Level | Meaning |
| --- | --- |
| **High** | Exploitable, or silently corrupts data/scores that people act on. Fix before any real deployment. |
| **Medium** | Wrong behaviour under realistic conditions, or a stated control that isn't implemented. |
| **Low** | Correctness or hygiene debt with limited blast radius. |

## Priority order

If you fix things in one pass, this order clears the most risk per unit of work:

1. **S2** JWT secret fallback — one line, removes a total-compromise path
2. **S1** Unauthenticated `/uploads` — the only unauthenticated read path to member work
3. **S3** Login brute-force — no lockout at all today
4. **S4** Reset-link header poisoning — account takeover via a legitimate email
5. **C2** `on_time` never set on supervisor completion — every Performance Index is wrong
6. **C1** Duplicate collaboration ratings — Peer Evaluation is inflatable at will
7. **D1** Reassignment destroys submitted work — irreversible data loss
8. **H1** Self-referential dependency — breaks clean installs
9. Everything else

---

# Security

## S1 · `/uploads` is served with no authentication — **High**

**Where** `server/src/index.js:33`, `server/src/middleware/upload.js:7`

```js
app.use('/uploads', express.static(uploadRoot));
```

**What happens.** Task briefings, submission attachments and profile avatars all land in one
flat directory. The scope-checked download routes
(`GET /api/tasks/:taskId/files/:fileId`, `GET /api/submissions/:id/files/:fileId`) verify the
caller before streaming — but `express.static` serves the same directory to anyone who knows
a filename, with no token required.

**Why it matters.** Filenames are `<epoch-ms>-<8 random bytes><ext>`, so they aren't trivially
enumerable, but they leak through any shared link, browser history, proxy log or referrer.
Once leaked, a submission attachment is readable by an unauthenticated stranger — including
after the member is deactivated or deleted.

**Reproduce.** Upload a report attachment, read its `stored_name` from `submission_files`,
then fetch `http://localhost:4000/uploads/<stored_name>` in a private window with no token.

**Fix.** Split the storage roots so only avatars are public:

```js
// upload.js
const uploadRoot  = path.resolve(process.cwd(), env.uploadDir);          // private
const avatarRoot  = path.resolve(uploadRoot, 'avatars');                 // public
// point avatarUpload's diskStorage at avatarRoot, `upload` at uploadRoot

// index.js
app.use('/uploads/avatars', express.static(avatarRoot));   // and nothing else
```

Existing `avatar_url` values (`/uploads/<file>`) need a one-off migration to
`/uploads/avatars/<file>` plus a file move.

---

## S2 · `JWT_SECRET` silently falls back to a known string — **High**

**Where** `server/src/config/env.js:19`

```js
jwtSecret: process.env.JWT_SECRET || 'dev_insecure_secret_change_me',
```

**What happens.** A deployment that forgets `server/.env`, or that ships an `.env` with the
key commented out, boots normally and signs tokens with a string that is committed to this
repository.

**Why it matters.** Anyone with the source can mint a valid admin token. There is no startup
warning, no health-check signal, and no way to notice from the outside.

**Fix.** Fail fast outside development:

```js
const secret = process.env.JWT_SECRET;
if (!secret && (process.env.NODE_ENV || 'development') !== 'development') {
  console.error('[env] JWT_SECRET is required outside development. Refusing to start.');
  process.exit(1);
}
if (!secret) console.warn('[env] JWT_SECRET unset — using an insecure development key.');
```

---

## S3 · No rate limiting or lockout on login — **High**

**Where** `server/src/routes/auth.routes.js:30`

**What happens.** `login_audit` faithfully records every failed attempt with IP and
user-agent — and nothing reads it. There is no delay, no lockout, no CAPTCHA, no per-IP cap.
The same is true for `POST /forgot-password` and `POST /reset-password`.

**Why it matters.** With an 8-character minimum password policy (see S10), an unthrottled
endpoint makes online guessing practical. bcrypt cost 10 slows a single attempt to roughly
50–100 ms, which is not a substitute for throttling — it also means an attacker can
trivially exhaust the 10-connection pool with concurrent login requests.

**Fix.** Two layers. First, a general limiter (`express-rate-limit`) on `/api/auth/*`.
Second, an account-aware check that reuses the audit data you already collect:

```js
const [[recent]] = await pool.query(
  `SELECT COUNT(*) AS c FROM login_audit
    WHERE email = ? AND success = 0 AND created_at > (NOW() - INTERVAL 15 MINUTE)`,
  [email || '']
);
if (Number(recent.c) >= 10) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
```

Apply the same window per `ip_address` so distributed guessing against many accounts is
caught too.

---

## S4 · Reset link is built from the attacker-controlled `Origin` header — **High**

**Where** `server/src/routes/auth.routes.js:153`

```js
const link = `${req.headers.origin || ''}/reset-password?token=${token}`;
```

**What happens.** `Origin` is supplied by whoever sends the request. An attacker calls
`POST /api/auth/forgot-password` for a victim's address with
`Origin: https://evil.example`, and the victim receives a genuine email from the genuine
system containing a link to the attacker's domain — carrying a valid, unused reset token.

**Why it matters.** This is account takeover through a message the victim has every reason to
trust. The email body also prints the raw token in plaintext (`Reset token: ${token}`), so a
mail-log or forwarding leak is equally sufficient.

**Fix.** Never derive the link from request headers. Use a configured base URL, and drop the
raw token from the body:

```js
// env.js
publicUrl: process.env.PUBLIC_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173',

// auth.routes.js
const link = `${env.publicUrl}/reset-password?token=${token}`;
await sendMail({ to: email, subject: '...', text: `Reset your password (valid 1 hour): ${link}` });
```

---

## S5 · Idle session timeout is configured but not implemented — **Medium**

**Where** `server/src/config/env.js:21`, `server/.env.example:17-18`

```js
// "Session inactivity in minutes (SRS 5.2: sessions expire after 30 min)"
sessionIdleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),
```

`sessionIdleMinutes` is read into config and referenced nowhere else in the codebase. Real
session length is the JWT's `expiresIn`, default **8 hours**, with no idle component — a
token left in `localStorage` on a shared machine stays valid all day.

**Fix.** Either implement it or delete the setting; leaving a documented control unimplemented
is worse than not claiming it. To implement, put a `lastSeen` timestamp in the token claims
and re-issue on activity, or track last-activity server-side:

```js
// middleware/auth.js, after loading the user
const idleMs = env.sessionIdleMinutes * 60_000;
if (payload.iat && Date.now() - payload.iat * 1000 > idleMs) {
  return res.status(401).json({ message: 'Session expired due to inactivity.' });
}
```

with the client refreshing its token on activity. Shortening `JWT_EXPIRES_IN` to `30m` plus a
refresh endpoint is the simpler equivalent.

---

## S6 · `must_reset` is set but never enforced — **Medium**

**Where** `server/src/routes/admin.routes.js:104,144`; `auth.routes.js:134,179`

Admin-provisioned accounts and admin password resets both set `must_reset = 1`, and both
password-change paths clear it — but **no login path reads it**. A user handed a temporary
password can keep it indefinitely.

**Fix.** Return the flag from login and `/auth/me`, and gate the app on it:

```js
// auth.routes.js — add must_reset to USER_PUBLIC_FIELDS
// client App.tsx — before routesByRole
if (user.must_reset) return <ForcePasswordChange />;
```

Server-side, reject every non-auth route with `403 { code: 'must_reset' }` while the flag is
set, so the gate can't be skipped by calling the API directly.

---

## S7 · Peer-review anonymity depends on column selection alone — **Medium**

**Where** `server/src/routes/peer.routes.js:99`; `server/src/db/schema.sql:279`

`peer_assessments` stores `assessor_id`. Anonymity exists purely because `GET /api/peer/mine`
never selects it. The schema comment says so explicitly: *"One-directional anonymity is
enforced at the API layer (not the schema)."*

**Why it matters.** One `SELECT *` added to a member-facing route de-anonymises every reviewer
retroactively — and the failure is invisible in review unless someone thinks about it.

**Fix.** Make the guarantee structural. Create a view that member routes are required to use:

```sql
CREATE VIEW peer_assessments_anon AS
SELECT id, submission_id, cycle_id, assessee_id, kind, score, comment, created_at
  FROM peer_assessments;
```

Then have every member-scoped handler query the view, and add a test that fails if
`assessor_id` appears in any response body from a `member`-role request.

---

## S8 · Upload filter accepts on *either* MIME type or extension; no `nosniff` — **Low**

**Where** `server/src/middleware/upload.js:29-32,40-46`

```js
if (ALLOWED.has(file.mimetype) || /\.(pdf|docx?)$/i.test(file.originalname)) cb(null, true);
```

The `||` means a file passes if *either* check succeeds, so arbitrary content can be stored
under a `.pdf` name, or with a spoofed `Content-Type` under any name. Combined with S1's
static mount and the absence of `X-Content-Type-Options: nosniff`, that widens the surface
for content-type confusion.

**Fix.** Require both, and set the header:

```js
if (ALLOWED.has(file.mimetype) && /\.(pdf|docx?)$/i.test(file.originalname)) cb(null, true);
// index.js
app.use(helmet({ contentSecurityPolicy: false }));  // or at minimum:
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
```

Serve attachments with `Content-Disposition: attachment` (which `res.download()` already does)
and never inline.

---

## S9 · Upload volume is effectively unbounded — **Medium**

**Where** `server/src/middleware/upload.js:28`; `server/.env.example:22-23`

```
MAX_UPLOAD_MB=1024      # per file
MAX_UPLOAD_FILES=10     # per request
```

Any authenticated member can push **10 GB per request** to local disk, repeatedly, with no
quota, no total-size cap, and no cleanup. Multer writes to disk as it streams, so the disk
fills before any handler code runs.

**Why it matters.** A full disk takes down MySQL on the same host. This needs no
sophistication — a bored user with a large file does it by accident.

**Fix.** Lower the default to something a report actually needs (25 MB is generous for
PDF/DOCX), add a per-request total, and add a per-member storage quota checked before accepting:

```
MAX_UPLOAD_MB=25
MAX_UPLOAD_FILES=10
```

Pair with monitoring on the uploads directory, and see D4 for reclaiming orphans.

---

## S10 · Password policy is weak — **Low**

**Where** `server/src/utils/password.js:7-9`

```js
return typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
```

`Password1` passes. There is no check against common passwords, no length bonus, no
rejection of the email local-part.

**Fix.** Raise the minimum to 12, or drop the composition rules in favour of a strength
estimator (`zxcvbn`) with a minimum score — composition rules push users toward
`Password1!` while a length floor genuinely helps.

---

## S11 · The last admin can lock everyone out — **Low**

**Where** `server/src/routes/admin.routes.js:119,150`

`DELETE /users/:id` refuses self-deletion, but nothing stops the sole admin from
demoting themselves via `PATCH /users/:id { role: 'member' }`, or from deleting the only
*other* admin and then being deactivated by a `status` change. There is no recovery path
short of direct SQL.

**Fix.** Guard both handlers:

```js
const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'`);
const demoting = role && role !== 'admin';
if (c <= 1 && Number(req.params.id) === req.user.id && (demoting || status === 'inactive')) {
  throw new HttpError(400, 'The last active administrator cannot be demoted or deactivated.');
}
```

---

# Correctness & scoring

## C1 · Duplicate collaboration ratings inflate Peer Evaluation — **High**

**Where** `server/src/routes/peer.routes.js:72-82`; `server/src/db/schema.sql:292`

```sql
UNIQUE KEY uq_assessment (cycle_id, assessor_id, assessee_id, kind)
```

```js
const [cycles] = await pool.execute(
  `SELECT id FROM evaluation_cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1`
);
const cycleId = cycles[0]?.id || null;          // ← null when no open cycle
```

**What happens.** MySQL treats NULLs as distinct in a UNIQUE index, so when `cycle_id` is
NULL the key enforces nothing and `ON DUPLICATE KEY UPDATE` never fires. Every submitted
collaboration rating inserts a **new row**.

No endpoint creates or opens an evaluation cycle — the only `INSERT INTO evaluation_cycles`
in the codebase is in `db/seed.js:85`. So a production install set up with `db:setup` and no
demo seed has **no cycle at all**, and is in this state permanently.

**Why it matters.** `PE` averages received collaboration scores:
`(Σ collab / 5m) × 0.5`. A member can rate one teammate 5/5 fifty times and lift that
teammate's PE component to its ceiling — or rate them 1/5 fifty times and floor it. PE carries
weight 0.35 in the Performance Index, so this is directly falsifiable performance data.

**Reproduce.** On a `db:setup`-only database, `POST /api/peer` twice with the same
`{ kind: 'collaboration', assessee_id, score }`. Two rows appear in `peer_assessments`.

**Fix.** Two parts.

1. Stop relying on a nullable column for uniqueness. Use a sentinel instead of NULL:

```sql
ALTER TABLE peer_assessments MODIFY cycle_id BIGINT UNSIGNED NOT NULL DEFAULT 0;
```
(and drop the FK, or keep a permanent row with `id = 0` representing "no cycle")

2. Guarantee an open cycle exists rather than falling back to NULL:

```js
async function currentCycleId() {
  const [rows] = await pool.execute(
    `SELECT id FROM evaluation_cycles WHERE status='open' ORDER BY id DESC LIMIT 1`
  );
  if (rows.length) return rows[0].id;
  const [r] = await pool.execute(
    `INSERT INTO evaluation_cycles (name, start_date, end_date, status)
     VALUES (CONCAT('Auto ', DATE_FORMAT(NOW(), '%Y-%m')), CURDATE(),
             LAST_DAY(CURDATE()), 'open')`
  );
  return r.insertId;
}
```

Then add admin endpoints to open and close cycles — the table exists for a reason, and today
nothing drives it.

**Cleanup.** Existing databases need de-duplication before the constraint will apply:

```sql
DELETE p1 FROM peer_assessments p1
  JOIN peer_assessments p2
    ON p1.assessor_id = p2.assessor_id AND p1.assessee_id = p2.assessee_id
   AND p1.kind = p2.kind AND p1.cycle_id <=> p2.cycle_id AND p1.id < p2.id;
```

---

## C2 · `on_time` is never set when a supervisor completes an assignment — **High**

**Where** `server/src/routes/reports.routes.js:386-389` vs `tasks.routes.js:243-246`

Member-driven completion sets it:

```js
if (status === 'Completed') {
  const onTime = a.deadline ? (new Date() <= new Date(a.deadline) ? 1 : 0) : 1;
  extra = `, completed_at = NOW(), on_time = ${onTime}`;
}
```

Supervisor approval does not:

```js
} else if (mark_completed) {
  await pool.execute(
    `UPDATE task_assignments SET status = 'Completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = ?`,
    [sub.assignment_id]
  );
}
```

**What happens.** `on_time` stays NULL. Task Performance is
`(completed / assigned) × (on_time / completed)` — the completion counts in the numerator of
the first factor but contributes nothing to the second.

**Why it matters.** This is the *normal* path for any task that goes through review. A member
who submits everything early and has every submission approved by their supervisor scores
`timeliness = 0`, hence `TP = 0`, hence loses the full 0.25 weight. The members most engaged
with the review workflow are penalised hardest. Every Performance Index currently displayed
is affected.

**Fix.** Mirror the member path, computing against the task deadline:

```js
} else if (mark_completed) {
  await pool.execute(
    `UPDATE task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
        SET ta.status = 'Completed',
            ta.completed_at = COALESCE(ta.completed_at, NOW()),
            ta.on_time = COALESCE(ta.on_time,
                          CASE WHEN t.deadline IS NULL OR ? <= t.deadline THEN 1 ELSE 0 END)
      WHERE ta.id = ?`,
    [sub.submitted_at, sub.assignment_id]
  );
}
```

Judging against the **submission** timestamp rather than the approval timestamp is the fairer
reading — a member shouldn't be marked late because their supervisor reviewed slowly.

**Backfill.** After fixing, repair history:

```sql
UPDATE task_assignments ta JOIN tasks t ON t.id = ta.task_id
   SET ta.on_time = CASE WHEN t.deadline IS NULL OR ta.completed_at <= t.deadline THEN 1 ELSE 0 END
 WHERE ta.status = 'Completed' AND ta.on_time IS NULL;
```

---

## C3 · Weekly TP has a falsy-zero fallback — **Medium**

**Where** `server/src/routes/analytics.routes.js:96`

```js
const tp = Math.max(0, Math.min(1, (Math.min(completed, 5) / 5) * (completed ? timeliness || 0.5 : 0)));
```

**What happens.** `timeliness || 0.5` is JavaScript falsy coalescing, not a null check. A week
in which the member completed tasks and **none** were on time gives `timeliness === 0`, which
is falsy, so the expression substitutes `0.5` — the same value used for "we don't know".

**Why it matters.** A completely-late week scores identically to a week with no timeliness
data. The weekly chart on the supervisor dashboard therefore cannot show a member missing
every deadline. It also silently diverges from the lifetime formula, which correctly scores
that case as 0.

**Fix.** Distinguish "no data" from "zero":

```js
const known = completed > 0 && onTimeIsRecorded;   // count rows where on_time IS NOT NULL
const factor = completed === 0 ? 0 : (known ? timeliness : 0.5);
const tp = clamp01((Math.min(completed, 5) / 5) * factor);
```

C2 is the root cause of the NULLs this was papering over — fix C2 first, then this fallback
can go away entirely.

---

## C4 · `logActivity('profile_update')` is silently discarded — **Low**

**Where** `server/src/routes/auth.routes.js:114`; `schema.sql:367`

```js
await logActivity(req.user.id, 'profile_update', { email }, clientIp(req));
```

```sql
action_type ENUM('login','task_update','submission','comment','view','peer_review')
```

`'profile_update'` is not a member of the enum. Under `STRICT_TRANS_TABLES` (MySQL 8's
default) the insert errors, and `logActivity` swallows it in a bare `catch {}`. The event is
lost with no signal.

**Fix.** Pick one: add the value to the enum (in both `schema.sql` and `migrate.js`), or drop
the call. Separately, `logActivity`'s silent catch should at least `console.warn` — a logging
layer that fails invisibly is worse than one that fails loudly.

---

## C5 · Performance Index weights are neither validated nor normalised — **Low**

**Where** `server/src/services/performance.service.js:75`; `services/settings.service.js`

`PUT /api/admin/settings` accepts any numeric value for `pi_weight_tp`, `pi_weight_pe`,
`pi_weight_sa`. They are used directly and the result is clamped to `[0, 1]`. Set all three to
`1.0` and every member with any activity pins at PI = 1.0.

**Fix.** Validate at the write endpoint that the three sum to 1.0 (±0.001), or normalise at
read time in `getSettings()`. Validating at write is clearer — it tells the admin they made a
mistake instead of quietly changing what they typed.

---

# Data integrity

## D1 · Reassigning a task destroys the removed member's submitted work — **High**

**Where** `server/src/routes/tasks.routes.js:297-299`; `schema.sql:222`

```js
for (const memberId of toRemove) {
  await conn.execute(`DELETE FROM task_assignments WHERE task_id = ? AND member_id = ?`, [taskId, memberId]);
}
```

```sql
CONSTRAINT fk_sub_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments (id) ON DELETE CASCADE
```

**What happens.** Removing a member from a task via `PATCH /api/tasks/:id` deletes their
assignment, which cascades to **every submission they made against it**, their attachment
rows, all supervisor feedback comments, all peer assessments tied to those submissions, and
the peer review assignments other members still owe. The files remain on disk, orphaned and
unreferenced.

**Why it matters.** This is irreversible, and it is triggered by an ordinary editing action
that reads as low-stakes ("update who's on this task"). There is no confirmation and no
audit trail of what was destroyed.

**Fix.** Refuse to remove an assignee who has submitted anything:

```js
const [[{ n }]] = await conn.execute(
  `SELECT COUNT(*) AS n FROM submissions s
     JOIN task_assignments ta ON ta.id = s.assignment_id
    WHERE ta.task_id = ? AND ta.member_id = ?`,
  [taskId, memberId]
);
if (n > 0) throw new HttpError(409,
  `${name} has already submitted work for this task and cannot be unassigned.`);
```

Better still, add an `unassigned_at` column and soft-remove, so history survives and the
supervisor can undo.

---

## D2 · Editing subtasks wipes completion state and assignees — **Medium**

**Where** `server/src/routes/tasks.routes.js:318-330`

```js
if (Array.isArray(subtasks)) {
  await conn.execute(`DELETE FROM subtasks WHERE task_id = ?`, [taskId]);
  // ...then re-INSERT from the strings
}
```

Subtasks are addressed by title string, so the delete-and-recreate discards `is_done` and
`assigned_to` for every row — including ones the supervisor didn't touch. A supervisor fixing
a typo in one subtask silently un-checks the team's completed items and drops every
sub-assignment.

**Fix.** Send subtasks as objects with ids and reconcile:

```js
// { id?: number, title: string, is_done?: 0|1, assigned_to?: number|null }
// UPDATE rows with an id, INSERT rows without one, DELETE ids no longer present
```

---

## D3 · `member_ids` type mismatch can delete every assignee — **Medium**

**Where** `server/src/routes/tasks.routes.js:293-295`

```js
const currentIds = current.map((r) => r.member_id);          // numbers, from MySQL
const toAdd    = member_ids.filter((m) => !currentIds.includes(Number(m)));   // coerced ✅
const toRemove = currentIds.filter((m) => !member_ids.includes(m));           // not coerced ❌
```

The two comparisons are asymmetric. If `member_ids` arrives as strings — which
`POST /api/tasks` explicitly tolerates via `parseJsonArray`, and which any non-browser client
may send — then `member_ids.includes(m)` compares `"7"` to `7` and returns false for
everyone. `toRemove` becomes **the entire current roster**, while `toAdd` correctly skips them,
so all existing assignees are unassigned and not re-added, taking their submissions with them
(see D1).

The bundled UI happens to send numbers and never calls this endpoint today, so it is latent —
but it's one integration away from firing.

**Fix.** Normalise once at the top of the handler:

```js
const memberIds = Array.isArray(member_ids) ? [...new Set(member_ids.map(Number).filter(Boolean))] : null;
```

and use `memberIds` for both comparisons.

---

## D4 · Uploaded files are never deleted — **Low**

**Where** `tasks.routes.js:53`, `reports.routes.js:46`, `tasks.routes.js:338`

Multer writes to disk before the enclosing transaction begins, so a rollback leaves the files
behind. Deleting a task cascades every database row but touches no file. The only cleanup
anywhere is the avatar replacement in `auth.routes.js:105`.

**Fix.** Unlink on transaction failure:

```js
try {
  const taskId = await withTransaction(...);
} catch (err) {
  await Promise.all(files.map((f) => fs.promises.unlink(path.join(uploadRoot, f.filename)).catch(() => {})));
  throw err;
}
```

and add a periodic sweep — a job that lists `uploadRoot` and removes anything with no matching
row in `task_files`, `submission_files`, or `users.avatar_url`.

---

## D5 · Submission creation is not transactional — **Low**

**Where** `server/src/routes/reports.routes.js:39-55`

The `submissions` insert, the per-file `submission_files` inserts, and the
`task_assignments.status = 'Under Review'` update are four separate statements with no
transaction. A failure between them leaves a submission with missing file rows, or a
submission whose assignment never advanced.

**Fix.** Wrap in `withTransaction`, exactly as `POST /api/tasks` already does. Keep the peer
reviewer assignment *outside* the transaction — it is intentionally best-effort.

---

## D6 · `DELETE /api/tasks/:id` reports success on a no-op — **Low**

**Where** `server/src/routes/tasks.routes.js:342-345`

```js
await pool.execute(`DELETE FROM tasks WHERE id = ? AND (created_by = ? OR ? = 'admin')`, [...]);
res.json({ message: 'Task deleted.' });
```

A supervisor deleting another supervisor's task matches zero rows and still receives
`Task deleted.` The UI removes it from the list; a refresh brings it back.

**Fix.** Check `affectedRows` and return `403` (or `404`) when it's zero.

---

# Performance

## P1 · Analytics runs N+1 queries in nested loops — **Medium**

**Where** `server/src/routes/analytics.routes.js:179-189` and `263-287`

```js
for (const m of memberRows) {
  const perf = await computePerformanceForMember(m.id, settings);   // ~6 queries
  const eng  = await computeEngagementForMember(m.id, settings);    // ~5 queries
}
```

`/overview` costs roughly 11 sequential round-trips per member. `/weekly` is worse — it loops
weeks × members, each iteration issuing 4 queries: **20 members × 8 weeks × 4 ≈ 640 awaited
queries** for one page load, against a 10-connection pool.

**Why it matters.** The supervisor dashboard is the most-visited screen for the role that uses
the system most. Latency grows linearly with team size and week count, and a handful of
concurrent supervisors saturates the pool — at which point unrelated requests queue behind it.

**Fix.** Replace the per-member queries with set-based aggregates. The weekly path in
particular collapses to one query per metric across all members and all weeks:

```sql
SELECT member_id,
       YEARWEEK(completed_at, 3) AS wk,
       COUNT(*) AS completed,
       SUM(on_time = 1) AS on_time
  FROM task_assignments
 WHERE member_id IN (?) AND status = 'Completed' AND completed_at >= ?
 GROUP BY member_id, wk
```

Then pivot in JavaScript. Four such queries replace all 640. As an interim measure,
`Promise.all` over members would parallelise but still hammer the pool — batching is the real
fix.

---

## P2 · `performance_scores` and `task_status_history` are written but never read — **Low**

**Where** `services/performance.service.js:104`, `tasks.routes.js:67,252,306`

Every analytics endpoint recomputes from source tables, so the nightly performance snapshot
has no consumer at all. `task_status_history` receives a row on every transition and is never
queried. (`engagement_scores`, by contrast, has three real readers.)

**Fix.** Decide which way to go rather than leaving both half-built. Either surface them —
a PI trend chart from `performance_scores`, a status timeline on the task detail screen from
`task_status_history`, both of which the UI would benefit from — or stop writing them.
Leaving write-only tables invites someone to assume they're authoritative.

---

## P3 · Every session polls two endpoints every 30 seconds — **Low**

**Where** `client/src/components/Layout.tsx:76-87`

`GET /api/notifications` for all roles, plus `GET /api/submissions/review-pending-count` for
supervisors and admins — each on its own 30-second interval, running whether or not the tab is
visible.

**Fix.** Pause on `document.hidden`, back off when the tab is idle, and consider
Server-Sent Events for notifications — the payload is small and the endpoint is already
per-user.

---

# Robustness

## R1 · The Axios retry wrapper retries non-idempotent POSTs — **Medium**

**Where** `client/src/api/client.ts:14-31`

```js
if (config && retries < 2 && (networkErr || gatewayErr)) {
  config.__retryCount = retries + 1;
  await new Promise((r) => setTimeout(r, 800 + retries * 700));
  return api(config);
}
```

There is no method check. A `POST /api/tasks` or `POST /api/submissions` that reaches the
server and commits, but whose *response* is lost (proxy restart, dropped connection, 502 from
the Vite proxy), is replayed up to twice — creating duplicate tasks with duplicate assignment
notifications, or duplicate submissions each triggering its own set of peer review
assignments.

**Why it matters.** The retry exists specifically because `node --watch` restarts the API and
the Vite proxy returns a synthetic 502 during the gap — precisely the window in which a
request may already have been processed.

**Fix.** Restrict retries to idempotent methods:

```js
const method = (config?.method || 'get').toLowerCase();
const idempotent = ['get', 'head', 'options'].includes(method);
if (config && idempotent && retries < 2 && (networkErr || gatewayErr)) { ... }
```

If you want writes to survive restarts too, add an `Idempotency-Key` header and de-duplicate
server-side — but method-gating is the correct default.

---

## R2 · Peer reviewer assignment failures are swallowed — **Low**

**Where** `server/src/routes/reports.routes.js:60-64`

```js
try {
  peerAssign = await assignPeerReviewersForSubmission(submissionId, req.user.id, a.title);
} catch (err) {
  console.error('[peer-assign] submission assignment failed:', err.message);
}
```

Keeping the submission alive when reviewer selection fails is the right call. But the failure
leaves a submission that will never receive peer reviews, and nothing retries or flags it —
the supervisor sees "No peer reviewers were available to assign", which reads like an expected
empty-pool result rather than an error.

**Fix.** Distinguish the two outcomes in the message, and have the nightly job sweep for
submissions with zero `peer_review_assignments` rows and retry the assignment.

---

## R3 · `PATCH /api/admin/users/:id` doesn't validate enums — **Low**

**Where** `server/src/routes/admin.routes.js:119-135`

`role` and `status` are passed straight into the `UPDATE`. An invalid value produces a raw
MySQL error surfaced as a 500 with a database message, rather than a 400 the UI can show.

**Fix.** Validate against the same allowlists `POST /users` already uses.

---

# Project hygiene

## H1 · Both packages depend on their own parent — **Medium**

**Where** `server/package.json:26`, `client/package.json:17`

```json
"task-management-system": "file:.."
```

Server and client each declare a dependency on the **root** package, which is the repository
itself. It serves no purpose — nothing imports it — and it makes `npm install` resolve and
link the whole project into each workspace's `node_modules`, which is at best wasted work and
at worst a resolution loop on a clean checkout.

**Fix.** Delete both lines and the corresponding `package-lock.json` entries, then re-run
`npm run install-all` on a clean tree to confirm. If the intent was a monorepo, use npm
workspaces in the root `package.json` instead.

---

## H2 · There are no tests — **Medium**

No test files, no runner, no CI configuration anywhere in the repository.

**Why it matters.** The scoring engine is the system's whole value proposition and it is pure,
deterministic arithmetic over well-defined inputs — the single most testable thing here, and
the place where a silent regression (see C1, C2, C3) is hardest to notice by using the app.

**Fix.** Start narrow, with the highest-value targets:

- `computePerformanceForMember` — table-driven cases covering each penalty path, the zero-data
  case, and the clamping boundaries
- `computeEngagementForMember` — the 14-day cold-start guard and each status band edge
- `utils/scope.js` — the authorization queries, against a seeded fixture database
- One integration test per role asserting that a cross-scope request returns 403

`node --test` is built in and needs no dependency.

---

## H3 · Schema changes must be applied in two places — **Low**

**Where** `server/src/db/schema.sql` and `server/src/db/migrate.js`

`schema.sql` covers fresh installs; `migrate.js` covers existing databases. Nothing enforces
that they agree, and they have already drifted once — `migrate.js:78` creates
`peer_review_assignments.status` as `ENUM('pending','completed')` and then widens it to
include `'missed'` at line 117, while `schema.sql:309` declares all three from the
start.

**Fix.** Adopt a numbered migration directory with a `schema_migrations` table, and generate
`schema.sql` from a fresh migration run rather than hand-maintaining it. Until then, add a CI
step that runs `db:setup` on one database and `db:migrate` on another, then diffs
`information_schema`.

---

# Summary

| ID | Issue | Severity | Area |
| --- | --- | --- | --- |
| S1 | `/uploads` served without authentication | High | Security |
| S2 | `JWT_SECRET` falls back to a committed string | High | Security |
| S3 | No rate limiting or lockout on login | High | Security |
| S4 | Reset link built from the `Origin` header | High | Security |
| S5 | Idle session timeout configured, not implemented | Medium | Security |
| S6 | `must_reset` never enforced | Medium | Security |
| S7 | Peer anonymity is query-shape only | Medium | Security |
| S8 | Upload filter accepts MIME *or* extension; no `nosniff` | Low | Security |
| S9 | Upload volume effectively unbounded (10 GB/request) | Medium | Security |
| S10 | Weak password policy | Low | Security |
| S11 | Last admin can lock everyone out | Low | Security |
| C1 | Duplicate collaboration ratings inflate PE | High | Scoring |
| C2 | `on_time` unset on supervisor completion | High | Scoring |
| C3 | Weekly TP falsy-zero fallback | Medium | Scoring |
| C4 | `profile_update` activity silently dropped | Low | Scoring |
| C5 | PI weights unvalidated | Low | Scoring |
| D1 | Reassignment destroys submitted work | High | Data |
| D2 | Subtask edit wipes completion and assignees | Medium | Data |
| D3 | `member_ids` type mismatch can unassign everyone | Medium | Data |
| D4 | Uploaded files never deleted | Low | Data |
| D5 | Submission creation not transactional | Low | Data |
| D6 | Task delete reports success on a no-op | Low | Data |
| P1 | Analytics N+1 (~640 queries per page) | Medium | Performance |
| P2 | Write-only snapshot tables | Low | Performance |
| P3 | Two 30-second polls per session | Low | Performance |
| R1 | Axios retries non-idempotent POSTs | Medium | Robustness |
| R2 | Peer assignment failures swallowed | Low | Robustness |
| R3 | Admin user PATCH doesn't validate enums | Low | Robustness |
| H1 | Self-referential `file:..` dependency | Medium | Hygiene |
| H2 | No tests | Medium | Hygiene |
| H3 | Schema maintained in two places | Low | Hygiene |
