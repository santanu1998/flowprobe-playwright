# FlowProbe — Playwright E2E, API and IoT Test Automation

End-to-end, API, IoT-telemetry, accessibility and visual test automation for a cloud device-fleet
console, built with **Playwright and TypeScript**, running across **Chromium, Firefox, WebKit and
mobile Chrome**, wired into **GitHub Actions, Azure DevOps and Jenkins**.

**The application under test ships with the suite.** `npm install && npm test` is the whole setup —
no database, no broker, no cloud account, no seeded fixtures to chase. That is deliberate: a test
suite nobody else can run is a screenshot, not a deliverable.

[![Playwright](https://img.shields.io/badge/Playwright-1.64-2EAD33)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)]()
[![Tests](https://img.shields.io/badge/tests-206%20passing-success)]()
[![a11y](https://img.shields.io/badge/WCAG%202.1-AA-blueviolet)]()

---

## Results

```
  206 passed  (5 projects)
```

| Project | Tests | Runtime | What it proves |
|---|---|---|---|
| `api` | 62 | 4.6 s | Contract, validation, authorisation matrix, IoT alert rules |
| `chromium` | 39 | 22 s | Full UI regression, accessibility, visual baselines |
| `firefox` | 35 | ~50 s | Cross-engine functional parity |
| `webkit` | 35 | ~50 s | Cross-engine functional parity |
| `mobile-chrome` | 35 | ~25 s | Touch viewport and responsive behaviour |
| Postman / Newman | 29 assertions | 1.5 s | The same API contract, runnable by hand in Postman |

---

## What this suite actually found

Five defects, each caught by a test rather than by reading the code — the full list with severities
is in [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md):

- **Status badges failed WCAG 2.1 AA contrast** (4.0:1 against a required 4.5:1) because badge text
  sits on a 16 %-opacity tint of its own hue. Fixed with dedicated on-tint colour tokens.
- **The console scrolled horizontally at 390 px** — a six-column table cannot shrink below its
  content. Fixed by scrolling the panel instead of the document.
- **A non-object JSON body reached the validators** and produced a 422 where a 400 was correct.
- **A filter action fired its request synchronously**, so a wait registered afterwards missed the
  response — an intermittent ten-second timeout, fixed by arming the waiter first.
- **The triage redaction leaked tokens**: it stopped at `Bearer` and printed the value after it.

---

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript 5.9, strict, `noUncheckedIndexedAccess` |
| Runner | Playwright Test 1.64 |
| API testing | Playwright `APIRequestContext` + a typed client |
| API exploration | Postman collection, Newman in CI |
| Accessibility | `@axe-core/playwright`, WCAG 2.1 A/AA |
| Visual | Playwright snapshot comparison |
| Application under test | Node 20, zero runtime dependencies |
| IoT transport | Server-Sent Events, with an injection hook standing in for MQTT |
| CI/CD | GitHub Actions, Azure DevOps, Jenkins |
| Containers | Docker (official Playwright image) |

---

## Layout

```
flowprobe-playwright/
├── app/                              the application under test (zero dependencies)
│   ├── server.js                     REST API, SPA host, SSE telemetry stream
│   ├── lib/{store,auth,simulator}.js  data, sessions and roles, IoT ingest + alert rules
│   └── public/                       the console UI
├── tests/
│   ├── api/                          contract, validation, authorisation matrix, IoT alerting
│   ├── ui/                           journeys, alerts, accessibility, visual
│   ├── pages/                        page objects
│   ├── fixtures/test.ts              API-seeded auth, data cleanup, evidence attachment
│   └── support/                      typed API client, domain types, self-healing locator
├── tools/triage.js                   failure classification → PR comment + defect payload
├── postman/                          collection + environment
├── docs/TEST_PLAN.md                 levels, risk model, isolation strategy, metrics, defect log
├── playwright.config.ts
├── Dockerfile · Jenkinsfile · azure-pipelines.yml · .github/workflows/ci.yml
└── eslint.config.js
```

---

## Running it

**Prerequisites:** Node 20+.

```bash
npm install
npx playwright install          # browsers

npm test                        # everything, 5 projects
npm run test:api                # 62 API tests, ~5 seconds
npm run test:smoke              # merge gate
npm run test:regression         # full functional set
npm run test:iot                # telemetry ingest and alerting
npm run test:a11y               # WCAG 2.1 AA
npm run test:visual             # pixel baselines
npm run test:mobile             # Pixel 7 viewport

npm run report                  # open the HTML report
npm run triage                  # classify the failures from the last run
npm run newman                  # the Postman collection, headless
```

The suite boots the application itself via Playwright's `webServer`. To drive the console by hand:

```bash
npm run app                     # http://localhost:4173
```

Demo accounts: `admin / Admin@123`, `operator / Operator@123`, `viewer / Viewer@123`.

---

## Design decisions worth defending

### Tests own their data; they do not reset the world

Parallel workers share one application instance. Resetting global state between tests would mean
one worker wiping the fleet while another is mid-assertion. Instead every mutating test registers
its own run-unique device and a fixture retires it afterwards, with an admin session, pass or fail.

Aggregate checks are written as **invariants** rather than absolute counts:

```ts
expect(online + degraded + offline).toBe(total);
```

That holds no matter what the rest of the suite is doing. Cross-layer UI↔API comparisons are scoped
to a site no test writes to. This is what keeps `fullyParallel` on and the full run under three
minutes.

### Authentication through the API, not through the form

The login form is tested once, thoroughly. Every other UI test receives a session seeded into
`sessionStorage` before the first script runs. That removes roughly 1.5 seconds and one whole class
of flakiness from every test that is not about signing in.

### Self-healing locators that still report the repair

A page object declares ranked candidates for one control. When the primary selector stops matching,
the next one is used, the repair is recorded, and it is attached to the report. The suite survives a
refactor **without** losing the signal that a selector needs updating:

```
[self-heal] Device grid: "[data-test=device-table]" no longer matches; used "table.grid"
```

A test in the suite deliberately removes the attribute to prove this path works.

### Retries that cannot hide a defect

One retry in CI, zero locally. A retried test is reported as **flaky**, not as passing. Triage then
decides whether the cause was environmental at all — a blanket retry policy turns real defects into
green builds, which is worse than having no retries.

### No sleeping, enforced by lint

`page.waitForTimeout` is blocked by an ESLint rule with a message pointing at the alternative. Every
wait is for a condition. Waiters are armed before the action that triggers them.

---

## Failure triage

`npm run triage` turns the JSON report into a Markdown summary for the pull request and a JSON
payload a Jira or Azure DevOps webhook can consume:

```
| Bucket            | Count | Retryable | Raises a defect |
|-------------------|-------|-----------|-----------------|
| LOCATOR_DRIFT     | 1     | no        | no              |
| ENVIRONMENT       | 1     | yes       | no              |
| SYNCHRONISATION   | 1     | yes       | no              |
| ACCESSIBILITY     | 1     | no        | yes             |
```

Each failure gets a probable cause, concrete next steps and a redacted excerpt. Classification is
deterministic and runs offline — the pipeline decision never depends on a model being reachable.
`ANTHROPIC_API_KEY`, when set, adds a natural-language explanation **on top of** the verdict the
pipeline acts on.

---

## CI/CD

All three pipelines run the same stages: **static analysis → API gate → browser matrix → Postman →
triage**.

- **GitHub Actions** — types, lint and `npm audit` first; API project as the fast gate; a four-way
  browser matrix; the triage summary posted as a sticky PR comment.
- **Azure DevOps** — the same stages with results published to Azure Test Plans.
- **Jenkins** — parameterised declarative pipeline for teams on self-hosted agents.

Pull requests run `@smoke` across all engines; the nightly schedule runs the full regression.

---

## Documentation

[`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) — test levels and tags, risk-based coverage, entry and exit
criteria, the data-isolation strategy, the synchronisation policy, defect lifecycle, Agile
integration, metrics and the defect log.
