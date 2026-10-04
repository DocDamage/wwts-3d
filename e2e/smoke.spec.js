import { test, expect } from '@playwright/test';

/** Fail the test on uncaught page errors and console errors (ignoring missing optional assets) */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|favicon|AudioContext|autoplay/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

const skipTour = (page) => page.addInitScript(() => { try { localStorage.setItem('wwts_tour_done_v1', '1'); } catch { /* */ } });

test('app loads and the main screens switch', async ({ page }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.goto('/');
  await expect(page.locator('#screen-leagues')).toHaveClass(/active/);
  for (const screen of ['roster', 'battle', 'leagues']) {
    await page.click(`.main-nav-btn[data-screen="${screen}"]`);
    await expect(page.locator(`#screen-${screen}`)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
});

test('tools menu opens accessibility settings and they stick', async ({ page }) => {
  await skipTour(page);
  await page.goto('/');
  await page.click('#btn-tools');
  await page.click('#tools-menu [data-open="a11y-modal"]');
  const modal = page.locator('#a11y-modal');
  await expect(modal).toBeVisible();
  await modal.locator('[data-a11y="palette"]').selectOption('cb');
  await modal.locator('[data-a11y="captions"]').check();
  await expect(page.locator('body')).toHaveAttribute('data-palette', 'cb');
  await modal.locator('#a11y-test-caption').click();
  await expect(page.locator('.a11y-caption')).toHaveText('Here comes a new challenger!');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-palette', 'cb');
});

test('first visit offers the tour, which walks to the end', async ({ page }) => {
  await page.goto('/');
  await page.click('.tour-prompt [data-go]');
  const card = page.locator('.tour-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#tour-title')).toHaveText('Welcome to WWTS');
  for (let i = 0; i < 20 && await card.isVisible(); i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tour-prompt')).toHaveCount(0);
});

test('fight club select screen lists the whole cast', async ({ page }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.goto('/');
  await page.click('.main-nav-btn[data-screen="fight"]');
  await expect(page.locator('#screen-fight')).toBeVisible();
  await expect(page.locator('#fs-grid-1 .fs-tile')).toHaveCount(28);
  await page.selectOption('#fs-mode', 'training');
  await expect(page.locator('#fs-start')).toHaveText('TRAIN!');
  await page.click('#fs-controls');
  await expect(page.locator('#fs-controls-modal')).toBeVisible();
  await expect(page.locator('#fs-controls-body tr')).toHaveCount(12);
  await page.click('#fs-controls-close');
  expect(errors).toEqual([]);
});

test('audience vote page and overlays load', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/vote.html');
  await expect(page.locator('#v-room')).toBeVisible();
  for (const w of ['scoreboard', 'timer', 'crowd', 'fight']) {
    await page.goto(`/overlay.html?w=${w}&demo=1`);
    await expect(page.locator('body')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});
