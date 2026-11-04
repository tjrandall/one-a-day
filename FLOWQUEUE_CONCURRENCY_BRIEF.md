# FlowQueue Upgrade Brief - November 2026

Author: T.J. Randall with Claude (Principal Architect)
Date: 2026-11-03
Audience: Claude Code, working in the one-a-day repo and its private submodules

## Ground rules for this session

1. Read `ARCHITECTURE_RULES.md` before touching code. The default assumption is that every new feature is a Thread with extra fields. A new standalone data model needs a written justification and T.J.'s approval before any code is written.
2. Work phase by phase. Each phase ends with a short written report and stops for T.J.'s review. Do not start the next phase without his go-ahead.
3. Nothing is "fixed" until T.J. verifies it against a real export. Passing local tests is necessary, not sufficient.
4. No em dashes anywhere: code, comments, commit messages, docs, UI strings. Use periods, commas, or plain hyphens.
5. Private data lives in private submodules (pattern: `fq-personal`). Nothing personal goes into the public one-a-day repo.

## Order of work

| Order | Item | Why this order |
|---|---|---|
| 1 | A1 Write Safety Phase 0 | Everything else writes data. The CRM import writes hundreds of objects. |
| 2 | A2 Hygiene rule false positives | Small, isolated, restores trust in the warnings. |
| 3 | A3 Focus Now / TOAT empty state | Conditional, see below. |
| 4 | B0 to B3 fq-crm | Builds on a write path we trust. B1 and later need A1 findings reviewed first. |

---

## Part A: Fixes

### A1. Multi-Device Write Safety, Phase 0 (investigate and report only)

Existing brief: `FLOWQUEUE_CONCURRENCY_BRIEF.md`. Run Phase 0 as written there. Do not start Phase 1.

New evidence from 2026-11-03, from real DEV exports:

- The in-app **Catch Up** flow on 2026-10-29 wrote 28 evolution_log entries ("Catch Up: marked done (confirmed by user)", "Catch Up: parked (open -> dormant)", "Completed: ... thread closed"). On every one of those 28 threads the `status` field never changed. The log write landed and the status write did not.
- 3 threads were closed on 2026-10-30 and closed again on 2026-11-02, which suggests a revert happened in between.
- On 2026-11-03, two **bulk imports** (109 threads, then 14 threads plus 1 new edge and 18 deleted edges) persisted completely. Every field was verified against a fresh export.

Lead to check first: the Catch Up write path. Possible causes include writing the log and the status through different code paths, a stale in-memory object overwriting the status after the log append, or the status write being dropped without an error. Confirm or rule each of these out with evidence.

Second incident, 2026-11-03 about 19:50 ET, right after the two imports:
- A page refresh triggered the browser's "Changes you made may not be saved" prompt, even though T.J. had not edited anything since the import. After reload, the app rendered only the header and "Select a thread to view details".
- The Network tab showed static files all 200 (local server fine), but the Supabase request `user_data?select=db&user_id=eq.<id>` stayed **pending** indefinitely. In an incognito window, email sign-in also hung at "Signing in...". Supabase was not responding to either auth or data.
- The request shape suggests the entire FlowQueue database is stored as **one `db` value per user row**. If so, every save rewrites the full dataset (about 2.4 MB in the DEV export). That would explain whole-object last-write-wins, and it would make Disk IO cost scale with total data size, not change size. See the June "Supabase Disk IO Budget Alert" thread. Confirm the storage model in Phase 0, and estimate the IO cost of one save and of one bulk import.
- Find out what the pending save behind the "unsaved changes" prompt contained, and whether it could have overwritten newer data if it had landed late.
- Supabase dashboard at 19:56 ET: Free plan, Nano compute, status stuck at "Checking...", 353 requests in the last hour with a 20.7% success rate, 265 API gateway errors in a single spike around the time of the imports, 13 Postgres errors, and **"Last backup: No backups"**. The Free plan has no database backups, so T.J.'s JSON exports are the only backups. Phase 0 should propose a backup routine (for example, an automatic export after every bulk import and once a day) and check whether one-row-blob storage risks dead-tuple bloat against the Free plan's 500 MB database limit.
- Postgres logs, same evening (ET):
  - 19:01:48-19:01:58: statement timeouts, then "process still waiting for ShareLock on transaction 9638 after 1000 ms" (acquired after 1480 ms). Two transactions were updating the same row at the same time.
  - 19:04:31: "checkpoint complete: wrote 248 buffers ... write=24.968 s". That is about 2 MB taking 25 seconds to write, which means disk throughput was throttled.
  - 19:27:44: "database system was interrupted ... starting up ... not accepting connections". Postgres restarted about 2 minutes after the first bulk import.
  - 19:50:25-19:50:26: another ShareLock wait (transaction 9661), then a statement timeout. This lines up with the refresh that showed the "unsaved changes" prompt.
  - 20:07: database size 15 MB, so bloat against the 500 MB limit is ruled out. Database, Auth, Realtime, Storage, and Edge Functions were all Healthy, but **PostgREST was Unhealthy**. FlowQueue reaches data only through PostgREST, so the app could not load at all. The app's read-only guard ("NOT SAVED: Your data could not be loaded from the cloud, so this session is read-only") correctly stopped an empty session from saving over the cloud data. Keep that guard, and add a test for it.
  - PostgREST logs: 20:06:01-02, after the project restart, PostgREST returned `PGRST002` ("Could not query the database for the schema cache. Retrying.") to the app's `GET /user_data?select=db` requests. Its schema cache query took 6523 ms at 20:06:03, then 2275 ms. After `notify pgrst, 'reload schema'` at 20:10:21, the schema cache loaded in under 1 ms and no errors followed. The cache reports **1 Relation**, which is consistent with a single-table storage model. pg_stat_activity at 20:11 showed no stuck transactions.
  - Conclusion to verify: concurrent writes to a single per-user row are contending for the row lock on an IO-starved Nano instance. Phase 0 must identify every writer (tabs, devices, autosave timers, sync loops) and whether a write can hold its transaction open.
- The 404s for `demo_boot.js`, `demo_data_sync.js`, and `demo.config.js` appeared in the same console. Confirm they are expected when the fq-demo submodule is absent, and silence them if so.

Phase 0 report must include:
- How Catch Up writes status, and how that differs from the import write path.
- Whether the 10/29 pattern can be reproduced in dev.
- Any other in-app flows (quick complete, park, date push) that share the Catch Up write path.

Add an acceptance test to the concurrency brief: "A Catch Up action that marks a thread done or parked is reflected in `status` in the next export, not only in `evolution_log`."

### A2. Hygiene rule `no_dates_set` false positives

In the 2026-11-03 export, all 33 remaining `no_dates_set` warnings fall into categories that should not need dates:
- `thread_kind` = `habit` (prayers, Mass, Examen)
- `thread_kind` = `idea` (reading list, book and t-shirt ideas)
- `thread_kind` = `cadence` (bill pay on the 1st and 15th, Divinum Officium health check, Greensea sweep, Gmail sweep)
- Standing bollards whose closing condition says they never close

Fix: exempt these from `no_dates_set`. Cadences are driven by `recurrence` / `next_due`, not `next_action_date`, so they should be checked on those fields instead.

Acceptance: in the next export, these threads raise no `no_dates_set` warning, and a regular open thread with no dates still does.

### A3. Focus Now and TOAT show no winner (conditional)

In the 2026-11-03 export (exported 00:29Z), `focus_now_diagnostic` and `toat_diagnostic` were both empty: winner null, zero candidates. At that moment nothing was overdue or due that day, so this may be by design.

T.J. will check again on 2026-11-04, when "SSI - report Abigail income for YLF" comes due. Only do this item if they are still empty then.
- If empty is by design: the UI should show an explicit empty state ("Nothing due today. Next up: ...") rather than a blank.
- If it is not by design: find out why the candidate set is empty and fix it.

### A4. Minor observations (no action unless cheap)

- The import dialog reported "1 edges restored" for an edge that was newly added. The wording should say "added".
- ADE-002 inferred two `enables` edges from parent to new child on import. These duplicate the parent relationship. ADE-002 has created duplicate edges before (see July data hygiene notes). Consider not inferring edges that just restate `parent_uuid`.

---

## Part B: fq-crm (new private submodule)

### Goal and framing

If T.J. lands the SEI role, his work has three bollards: **Client Work**, **Biz Dev**, and **Recruitment**. Biz Dev and Recruitment both run on relationships.

**fq-crm is not a CRM replacement.** SEI will have its own system of record for clients, prospects, and candidates. fq-crm exists so that Biz Dev and Recruitment work flows through FlowQueue's machinery (pressure scores, day load, Focus Now, TOAT, This Week, the buffer rule) alongside everything else in T.J.'s life: school, family, health, the move. The point is that a demanding new role and the rest of his life are planned on one load picture, not two.

Target: usable on T.J.'s first day at SEI.

### Design: a Pool, plus promote-on-touch

Most LinkedIn connections (likely 50% or more) will never become a deal or a recruit. They must not become threads up front.

| Layer | What it is | Thread? |
|---|---|---|
| **Pool** | The LinkedIn export (people and companies) as a searchable, scrollable, filterable list. Reference data waiting for triage. | No |
| **Contact / Company** | Created only when T.J. pulls a person or company in from the Pool (or adds one by hand). | Yes: `thread_kind: "contact"` / `"company"` |
| **Touch** | One logged activity: who, company, channel, action, date, which session. Example: "Messaged Bill Dodd at GE on LinkedIn". | No: a structured evolution_log entry on the contact (or company) thread |
| **Session cadences** | "Biz Dev: Company Research" and "Biz Dev: Contact Engagement" (and Recruitment equivalents), each 15-30 min. | Yes: `thread_kind: "cadence"` |
| **Opportunity / Recruit** | Created when a relationship qualifies (an "SQL" or equivalent). | Yes: ordinary threads under Biz Dev / Recruitment, using `stage` |

#### Architecture justification for the Pool (required by ARCHITECTURE_RULES.md)

The Pool is the one new non-Thread structure. Justification:
- Pool rows are not work. They have no closing condition, no next action, no owner decision, and no lifecycle.
- Most of them will never be acted on. Making them threads would put thousands of inert objects in the thread store, against T.J.'s known failure mode (an overwhelming list once he falls behind).
- The Pool is import staging and reference data, like a read-only address book. The moment a row becomes work (a touch), it is promoted to a Thread, and everything from then on is Thread-based.
- The Pool is never pressure-scored, never surfaces in any list or diagnostic, and never generates warnings.

Claude Code: confirm this against the codebase in B0. If an existing structure (for example the Inbox) can serve as the Pool without strain, prefer it and say so.

#### Touch logging (the core interaction)

When a session cadence surfaces and T.J. checks in:
1. "Log touch" opens a single type-ahead search across existing contact and company threads **and** the Pool.
2. Picking a Pool row promotes it on the spot: it creates the contact thread, matches or creates the company thread, and adds a `works_at` edge.
3. The touch form has: channel (configurable list, for example LinkedIn message, LinkedIn comment, email, call, in person), a free-text action, and the date (defaults to today).
4. The touch is saved as a structured evolution_log entry on the contact thread, with `{date, channel, action, session_thread_uuid}`. The session cadence's check-in records how many touches were logged and links to them.
5. Several touches can be logged in one session without leaving the dialog.

Extending evolution_log entries with optional structured fields is an extension of an existing structure, not a new model. Keep `{date, note}` working, and generate `note` from the structured fields so older views still read correctly.

Optional field per touch: `logged_in_employer_crm` (boolean). This is a reminder to enter the activity in SEI's system of record, since fq-crm does not sync with it.

#### Relationship stages and attribution

- A contact thread carries a relationship stage in `stage`. Default vocabulary: engaged, responding, conversation. Configurable.
- When a relationship qualifies, T.J. creates an Opportunity (Biz Dev) or Recruit (Recruitment) thread from the contact. Its first stage is configurable (default "SQL" for Biz Dev, "candidate" for Recruitment). It links back to the contact with an `originated_from` edge.
- Attribution comes from the existing links: Opportunity -> contact -> that contact's touch log. Example readout: "First touch: LinkedIn message to Bill Dodd (GE), 11/12, Contact Engagement session. Conversation 11/20. SQL 12/3."
- Weekly funnel, computed from the same data: sessions completed, touches logged, contacts promoted, conversations started, SQLs and recruits created, and which session type produced them.

### Configuration (everything T.J. cannot decide until he is at SEI)

Keep all of this in one config file in fq-crm, editable without code changes:
- Session cadences: names, which bollard, days of week, time block (default 15-30 min), effort estimate.
- Touch channels.
- Contact relationship stages.
- Opportunity stages (default: SQL, proposal, negotiation, won, lost) and Recruit stages (default: candidate, contacted, interested, submitted, interviewing, hired, passed). Terminal stages are marked won/lost or hired/passed so closing logic knows them.
- Work-day rules: Biz Dev and Recruitment items are never scheduled on Saturday or Sunday by default. Weekends are personal only, and Sunday has no work. Configurable, but this is the default.

Defaults must work out of the box, so the system is usable on day one before T.J. tunes anything.

### Integration with FlowQueue's load picture

This is the reason fq-crm exists, so treat it as a requirement:
- **Session cadences** count toward day load with their effort estimate and are pressure-scored like any other cadence.
- **Opportunities and recruits** are ordinary threads: full pressure scoring, Focus Now and TOAT eligibility, This Week membership, buffer rule on any real external deadline.
- **Contacts with a scheduled next touch** (`next_action_date` set) appear in This Week and day load like any dated thread.
- **Contacts and companies with no next touch** are standing threads. They are excluded from overdue counts, stalled detection, and the `no_dates_set` hygiene rule (same exemption as A2).
- **Pool rows** never appear anywhere except the Pool view and the touch search.
- Show the facts and let T.J. decide. No automatic rescheduling. Day load shows how a Biz Dev-heavy day stacks against school and family, and T.J. chooses.

### LinkedIn import (into the Pool)

Source: LinkedIn "Get a copy of your data" export, mainly `Connections.csv`. Expected columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On. The file may start with a short notes preamble, so detect the header row rather than assuming line 1. Email is usually blank. Treat it as optional.

Requirements:
- Imports go into the **Pool only**. No threads are created at import time.
- Idempotent: rows are keyed on the LinkedIn profile URL. Re-import updates Pool rows. It never touches promoted contact threads except to offer a "LinkedIn shows a new company/title" notice that T.J. can accept.
- Companies in the Pool are derived from the Company column, normalized. Ambiguous matches are flagged, not guessed.
- Dry-run report first: rows read, rows added, rows updated, rows skipped (with reason), company matches flagged.
- Raw export files are never committed. Add them to `.gitignore`.
- **Manual Add to Pool:** a simple form (name, company, title, optional URL or email, source) for people and companies not in the LinkedIn export. Same dedupe rules as the import.
- Optional later: `Messages.csv` to show last-message date in the Pool as a triage hint. Not in the first version.

### Data handling

- fq-crm is a private submodule, following the `fq-personal` credential pattern.
- Contact data is personal information about third parties. Store only what the export provides plus what T.J. adds.
- **SEI boundary:** fq-crm stores T.J.'s planning layer (who, company, action, stage), not client files or deal documents. Whether SEI client or prospect contacts go in at all is deferred. If they do, they enter through manual Add to Pool like any other contact, so no special path is needed. Each Pool row records its `source` (for example `linkedin`, `manual`) so a source can be filtered or removed later.

### Bollard placement

Career Life Area -> W-2 Work bollard -> three child bollards: Client Work, Biz Dev, Recruitment. Biz Dev and Recruitment hold their session cadences, opportunities, and recruits. Per the bollard rule, none of these parents carries its own next_action_date. Create them when T.J. starts at SEI, not before.

### Phases

**B0. Design note only (no code).** Confirm the Pool justification, or find an existing structure that serves. Confirm the Thread mapping for contacts, companies, opportunities, recruits, and session cadences against the real schema and DueEngine. List every code path that needs the standing-thread exemption (overdue, stalled, hygiene) and every path that must never see Pool rows. Specify the structured evolution_log extension and the config file format. Stop for review.

**B1. Submodule, Pool, and import.** Scaffold `fq-crm`. Build the Pool and the LinkedIn importer with dry-run. Run it in dev.
Acceptance:
- Dry-run counts reconcile with the CSV (added + updated + skipped = rows).
- After a real dev import, thread count, Focus Now, TOAT, This Week, load overview, and hygiene warnings are identical to before.
- A second import adds zero rows.

**B2. Session cadences, touch logging, promotion.** Build the session cadences from config, the Log Touch dialog, and promote-on-touch.
Acceptance:
- Logging a touch on a Pool row creates exactly one contact thread, one matched or created company thread, one `works_at` edge, and one structured log entry. All of these are visible in the next export.
- Logging a second touch on the same person adds a log entry and creates no new thread.
- Session cadences appear in day load with their effort estimate on configured weekdays only.
- This is the same class of write as the 10/29 Catch Up bug, so each acceptance item is verified in a fresh export, not in the UI.

**B3. Stages, opportunities, recruits, funnel.** Contact relationship stages, Opportunity and Recruit creation with `originated_from` edges, configurable pipelines, and the weekly funnel view with attribution.
Acceptance:
- Creating an Opportunity from a contact shows the first touch, its session, and the dates in the attribution readout.
- Stage changes are logged in evolution_log.
- Opportunities and recruits are pressure-scored and appear in Focus Now / TOAT candidate lists like any thread.
- Closing an Opportunity or Recruit at a terminal stage closes the thread and leaves the contact thread standing.

### Decisions

Settled (T.J. 2026-11-03):
1. Pool plus promote-on-touch. Contacts and companies become threads only when pulled in.
2. Session days and times are configurable. To be set after T.J. starts at SEI.
3. Stage vocabularies are configurable, with defaults that work on day one.
4. fq-crm is not a CRM replacement. It exists to put Biz Dev and Recruitment on FlowQueue's pressure and load picture with the rest of T.J.'s life.

5. SEI data boundary: no decision needed now. If SEI client or prospect contacts are ever added, they go in through manual Add to Pool (see the Pool requirements), with no separate design.
6. SEI bollards live in the Career Life Area, under a W-2 Work bollard: Client Work, Biz Dev, Recruitment.

No decisions are open for B0.
