import { test as setup } from '@playwright/test';

import { DEMO_EMAIL, DEMO_PASSWORD, STORAGE_STATE } from './fixtures';

/**
 * Signs in once and saves the session for every other spec.
 *
 * Not an optimisation. Sign-in is rate-limited to five attempts a minute per
 * address — deliberately, because that limit is what prices out credential
 * stuffing — and a suite that signed in per test would spend most of its run
 * being refused by a control that is working correctly.
 *
 * `auth.spec.ts` is the exception: it exercises sign-in itself and therefore
 * opts out of this state.
 */
setup('authenticate', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.waitForURL(/\/(\?.*)?$/);
  await page.context().storageState({ path: STORAGE_STATE });
});
