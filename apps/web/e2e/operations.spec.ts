import { expect, test } from './fixtures';

test.describe('operations', () => {
  test('starts a scan and lands on its page', async ({ signedIn: page, isMobile }) => {
    // The header's button is hidden below `sm`; the same action is in Quick
    // actions, which is where a phone reaches it.
    const start = isMobile
      ? page.getByRole('button', { name: 'Scan now' })
      : page.getByRole('button', { name: 'New scan' });
    await start.click();

    // Collection is queued work; the response is the run, not its results.
    await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Scan history', level: 1 })).toBeVisible();
    await expect(page.getByText('Collected')).toBeVisible();
  });

  test('saves a post and removes it again', async ({ signedIn: page }) => {
    await page.goto('/posts');
    await expect(page.getByRole('heading', { name: 'Posts', level: 1 })).toBeVisible();

    const save = page.getByRole('button', { name: 'Save this post' }).first();
    if ((await save.count()) === 0) {
      await expect(page.getByText('No post matches these filters.')).toBeVisible();
      return;
    }

    // The button saves with a background fetch and does not block on it — it
    // updates optimistically, which is what makes the list feel responsive.
    // Navigating straight after the click therefore raced the request and
    // usually cancelled it before it reached the API, leaving nothing to find
    // on the next page. Both halves of the toggle wait for their own call.
    const stored = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/saved') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await save.click();
    await stored;

    await page.goto('/saved');
    await expect(page.getByRole('heading', { name: 'Saved', level: 1 })).toBeVisible();

    const remove = page.getByRole('button', { name: 'Remove from saved' }).first();
    await expect(remove).toBeVisible();

    const removed = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/saved') &&
        response.request().method() === 'DELETE' &&
        response.ok(),
    );
    await remove.click();
    await removed;
  });

  test('shows publications as a separate tab', async ({ signedIn: page }) => {
    await page.goto('/saved');
    await page.getByRole('link', { name: 'Publications' }).click();

    await expect(page).toHaveURL(/tab=publications/);
    // V1 never publishes, so an empty list here is the expected state.
    await expect(page.getByRole('link', { name: 'Publications' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('saves a preference', async ({ signedIn: page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();
  });
});
