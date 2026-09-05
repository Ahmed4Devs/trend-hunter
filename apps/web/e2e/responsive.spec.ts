import { expect, test } from './fixtures';

test.describe('small screens', () => {
  // The rail is replaced by a drawer below `lg`, which is a different element
  // rather than the same one restyled, so it needs its own assertions.
  test.skip(({ isMobile }) => !isMobile, 'covers the mobile layout only');

  test('opens navigation in a drawer and closes it on navigation', async ({ signedIn: page }) => {
    await page.getByRole('button', { name: /open the navigation menu/i }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: 'Sources' }).click();

    await expect(page).toHaveURL(/\/sources$/);
    await expect(drawer).toBeHidden();
  });

  // Every page, not one: the failure is caused by a single unbreakable string
  // in a card, so it appears on whichever page happens to hold one.
  for (const path of ['/', '/topics', '/posts', '/content', '/saved', '/settings']) {
    test(`keeps ${path} from scrolling sideways`, async ({ signedIn: page }) => {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();

      // A wide table scrolls inside its own container; the layout does not pan.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    });
  }
});
