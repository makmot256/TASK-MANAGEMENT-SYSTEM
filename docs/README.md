# Documentation Index

Technical documentation for the **Task Management System** (TMS) — a role-based task
assignment, reporting, peer-review and performance-analytics platform.

| Document | What's inside |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System context, container/component breakdown, request lifecycle, key workflows, cross-cutting concerns, deployment, known gaps |
| [DATA-MODEL.md](./DATA-MODEL.md) | Entity-relationship diagram, table-by-table reference, indexing and integrity rules, and a [design review](./DATA-MODEL.md#design-review) of the model itself |
| [API.md](./API.md) | Every HTTP endpoint: method, path, role, payload, response, and the authorization scope applied |
| [SCORING.md](./SCORING.md) | The Performance Index, the engagement engine, peer-reviewer assignment weighting, and every penalty rule — with worked examples |
| [ISSUES.md](./ISSUES.md) | **All 31 findings — resolved.** Each keeps its original diagnosis and adds what was done and how it was verified |
| [DEPLOYMENT-CPANEL.md](./DEPLOYMENT-CPANEL.md) | The live cPanel deployment: environment, why Passenger is unusable there, the reverse-proxy setup, tradeoffs taken, and how to retire the workaround |

For installation and day-to-day running, see the repository root:

- [`README.md`](../README.md) — feature summary, stack, setup, demo credentials
- [`GETTING_STARTED.md`](../GETTING_STARTED.md) — step-by-step beginner setup guide (Windows/XAMPP focused)

## Running it

```bash
docker compose up -d --build                      # MySQL + schema + API on :4000
docker compose --profile tools run --rm db-seed   # optional demo dataset
docker compose --profile tools run --rm test      # 38 tests
```

Mailpit collects password-reset and at-risk emails at `http://localhost:8025`, so those flows
are testable without a real SMTP relay. A host install (npm + your own MySQL) is still
supported — see [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-deployment).

## Quick orientation

```
TASK-MANAGEMENT-SYSTEM/
├─ server/
│  ├─ src/          Express API + scheduled scoring jobs      (Node 18+, ESM)
│  │  └─ db/        schema.sql · migrations.js · triggers.js · setup.js · seed.js
│  └─ test/         node --test suite (38 tests)
├─ client/          React 18 + TypeScript SPA                 (Vite)
├─ docs/            You are here
├─ Dockerfile       Multi-stage: SPA build → prod deps → runtime
└─ docker-compose.yml   MySQL 8 + API + Mailpit, with tools profiles
```

Three roles, three workspaces, one codebase:

| Role | Owns | Primary screens |
| --- | --- | --- |
| `admin` | Users, teams, system settings, audit | Dashboard, Users, Teams, Settings, Security & Audit |
| `supervisor` | Task creation, review decisions, analytics | Dashboard, Tasks, Review Queue, Performance, Peer Reviews, My Team |
| `member` | Task execution, reports, peer reviews | Dashboard, My Tasks, My Team, My Reports, Peer Reviews |
