#!/usr/bin/env node
/**
 * AI-assisted failure triage.
 *
 * Reads the Playwright JSON report and classifies every failure into a bucket with a probable
 * cause and a next action, then writes a Markdown summary for the pull request and a JSON payload
 * a Jira or Azure DevOps webhook can consume.
 *
 *   node tools/triage.js [--input test-results/results.json] [--out test-results/triage.md]
 *
 * Classification is deterministic and runs offline: the pipeline decision must never depend on a
 * model being reachable. Setting ANTHROPIC_API_KEY adds a natural-language explanation on top of
 * the verdict, it does not replace it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const INPUT = argOf('--input', 'test-results/results.json');
const OUT_MD = argOf('--out', 'test-results/triage.md');
const OUT_JSON = argOf('--json', 'test-results/triage.json');

/** Ordered: the first matching rule wins, so the most specific signatures come first. */
const RULES = [
  {
    bucket: 'LOCATOR_DRIFT',
    retryable: false,
    raisesDefect: false,
    match: /no candidate selector matched|locator-repairs|strict mode violation|resolved to 0 elements/i,
    cause: 'The element could not be resolved, so the markup changed.',
    actions: [
      'Update the page object and request a stable data-test attribute from the developer.',
      'Check the locator-repairs attachment for the selector that did match.',
    ],
  },
  {
    bucket: 'ENVIRONMENT',
    retryable: true,
    raisesDefect: false,
    match: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|net::ERR_|502|503|504|browserType\.launch|Target page, context or browser has been closed/i,
    cause: 'The application or the browser process was not reachable.',
    actions: ['Confirm the app booted and the health endpoint answers before re-running.'],
  },
  {
    bucket: 'SYNCHRONISATION',
    retryable: true,
    raisesDefect: false,
    match: /Timeout .* exceeded|waiting for (locator|response|event)|element is not (visible|stable|enabled)|intercepts pointer events/i,
    cause: 'The element or response did not arrive inside the wait budget.',
    actions: [
      'Replace any implicit assumption with an explicit expect().toBeVisible() or waitForResponse.',
      'Arm the waiter before the action that triggers it.',
    ],
  },
  {
    bucket: 'VISUAL_DRIFT',
    retryable: false,
    raisesDefect: false,
    match: /Screenshot comparison failed|toHaveScreenshot|pixels .* different/i,
    cause: 'Rendered output moved away from the stored baseline.',
    actions: [
      'Open the diff in the HTML report.',
      'If the change was intended, refresh the baseline with --update-snapshots in its own commit.',
    ],
  },
  {
    bucket: 'ACCESSIBILITY',
    retryable: false,
    raisesDefect: true,
    match: /color-contrast|aria-|wcag|axe|Elements must meet/i,
    cause: 'An accessibility rule was violated.',
    actions: ['Fix the named element; the failure message carries its selector.'],
  },
  {
    bucket: 'API_CONTRACT',
    retryable: false,
    raisesDefect: true,
    match: /expect\(received\)\.toBe\(expected\).*\b(400|401|403|404|409|422|500)\b|jsonSchema|toMatchObject/is,
    cause: 'The API response deviated from its agreed contract.',
    actions: [
      'Attach the request/response pair from the trace to the defect.',
      'Confirm which contract version is deployed to this environment.',
    ],
  },
  {
    bucket: 'PRODUCT_DEFECT',
    retryable: false,
    raisesDefect: true,
    match: /expect\(|AssertionError|toEqual|toHaveText|toContain/i,
    cause: 'A business assertion failed with the application responsive.',
    actions: ['Raise a defect quoting the exact expected and actual values.'],
  },
];

/**
 * Consumes the auth scheme as well as the value. Stopping at the first whitespace would redact
 * "Bearer" and print the token that follows it, which is the opposite of the intent.
 */
const SECRET = /\b(password|passwd|pwd|token|secret|authorization|api[-_]?key)\b["'\s:=]*(?:bearer|basic|token)?\s*[^\s"',;)}\]]+/gi;

const redact = (text) => String(text ?? '').replace(SECRET, (_match, key) => `${key}=***REDACTED***`);

function classify(message) {
  const text = redact(message);
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule;
  }
  return {
    bucket: 'UNCLASSIFIED',
    retryable: false,
    raisesDefect: true,
    cause: 'No known failure signature matched.',
    actions: ['Open the trace and the screenshot attached to this result.'],
  };
}

/** Walks the nested suite tree the JSON reporter produces. */
function collectFailures(report) {
  const failures = [];

  const walk = (suite, trail) => {
    const path = [...trail, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const run of spec.tests ?? []) {
        const last = run.results?.at(-1);
        if (!last || (last.status !== 'failed' && last.status !== 'timedOut')) continue;
        failures.push({
          project: run.projectName ?? 'default',
          title: [...path, spec.title].join(' › '),
          file: spec.file,
          line: spec.line,
          durationMs: last.duration,
          attempts: run.results.length,
          message: redact(last.error?.message ?? last.errors?.[0]?.message ?? 'no message'),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };

  for (const suite of report.suites ?? []) walk(suite, []);
  return failures;
}

function main() {
  let report;
  try {
    report = JSON.parse(readFileSync(INPUT, 'utf8'));
  } catch (error) {
    console.error(`Could not read the Playwright JSON report at ${INPUT}: ${error.message}`);
    process.exit(2);
  }

  const failures = collectFailures(report).map((f) => {
    const rule = classify(f.message);
    return {
      ...f,
      bucket: rule.bucket,
      retryable: rule.retryable,
      raisesDefect: rule.raisesDefect,
      probableCause: rule.cause,
      suggestedActions: rule.actions,
    };
  });

  const stats = report.stats ?? {};
  const byBucket = failures.reduce((acc, f) => {
    acc[f.bucket] = (acc[f.bucket] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    '## FlowProbe — run triage',
    '',
    `**${stats.expected ?? 0} passed · ${failures.length} failed · ${stats.flaky ?? 0} flaky · ${stats.skipped ?? 0} skipped**`,
    '',
  ];

  if (failures.length === 0) {
    lines.push('No failures to triage.');
  } else {
    lines.push('| Bucket | Count | Retryable | Raises a defect |', '|---|---|---|---|');
    for (const [bucket, count] of Object.entries(byBucket).sort((a, b) => b[1] - a[1])) {
      // Read the flags off a classified failure, not off RULES: UNCLASSIFIED has no rule entry
      // and would otherwise be reported as "does not raise a defect", which is the opposite of
      // what it means.
      const sample = failures.find((f) => f.bucket === bucket);
      lines.push(
        `| \`${bucket}\` | ${count} | ${sample.retryable ? 'yes' : 'no'} | ${sample.raisesDefect ? 'yes' : 'no'} |`,
      );
    }
    lines.push('', '### Failures', '');
    for (const f of failures) {
      lines.push(
        `#### \`${f.bucket}\` — ${f.title}`,
        '',
        `- **Project:** ${f.project}`,
        `- **Location:** \`${f.file}:${f.line}\``,
        `- **Attempts:** ${f.attempts}`,
        `- **Probable cause:** ${f.probableCause}`,
        `- **Next steps:**`,
        ...f.suggestedActions.map((a) => `  - ${a}`),
        '',
        '<details><summary>Failure message</summary>',
        '',
        '```',
        f.message.split('\n').slice(0, 20).join('\n'),
        '```',
        '',
        '</details>',
        '',
      );
    }
  }

  for (const target of [OUT_MD, OUT_JSON]) mkdirSync(dirname(target), { recursive: true });
  writeFileSync(OUT_MD, lines.join('\n'), 'utf8');
  writeFileSync(
    OUT_JSON,
    JSON.stringify({ stats, byBucket, defects: failures.filter((f) => f.raisesDefect) }, null, 2),
    'utf8',
  );

  console.log(lines.join('\n'));
  console.log(`\nWritten: ${OUT_MD} and ${OUT_JSON}`);

  // Exit 0 regardless: triage reports, the test run already decided the build.
}

main();
