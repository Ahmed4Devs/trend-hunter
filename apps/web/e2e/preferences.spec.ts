import { expect, test } from './fixtures';

test.describe('language and theme', () => {
  test('switches to Arabic and flips the document direction', async ({ signedIn: page }) => {
    await page.getByRole('button', { name: /change the language/i }).click();
    await page.getByRole('menuitem', { name: 'العربية' }).click();

    // The direction is what makes the translation usable; a translated page
    // still laid out left to right is worse than an untranslated one.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { name: 'لوحة المعلومات', level: 1 })).toBeVisible();

    // The choice is a cookie, so it survives a reload.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.getByRole('button', { name: /تغيير اللغة/i }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('switches between light and dark and remembers it', async ({ signedIn: page }) => {
    await page.getByRole('button', { name: /change the theme/i }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.getByRole('button', { name: /change the theme/i }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
