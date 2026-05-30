# One-A-Day

A personal operating system for managing life threads — the open loops, assumptions, contingencies, and next actions that actually run your life.

## Running

```bash
cd one-a-day
python3 -m http.server 8080
# open http://localhost:8080
```

## Architecture

Plain vanilla JS, no bundler. All code lives on `window.OAD`.

| File | Role |
|------|------|
| `js/data.js` | DB, persona, CRUD operations |
| `js/engine.js` | Pure functions: `pressure()`, `suggestArea()`, `esc()` |
| `js/api.js` | Anthropic API: `genInsight()`, `draftEmail()` |
| `js/render.js` | DOM rendering: `renderList()`, `renderDetail()` |
| `js/modals.js` | All modals and form handling |
| `tests/tests.data.js` | Seed data |
| `tests/tests.js` | Test suite + `OAD.boot()` |

## The Raptor Principle

Tests run before the UI renders. `OAD.boot()` runs the full suite on load. If any test fails, the UI is blocked.

## API Key

Open Settings in the app and paste your Anthropic API key. It is stored in `localStorage` and sent only to `api.anthropic.com`.

## Thread Model

Each thread tracks: status, priority, a closing condition (outcome, not action), the current unverified assumption, next action with date/channel/contact, contingency with trigger date and escalation path, graph connections, and an evolution log.

## Pressure Score

`OAD.pressure(thread)` returns 0–100:

- Stalled: +30, Waiting: +15
- Unverified assumption: +20
- Critical: +30, High: +20, Medium: +10
- Each blocking connection: +10
- Contingency < 3 days: +25, < 7 days: +15, < 14 days: +5
- Capped at 100
