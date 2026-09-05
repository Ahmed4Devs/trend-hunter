import { expect, test as base, type Page } from '@playwright/test';

/**
 * The seeded demo account.
 *
 * Read from the environment with the seed's own defaults as the fallback, so a
 * deployment that changed them can still run these tests — and so this file
 * contains no credential that is treated as a secret anywhere.
 */
export const DEMO_EMAIL = process.env.E2E_EMAIL ?? 'demo@trendhunter.local';
export const DEMO_PASSWORD = process.env.E2E_PASSWORD ?? 'TrendHunter123!';

/** Where the shared signed-in session is stored. */
export const STORAGE_STATE = 'playwright/.auth/user.json';

/**
 * Signs in through the real form.
 *
 * Used only by the specs that are testing sign-in itself; everything else
 * starts from the shared session, because the endpoint is rate-limited.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(\?.*)?$/);
}

/**
 * A test that starts signed in, on the dashboard.
 *
 * The session comes from the project's `storageState`; this fixture only adds
 * the opening navigation, so a spec that is about the dashboard does not have
 * to say so and a spec that is about another page simply navigates on.
 */
export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    await page.goto('/');
    await use(page);
  },
});

export { expect };
