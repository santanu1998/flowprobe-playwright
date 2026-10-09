# Test Plan — FlowProbe Fleet Console

Version 1.0 · Owner: QA Engineering · Scope: release 1.x

---

## 1. What is being tested

A cloud-hosted IoT device fleet console: a REST API, a browser console, and a telemetry ingest path
that raises alerts when a device breaches a threshold.

**In scope** — authentication and role separation, device lifecycle (register, read, update,
retire), filtering and search, remote commands, telemetry ingest and alerting, the console UI across
four engines, accessibility to WCAG 2.1 AA, and visual stability.

**Out of scope** — load testing above 50 concurrent sessions, broker-level MQTT conformance, and
firmware behaviour on physical hardware.

---

## 2. Test levels and tags

Every test carries tags, and the tags are what CI selects on. A folder name is not a test strategy.

| Tag | Meaning | Where it runs |
|---|---|---|
| `@smoke` | The journeys that gate a merge | Every pull request, all engines |
| `@regression` | Full functional coverage | Nightly and per release candidate |
| `@api` | No browser; contract and data | Every push, first job in the pipeline |
| `@iot` | Telemetry ingest and alerting | Every push |
| `@a11y` | WCAG 2.1 A/AA via axe-core | Nightly and pre-release |
| `@visual` | Pixel baselines | Nightly, Chromium only |

---

## 3. Risk-based coverage

| Area | Impact | Likelihood | Priority | How it is covered |
|---|---|---|---|---|
| Role separation | High | Medium | **P0** | A 7 × 3 action/role matrix — 21 explicit assertions |
| Authentication | High | Low | **P0** | Positive, negative, lockout, tampered token, user enumeration |
| Alert thresholds | High | Medium | **P0** | Above, at and below each boundary; duplicate suppression |
| Device lifecycle | High | Medium | **P0** | Create, read, partial update, delete, cascade to alerts |
| Input validation | Medium | High | P1 | Six invalid payloads, duplicate names, malformed and non-object JSON |
| Filtering and search | Medium | High | P1 | Composed filters, case-insensitivity, ordering, empty state |
| Live telemetry (SSE) | Medium | Medium | P1 | Stream auth, push-driven UI update without reload |
| Accessibility | Medium | Medium | P1 | axe on login, console and drawer; keyboard-only journeys |
| Visual stability | Low | Medium | P2 | Three baselines plus a responsive overflow check |

---

## 4. Entry and exit criteria

**Entry** — the build is deployed, `/api/health` returns `UP`, acceptance criteria are agreed, and
the test data seed is in a known state.

**Exit**
- 100 % of `@smoke` and `@api` pass on every engine in the matrix.
- ≥ 98 % of `@regression` passes; every remaining failure is linked to a triaged defect.
- No open Critical or Blocker defect against an in-scope story.
- No accessibility violation at WCAG 2.1 AA.
- No test marked flaky in two consecutive nightly runs.

---

## 5. Test data and isolation

Parallel workers share one application instance, so isolation comes from ownership, not from
resetting global state:

- Every mutating test registers its **own** device with a run-unique name.
- Fixtures retire those devices afterwards, pass or fail, using an admin session — cleanup must not
  depend on the role the test happened to run as.
- Aggregate assertions are written as **invariants** (`online + degraded + offline === total`)
  rather than absolute counts, because an absolute count under concurrency is a race, not a check.
- Cross-layer UI↔API comparisons are scoped to `Kolkata-DC1`, a site no test writes to.

This is the single most important design decision in the suite. It is what allows `fullyParallel`
to stay on and the full run to finish in minutes rather than tens of minutes.

---

## 6. Synchronisation policy

No `waitForTimeout`. It is blocked by a lint rule, not by convention.

- Wait for a **condition**: `expect().toBeVisible()`, `expect.poll()`, `waitForResponse()`.
- Arm the waiter **before** the action that triggers it. A request fired synchronously by a click
  can complete before a wait registered afterwards ever starts listening — that ordering mistake is
  the single most common source of a ten-second intermittent timeout.

---

## 7. Defect lifecycle

```
NEW ──► TRIAGED ──► IN PROGRESS ──► FIXED ──► RETEST ──► CLOSED
 │          │                                   │
 │          └──► DEFERRED (with a reason)       │
 └──► REJECTED (duplicate / not a defect) ◄─────┘   REOPENED
```

Automated failures are classified before a human sees them (§8). Only buckets that indicate a
product problem create a tracker item, so the backlog stays a list of defects rather than a log of
infrastructure noise.

**Severity** describes user impact; **priority** is set by the product owner.

---

## 8. Failure triage

`tools/triage.js` reads the Playwright JSON report and assigns a bucket:

| Bucket | Retryable | Raises a defect |
|---|---|---|
| `LOCATOR_DRIFT` | no | no — fix the page object |
| `ENVIRONMENT` | yes | no |
| `SYNCHRONISATION` | yes | no |
| `VISUAL_DRIFT` | no | no — review the diff, then refresh the baseline deliberately |
| `ACCESSIBILITY` | no | yes |
| `API_CONTRACT` | no | yes |
| `PRODUCT_DEFECT` | no | yes |
| `UNCLASSIFIED` | no | yes |

Classification is deterministic and offline; a model outage can never change a build result. Secrets
are redacted — including the value after an auth scheme, not just the scheme — before anything is
written to a report or a ticket.

---

## 9. Agile integration

- **Three amigos** before code: BA, developer and tester agree concrete examples. Ambiguity found
  here costs minutes; found in UAT it costs days.
- **Definition of Done**: merged, a test added at the cheapest level that can catch the defect,
  regression green, no new Critical defect, docs updated.
- **Stand-up**: QA raises blocked verification and quality risk early, not at sprint end.
- **Retrospective**: every escaped defect is reviewed for the missing test level, not for blame.

---

## 10. Metrics

| Metric | Target | Source |
|---|---|---|
| Defect escape rate | < 5 % | Tracker, per release |
| Smoke pass rate | 100 % | Every PR run |
| Regression pass rate | ≥ 98 % | Nightly |
| Mean time to feedback | < 8 min | PR gate duration |
| Flaky tests | 0 | Playwright `flaky` count, two consecutive nights |
| WCAG 2.1 AA violations | 0 | axe-core |
| Requirement coverage | 100 % | Traceability matrix |

---

## 11. Defects found by this suite

Recorded here because they are the point of the exercise: each was found by a test, not by reading
the code.

| ID | Title | Severity | Found by | Status |
|---|---|---|---|---|
| FP-001 | Status badges fail WCAG 2.1 AA contrast on the tinted background (4.0:1 against a required 4.5:1) | Major | `@a11y` axe scan of the console | Fixed — dedicated `--*-on-tint` text colours |
| FP-002 | The console scrolls horizontally at 390 px because a six-column table cannot shrink | Major | Responsive overflow check | Fixed — the panel scrolls, the document does not |
| FP-003 | A syntactically valid but non-object JSON body (`"a string"`) reached the validators and returned 422 instead of 400 | Minor | Negative API test | Fixed — rejected at the edge |
| FP-004 | `Clear filters` fired its request synchronously, so a wait registered afterwards missed the response | Minor (test defect) | Intermittent 10 s timeout | Fixed — waiter armed before the action |
| FP-005 | Triage redaction stopped at the auth scheme and printed the token after `Bearer` | Critical (test tooling) | Synthetic triage fixture | Fixed — pattern consumes scheme and value |
