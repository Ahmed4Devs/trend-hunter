import { expect, test } from '@playwright/test';

import { DEMO_EMAIL, DEMO_PASSWORD, signIn } from './fixtures';

test.describe('authentication', () => {
  test('sends an anonymous visitor to sign in and back to where they were going', async ({
    page,
  }) => {
    await page.goto('/topics');

    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftopics/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/topics$/);
  });

  test('refuses a wrong password without saying which half was wrong', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Scoped to the form: Next renders a route announcer with the same role,
    // and an unscoped query matches both.
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible();
    // The message must not distinguish an unknown account from a wrong
    // password: that difference is an account-enumeration oracle.
    await expect(alert).toHaveText(/do not match an account/i);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('ignores an absolute redirect target', async ({ page }) => {
    // An open redirect here would phish a session that has just been created.
    await page.goto('/sign-in?next=https://example.com/');
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Back to the dashboard, not to the attacker's origin.
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/(\?.*)?$/);
  });

  // Signs in for itself rather than borrowing the shared session. Signing out
  // revokes the session server-side, and the shared one is what every other
  // spec is using — the failure that produces is a redirect loop in an
  // unrelated file sixty seconds later, once the cookie cache expires.
  test('signs out and stops serving the dashboard', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
