import { expect, test } from './fixtures';

/**
 * The AI flows.
 *
 * They run against the offline provider (`AI_PROVIDER=mock`), which is
 * deterministic and free — these assertions are about the workflow, not about
 * the quality of a model's prose.
 */
test.describe('authoring', () => {
  test('translates free text into Arabic', async ({ signedIn: page }) => {
    await page.goto('/translations');
    await expect(page.getByRole('heading', { name: 'Translations', level: 1 })).toBeVisible();

    await page.getByLabel('Text to translate').fill('Vector databases are having a moment.');
    await page.getByRole('button', { name: 'Translate', exact: true }).click();

    await expect(page.getByText('Translation created.')).toBeVisible({ timeout: 30_000 });

    // The Arabic pane declares its own direction regardless of the interface
    // language, which is the thing most likely to regress.
    await expect(page.locator('p[dir="rtl"][lang="ar"]').first()).toBeVisible();
  });

  test('generates a draft from a topic', async ({ signedIn: page }) => {
    await page.goto('/content');
    // `count()` does not wait. Without an assertion that the page has rendered,
    // the branch below reads an empty page and takes the wrong path.
    await expect(page.getByRole('heading', { name: 'Content Studio', level: 1 })).toBeVisible();

    const generate = page.getByRole('button', { name: 'Generate', exact: true });
    if ((await generate.count()) === 0) {
      await expect(page.getByText(/at least one topic/i)).toBeVisible();
      return;
    }

    await generate.click();
    await expect(page.getByText('Draft generated.')).toBeVisible({ timeout: 60_000 });
  });

  test('builds a thread and translates the whole of it', async ({ signedIn: page }) => {
    await page.goto('/threads');
    await expect(page.getByRole('heading', { name: 'Threads', level: 1 })).toBeVisible();

    const create = page.getByRole('button', { name: 'New thread' });
    if ((await create.count()) === 0) {
      await expect(page.getByText(/at least one topic/i)).toBeVisible();
      return;
    }

    await create.click();
    await expect(page.getByText('Thread created.')).toBeVisible({ timeout: 60_000 });

    // Whole-thread translation, never post by post: the references between the
    // posts only survive if the thread is translated as one narrative.
    await page.getByRole('button', { name: 'Translate the whole thread' }).first().click();
    await expect(page.getByText('Thread translated.')).toBeVisible({ timeout: 60_000 });
  });

  test('generates a report and draws it', async ({ signedIn: page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Generate a report' }).click();
    await expect(page.getByText('Report generated.')).toBeVisible({ timeout: 30_000 });
    // Exact, because the pagination summary also contains the word.
    await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
  });
});
