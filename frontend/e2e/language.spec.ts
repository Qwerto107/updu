import { expect, test } from '@playwright/test';
import { locales, normalizeLocale, translate } from '../src/lib/i18n/locales';

test.describe('language preferences', () => {
    test.beforeEach(async ({ request }) => {
        // 复用 setup 项目保存的会话，避免整套 E2E 重复登录触发限流。
        expect((await request.post('/api/v1/settings', {
            data: { default_language: 'en' },
        })).ok()).toBeTruthy();
    });

    test.afterEach(async ({ request }) => {
        await request.post('/api/v1/settings', { data: { default_language: 'en' } });
    });

    test('login language changes immediately and survives reload', async ({ page }) => {
        await page.context().clearCookies();
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Sign in to updu' })).toBeVisible();
        await page.getByRole('button', { name: '简体中文', exact: true }).click();
        await expect(page.getByRole('heading', { name: '登录 updu' })).toBeVisible();
        await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await page.reload();
        await expect(page.getByRole('heading', { name: '登录 updu' })).toBeVisible();
        await page.getByRole('button', { name: 'English', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Sign in to updu' })).toBeVisible();
    });

    test('saved default applies to new visitors while personal preference wins', async ({ page, browser, request }) => {
        // 复用测试请求的已登录会话，避免重复登录触发正常的限流保护。
        await page.context().addCookies((await request.storageState()).cookies);
        await page.goto('/settings/general');
        await expect(page.getByLabel('Default Language', { exact: true })).toBeVisible();
        await page.getByLabel('Default Language', { exact: true }).selectOption('zh-CN');
        await page.getByRole('button', { name: 'Save Settings', exact: true }).click();
        await expect(page.getByText('设置保存成功。', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
        const saved = await request.get('/api/v1/settings');
        expect((await saved.json()).default_language).toBe('zh-CN');
        await page.reload();
        await expect(page.getByLabel('默认语言', { exact: true })).toHaveValue('zh-CN');
        await page.getByRole('button', { name: 'English', exact: true }).click();
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

        // 新上下文没有本地偏好或登录态，必须采用服务器保存的中文默认值。
        const visitor = await browser.newContext({
            baseURL: page.url().split('/settings')[0],
            // 显式清除项目默认登录态，确保这里验证的确实是新访客。
            storageState: { cookies: [], origins: [] },
        });
        try {
            const login = await visitor.newPage();
            await login.goto('/login');
            await expect(login.getByRole('heading', { name: '登录 updu' })).toBeVisible();
            await expect(login.locator('html')).toHaveAttribute('lang', 'zh-CN');
        } finally { await visitor.close(); }
        await page.getByRole('button', { name: 'Use instance default', exact: true }).click();
        await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    });

    test('unsupported preferences and missing translations fall back safely', async ({ page, request }) => {
        await page.addInitScript(() => localStorage.setItem('updu_language', 'unsupported'));
        await page.context().clearCookies();
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Sign in to updu' })).toBeVisible();
        const response = await request.post('/api/v1/settings', { data: { default_language: 'fr' } });
        expect(response.status()).toBe(400);
        expect(normalizeLocale('fr')).toBe('en');
        expect(translate('zh-CN', 'An untranslated message')).toBe('An untranslated message');
        expect(translate('zh-CN', 'constructor')).toBe('constructor');
        expect(translate('zh-CN', '__proto__')).toBe('__proto__');
        expect(translate('zh-CN', 'Error: {message}', { message: '<b>example</b>' })).toBe('错误：<b>example</b>');
        expect(locales.map(locale => locale.code)).toEqual(['en', 'zh-CN']);
    });

    test('Chinese navigation and all main pages render without runtime errors', async ({ page, request }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.context().addCookies((await request.storageState()).cookies);
        await page.goto('/');
        await page.getByRole('button', { name: '简体中文', exact: true }).click();
        // 检查各路由的实际浏览器渲染，发现翻译接入导致的运行时错误。
        for (const route of ['/', '/services', '/topology', '/certificates', '/stats',
            '/incidents', '/maintenance', '/status-pages', '/settings/general',
            '/settings/notifications', '/settings/users', '/settings/backup',
            '/settings/system', '/settings/peers']) {
            await page.goto(route);
            await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
            await expect(page.locator('#main-content'), route).toBeVisible();
            await expect(page.getByRole('group', { name: '语言', exact: true })).toBeVisible();
        }
        expect(errors).toEqual([]);
        // 分段开关在 320px 手机宽度下仍须完整显示，并保留退出入口。
        await page.setViewportSize({ width: 320, height: 800 });
        for (const route of ['/', '/stats']) {
            await page.goto(route);
            await expect(page.getByRole('group', { name: '语言', exact: true })).toBeInViewport();
            await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeInViewport();
            await expect.poll(() => page.evaluate(() =>
                document.documentElement.scrollWidth - document.documentElement.clientWidth,
            )).toBeLessThanOrEqual(1);
        }
    });
});
