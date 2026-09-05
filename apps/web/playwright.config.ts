import { defineConfig, devices } from '@playwright/test';

import { STORAGE_STATE } from './e2e/fixtures';

/**
 * End-to-end tests.
 *
 * These run against a real stack — a migrated, seeded PostgreSQL, Redis, the
 * API and this application — because that is the only configuration in which
 * they are worth anything. A mocked API would test the mock.
 *
 * The web server is started by Playwright; the API and the datastores are not,
 * because they are shared infrastructure that a developer already has running
 * (`pnpm docker:up && pnpm dev`). `reuseExistingServer` keeps a local run from
 * fighting a dev server that is already up.
 */
/**
 * Both the address the tests use and the port the dev server is started on come
 * from one place, so pointing a run at an already-running instance — or moving
 * off a busy port — is a single variable rather than two that can disagree.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const port = new URL(baseURL).port === '' ? '3000' : new URL(baseURL).port;

export default defineConfig({
  testDir: './e2e',
  // A failing assertion in one flow must not leave a signed-in session behind
  // for the next, so the files run sequentially against the shared database.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    // Kept only for a failure: a trace per passing test is a lot of disk for
    // something nobody opens.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  projects: [
    // Signs in once and saves the session. Everything below depends on it.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      // For the sign-out test, which starts from the shared session.
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'chromium',
      testIgnore: /auth\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },

    // The sidebar becomes a drawer below `lg`, which is a different component
    // rather than the same one restyled, so it needs its own run.
    {
      name: 'mobile',
      testIgnore: /auth\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
    },
  ],

  webServer: {
    // A production build, not `next dev`: the dev server compiles routes on
    // demand and its client bundle is not reliably attached by the time a test
    // clicks, which turns a form submit into a native navigation — a real
    // failure, but not the one under test. `pnpm test:e2e` builds first.
    command: `pnpm exec next start --port ${port}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
