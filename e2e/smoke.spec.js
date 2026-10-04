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

test('a training match starts and runs without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.goto('/');
  await page.click('.main-nav-btn[data-screen="fight"]');
  await page.selectOption('#fs-mode', 'training');
  await page.click('#fs-start');
  await expect(page.locator('.fight-training')).toBeVisible({ timeout: 45_000 });
  // hold a few inputs so movement, attacks and contact code all run
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyD');
  for (const k of ['KeyF', 'KeyG', 'KeyV', 'KeyB']) { await page.keyboard.press(k); await page.waitForTimeout(450); }
  await page.waitForTimeout(1000);
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

test.describe('small screens', () => {
  for (const vp of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
    test(`no sideways scrolling at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await skipTour(page);
      await page.goto('/');
      for (const screen of ['leagues', 'roster', 'battle', 'fight']) {
        await page.click(`.main-nav-btn[data-screen="${screen}"]`);
        await page.waitForTimeout(500);
        const w = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(w, `${screen} at ${vp.width}px`).toBeLessThanOrEqual(vp.width + 1);
      }
    });
  }
});

test('a producer signs up from their phone and the host sees them', async ({ page, context }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.goto('/');
  await page.click('#btn-tools');
  await page.click('#tools-menu [data-open="signup-modal"]');
  await page.locator('#su-open').check();
  const room = await page.locator('#su-room').textContent();
  const phone = await context.newPage();
  await phone.goto(`/entry.html?room=${room}`);
  await phone.fill('#e-name', 'E2E Producer');
  await phone.click('#e-register');
  await expect(phone.locator('#e-me-name')).toHaveText('E2E Producer');
  await expect(page.locator('#su-list')).toContainText('E2E Producer');
  await page.locator('#su-list [data-su="in"]').first().click();
  await expect(phone.locator('#e-status')).toHaveText('✓ Checked in');
  await phone.close();
  expect(errors).toEqual([]);
});

test('coin flip decides the order and the run of show loads a matchup', async ({ page }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.addInitScript(() => { try { localStorage.setItem('wwts_a11y_v1', JSON.stringify({ reducedMotion: true })); } catch { /* */ } });
  await page.goto('/');
  await page.click('.main-nav-btn[data-screen="battle"]');
  await page.click('#btn-run-of-show');
  const p1 = page.locator('#ros-p1');
  const p2 = page.locator('#ros-p2');
  await p1.selectOption({ index: 1 });
  await p2.selectOption({ index: 2 });
  await page.click('#ros-add');
  await expect(page.locator('#ros-list .ros-item')).toHaveCount(1);
  await page.locator('#ros-list [data-act="load"]').click();
  await expect(page.locator('#flow-primary-label')).toContainText('Flip for Order');
  await page.click('#btn-primary-flow');
  await expect(page.locator('.coin-flip')).toBeVisible();
  await expect(page.locator('#flow-primary-label')).toContainText('▶ Play', { timeout: 8000 });
  await expect(page.locator('#ros-chip')).toBeVisible();
  expect(errors).toEqual([]);
});

test('event settings, calibration and the new tool panels open', async ({ page }) => {
  const errors = watchErrors(page);
  await skipTour(page);
  await page.goto('/');
  for (const id of ['event-settings-modal', 'templates-modal', 'calibration-modal', 'cohost-modal', 'public-modal']) {
    await page.click('#btn-tools');
    await page.click(`#tools-menu [data-open="${id}"]`);
    await expect(page.locator(`#${id}`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  await page.click('#btn-tools');
  await page.click('#tools-menu [data-open="event-settings-modal"]');
  await page.selectOption('[data-setting="timeLimit"]', 'overrun');
  await expect(page.locator('.es-penalty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('phone pages for co-hosts and the crowd load', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/cohost.html?room=ABCD');
  await expect(page.locator('#c-pin')).toBeVisible();
  await page.goto('/entry.html');
  await expect(page.locator('#e-room-code')).toBeVisible();
  for (const w of ['next', 'coin', 'predict']) {
    await page.goto(`/overlay.html?w=${w}&demo=1`);
    await expect(page.locator('#ov-root')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});
