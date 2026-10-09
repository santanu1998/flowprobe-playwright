import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

/**
 * FlowProbe test configuration.
 *
 * The suite is split into projects rather than folders so the same run can produce an API-only
 * signal in seconds and a full cross-browser signal in minutes, and so CI can select exactly the
 * slice it needs without a separate config file.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',

  /* Tests must be independent; anything that relies on ordering is a defect in the test, not a
     reason to serialise the suite. */
  fullyParallel: true,
  workers: IS_CI ? 4 : process.platform === 'win32' ? 2 : undefined,

  /* A failing build must never be caused by a stray .only left in a commit. */
  forbidOnly: IS_CI,

  /* One retry in CI surfaces genuine flakiness as "flaky" in the report rather than hiding it;
     locally, zero retries keep the feedback honest while a test is being written. */
  retries: IS_CI ? 1 : 0,

  timeout: 30_000,
  expect: {
    timeout: 7_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],

  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,

    /* Evidence on failure only: traces and video for every pass would cost minutes and gigabytes
       for information nobody reads. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    testIdAttribute: 'data-test',
  },

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: './tests/ui',
      use: { ...devices['Desktop Firefox'] },
      /* Visual baselines are rendered per engine; keeping one engine authoritative avoids a
         three-way baseline maintenance problem for no extra defect-finding power. */
      grepInvert: /@visual/,
      /* Firefox and WebKit take noticeably longer to hand over a fresh context under parallel
         load. Measured ~12 s worst case here, so 45 s leaves real headroom: a browser that is
         merely slow to start must not be reported as a product failure. */
      timeout: 45_000,
    },
    {
      name: 'webkit',
      testDir: './tests/ui',
      use: { ...devices['Desktop Safari'] },
      grepInvert: /@visual/,
      timeout: 45_000,
    },
    {
      name: 'mobile-chrome',
      testDir: './tests/ui',
      use: { ...devices['Pixel 7'] },
      grepInvert: /@visual/,
    },
  ],

  /* The application under test has no external dependencies, so the suite boots it itself.
     That is what makes a clone-and-run reproduction possible on any machine. */
  webServer: {
    command: 'node app/server.js',
    url: `${BASE_URL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: !IS_CI,
    env: {
      FLOWPROBE_TEST_MODE: '1',
      PORT: String(PORT),
    },
  },
});
