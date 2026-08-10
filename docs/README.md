# Documentation Index

Technical documentation for the **Task Management System** (TMS) — a role-based task
assignment, reporting, peer-review and performance-analytics platform.

| Document | What's inside |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System context, container/component breakdown, request lifecycle, key workflows, cross-cutting concerns, deployment, known gaps |
| [DATA-MODEL.md](./DATA-MODEL.md) | Entity-relationship diagram, table-by-table reference, lifecycle of each record, indexing and integrity rules |
| [API.md](./API.md) | Every HTTP endpoint: method, path, role, payload, response, and the authorization scope applied |
| [SCORING.md](./SCORING.md) | The Performance Index, the engagement engine, peer-reviewer assignment weighting, and every penalty rule — with worked examples |
| [ISSUES.md](./ISSUES.md) | **What needs fixing** — 31 prioritised findings with evidence, impact, reproduction steps and concrete fixes |

For installation and day-to-day running, see the repository root:

- [`README.md`](../README.md) — feature summary, stack, setup, demo credentials
- [`GETTING_STARTED.md`](../GETTING_STARTED.md) — step-by-step beginner setup guide (Windows/XAMPP focused)

## Quick orientation

```
TASK-MANAGEMENT-SYSTEM/
├─ server/          Express API + MySQL + scheduled scoring jobs      (Node 18+, ESM)
├─ client/          React 18 + TypeScript SPA                          (Vite)
├─ docs/            You are here
└─ docker-compose.yml   Optional MySQL 8 container
```

Three roles, three workspaces, one codebase:

| Role | Owns | Primary screens |
| --- | --- | --- |
| `admin` | Users, teams, system settings, audit | Dashboard, Users, Teams, Settings, Security & Audit |
| `supervisor` | Task creation, review decisions, analytics | Dashboard, Tasks, Review Queue, Performance, Peer Reviews, My Team |
| `member` | Task execution, reports, peer reviews | Dashboard, My Tasks, My Team, My Reports, Peer Reviews |
