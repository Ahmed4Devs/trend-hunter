import { expect, test } from './fixtures';

test.describe('dashboard', () => {
  test('renders every panel', async ({ signedIn: page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

    // The six KPI cards, the activity chart, the two mid-page panels and the
    // operational column. Each is a separate query on the server, so a missing
    // one is a broken aggregate rather than a layout problem.
    await expect(page.getByText('New topics')).toBeVisible();
    await expect(page.getByText('Arabic opportunities')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trending topics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Source distribution' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent posts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API and system usage' })).toBeVisible();
  });

  test('keeps the activity range in the URL', async ({ signedIn: page }) => {
    await page.getByRole('tab', { name: '30d' }).click();

    await expect(page).toHaveURL(/range=30d/);
    // A reload must show the same view; that is the point of putting it in the
    // URL rather than in component state.
    await page.reload();
    await expect(page.getByRole('tab', { name: '30d' })).toHaveAttribute('data-state', 'active');
  });

  // The permanent rail exists only from `lg` up; below it navigation is a
  // drawer, which `responsive.spec.ts` covers on its own terms.
  test('navigates to a section from the sidebar', async ({ signedIn: page, isMobile }) => {
    test.skip(isMobile, 'the sidebar is a drawer on small screens');

    await page.getByRole('link', { name: 'Posts', exact: true }).click();
    await expect(page).toHaveURL(/\/posts$/);
    await expect(page.getByRole('heading', { name: 'Posts', level: 1 })).toBeVisible();
  });
});
