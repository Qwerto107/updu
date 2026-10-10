import { expect, test } from '@playwright/test';
import { authMode, expectedUsername } from './helpers/env';
import { loginThroughUI } from './helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test('login, session persistence, and logout work', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: /sign in to updu/i }),
    ).toBeVisible();

    await loginThroughUI(page);
    await expect(page.getByText(expectedUsername, { exact: true })).toBeVisible();

    await page.goto('/monitors');
    // 旧监控路径会重定向到服务列表，继续验证兼容入口和登录态。
    await expect(page).toHaveURL(/\/services$/);
    await expect(
        page.getByRole('heading', { name: 'Services', level: 1 }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByText(expectedUsername, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
        page.getByRole('heading', { name: /sign in to updu/i }),
    ).toBeVisible();
});
