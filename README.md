<div align="center">

# one·a·day

### *Everyone who operates at a high level has an executive assistant.*
### *One-A-Day gives that to everyone.*

**AI-powered · Always on · Working across every area of your life**

---

[![Tests](https://img.shields.io/badge/tests-23%20passing-brightgreen)]()
[![Architecture](https://img.shields.io/badge/architecture-graph--based-blue)]()
[![AI](https://img.shields.io/badge/AI-Claude%20powered-purple)]()
[![Status](https://img.shields.io/badge/status-active%20development-orange)]()

</div>

---

## The Problem With Every To-Do App

You've tried them all. Todoist. Things. Notion. Asana. They all fail the same way.

**They model tasks as atomic units** — a thing to do, a date, done or not done. Reality doesn't work that way. A task is a *thread* — it has context, dependencies, competing priorities, and an evolving follow-up chain that changes based on what happens at each step.

**They're trees, not graphs.** Every app models one parent, children underneath, strictly hierarchical. But reality is a directed graph. The thing you're waiting on for your job search connects to your housing situation connects to your financial runway. No app surfaces those connections. You just feel stuck and don't know why.

**They're reactive, not proactive.** Every existing app manages what you *tell* it. It never asks whether the frame you're operating in is correct. It never generates a move you haven't thought of. It never surfaces the cost of inaction.

*It counts to 100 and stops.*

---

## What One-A-Day Does Differently

### 🧠 The Counsel Engine
An AI that doesn't just track your tasks — it *thinks* about them. Every thread gets an AI-generated insight that applies **epistemic auditing**: what assumption is baked into this thread? What's the real closing condition? What are you not seeing? What happens if you do nothing?

This isn't a chatbot bolted onto a list. It's a reasoning engine that knows your full life context and gets smarter every day you use it.

### 🕸️ Life as a Graph
Tasks aren't isolated. They're nodes in a directed graph. One-A-Day makes those connections explicit:

- **blocks** — this thread cannot close until that one does
- **enables** — closing this unlocks something else
- **relates** — these threads share context

The app finds cycles (circular dependencies that have you stuck), surfaces critical path nodes (where one stall cascades into five), and tells you what to work on based on the actual shape of your life — not an arbitrary priority list.

### 🎯 Closing Conditions, Not Task Completion
Most apps ask "did you do the thing?" One-A-Day asks "is the outcome actually achieved?"

Every thread has a **closing condition** — a specific, verifiable fact that proves the thread is truly done. Not "sent the email." Not "made the call." *What real-world outcome has to be true for this to be closed?*

This distinction sounds subtle. It changes everything.

### ⚠️ Assumption Auditing
Every thread carries a **current assumption** field. The app tracks whether that assumption has been verified as fact — and flags when you're waiting on something that's built on an unverified assumption.

> *"Equipment was ordered and is in transit."*  
> **Unverified.** No tracking number. No vendor name. No ETA.

The counsel engine sees this and asks: what would have to be true for this to actually be in motion? That's not pessimism. That's the difference between waiting and acting.

### 📈 The Persona — The Moat
One-A-Day builds a living model of *you*. Not a profile. A behavioral intelligence layer that observes patterns across all your threads over time:

- Where does your thinking tend to be most assumption-laden?
- What life areas are you chronically stalling in?
- Which types of counsel do you accept vs. dismiss?
- What's actually working — and what isn't?

The longer you use One-A-Day, the richer this model becomes. The richer the model, the better the AI performs against it — not because the AI improved, but because it knows you better.

**The AI is a commodity. The graph is not.**

---

## The Raptor Principle

> *In Jurassic Park, the computer wasn't wrong at counting to 100. It was wrong at **stopping** at 100. Nobody questioned the stopping condition.*

One-A-Day is built on **epistemic humility + adversarial questioning** — code-named *Raptor*. Before accepting any constraint, assumption, or stopping condition as valid, ask: is this based on verified fact, or on an assumption we made at some point and never re-examined?

This principle is baked into the product at every level:

- Every thread has an explicit assumption field and verification status
- The counsel engine applies adversarial questioning to every insight it generates
- **Tests run before any UI renders** — if assumptions in the code are wrong, the UI is blocked
- The data model was defined before the UI was built, not the other way around

When something feels stuck, the first question isn't "who's blocking?" It's: *what assumption is this built on, and is that assumption actually a fact?*

---

## Architecture

One-A-Day is built for the long game. Every architectural decision anticipates where this is going.

```
one-a-day/
├── index.html              # Shell only — orchestrates load order
├── css/
│   └── app.css             # Design tokens + all component styles
├── js/
│   ├── data.js             # Graph DB, persona model, data access
│   ├── engine.js           # Pure functions — pressure scoring, area detection
│   ├── api.js              # AI counsel engine — isolated, swappable
│   ├── render.js           # DOM layer — zero API calls, zero side effects
│   └── modals.js           # Form handling and state mutation
├── tests/
│   ├── tests.js            # Full test suite + boot sequence gate
│   └── tests.data.js       # Seed data — customizable life scenarios
└── README.md
```

### Clean Layer Separation

| Layer | Owns | Maps to (production) |
|-------|------|----------------------|
| `data.js` | Graph state, persona, constants | PostgreSQL + Prisma ORM |
| `engine.js` | Pure business logic, no DOM | Shared utility library |
| `api.js` | AI inference calls | Node.js backend routes |
| `render.js` | DOM generation | React components |
| `modals.js` | Form handling | React controlled components |
| `tests/` | Test suite + boot gate | Jest + CI pipeline |

**The AI is a plugin, not the foundation.** A clean abstraction layer separates the graph from the reasoning engine — swap Claude for GPT-4, Gemini, a local model, or a GovCloud-approved LLM without touching application logic. The moat is the graph. Not the AI.

---

## The Data Model

### Thread
The fundamental unit. Not a task — a *thread*.

```javascript
{
  // Identity
  id, title, life_area, status, priority,

  // The epistemic core
  closing_condition,       // What OUTCOME closes this — not what action
  closing_condition_type,  // 'outcome' | 'action'
  current_assumption,      // What we're assuming right now
  assumption_verified,     // Has this been confirmed as fact?

  // Execution
  next_action,
  next_action_date,
  next_action_channel,
  next_action_contact,

  // Contingency
  contingency_trigger_date,
  contingency_action,
  contingency_escalation,  // The escalation beyond the obvious

  // The graph
  connections[],           // { to_label, edge_type: 'blocks'|'enables'|'relates' }

  // Living history
  evolution_log[],         // { date, note } — what happened, what changed

  // The moat
  ai_insights[]            // Counsel engine observations + user responses
}
```

### Pressure Score
Every thread gets a computed urgency score (0-100) based on:
- Status (stalled: +30, waiting: +15)
- Unverified assumption: +20
- Priority (critical: +30, high: +20, medium: +10)
- Each blocking connection: +10
- Contingency proximity (< 3 days: +25, < 7 days: +15, < 14 days: +5)

Threads sort by pressure. The most urgent thing is always first.

### Persona — The Intelligence Layer
```javascript
{
  assumption_tendencies[],  // Where your thinking is most assumption-laden
  counsel_history[],        // Every AI insight + your response = learning signal
  what_is_working[],        // Patterns that are producing results
  what_is_not_working[],    // Patterns that aren't — and how to address them
  life_context: {
    pressure_level,
    hard_deadline,
    hard_deadline_context
  },
  tone_calibration: {
    challenge_tolerance,    // How direct should the AI be with you?
    current_mode,           // supportive | direct | urgent | exploratory
    avoid_patterns[]        // Things the AI should never do with this user
  }
}
```

---

## The Roadmap

### Now — Local Prototype ✅
Graph model working. Pressure scoring live. Test suite gate enforced. Counsel engine integrated. Layer architecture clean and deployable-ready.

### Next — Deployable Stack
- Node.js + Express backend
- PostgreSQL with Prisma (graph model maps directly)
- React frontend (render.js becomes components)
- Docker + GCP Cloud Run
- Full offline mode with intelligent sync

### Soon — The Features That Make It Irreplaceable
- **Heat map** — visual graph showing which life areas are running hot, which are stalled, where the critical path is
- **Connection engine** — AI scans across all threads and surfaces connections you haven't noticed
- **Proactive counsel** — generates new threads you haven't thought of, based on patterns from people in similar situations
- **Calendar integration** — reads your calendar to surface blocking conflicts and theme connections
- **Habit stack** — lifecycle-aware recurring behavior management (active phase → check-in mode → automatic)
- **Idea incubation** — a third data type for intentions that aren't ready to schedule but shouldn't be lost

### Later — The Platform
- Team graphs — individual-first model with emergent team layer
- Team Priority Mode — AI coaches individuals in service of team closing conditions
- Integrations — Jira, Asana, Slack, Google Calendar, GitHub
- Enterprise — SSO, audit logging, data residency, white-labeling, GovCloud
- Mobile — full feature parity, offline-first

---

## Running It

```bash
git clone https://github.com/tjrandall/one-a-day.git
cd one-a-day
python3 -m http.server 8080
```

Open **http://localhost:8080**

The test suite runs first. All 23 tests must pass before the UI renders. That's not a bug. That's the Raptor Principle in action.

Add your Anthropic API key in Settings to activate the counsel engine.

---

## Why This Exists

This project started as a personal tool — built by someone managing a federal job search, a business formation saga, a home sale, VA claims, VR&E coursework, Coast Guard Auxiliary work, and an open-source infrastructure project *simultaneously*.

Every to-do app failed. Not because they were badly built. Because they were solving the wrong problem. They tracked tasks. What was needed was a system that could hold the full complexity of a real human life — the connections between things, the assumptions underneath things, the cost of inaction on things — and reason about it intelligently.

One-A-Day is that system.

---

<div align="center">

*Built with the Raptor Principle.*  
*Question the frame. Not just the answer.*

**[github.com/tjrandall/one-a-day](https://github.com/tjrandall/one-a-day)**

</div>
