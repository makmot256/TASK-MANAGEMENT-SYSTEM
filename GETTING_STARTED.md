# Getting Started — Run This Project Locally (Beginner Guide)

This guide walks you through **everything** needed to run the Task Management System
on your own Windows computer, step by step. No prior experience needed — just follow
each step in order.

> The project has two parts that run together:
> - **Server** (the "backend" / API) — Node.js
> - **Client** (the "frontend" / website you see) — React
> - A **MySQL database** to store all the data
>
> You start them all with a single command at the end. Don't worry, it's easy.

---

## Part 1 — Install the tools you need (one time only)

You only do Part 1 once per computer. If you already have these, skip ahead.

### 1.1 Install Node.js (runs the app)

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the big green button on the left).
3. Run the installer and click **Next** through all steps (keep the default options),
   then **Finish**.
4. **Check it worked:** open **PowerShell** (press the Windows key, type `PowerShell`,
   press Enter) and type:

   ```powershell
   node -v
   npm -v
   ```

   You should see version numbers (e.g. `v20.x.x` and `10.x.x`). If you do, Node is installed. 🎉

### 1.2 Install XAMPP (gives you the MySQL database)

1. Go to **https://www.apachefriends.org** and download **XAMPP for Windows**.
2. Run the installer, keep clicking **Next** (default options are fine), then **Finish**.
   - If Windows shows a security warning, allow it.
3. Open the **XAMPP Control Panel** (search "XAMPP" in the Start menu).
4. Find the **MySQL** row and click its **Start** button.
   - When it turns **green** and shows a port (usually `3306`), your database is running. ✅
   - Leave the XAMPP Control Panel open while you use the app.

> The app is already set up to connect to XAMPP's database using the default settings
> (user `root`, no password, port `3306`). You don't need to change anything.

### 1.3 (Optional) A code editor

You already have **Cursor** (or VS Code). That's all you need to view the project.

---

## Part 2 — Set up the project (one time only)

### 2.0 Get the project onto your computer

You need the project folder (named `TASK MANAGEMENT SYSTEM`) somewhere on your PC.
Pick whichever applies to you:

- **Someone gave you a ZIP file:** right-click it → **Extract All…** → choose a location
  (your Desktop is fine). You'll end up with a `TASK MANAGEMENT SYSTEM` folder.
- **Someone gave you a USB / shared folder:** copy the whole `TASK MANAGEMENT SYSTEM`
  folder onto your computer (e.g. your Desktop).
- **It's in a Git repository:** if you have Git installed, open PowerShell and run
  `git clone <the-repository-link>`, which downloads the folder for you.

> Tip: avoid putting it in a path with special characters. A normal location like your
> Desktop or `C:\Projects\` works perfectly. A space in the name (like this one) is fine.

### 2.1 Open PowerShell **in the project folder**

1. Open the `TASK MANAGEMENT SYSTEM` folder in File Explorer (double-click into it so you
   can see folders like `client`, `server`, and the file `package.json`).
2. Click the address bar at the top, type `powershell`, and press **Enter**.
   (A blue PowerShell window opens already pointing at the project folder — no need to
   know or type the full path.)

   To confirm you're in the right place, run:

   ```powershell
   pwd
   ```

   It should print a path ending in `TASK MANAGEMENT SYSTEM`. As long as it ends with that
   folder name, you're good — it doesn't matter where on your computer it lives.

> If `npm` commands later fail with a red error mentioning **"running scripts is disabled
> on this system"**, do the one-time fix in step 2.1b before continuing.

### 2.1b (Only if needed) Allow PowerShell to run npm

Fresh Windows installs sometimes block scripts. If you saw the "running scripts is
disabled" error, run this **once**, then press `Y` and Enter when prompted:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Close and reopen PowerShell (back in the project folder) and continue. If you never saw
that error, skip this step.

### 2.2 Create the settings file (`.env`)

The server needs a small settings file. Copy the provided example:

```powershell
Copy-Item server\.env.example server\.env
```

> The defaults already match XAMPP, so you don't need to edit anything. (If you're
> curious, the file lives at `server\.env`.)

### 2.3 Install the project's building blocks (dependencies)

This downloads all the code libraries the app needs. It can take a few minutes the
first time — that's normal.

```powershell
npm run install-all
```

Wait until it finishes and you get your prompt back.

### 2.4 Create the database and its tables

Make sure **MySQL is green/running in XAMPP first**, then run:

```powershell
npm run db-setup
```

This creates the database, all the tables, and the first admin account.

### 2.5 Apply updates and add demo data

```powershell
npm run db-migrate
npm run db-seed
```

- `db-migrate` makes sure the database has the latest tables/columns.
- `db-seed` fills it with realistic demo people, teams, tasks, and reports so you have
  something to explore immediately.

✅ Setup is done! You won't need to repeat Part 2 unless you move to a new computer
(or want to wipe and reload demo data with `npm run db-seed`).

---

## Part 3 — Run the app (every time you want to use it)

1. Make sure **MySQL is running** in the XAMPP Control Panel (green).
2. Open PowerShell in the project folder (see step 2.1).
3. Start everything with one command:

   ```powershell
   npm run dev
   ```

4. Wait a few seconds. You'll see messages like:
   - `[api] listening on http://localhost:4000`
   - `Local: http://localhost:5173/`

5. Open your web browser and go to:

   ```
   http://localhost:5173
   ```

   The login page should appear. 🎉

### To stop the app

Click the PowerShell window and press **Ctrl + C** (you can press it twice). This stops
both the server and the website. You can close the window afterward.

---

## Part 4 — Log in and explore

Use these demo accounts (all passwords are exactly as shown):

| Role        | Email                 | Password       | What they can do |
|-------------|-----------------------|----------------|------------------|
| **Admin**       | `admin@tms.local`     | `Admin@123`    | Manage users, teams, settings, audit log |
| **Supervisor**  | `sarah@tms.local`     | `Password@123` | Assign tasks, review reports, see performance & peer reviews |
| **Supervisor**  | `david@tms.local`     | `Password@123` | Same as above (different team) |
| **Member**      | `grace@tms.local`     | `Password@123` | Do tasks, submit reports, team chat, peer reviews |
| **Member**      | `brian@tms.local`     | `Password@123` | Same (Grace's teammate — great for testing chat) |

> Tip: To test the **team chat**, open the app in a normal browser window as `grace@tms.local`
> and a second **incognito/private** window as `brian@tms.local`. Messages will appear in both.

---

## Part 5 — Troubleshooting (common issues)

**The website opens but says it can't connect / login fails**
- Make sure **MySQL is green** in XAMPP.
- Make sure you ran `npm run db-setup` (and ideally `db:migrate` + `db:seed`).
- Stop the app (Ctrl + C) and run `npm run dev` again.

**"Port 4000 is already in use" or the website can't reach the API**
- Something is still running from before. Close all PowerShell windows, then in a fresh
  PowerShell run this to free the ports, and start again:

  ```powershell
  Get-NetTCPConnection -LocalPort 4000,5173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  npm run dev
  ```

**MySQL won't start in XAMPP (port 3306 busy)**
- Another MySQL is already running on your PC. Either use that one, or stop it and start
  XAMPP's MySQL. (If you installed MySQL separately before, that's usually the cause.)

**`npm` is not recognized**
- Node.js isn't installed or PowerShell was opened before installing it. Close and reopen
  PowerShell, and re-check with `node -v`. If still missing, re-install Node.js (step 1.1).

**Red error: "running scripts is disabled on this system" (npm.ps1 cannot be loaded)**
- Windows is blocking scripts. Run this once, press `Y` + Enter, then reopen PowerShell:

  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

**The path printed by `pwd` doesn't end in `TASK MANAGEMENT SYSTEM`**
- You opened PowerShell in the wrong place. In File Explorer, navigate *into* the project
  folder (you should see `client`, `server`, `package.json`), then type `powershell` in the
  address bar and press Enter to reopen it there.

**I want to reset the demo data**
- Run `npm run db-seed` again. This reloads fresh demo content.

---

## Quick reference (the whole thing in short)

```powershell
# One-time setup
Copy-Item server\.env.example server\.env
npm run install-all
npm run db-setup
npm run db-migrate
npm run db-seed

# Every time you want to run it (MySQL must be ON in XAMPP)
npm run dev
# then open http://localhost:5173
```

That's it — enjoy exploring the Task Management System!

---

## A note for Mac / Linux users

This guide uses Windows + XAMPP, but the project itself is cross-platform. On Mac/Linux the
only differences are:
- Install Node.js the same way (from nodejs.org or your package manager).
- Instead of XAMPP, install MySQL (e.g. `brew install mysql` on Mac) **or** use the included
  Docker option: run `docker compose up -d` in the project folder (needs Docker Desktop).
- Use a normal terminal; the `npm run ...` commands are identical. The PowerShell-only
  steps (execution policy, the port-freeing command) don't apply.
