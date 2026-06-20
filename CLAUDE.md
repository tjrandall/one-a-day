# One-A-Day — Build Spec for Claude Code

## Keeping This Document Current
At the end of every build session, update this file to reflect what was completed. Mark finished items ✅. Update data model descriptions when fields are added. Update the Render Layer section when new panels ship. Update the Architecture Queue. Commit the update with the work. A stale CLAUDE.md is a navigation hazard — future sessions will re-propose work that's already done.

---

## Long-Term Target: Published Mobile App
The end goal is a published app on the iOS App Store and Google Play Store. Every architecture decision must be made with this in mind — not just what works on localhost today.

**Future requirements to design toward (not implement now):**
- Authentication — per-user identity, sessions, token management
- Per-user data isolation — no shared state between accounts
- Server-side persistence — localStorage is a local prototype; data must eventually live on a server
- Access controls — API keys, admin vs. user roles, data ownership
- Export/import features — design these with eventual multi-user security in mind, not just localhost convenience; an export that works fine solo can become a data-leakage vector in a multi-user system

**What this means for current work:**
- Don't hardcode assumptions that there is only one user
- Don't build export/import flows that would be insecure if another user's data were present
- Don't architect around localStorage as a permanent solution — it's a scaffold, not the foundation
- Flag any decision that would be painful to undo once real users and real data exist

---

## File Structure
one-a-day/
├── index.html              # Shell only — loads all layers in order
├── schema.sql              # Supabase schema — run once in SQL editor
├── css/
│   └── app.css             # All styles and design tokens
├── js/
│   ├── supabase-client.js  # Supabase client init (URL + publishable key)
│   ├── data.js             # DB, persona, constants, data access, cloud save/load, export/import
│   ├── engine.js           # Pure functions: pressure(), deadlineState(), suggestArea(), esc()
│   ├── api.js              # Anthropic API calls: genInsight(), draftEmail()
│   ├── render.js           # All DOM rendering
│   └── modals.js           # All modal functions, form handling, auth modals
├── tests/
│   ├── tests.js            # Full test suite (118 tests) + boot functions
│   └── tests.data.js       # Seed data: threads, cadences, habits, ideas
└── README.md

## Script Load Order in index.html
supabase (CDN) → js/supabase-client.js → js/data.js → js/engine.js → js/api.js → js/render.js → js/modals.js → tests/tests.data.js → tests/tests.js → OAD.boot()

## The Raptor Principle
Tests run before any UI renders. OAD.boot() in tests.js runs the full test suite first. If any test fails, UI is blocked. This is non-negotiable.

## Global Namespace
All code lives on window.OAD = {}. No modules, no bundler — plain vanilla JS that runs in a browser via python3 -m http.server 8080.

---

## Persistence Architecture — Supabase (LIVE)
- Backend: Supabase (PostgreSQL + JSONB + RLS). Project: hypddwbncupihqfhwiwb.supabase.co
- Schema: single `user_data` table — one row per user, entire OAD.DB stored as JSONB `db` column
- RLS: `auth.uid() = user_id` on all operations — DB enforces per-user isolation
- localStorage: kept as local cache only; saves on every mutation, Supabase is authoritative
- Auth: email/password via Supabase Auth. Session persists across reloads (no re-login required)
- Boot flow: tests → "Launch App" → check Supabase session → if session: load cloud data (or seed + push) → render; if no session: show sign-in modal
- Sign out: available in Settings modal

**Key functions:**
- `OAD._saveToCloud()` — async, fire-and-forget, called by saveDB() when authenticated
- `OAD._loadFromCloud()` — async, called on boot/sign-in; returns true if data found
- `OAD._bootAfterAuth()` — called after sign-in/sign-up; loads cloud, migrates localStorage, seeds if empty
- `OAD._finishBoot()` — renders list and selects first thread
- `OAD._normalizeDB()` — ensures all arrays exist and backfills UUIDs on threads that predate the field
- `OAD._migrateActionDeadlines()` — one-time migration: sets `deadline = next_action_date` for open action-type threads that have no deadline. Called by `_bootAfterAuth` and `_initApp` after cloud/localStorage load.

---

## Remaining Architecture Queue
1. ✅ Supabase project + schema + RLS
2. ✅ Replace saveDB/loadDB with Supabase client calls
3. ✅ Auth UI (sign in, sign up, sign out, session restore)
4. **Realtime cross-device sync** — subscribe to user_data table changes, re-render on update
5. **Capacitor mobile packaging** — wrap for iOS App Store + Google Play

localStorage is a temporary bridge only — do not build new features on top of it.

---

## Data Model — Thread
Every thread has:
- **uuid** — stable UUID assigned at creation (`crypto.randomUUID()`). Used for export/import matching. Never changes. Backfilled by `_normalizeDB()` for threads that predate this field.
- id — sequential integer, internal use only
- title, life_area, status (open|waiting|stalled|closed), priority (critical|high|medium|low)
- closing_condition (string) — what verified OUTCOME closes this, not what action
- closing_condition_type (outcome|action), closing_condition_met (boolean)
- current_assumption (string), assumption_verified (boolean)
- next_action, next_action_date, next_action_channel, next_action_contact
- contingency_trigger_date, contingency_action, contingency_escalation
- deadline (ISO date, optional), effortEstimate, weeklyCommitment, effortLogged
- connections[] — graph edges: {to_label, edge_type: blocks|enables|relates}
- evolution_log[] — {date, note} living history
- ai_insights[] — counsel engine observations
- date_push_count (integer) — tracks how many times the next_action_date has been pushed back

## Data Model — Deadline-Driven Prioritization (LIVE)

### Design Principle
Work backwards from the deadline, not forward from today. If something is due 6/26 and requires 4 sessions of work, the app must surface that *this week's session is not optional* — before it feels urgent, not after.

### Thread Attributes
- `deadline` — ISO date string, optional. Set in edit form under "Deadline Tracking"
- `effortEstimate` — total estimated sessions needed
- `weeklyCommitment` — minimum sessions per week required to hit deadline
- `effortLogged` — sessions completed to date (auto-increments on Complete Action)

### Derived State — `OAD.deadlineState(thread)` in engine.js
- `daysRemaining`, `weeksRemaining` — from today to deadline
- `sessionsRemaining` — effortEstimate minus effortLogged
- `onTrack` — boolean: sessionsRemaining <= weeksRemaining * weeklyCommitment
- `behindBy` — sessions in deficit when not on track

### UI Behavior (implemented)
- Thread list: deadline threads show compact row — "3w remaining · 4 sessions left ⚑ 1 behind"
- Thread list: at-risk threads (onTrack: false) get red left border + subtle background
- Detail view: "Deadline Tracking" card with full countdown, on-track/at-risk badge, progress
- Edit form: "Deadline Tracking" section with deadline, effortEstimate, weeklyCommitment fields

### Pressure Score Integration
- deadline within 7 days and not on track: +30
- deadline within 14 days and not on track: +20
- deadline within 30 days and not on track: +10
- behind by 2+ sessions: additional +15

### Live Test Case
- Thread: eCornell Python for Data Science — deadline June 26, 2026
- effortEstimate: 4, weeklyCommitment: 1, effortLogged: 0
- Current state: at-risk (1 session behind)

## Data Model — Persona (the moat)
OAD.DB.persona contains:
- assumption_tendencies[] — observed patterns of unverified assumptions
- counsel_history[] — every AI insight generated and user response
- what_is_working[], what_is_not_working[]
- life_context: { pressure_level, hard_deadline, hard_deadline_context }
- tone_calibration: { challenge_tolerance, current_mode, avoid_patterns[] }

## Pressure Score (engine.js)
OAD.pressure(thread) returns 0-100:
- stalled: +30, waiting: +15
- assumption unverified: +20
- critical: +30, high: +20, medium: +10
- each blocking connection: +10
- contingency < 3 days: +25, < 7 days: +15, < 14 days: +5
- deadline within 7 days and not on track: +30
- deadline within 14 days and not on track: +20
- deadline within 30 days and not on track: +10
- behind by 2+ sessions: additional +15
- **cross-load multiplier: +12 when `getDayLoad(thread.next_action_date) > 150`** — surface threads piling up on the same day
- capped at 100

## Cross-Load Awareness (engine.js)
`OAD.getDayLoad(dateStr)` — sums `pressure(t, true)` for all non-closed threads whose `next_action_date === dateStr`. The `_inBleedUp=true` flag prevents recursive calls into `getDayLoad`. If the day's total load exceeds 150, each thread on that date gets +12 pressure. Implemented in `engine.js`; tested with a 3-thread stalled-critical fixture at date '2099-01-01'.

## API Layer (api.js) & The Coach Engine
- **OAD._llmCall(messages, systemPrompt)** — Router that dynamically sends requests to either Claude or Gemini based on the user's provider setting.
- **OAD._geminiCall / OAD._claudeCall** — Provider-specific implementations.
- **OAD.genDailyIntercept()** — Synthesizes day load, stalled threads, and overdue cadences into a 3-bullet morning briefing (Focus, Avoidance, Reality Check).
- **OAD.extractPersonaLesson(thread, pushes, reason)** — Analyzes procrastination behavior and proposes updates to the user's Persona (`assumption_tendencies` or `what_is_not_working`).
- **OAD.genInsight(thread)** — Generates deep-dive insight for a specific thread.
- **OAD.draftEmail(tid)** — Generates an email draft based on thread history.
- Model defaults: `gemini-1.5-pro-latest` or `claude-3-5-sonnet-latest`.

## Render Layer (render.js)
- `OAD.renderList()` — thread list with persona bar, pressure scores, sorted by pressure desc; deadline countdown rows; at-risk elevation
- `OAD.renderDetail(id)` — full thread detail: next action, deadline card, AI insight, closing condition, assumption, contingency, connections, evolution log
- `OAD.renderCadencePanel()` — cadence view with overdue banners and mark-done actions
- `OAD.renderHabitPanel()` — daily habit check-in panel; yes/no per habit, streak, reflection note, Change button
- `OAD.renderIdeaPanel()` — idea incubation list; idea-of-the-week callout, grouped by type, promote-to-thread flow
- `OAD.renderDailyView()` — default landing view with 5 sections: Overdue / Today / This Week / Active + **This Week's Load** (5th section). Load section shows 7 days: count of threads + cadences due, labeled Clear (0-1) / Busy (2) / Heavy (3+). ADA 508: text labels, border-left color is secondary, full aria-label on each row.
- Zero API calls in this layer

---

## Export / Import (LIVE)
Located in `js/data.js` and `js/modals.js`. Accessible from the Settings modal.

### Export (`OAD.exportThreads()`)
Moat-safe flat JSON. Includes basic thread attributes (uuid, parent_uuid, title, status, priority, life_area, pressure, closing_condition, next_action, next_action_date, etc.). Calls `_normalizeDB()` + `saveDB()` before building the payload so UUID backfill is always complete.

**Deliberately excludes:** connections[] (the graph is the moat), evolution_log, current_assumption, contingency_action, contingency_escalation, ai_insights[], and persona data.

Includes `exported_by: user_id` — ownership-stamped for future multi-user scoping.

### Import (`OAD.parseImportFile()` + `OAD.applyImport()`)
Accepts the same JSON format. Matching priority: **(1)** UUID match — `row.uuid` finds existing thread → update; **(2)** title fallback — `row.uuid` absent/null AND exactly one non-closed thread shares the title → update (prevents duplicates from AI-generated patches and older export formats that omit UUIDs); **(3)** create — neither matched. Title fallback is deliberately conservative: if two open threads share the same title, the row falls through to create rather than risk updating the wrong one.

**`_IMPORT_FIELDS`** controls which fields sync on update. `title` and `date_push_count` are included. The `_diffImportItem` preview shows title changes before the user confirms.

- Row with UUID matching an existing thread → staged as update (shows field-by-field diff, requires per-item checkbox confirmation)
- Row with unknown or absent UUID → create
- Evolution log is always appended, never overwritten; deduped by date+note

`applyImport()` re-looks up each thread by UUID at apply time, not from stored references, to avoid stale-reference bugs.

---

## Data Model — Habit (LIVE)
Habits are living practices that never close. Not tasks. Not threads.
The check-in question is not "did I do it" but "how is this going in my life right now."

Every habit has:
- id, title, life_area
- frequency — daily | weekly | every-other-day | custom
- time_of_day — morning | evening | flexible
- current_streak, longest_streak
- last_checked_in (date), last_check_in_done (boolean), last_check_in_note (string)
- phase — active | check-in | dormant
- why — the anchor: why does this practice matter

11 seed habits from TJ's Plan of Life (morning prayers through Evening Examen).

UI behavior:
- Habits have their own panel — click "Habits" in the header nav
- Check-in is yes/no + optional one-line reflection, inline on the card
- Streak increments on consecutive daily yes check-ins; resets on no
- Streak is visible but not weaponized — missing a day is noted, not catastrophized
- Missing 3+ days shown as "Last checked in N days ago" on the card

Counsel engine cross-data-type behavior (future):
- Notices when habit check-ins are sparse during high-pressure thread weeks
- This is a core product differentiator — no other app holds both the life graph and spiritual practice with a reasoning engine across both

## Data Model — Idea (LIVE)
Ideas and deferred reading that are not ready to schedule and have no closing condition.
A holding area for what matters but isn't ready.

Every idea has:
- id, title, notes, source, added_date, last_surfaced
- type — book | article | creative | project-seed | other
- energy_required — low | medium | high
- tags[]

14 seed ideas: 4 creative + 10 books from TJ's real Todoist data.

UI behavior:
- Ideas have their own panel — click "Ideas" in the header nav
- `OAD.ideaOfTheWeek()` — deterministic weekly rotation; same idea all week, cycles list
- Grouped by type: Creative, Books, Other
- No due dates, no pressure scores, no overdue states
- "→ Promote to Thread" opens the full thread form pre-filled with the title — deliberate friction; the user must define closing condition, next action, etc. Idea stays in the incubation list.
- "Remove" deletes from incubation list with confirmation

## Data Model — Cadence (LIVE)
Cadences are date-anchored mandatory obligations that recur on a known schedule. The date IS the work. Missing a Cadence is a failure state.

Every cadence has:
- id, title, life_area
- recurrence — monthly-1st | monthly-15th | monthly-last | weekly | weekly-days | custom (`custom` is in the enum but has no `nextCadenceDue`/`prevCadenceDue` branch — unimplemented)
- days_of_week[] — only used when recurrence is `weekly-days`; integers 0–6 matching `Date.getDay()` (0 = Sun). Backfilled to `[]` by `_normalizeDB()` for cadences that predate this field.
- last_completed (date), next_due (date), overdue (boolean)
- notes, consequences

`OAD.nextCadenceDue(recurrence, fromDate, daysOfWeek)` and `OAD.prevCadenceDue(recurrence, daysOfWeek)` in `engine.js` compute the schedule. For `weekly-days`, next-due walks forward from the day *after* `fromDate` to the nearest matching weekday (so completing on a day that's itself in the list rolls to the following week, not the same day); prev-due walks backward from today inclusive. Both fall back to `null`/plain-weekly behavior if `days_of_week` is empty. `OAD.formatRecurrence(c)` expands `weekly-days` into a sorted day-name label (e.g. `weekly-days (Mon, Wed, Fri)`) for display; the cadence edit form exposes day checkboxes via `.cd-dow`.

3 seed cadences: Pay the Bills (1st), Pay the Bills (15th), and Monthly Bills Review (monthly-15th). Seeding is done by `OAD._seedCadences()` in `tests/tests.data.js` — extracted from `_seedData()` so it can be called independently in the `_bootAfterAuth` guard block.

UI behavior:
- Cadences panel — click "Cadences" in the header nav
- Overdue cadences surface as a hard banner in the detail panel
- Completed cadences show ✓; reset automatically on next trigger date
- No pressure score — binary: done or not done

## Calendar Sync & OAuth SSO
- **OAuth Providers:** Google (`google`) and Microsoft (`azure`) are implemented in the `OAD._signInWithProvider` flow (`js/modals.js`).
- **Scopes Requested:** 
  - Google: `https://www.googleapis.com/auth/calendar.readonly`
  - Microsoft: `Calendars.Read`
- **Security:** Access tokens are secured and provided via `supabase.auth.getSession()` session metadata, preparing the application to safely pull down calendar events.
