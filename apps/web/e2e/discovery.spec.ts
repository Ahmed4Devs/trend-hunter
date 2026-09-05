import { expect, test } from './fixtures';

test.describe('discovery', () => {
  test('filters posts through the URL', async ({ signedIn: page }) => {
    await page.goto('/posts');

    await page.getByRole('combobox', { name: 'Source' }).click();
    await page.getByRole('option', { name: 'REDDIT' }).click();

    await expect(page).toHaveURL(/sources=REDDIT/);

    // The filter is applied by the server, so a reload must produce the same
    // list rather than resetting to everything.
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Source' })).toContainText('REDDIT');
  });

  test('searches posts from the filter box', async ({ signedIn: page }) => {
    await page.goto('/posts');
    await page.getByLabel('Search posts').fill('release');

    // The field debounces before it navigates; waiting on the URL is what makes
    // this assert the navigation rather than the keystroke.
    await expect(page).toHaveURL(/search=release/, { timeout: 5000 });
  });

  test('opens global search with the keyboard', async ({ signedIn: page }) => {
    // Retried as a unit: the shortcut is registered by a client component, and
    // a press that lands before it is listening is simply not heard.
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await expect(page.getByRole('combobox', { name: 'Search' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('lists topics and opens one', async ({ signedIn: page }) => {
    await page.goto('/topics');
    await expect(page.getByRole('heading', { name: 'Topics', level: 1 })).toBeVisible();

    const firstTopic = page.locator('main h2').first();
    if ((await firstTopic.count()) === 0) {
      // Nothing has been clustered in this database yet; the empty state is the
      // correct rendering and asserting it is more useful than skipping.
      await expect(page.getByText('No topic matches these filters.')).toBeVisible();
      return;
    }

    await firstTopic.click();
    await expect(page).toHaveURL(/\/topics\/[\w-]+$/);
    await expect(page.getByText('Trend history')).toBeVisible();
  });
});
