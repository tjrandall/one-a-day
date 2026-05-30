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
