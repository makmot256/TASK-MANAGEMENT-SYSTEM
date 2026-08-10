# API Reference

Base URL: `http://localhost:4000/api` (the Vite dev server proxies `/api` and `/uploads`
from `:5173`, so the browser always calls same-origin relative paths).

## Conventions

**Authentication.** Every endpoint except the four marked *public* requires:

```
Authorization: Bearer <jwt>
```

The token comes from `POST /api/auth/login`, is signed with `JWT_SECRET`, expires after
`JWT_EXPIRES_IN` (default `8h`), and carries `{ sub, role, name, email }`. The server does
**not** trust the role claim — it re-reads the user row on every request, so deactivating an
account takes effect immediately.

**Content type.** JSON in, JSON out, except the four multipart endpoints marked
`multipart/form-data`.

**Errors.** Uniform shape:

```json
{ "message": "You do not have permission to perform this action." }
```

| Status | Meaning here |
| --- | --- |
| 400 | Validation failure |
| 401 | Missing/invalid token, or wrong credentials |
| 403 | Wrong role, or outside your data scope, or inactive account |
| 404 | Not found |
| 409 | Conflict (duplicate email) |
| 413 | Upload too large or too many files |
| 503 | Database unreachable |

**Role column** below means the role gate (`requireRole`). *Scope* describes the row-level
check applied on top of it.

---

## Health

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | *public* | `{ status: "ok", time }` — liveness only, does not touch the DB |

---

## Auth — `/api/auth`

| Method | Path | Role |
| --- | --- | --- |
| POST | `/login` | *public* |
| GET | `/me` | any |
| PATCH | `/profile` | any |
| PATCH | `/change-password` | any |
| POST | `/forgot-password` | *public* |
| POST | `/reset-password` | *public* |

### POST `/login`

```json
{ "email": "grace@tms.local", "password": "Password@123" }
```

→ `200 { "token": "...", "user": { id, full_name, email, role, ... } }`

Every attempt — success or failure — is written to `login_audit` with IP and user-agent
before any response is returned, so failures are always recorded. On success: `last_login_at` is stamped and a `login` row lands
in `activity_logs` (this feeds the engagement score). Returns `401` on bad credentials,
`403` if `status !== 'active'`.

### PATCH `/profile` — `multipart/form-data`

Fields: `full_name` (required), `email` (required, validated, uniqueness-checked),
`phone`, and an optional `avatar` image file (JPG/PNG/WEBP/GIF, ≤5 MB). Replacing an avatar
unlinks the previous file. → `{ message, user }`

### PATCH `/change-password`

```json
{ "currentPassword": "...", "newPassword": "..." }
```

New password must be ≥8 chars with at least one letter and one digit. Clears `must_reset`.

### POST `/forgot-password`

Always returns the same message whether or not the email exists — no account enumeration.
When it does exist, a 24-byte hex token valid for one hour is stored and emailed (or logged
to the console when SMTP is unconfigured).

### POST `/reset-password`

```json
{ "token": "...", "newPassword": "..." }
```

Requires `used = 0 AND expires_at > NOW()`; marks the token used.

---

## Admin — `/api/admin`

Every route here is `authenticate + requireRole('admin')`, applied at the router level.

### Users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users?role=&q=` | Filter by role and free-text on name/email. Each row includes comma-joined `teams` and `supervised_teams` |
| POST | `/users` | Provision an account |
| PATCH | `/users/:id` | Partial update of `full_name`, `role`, `phone`, `title`, `status` |
| POST | `/users/:id/reset-password` | Set a temporary password, sets `must_reset = 1` |
| DELETE | `/users/:id` | Refuses self-deletion. Cascades through everything the user owns |

**POST `/users`**

```json
{ "full_name": "Grace N.", "email": "grace@tms.local",
  "role": "member", "password": "Password@123",
  "phone": "0700000000", "title": "Field Officer" }
```

Creates the account as `active` with `must_reset = 1`, assigns a random avatar colour, and
emails a welcome notice. → `201 { id, message }`. `409` if the email is taken.

> `PATCH /users/:id` does not validate `role`/`status` against their enums — an invalid value
> produces a raw 500 rather than a 400.

### Teams

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/teams` | All teams with nested `supervisors[]`, `members[]`, and `member_count` |
| POST | `/teams` | `{ name, description, supervisor_ids[] }` — **at least one active supervisor required** |
| PATCH | `/teams/:id` | Passing `supervisor_ids` replaces the whole set |
| DELETE | `/teams/:id` | Cascades memberships; tasks survive with `team_id = NULL` |
| GET | `/teams/:id/members` | |
| POST | `/teams/:id/members` | `{ member_id }` — `INSERT IGNORE`, so idempotent |
| DELETE | `/teams/:id/members/:memberId` | |
| GET | `/users/:id/teams` | Returns memberships for a member, or supervised teams for a supervisor |
| PUT | `/users/:id/teams` | `{ team_ids[] }` — full replacement, routed by the user's role |

### Settings, audit, health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/settings` | All `system_settings` rows |
| PUT | `/settings` | `{ settings: { key: value, ... } }` — upsert; takes effect on the next scoring read, no restart |
| GET | `/audit` | Latest 100 login attempts with the user's name |
| GET | `/health` | Row counts for 7 tables, users by role, uptime, 24h login success/failure counts |

---

## Users — `/api/users`

| Method | Path | Role | Returns |
| --- | --- | --- | --- |
| GET | `/me/teams` | any | Teams you belong to (member) or supervise (supervisor) |
| GET | `/members` | supervisor, admin | Admin: all members. Supervisor: only members of teams they supervise |
| GET | `/cohort` | member | Active teammates you may give a **collaboration** rating to (same team, excluding yourself) |

---

## Tasks — `/api/tasks`

| Method | Path | Role | Scope |
| --- | --- | --- | --- |
| POST | `/` | supervisor, admin | — |
| GET | `/` | any | Shape differs per role (below) |
| GET | `/:id` | any | Member: must be assigned. Supervisor: creator, or an assignee in their teams |
| GET | `/:taskId/files/:fileId` | any | Same as detail; streams the briefing document |
| PATCH | `/:id/status` | member | Must be assigned |
| PATCH | `/:id` | supervisor, admin | Supervisor: creator only |
| DELETE | `/:id` | supervisor, admin | Supervisor: creator only |
| POST | `/:id/subtasks` | any | Assignee, creating supervisor, or admin |
| PATCH | `/subtasks/:subtaskId` | any | Same |
| DELETE | `/subtasks/:subtaskId` | any | Same |

### POST `/` — `multipart/form-data`

| Field | Required | Notes |
| --- | --- | --- |
| `title` | ✅ | |
| `deadline` | ✅ | DATETIME |
| `member_ids` | ✅ | JSON array or repeated field; at least one |
| `description`, `priority`, `start_date`, `team_id` | | `priority` ∈ `Low`/`Medium`/`High` |
| `subtasks` | | JSON array, or newline-separated text |
| `files` | | Up to 10 PDF/DOCX briefing documents |

Runs in a single transaction: task → assignments → initial history rows → subtasks → file
records. Then notifies each assignee. → `201 { id, message, files }`

### GET `/`

Role-shaped result:

- **member** — one row per assignment: task fields plus `assignment_id`, `status`,
  `completed_at`, `on_time`, `created_by_name`; ordered by deadline
- **supervisor** — tasks they created, aggregated with `assignee_count` and `completed_count`
- **admin** — all tasks with the same aggregates, newest first

### GET `/:id`

→ `{ task, assignments[], subtasks[], files[] }`. `assignments` carries each member's own
status, timestamps, name and avatar colour.

### PATCH `/:id/status`

```json
{ "status": "In Progress" }
```

Valid values: `To-Do`, `In Progress`, `Under Review`, `Completed`.

Side effects: `started_at` on the first `To-Do → In Progress`; `completed_at` **and**
`on_time` on `Completed`; a `task_status_history` row; a `task_update` activity log; a
`status_update` notification to the task creator.

### PATCH `/:id`

JSON. Supplying `member_ids` **replaces** the assignee set — added members get an assignment,
a history row and a notification; removed members have their assignment (and its submissions)
deleted by cascade. Supplying `subtasks` deletes and recreates the whole list, which discards
`is_done` and `assigned_to`.

### Subtasks

`POST /:id/subtasks` takes `{ title, assigned_to? }`. `assigned_to` must be another **assignee
of the same task** — that is how a member subdivides work with a teammate.
`PATCH /subtasks/:subtaskId` accepts `{ is_done?, assigned_to? }`.

---

## Submissions — `/api/submissions`

> Implemented in `routes/reports.routes.js`. Route order matters: `/mine`, `/review` and
> `/review-pending-count` are registered before `/:id`.

| Method | Path | Role | Scope |
| --- | --- | --- | --- |
| POST | `/` | member | Must be assigned to the task |
| GET | `/mine` | member | Own submissions |
| GET | `/review` | supervisor, admin | Supervisor: members in their teams |
| GET | `/review-pending-count` | supervisor, admin | Same — the nav badge |
| GET | `/:id` | any | Author, an assigned peer reviewer, the supervisor in scope, or admin |
| GET | `/:id/files/:fileId` | any | Same |
| POST | `/:id/comments` | supervisor, admin | |
| PATCH | `/comments/:commentId` | supervisor, admin | Own comments only |
| DELETE | `/comments/:commentId` | supervisor, admin | Own comments only (soft delete) |
| POST | `/:id/assess` | supervisor, admin | |

### POST `/` — `multipart/form-data`

| Field | Notes |
| --- | --- |
| `task_id` | Required; you must hold an assignment on it |
| `content` | Report text — required *unless* files are attached |
| `files` | Up to 10 PDF/DOCX, ≤`MAX_UPLOAD_MB` each |
| `kind` | `daily_log` or `weekly_report` (default) |
| `revision_of` | Id of the submission being revised |

Chain of effects: `is_late` computed against the deadline → assignment moves to
`Under Review` → `submission` activity logged → **up to 3 peer reviewers auto-assigned and
notified** → the supervisor is notified with the reviewers named.

→ `201 { id, message, peer_reviewers[], peer_reviewers_assigned }`

Peer assignment failure is caught and swallowed; the submission still succeeds.

### GET `/review`

The supervisor queue, ≤200 rows, ordered `new` → `pending` → `completed`. Each row carries
`queue_status`, file/comment counts, `peer_reviewer_count`, `peer_completed_count`, and the
full `peer_reviewers[]` list. Also returns `counts { all, new, pending, completed }` and
`pending` (= new + pending).

| `queue_status` | Condition |
| --- | --- |
| `new` | No supervisor assessment yet |
| `pending` | Assessed, revision requested, assignment not completed |
| `completed` | Otherwise |

### GET `/:id`

→ `{ submission, files[], comments[], assessment, peer_reviewers[] }`.
`peer_reviewers` is populated **only** for supervisors and admins. A member who is not the
author must hold a `peer_review_assignments` row for this submission.

### POST `/:id/assess`

```json
{ "quality_score": 4, "request_revision": false, "mark_completed": true }
```

`quality_score` is 0–5. If the submission is itself a revision, `responsiveness_score` is
derived from turnaround since `revision_requested_at` on the original: ≤24h → 5, ≤48h → 3,
otherwise 1.

- `request_revision` → stamps `revision_requested_at`, sends the assignment back to
  `In Progress`, notifies the member
- `mark_completed` → assignment becomes `Completed` (note: this path does **not** set
  `on_time`)

---

## Peer reviews — `/api/peer`

All member-only.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/assigned` | Reviews you owe, plus `pendingCount` and the live `penaltyPolicy` |
| POST | `/` | Submit a peer review or a collaboration rating |
| GET | `/mine` | Feedback **about you** — aggregates, comments, and comments grouped by task. **Anonymous** |
| GET | `/given` | Reviews you have written, with assessee names |

### POST `/`

Two modes, selected by `kind`:

**Peer review** — tied to a submission you were assigned:

```json
{ "kind": "peer_review", "submission_id": 42, "score": 4, "comment": "Clear methodology." }
```

Requires a matching `peer_review_assignments` row (`403` otherwise) and refuses self-review.
The comment is scanned by `utils/profanity.js`; a hit sets `vulgar_comment = 1` and the
response says a TP penalty was applied. On success the assignment is marked `completed` and
**your own** Performance Index is recomputed and snapshotted immediately.

**Collaboration** — a teammate rating, once per pair per open cycle:

```json
{ "kind": "collaboration", "assessee_id": 7, "score": 5, "comment": "Great to work with." }
```

Restricted to active members sharing a team with you.

Both are upserts (`ON DUPLICATE KEY UPDATE`) — re-rating overwrites. `score` must be 1–5.

### GET `/mine`

```json
{
  "aggregates": [{ "kind": "peer_review", "avg_score": 4.2, "n": 5 }],
  "comments":  [{ "kind", "score", "comment", "created_at", "submission_id", "task_id", "task_title" }],
  "groups":    [{ "key": "task-12", "task_id": 12, "task_title": "...", "comments": [...] }]
}
```

No assessor identity appears anywhere in this payload — that is the anonymity contract.

---

## Analytics — `/api/analytics`

| Method | Path | Role |
| --- | --- | --- |
| GET | `/overview` | supervisor, admin |
| GET | `/weekly?weeks=8&teamId=&memberId=` | supervisor, admin |
| GET | `/at-risk` | supervisor, admin |
| GET | `/member/:id` | supervisor, admin |
| GET | `/peer-reviews` | supervisor, admin |
| GET | `/peer-assignments` | supervisor, admin |
| GET | `/me` | member |
| POST | `/recompute` | supervisor, admin |

Supervisors are scoped to members of teams they supervise; admins see all members. Requesting
a member or team outside your scope returns `403 "Not in your scope."`

### GET `/overview`

→ `{ members[], teams[], cohort, weights, generated_at }`

Each member carries live `performance` (TP/PE/SA/PI + penalty breakdown), `engagement`, and a
`risk` colour (`green` / `amber` / `red` / `grey`). `teams[]` repeats the members grouped by
team with per-team averages. `cohort` gives the scope-wide averages and at-risk / on-track
counts. `weights` echoes the current settings so the UI can explain the numbers.

> Scores are computed **live per request**, in a loop over members. Expect latency to grow
> with team size.

### GET `/weekly`

`weeks` is clamped to 4–16 (default 8). Returns a Monday-start UTC series; each entry has
`avg_pi/tp/pe/sa`, `completed_tasks`, `active_members`, and a per-member breakdown. Weekly TP
uses a different formula from the lifetime one — see
[SCORING.md](./SCORING.md#weekly-scores-are-a-different-formula).

### GET `/member/:id`

→ `{ performance, engagement, trend, peers, weekly, teams }`

`trend` is daily average quality and responsiveness (≤30 days). `peers` is the **fully
attributed** review ledger — assessor names included, because supervisors need attribution
even though members do not get it.

### GET `/peer-assignments`

→ `{ assignments[], distribution[], stats, reviewees, poolSize, maxReviewersPerSubmission }`

`distribution` shows per-reviewer load (assigned / completed / pending / missed) alongside
their engagement score — this is the view that shows whether reviewer selection is spreading
work evenly.

### POST `/recompute`

Runs the full pipeline on demand: mark overdue reviews as `missed`, recompute and snapshot
performance for all members, recompute and snapshot engagement (sending at-risk alerts for
newly flagged members).

→ `{ message, missed_reviews_marked, performance_members, engagement }`

---

## Notifications — `/api/notifications`

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/` | Latest 50 for you, plus `unread` count. Polled every 30s by the client |
| PATCH | `/:id/read` | Scoped to your own rows |
| POST | `/read-all` | Fired when the dropdown opens |

---

## Team — `/api/team`

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/overview` | Admin: all teams. Supervisor: teams they supervise. Member: teams they belong to |
| GET | `/:teamId/messages?after=<id>` | Must have access to the team |
| POST | `/:teamId/messages` | Must have access to the team |

`GET /overview` returns each team with its members' task counts by status, completion rate,
on-time rate, and latest engagement score — so a member can see how their team is tracking
without any analytics permission.

Chat is poll-based: pass `after` with the last id you hold; up to 200 newer messages come
back in ascending order. Bodies are capped at 2000 characters.

---

## Static files

| Path | Auth | Contents |
| --- | --- | --- |
| `/uploads/<stored_name>` | **none** | Avatars, task briefings, and submission attachments — all in one directory |

Attachments should be fetched through the scope-checked endpoints
(`/api/tasks/:taskId/files/:fileId`, `/api/submissions/:id/files/:fileId`), which the SPA does
via `downloadFile()` so the JWT header is sent. The unauthenticated static mount exists for
avatars but currently exposes the same directory — see gap #1 in
[ARCHITECTURE.md](./ARCHITECTURE.md#11-known-gaps-and-technical-debt).
