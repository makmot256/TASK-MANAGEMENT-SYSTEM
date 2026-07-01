# TaskFlow — Task Management System

A complete, role-based **Task Management System** built from the project SRS. It lets supervisors
assign tasks, members track progress and submit reports, and supervisors review work, leave feedback,
and monitor performance through analytics and an ML-style engagement engine.

Three login platforms / user classes (per SRS 2.3):

| Role | Workspace |
| --- | --- |
| **System Administrator** | User provisioning, teams, system settings, security & audit, health |
| **Supervisor** | Task creation/assignment, review queue, performance analytics, team overview |
| **Member** | Kanban task board, report submission, peer reviews, personal engagement card |

Light mode is the default with a one-click **dark mode** toggle. The UI palette is inspired by the
referenced Code Stitch site (clean, professional, warm-accented).

---

## Modules (clearly defined)

The codebase is organised module-by-module, mirroring the SRS System Features:

1. **Identity & Access** — JWT auth, bcrypt password hashing, RBAC enforced at the API level, login auditing, password reset.
2. **Organisation** — Teams owned by supervisors; members belong to teams (defines the supervision scope).
3. **Task Management** (SRS 4.1) — create/assign tasks, subtask checklists, per-member status (To-Do → In Progress → Under Review → Completed), status history.
4. **Reports & Submissions** (SRS 4.1) — typed reports and/or PDF/DOCX uploads, submission history.
5. **Feedback & Comments** (SRS 4.1) — supervisor comments with edit/delete, multiple reviewers, chronological threads.
6. **Performance Monitoring** (SRS 4.2) — Performance Index `PI = w1·TP + w2·PE + w3·SA`, peer reviews + collaboration ratings (anonymised to the assessee), quality + responsiveness, analytics dashboard with charts and filtering.
7. **ML Engagement Monitoring** (SRS 4.3) — background job scoring engagement (0–100) from login/task/submission behaviour, at-risk flagging + alerts.
8. **Notifications** — in-app notifications + email hooks (console fallback in dev).
9. **System Settings** — configurable PI weights, penalty, engagement thresholds.

---

## Tech stack

- **Backend:** Node.js + Express, MySQL (mysql2), JWT, bcryptjs, Multer (uploads), node-cron (scheduled scoring), Nodemailer.
- **Frontend:** React + TypeScript + Vite, React Router, Recharts, Axios.
- **Database:** MySQL / MariaDB (relational, referential integrity, organised by module).

> The SRS suggests a Python ML worker. To keep the whole system a single, easy-to-run stack, the
> engagement/performance scoring is implemented as an **isolated scheduled background job** in Node
> (decoupled from request handling, exactly as the SRS requires). Weights and thresholds are configurable.

---

## Prerequisites

- **Node.js 18+** (tested on Node 22)
- **MySQL 8** or **MariaDB 10.4+**

You can use any of these for the database:

- **XAMPP** (MySQL/MariaDB) — start MySQL in the XAMPP control panel (default user `root`, empty password).
- **Docker** — `docker compose up -d` (uses the included `docker-compose.yml`).
- A standalone MySQL install — set credentials in `server/.env`.

---

## Setup & run

```bash
# 1. Install all dependencies (root, server, client)
npm run install-all

# 2. Configure the database connection
#    Copy server/.env.example to server/.env and adjust DB_* if needed.
#    (Defaults: host localhost, port 3306, user root, empty password.)

# 3. Create the schema + default admin
npm run db-setup

# 4. (Optional) load rich demo data
npm --prefix server run db:seed

# 5. Start backend (4000) + frontend (5173) together
npm run dev
```

Then open **http://localhost:5173**.

### Production build

```bash
npm run build      # builds the client into client/dist
npm start          # server serves the API + built client on http://localhost:4000
```

---

## Demo credentials

After running the seed (`npm --prefix server run db:seed`):

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@tms.local` | `Admin@123` |
| Supervisor | `sarah@tms.local` / `david@tms.local` | `Password@123` |
| Member | `grace@tms.local`, `brian@tms.local`, `kevin@tms.local`, … | `Password@123` |

The login screen also has one-click demo buttons. `kevin@` and `joseph@` are intentionally seeded as
**at-risk** so the engagement alerts and red status indicators are visible.

---

## Background scoring

The engagement + performance recalculation runs nightly (cron `SCORING_CRON`, default `0 2 * * *`).
You can run it manually at any time:

```bash
npm --prefix server run jobs:run
```

Supervisors can also click **Refresh data** on the Performance page (`POST /api/analytics/recompute`).

---

## Project structure

```
TASK MANAGEMENT SYSTEM/
├─ docker-compose.yml          # optional MySQL container
├─ package.json                # root scripts (install:all, dev, build, db:setup)
├─ server/                     # Express API
│  ├─ .env.example
│  └─ src/
│     ├─ config/               # env + db pool
│     ├─ db/                   # schema.sql, setup.js, seed.js   <-- modular MySQL schema
│     ├─ middleware/           # auth, rbac, upload, error
│     ├─ routes/               # auth, admin, users, tasks, reports, peer, analytics, notifications
│     ├─ services/             # performance (PI) + engagement (ML) + settings
│     ├─ jobs/                 # scheduler + manual runner
│     └─ utils/                # jwt, password, mailer, notify, scope
└─ client/                     # React + Vite frontend
   └─ src/
      ├─ components/           # Layout, UI primitives
      ├─ context/              # Auth, Theme (light default), Toast
      ├─ pages/                # member/, supervisor/, admin/ + auth
      └─ styles/theme.css      # design system + light/dark themes
```

---

## SRS coverage map

| SRS feature | Where |
| --- | --- |
| UC1 Create & Assign Task | `routes/tasks.routes.js` + `SupervisorTasks.tsx` |
| UC2 Update Task Status | `tasks.routes.js` (`/status`) + `MemberTasks.tsx` (Kanban) |
| UC3 View Member Progress | `analytics.routes.js` + `SupervisorDashboard.tsx` |
| UC4 Submit Report | `reports.routes.js` + `TaskDetail.tsx` |
| UC5 Review Submitted Report | `reports.routes.js` + `ReviewDetail.tsx` |
| UC6 Comment on Report | `reports.routes.js` (`/comments`) |
| UC7 View Analytics Dashboard | `analytics.routes.js` + `Analytics.tsx` |
| UC8 Engagement Score & Risk Alerts | `services/engagement.service.js` + `jobs/scheduler.js` |
| RBAC at API level (5.2) | `middleware/rbac.js` + per-route scope checks |
| Login auditing (5.2) | `login_audit` table + `AdminAudit.tsx` |
| Responsive + WCAG-minded UI (5.4) | `styles/theme.css` |
```
