# One-A-Day — Build Spec for Claude Code

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

## File Structure
one-a-day/
├── index.html              # Shell only — loads all layers in order
├── schema.sql              # Supabase schema — run once in SQL editor
├── css/
│   └── app.css             # All styles and design tokens
├── js/
│   ├── supabase-client.js  # Supabase client init (URL + publishable key)
│   ├── data.js             # DB, persona, constants, data access + cloud save/load
│   ├── engine.js           # Pure functions: pressure(), deadlineState(), suggestArea(), esc()
│   ├── api.js              # Anthropic API calls: genInsight(), draftEmail()
│   ├── render.js           # All DOM rendering: renderList(), renderDetail()
│   └── modals.js           # All modal functions, form handling, auth modals
├── tests/
│   ├── tests.js            # Full test suite + OAD.boot() + _initApp + _bootAfterAuth
│   └── tests.data.js       # Seed data loaded on boot
└── README.md

## Script Load Order in index.html
supabase (CDN) → js/supabase-client.js → js/data.js → js/engine.js → js/api.js → js/render.js → js/modals.js → tests/tests.data.js → tests/tests.js → OAD.boot()

## The Raptor Principle
Tests run before any UI renders. OAD.boot() in tests.js runs the full test suite first. If any test fails, UI is blocked. This is non-negotiable.

## Global Namespace
All code lives on window.OAD = {}. No modules, no bundler — plain vanilla JS that runs in a browser via python3 -m http.server 8080.

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

## Data Model — Thread
Every thread has:
- id, title, life_area, status (open|waiting|stalled|closed), priority (critical|high|medium|low)
- closing_condition (string) — what verified OUTCOME closes this, not what action
- closing_condition_type (outcome|action)
- closing_condition_met (boolean)
- current_assumption (string) — what we are assuming right now
- assumption_verified (boolean) — has this been confirmed as fact?
- next_action, next_action_date, next_action_channel, next_action_contact
- contingency_trigger_date, contingency_action, contingency_escalation
- deadline (ISO date, optional), effortEstimate, weeklyCommitment, effortLogged
- connections[] — graph edges: {to_label, edge_type: blocks|enables|relates}
- evolution_log[] — {date, note} living history
- ai_insights[] — counsel engine observations

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
- Current state: at-risk (1 session behind), pressure score elevated

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
- capped at 100

## API Layer (api.js)
- OAD.genInsight(thread) — calls claude-sonnet-4-20250514, injects full persona context, returns JSON insight
- OAD.draftEmail(tid) — generates email draft via Claude
- Model: claude-sonnet-4-20250514
- Requires server context for CORS — run via python3 -m http.server 8080

## Render Layer (render.js)
- OAD.renderList() — thread list with persona bar, pressure scores, sorted by pressure desc; deadline countdown rows; at-risk elevation
- OAD.renderDetail(id) — full thread detail: next action, deadline card, AI insight, closing condition, assumption, contingency, connections, evolution log
- OAD.renderCadencePanel() — cadence view with overdue banners and mark-done actions
- Zero API calls in this layer

## Remaining Architecture Queue
1. ✅ Supabase project + schema + RLS
2. ✅ Replace saveDB/loadDB with Supabase client calls
3. ✅ Auth UI (sign in, sign up, sign out, session restore)
4. Realtime cross-device sync — subscribe to user_data table changes, re-render on update
5. Capacitor mobile packaging — wrap for iOS App Store + Google Play

localStorage is a temporary bridge only — do not build new features on top of it.

## Next Priority — Habit Check-in Panel
Build the habit check-in panel as a dedicated view (not in the thread list). One-tap yes/no per habit, current streak visible, optional one-line reflection. No pressure scores, no overdue states, no automation. Data model and seed habits are fully specified below.

## Data Model — Habit
Habits are living practices that never close. Not tasks. Not threads.
The check-in question is not "did I do it" but "how is this going in my life right now."

Every habit has:
- id, title, life_area
- frequency — daily | weekly | every-other-day | custom
- time_of_day — morning | evening | flexible
- current_streak, longest_streak
- last_checked_in (date), last_check_in_note (string)
- phase — active | check-in | dormant
- why — the anchor: why does this practice matter

Seed habits (TJ's Plan of Life):
- Daily Rosary — daily, morning, personal
- Reading and Prayer 20min — daily, 6:30am, personal
- Evening Examen — daily, 8pm, personal
- Attend Mass — weekly Thursday, personal
- Morning Offering — daily, morning, personal
- Prayer to St. Joseph — daily, 7:30am, personal
- Morning Prayers routine — daily, morning, personal
- Ave Maris Stella — daily, morning, personal
- Litany of Humility — every-other-day, morning, personal
- Prayer before work — every workday, morning, personal
- Consecration to Sacred Heart — weekly Sunday, personal

UI behavior:
- Habits do NOT appear in the thread list
- Habits have their own view — a simple daily check-in panel
- Check-in is a single tap yes/no plus optional one-line reflection
- Streak is visible but not weaponized — missing a day is noted, not catastrophized
- Missing 3+ days triggers a gentle counsel engine observation, not a pressure score

Counsel engine cross-data-type behavior:
- Notices when habit check-ins are sparse during high-pressure thread weeks
- Example insight: "Your rosary check-ins have been sparse this week. Your three
  highest-pressure threads are all in job_search and finances. This may be worth noticing."
- This is a core product differentiator. No other app can do this because no other app
  holds both the life graph and the spiritual practice in the same system with a reasoning
  engine across both.

## Data Model — Idea
Ideas and deferred reading that are not ready to schedule and have no closing condition.
Not threads. Not habits. Intentions sitting in a holding area waiting for the right moment.

Every idea has:
- id, title, notes, source, added_date, last_surfaced
- type — book | article | creative | project-seed | other
- energy_required — low | medium | high
- tags[]

Seed ideas (TJ's real Todoist data):

Creative incubation:
- NaNoWriMo: Book idea — Enemy (creative)
- Hailstone Sequence (Collatz conjecture) — trackback to Adam and Eve (creative)
- Zen of Tommy notes (creative)
- T-shirt: G-Man / Dirty Dozen — apostles as movie poster headshots (creative)

Read Later:
- The New Economics for Industry Government Education — W. Edwards Deming (book)
- Five Dysfunctions of a Team — Patrick Lencioni (book)
- Heroic Leadership — Chris Lowney (book)
- Safety at the Sharp End — Rhona Flin (book)
- Managing the Unexpected — Weick (book)
- The Human Contribution — James Reason (book)
- Sources of Power — Gary Klein (book)
- Judith Herman — Trauma and Recovery (book)
- Bessel Van Der Kolk — trauma theory (book)
- The Heart of Change — John Kotter (book)

UI behavior:
- Ideas do NOT appear in the thread list
- Ideas have their own view — a simple scrollable incubation list
- System randomly surfaces one idea per week in the main view as idea of the week
- No due dates, no pressure scores, no overdue states
- An idea becomes a thread only when you consciously decide to act on it — this is a deliberate friction point. The system never automatically promotes an idea to a thread.

## Data Model — Cadence
Cadences are date-anchored mandatory obligations that recur on a known schedule. Not Threads (no closing condition). Not Habits (not a practice — a hard obligation with real consequences if missed). Not Ideas. The date IS the work. Missing a Cadence is not a pressure score event — it's a failure state.

Every cadence has:
- id, title, life_area
- recurrence — monthly-1st | monthly-15th | monthly-last | weekly | custom
- trigger_dates[] — computed list of upcoming due dates
- last_completed (date)
- next_due (date) — derived from recurrence + last_completed
- overdue (boolean) — derived: next_due < today and not completed
- notes — what specifically needs to happen on this date
- consequences — what breaks if this is missed (plain language)

Seed cadences:
- Pay the Bills (1st) — recurrence: monthly-1st | consequences: late fees, service disruption
- Pay the Bills (15th) — recurrence: monthly-15th | consequences: late fees, service disruption

UI behavior:
- Cadences do NOT appear in the thread list
- Cadences surface in a dedicated panel — a simple calendar-style view of upcoming trigger dates
- Overdue cadences surface as a hard banner — not subtle, not a badge
- Completed cadences for the current period show a checkmark; they reset automatically on next trigger date
- No pressure score — Cadences are binary: done or not done
- Counsel engine awareness: if a Cadence is overdue and the user is interacting with low-priority threads, surface an interruption: "Pay the Bills (1st) is overdue. Everything else can wait."
