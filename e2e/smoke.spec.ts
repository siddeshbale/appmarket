import { expect, test } from '@playwright/test';

test.describe('browser smoke (demo data, isolated DB)', () => {
  test('discover shows a labeled demo chart and navigates to a profile with a rank chart', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText('DEMO MODE')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
    await expect(page.locator('table.data tbody tr').first()).toBeVisible();
    await page.locator('table.data tbody tr').first().locator('a').first().click();
    await expect(page.getByRole('heading', { name: 'Chart history' })).toBeVisible();
    await expect(page.locator('svg.chart-svg').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('trending, new to chart and catalog tabs render with explanations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Trending (movers)' }).click();
    await expect(page.getByText(/Biggest risers|Insufficient history/)).toBeVisible();
    await page.getByRole('tab', { name: 'New to Chart' }).click();
    await expect(page.getByText(/New to chart is not the same as newly released|Needs at least two snapshots/)).toBeVisible();
    await page.getByRole('tab', { name: 'Catalog search' }).click();
    await page.getByPlaceholder(/e.g. notes/).fill('Lumen');
    await page.getByPlaceholder(/e.g. notes/).press('Enter');
    await expect(page.getByRole('link', { name: 'Lumen Notes' }).first()).toBeVisible();
    expect(page.url()).toContain('q=Lumen'); // shareable filter URL
  });

  test('watchlist create, compare and scenario calculator work', async ({ page }) => {
    await page.goto('/#/watchlists');
    await page.getByLabel('New watchlist name').fill('E2E list');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'E2E list' })).toBeVisible();
    await page.goto('/#/compare?ids=1,2');
    await expect(page.getByRole('heading', { name: 'Ranks by scope' })).toBeVisible();
    await page.goto('/#/scenarios');
    await expect(page.getByText('No data — enter all inputs')).toBeVisible();
    for (const lvl of ['low', 'base', 'high']) {
      await page.getByLabel(`Active payers per month ${lvl}`).fill('100');
      await page.getByLabel(`Monthly spend per payer ${lvl}`).fill('5');
    }
    await expect(page.getByText('500.00').first()).toBeVisible();
  });

  test('data & settings shows coverage and an import preview', async ({ page }) => {
    await page.goto('/#/data');
    await expect(page.getByText('Chart coverage')).toBeVisible();
    await page.goto('/#/data?tab=import');
    await page.locator('textarea').fill('platform,store_id,title\nandroid,com.e2e.app,E2E App\nios,bad,Bad\n');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('valid 1')).toBeVisible();
    await expect(page.getByText('bad 1')).toBeVisible();
  });
});
