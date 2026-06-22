# FlowQueue Security & Architecture Brief
**Prepared:** June 22, 2026  
**Prepared by:** Principal Architect review (Claude Code)  
**Purpose:** Pre-demo security hardening + enterprise readiness baseline  
**Context:** FlowQueue is positioning for healthcare operational coordination (HelmFlow/Gosnold). HIPAA compliance is a real requirement. This brief covers every gap that must close before a clinical pilot.

---

## How to read this

Three sprint tracks:
- **Sprint 1 — Demo-safe** (before any external demo)
- **Sprint 2 — Data integrity** (before sustained internal use)
- **Sprint 3 — Clinical pilot** (before any healthcare deployment)

Each item has a status checkbox, severity, location, and fix direction.

---

## Sprint 1 — Demo-Safe (do these first)

### [x] CRIT-02: Remove hardcoded credentials ✅ DONE June 22, 2026
**Severity:** CRITICAL  
**File:** `js/modals.js:1752–1779`  
**Resolution:** Credentials moved to `js/demo.config.js` (gitignored, local-only). `modals.js` now reads from `OAD.DemoConfig` — if the file is absent, login blocks silently skip and fall through to real Supabase auth. `index.html` loads the file optionally with `onerror="void 0"`.  
**Note:** Credentials removed from HEAD but still present in git history prior to commit `8b9b38f`. See Sprint 3 item below for full history scrub.

---

### [ ] CRIT-01: Fix `isSuperAdmin()` — always returns `true`
**Severity:** CRITICAL  
**File:** `js/config.js:77`  
**Risk:** Every user in every session is permanently a SuperAdmin. All access controls (life-area editing, persona admin, command center) are disabled/enabled based on this function — and they are all permanently unlocked for everyone. Security theater.  
**Fix:** Replace the constant `return true` with a real check: compare `OAD._userId` against a `roles` table in Supabase, or read a `role` claim from the Supabase JWT. The function must not be a constant.  
**Effort:** 1 day (requires Supabase schema change)

---

### [ ] HIGH-02: Add session timeout
**Severity:** HIGH  
**File:** Missing entirely  
**Risk:** HIPAA §164.312(a)(2)(iii) requires automatic logoff. A session left open on an unattended device gives full access indefinitely.  
**Fix:** Wire `mousemove`/`keydown`/`click` events to reset a countdown timer. On 15-minute inactivity, call `OAD.logout()` and return to the auth screen. Also configure shorter refresh token lifetimes in the Supabase dashboard.  
**Effort:** 4 hours

---

### [ ] LOW-03: Add Content Security Policy and Subresource Integrity
**Severity:** LOW  
**File:** `index.html`  
**Risk:** No CSP means any injected or compromised script runs with full app access. Three CDN dependencies (Supabase, Cytoscape, Google Fonts) load without integrity checks. A CDN-side supply chain compromise delivers malicious JS with zero browser defense.  
**Fix:** Add a `<meta http-equiv="Content-Security-Policy">` tag restricting `script-src` to known domains. Add `integrity="sha384-..."` and `crossorigin="anonymous"` to all CDN `<script>` tags. Generate integrity hashes via `openssl dgst -sha384 -binary | base64`.  
**Effort:** 2 hours

---

### [ ] LOW-04: Fix `_cheDebounce` global leak
**Severity:** LOW  
**File:** `js/engine.js` (CHE section)  
**Risk:** `clearTimeout(OAD._cheDebounce)` is correct but the variable must be explicitly namespaced. Verify it is `OAD._cheDebounce` not `window._cheDebounce` or bare `_cheDebounce`.  
**Fix:** Confirm the engine.js CHE callback uses `OAD._cheDebounce` throughout. One-line fix if not.  
**Effort:** 5 min

---

## Sprint 2 — Data Integrity

### [ ] HIGH-03: Replace `_afterSaveCallbacks` with dirty-flag pattern
**Severity:** HIGH  
**File:** `js/data.js:87–108`, `js/engine.js` (CHE registration)  
**Risk:** (a) The CHE `_afterSave` callback calls `saveDB()`, which does NOT re-trigger `_runAfterSave` — but any future callback that calls `addThread` or `updateThread` will, creating a cascade. (b) The 14+ `saveDB()` calls in `data.js` outside of `addThread`/`updateThread` (migrations, patch functions, `addEvolution`, `addInsight`) bypass the callbacks entirely — CHE health checks are inconsistently triggered. (c) A 500-thread import fires the debounce 500 times, resetting it on each write.  
**Fix:** Replace the per-call callback with a dirty flag: `saveDB()` sets `OAD._dbDirty = true`. A single `setInterval` (or post-operation hook) checks the flag, runs CHE, clears the flag. Add a `OAD._bulkMode = true` guard to suppress mid-batch triggers. This is more robust than debouncing and eliminates the cascade risk entirely.  
**Effort:** 1 day

---

### [ ] HIGH-04: Batch `saveDB()` during bulk operations
**Severity:** HIGH  
**File:** `js/data.js`, `js/modals.js:970`  
**Risk:** `applyImport` calls `updateThread` in a loop, each triggering `saveDB()` + `_runAfterSave`. A 500-thread import = 500+ Supabase roundtrips. At Supabase free tier rate limits, this will fail silently mid-import.  
**Fix:** Add `OAD._bulkMode` flag. Set it to `true` before bulk operations, `false` after. `saveDB()` and `_runAfterSave` skip their work while `_bulkMode` is active. Call a single `OAD.saveDB()` and `OAD.runCHE()` once the loop completes.  
**Effort:** 2 hours

---

### [ ] MED-04: Surface `saveDB()` failures to the user
**Severity:** MEDIUM  
**File:** `js/data.js` (saveDB implementation)  
**Risk:** If the Supabase upsert fails (network timeout, token expiry, RLS rejection), the error is swallowed. The user believes their data saved. It did not.  
**Fix:** `await` the Supabase call, check `.error`, and display a persistent banner: "⚠ Sync failed — changes are local only. Check your connection." Log the error to the console with enough context to debug.  
**Effort:** 2 hours

---

### [ ] MED-05: Content-hash the `detectCycles` cache
**Severity:** MEDIUM  
**File:** `js/engine.js:414`  
**Risk:** Cache uses a 100ms wall-clock TTL. Burst edits within the window return stale cycle data. A circular dependency can be created without detection — graph integrity breaks silently.  
**Fix:** Key the cache on a lightweight fingerprint: `OAD.DB.threads.length + ':' + (all connection UUIDs joined)`. Rebuild only when fingerprint changes. Invalidate explicitly in `saveDB()` by clearing the cache key.  
**Effort:** 2 hours

---

### [ ] LOW-02: Delete June 16 migration patches
**Severity:** LOW  
**File:** `js/data.js` (`_runJune16PatchV1`, `_runJune16DedupV2`)  
**Risk:** Both functions run at every boot. `_runJune16PatchV1` is a confirmed no-op (guard flag always set). `_runJune16DedupV2` still runs a broad Northeastern University regex that could close unrelated threads if the user adds one. Neither belongs in production boot.  
**Fix:** Delete both functions and their call sites. Add a comment in git: "migration completed, safe to remove." If future schema migrations are needed, use a versioned migration table in Supabase.  
**Effort:** 30 min

---

### [ ] MED-02: Replace serialized objects in `onclick` attributes
**Severity:** MEDIUM  
**File:** `js/render.js` (multiple locations)  
**Risk:** Thread objects serialized into `onclick` HTML attributes via `encodeURIComponent(JSON.stringify(...))`. Attributes have size limits, are inspectable, and are a fragile serialization path. Title content containing special sequences can break attribute quoting.  
**Fix:** Use `data-thread-id` attributes only. In the event handler, look up the thread from `OAD.DB.threads` by ID. Never embed serialized objects in HTML attributes.  
**Effort:** 1 day (touches many render functions)

---

## Sprint 3 — Clinical Pilot (HIPAA minimum)

### [ ] SEC-01: Scrub credential history from git
**Severity:** HIGH (required before open-sourcing or enterprise handoff)  
**Context:** Demo credentials (`gowiththeflow`, `daboss`, `showboat`, `worker`) were removed from source in commit `8b9b38f` (June 22, 2026) but remain in git history prior to that commit. Any `git log -p` or `git show` on earlier commits reveals them.  
**Risk:** Low for now (demo-only passwords, local server). Becomes a compliance issue if the repo is ever open-sourced, transferred to an enterprise customer, or audited.  
**Fix:** Use [BFG Repo Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) — faster and safer than `git filter-branch`:
```bash
# 1. Mirror clone the repo
git clone --mirror https://github.com/tjrandall/one-a-day.git

# 2. Run BFG to strip the passwords from all history
java -jar bfg.jar --replace-text passwords.txt one-a-day.git

# 3. Clean up and force-push
cd one-a-day.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```
`passwords.txt` contains one password per line. All collaborators must re-clone after the force-push.  
**Effort:** 1 hour  
**Prerequisite:** Coordinate with any other contributors; force-push rewrites history for everyone.

---

### [ ] CRIT-04: Remove PHI from localStorage
**Severity:** CRITICAL  
**File:** `js/data.js` (saveDB localStorage path)  
**Risk:** The entire `OAD.DB` blob — thread titles, evolution logs, persona details, health alert descriptions — is written to browser localStorage in cleartext. For HIPAA, localStorage is considered an uncontrolled, unencrypted local store. PHI cannot reside there, even transiently.  
**Fix:** Make Enterprise Mode (cloud-only, no localStorage cache) the **default** for any authenticated session. Remove `localStorage.setItem` from `saveDB()` entirely when a Supabase session is active. localStorage fallback is acceptable only in unauthenticated demo/dev contexts.  
**Effort:** 2 days (requires testing all boot/offline paths)

---

### [ ] HIGH-05: Implement audit log
**Severity:** HIGH  
**File:** Missing entirely  
**Risk:** HIPAA §164.312(b) requires audit controls. No record exists of who accessed what, when, from where, or what AI calls were made. Cannot investigate a breach, demonstrate compliance, or pass a HITRUST CSF assessment without this.  
**Fix:** Create a Supabase `audit_log` table: `(id uuid, user_id uuid, action text, resource_type text, resource_id text, metadata jsonb, created_at timestamptz)`. Write to it on: every thread create/update/delete, every login/logout, every LLM call (log prompt type and thread ID — never PHI content in metadata), and every health alert dismissal or auto-fix. RLS: users can only read their own rows; no client-side delete.  
**Effort:** 2 days

---

### [ ] CRIT-03: Move LLM calls to a server-side proxy
**Severity:** CRITICAL  
**File:** `js/api.js:26–86`  
**Risk:** Both API keys live in the browser. The Gemini key is in the URL query string — it appears in browser history, server access logs, proxy logs, and network inspector. The Anthropic integration explicitly sets `anthropic-dangerous-direct-browser-access: true`. Any XSS, shared device, or browser extension captures these keys permanently.  
**Fix:** Create a Supabase Edge Function (`/functions/v1/llm-proxy`). The browser sends the prompt and provider preference; the Edge Function holds the keys server-side and calls the LLM API. The Edge Function can also enforce per-user rate limits and write to the audit log. Remove all key storage from localStorage and all client-side LLM fetch calls.  
**Effort:** 3–5 days

---

### [ ] HIGH-01: Server-side role enforcement in Supabase RLS
**Severity:** HIGH  
**File:** `js/data.js`, Supabase RLS policies  
**Risk:** All role filtering (counselor sees only their threads, director sees counselor + director, etc.) happens in `getVisibleThreads()` in the browser. A user can type `OAD._demoRole = 'Executive'` in DevTools and immediately see the executive dashboard and peer data. No server-side enforcement exists.  
**Fix:** Add a `role` claim to Supabase JWT via a custom access token hook, or maintain a `user_roles` table. Update RLS policies on the `user_data` table to filter by `auth.jwt()->>'role'`. The client-side filter becomes a UX convenience only — the database enforces the boundary.  
**Effort:** 2–3 days

---

### [ ] MED-01: Sanitize user content in LLM prompts
**Severity:** MEDIUM  
**File:** `js/api.js` (all coaching functions)  
**Risk:** Thread titles, evolution entries, and persona fields are interpolated directly into LLM system and user prompts. A maliciously crafted thread title can attempt to override instructions in a multi-user deployment.  
**Fix:** Wrap all user-supplied content in structural delimiters in the prompt: `<user_content>...</user_content>` with an explicit system instruction that content inside those tags is data, not instructions. Never concatenate raw user strings into the instruction portion of a prompt.  
**Effort:** 4 hours

---

### [ ] MED-06: Add dirty-check guard to `runADE`
**Severity:** MEDIUM  
**File:** `js/engine.js:638`  
**Risk:** Three regex passes over all thread titles on every boot with no check for whether threads have changed. ADE-003 is O(n²) on thread count. At 500+ threads, boot time degrades measurably.  
**Fix:** Store `OAD.DB.ade_last_run` as a fingerprint of thread UUIDs + titles. Skip `runADE` if fingerprint matches. Invalidate on any thread write.  
**Effort:** 2 hours

---

## HIPAA Compliance Scorecard

| Requirement | Current | Target (Sprint 3) |
|---|---|---|
| §164.312(a)(1) Access Control | ❌ None | ✅ Supabase JWT roles + RLS |
| §164.312(a)(2)(i) Unique User ID | ⚠️ Bypassed by hardcoded creds | ✅ After CRIT-02 fix |
| §164.312(a)(2)(iii) Auto Logoff | ❌ Not implemented | ✅ 15-min inactivity timeout |
| §164.312(b) Audit Controls | ❌ None | ✅ audit_log table |
| §164.312(c)(1) Integrity | ⚠️ Silent failures | ✅ After MED-04 fix |
| §164.312(d) Person Authentication | ❌ Hardcoded bypass | ✅ After CRIT-02 fix |
| §164.312(e)(2)(ii) Encryption at Rest | ❌ Plaintext localStorage | ✅ After CRIT-04 fix |
| Encryption in Transit | ✅ HTTPS to Supabase | ✅ |
| BAA with Supabase | ❓ Unconfirmed | ✅ Requires Business tier |

**The core product logic is solid.** ADE, CHE, graph, Eisenhower, Mailroom, and the pressure engine are well-structured and architecturally sound. The security surface is narrow but the gaps are severe. Sprint 1 makes this demo-safe in 1–2 days. Sprint 3 makes it clinical-pilot-ready in 2–3 weeks.

---

## BAA Note
Supabase offers a HIPAA Business Associate Agreement on their **Business tier** ($25/mo+). Confirm this is active before storing any real PHI. Reference: https://supabase.com/docs/guides/platform/hipaa
