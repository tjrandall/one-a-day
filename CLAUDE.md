cat > ~/code/one-a-day/CLAUDE.md << 'SPEC'
# One-A-Day — Build Spec for Claude Code

## File Structure
one-a-day/
├── index.html          # Shell only — loads all layers in order
├── css/
│   └── app.css         # All styles and design tokens
├── js/
│   ├── data.js         # DB, persona, constants, data access
│   ├── engine.js       # Pure functions: pressure(), suggestArea(), esc()
│   ├── api.js          # Anthropic API calls: genInsight(), draftEmail()
│   ├── render.js       # All DOM rendering: renderList(), renderDetail()
│   └── modals.js       # All modal functions and form handling
├── tests/
│   ├── tests.js        # Full test suite + OAD.boot() entry point
│   └── tests.data.js   # Customizable seed data loaded on boot
└── README.md

## Script Load Order in index.html
js/data.js → js/engine.js → js/api.js → js/render.js → js/modals.js → tests/tests.data.js → tests/tests.js → OAD.boot()

## The Raptor Principle
Tests run before any UI renders. OAD.boot() in tests.js runs the full test suite first. If any test fails, UI is blocked. This is non-negotiable.

## Global Namespace
All code lives on window.OAD = {}. No modules, no bundler — plain vanilla JS that runs in a browser via python3 -m http.server 8080.

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
- connections[] — graph edges: {to_label, edge_type: blocks|enables|relates}
- evolution_log[] — {date, note} living history
- ai_insights[] — counsel engine observations

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
- capped at 100

## API Layer (api.js)
- OAD.genInsight(thread) — calls claude-sonnet-4-20250514, injects full persona context, returns JSON insight
- OAD.draftEmail(tid) — generates email draft via Claude
- Model: claude-sonnet-4-20250514
- Requires server context for CORS — run via python3 -m http.server 8080

## Render Layer (render.js)
- OAD.renderList() — thread list with persona bar, pressure scores, sorted by pressure desc
- OAD.renderDetail(id) — full thread detail: next action first, AI insight, closing condition, assumption, contingency, connections, evolution log
- Zero API calls in this layer

## Test Data (tests/tests.data.js)
Pre-loaded threads for TJ Randall:
1. VR&E equipment (waiting, high)

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
