# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

One-a-day is a single-file personal task manager ("chief of staff") that surfaces one prioritized task per day and uses the Anthropic API for AI coaching after completing or deferring a task.

**There is no build system.** The entire app is `index.html` — open it directly in a browser. No npm, no bundler, no dependencies.

## Running and testing

- **Run:** Open `index.html` in a browser (`open index.html` on Mac, `xdg-open index.html` on Linux, or use a local server like `python3 -m http.server`).
- **Tests:** Expand the "Tests" collapsible panel at the bottom of the page and click "Run all tests". Tests run entirely in-browser against live JS state.
- **Seed data:** Click "Load my tasks" in the test panel to populate with real-world task fixtures.

## Architecture

Everything lives in one file: HTML structure → `<style>` block → inline `<script>`.

**State** (four module-level variables):
- `tasks` — array of task objects (`mkTask()` normalizes shape)
- `config` — scheduling config (`rescheduleDays`, `businessWeekends`, `personalWeekends`)
- `filter` — current queue filter string
- `editId` / `coachSuggestion` — modal state

**Rendering** is fully imperative: every state mutation ends with a call to `render()`, which rewrites `innerHTML` for the stats, today card, and task list.

**Scheduling logic** (`computeFollowUpDate`, `addBusinessDays`, `nudgeToWeekday`) decides when a waiting task resurfaces. Business categories (`legal`, `financial`, `va-vre`, `jobs`) skip weekends by default; personal categories do not.

**AI coaching** (`callCoach`) fires after "Mark done" and "Waiting on response" actions. It calls `https://api.anthropic.com/v1/messages` directly from the browser using `claude-sonnet-4-20250514` and expects a JSON-only response. The system prompt embeds TJ's personal context (veteran status, ongoing tasks, location). **Note:** the fetch currently omits the `Authorization` header — the API key must be added there for coaching to work.

**Persistence** is session-only. Export/Import buttons serialize the full `{config, tasks}` state to a JSON file.

**Defer counter** tracks how many times a task has been skipped or marked waiting. At ≥2 deferrals the task shows a yellow badge; at ≥3 it turns red and the coach acknowledges the avoidance pattern.

## Key data shape

```js
// mkTask() defaults
{ id, name, category, execType, taskType, priority, dueDate,
  notes, status, doneDate, waitingFollowUp, deferCount }
```

`execType` controls where/how the task is done (`phone`, `computer`, `errand`, `thinking`, `quick`) and drives the contextual hint shown in the today card.

`taskType` can override the business/personal classification (`auto` infers from `category`).
