import { expect, test } from '@playwright/test';

function fixture(layout = 'list') {
    const now = Date.now();
    return {
        page: { name: 'Service health', slug: 'layout-demo', layout, groups: [{ name: 'Core' }] },
        incidents: [], maintenance: [],
        monitors: ['up', 'down', 'pending'].map((status, index) => ({
            id: `service-${index}`, name: ['Website', 'API gateway', 'New service'][index], type: 'http', groups: ['Core'], status,
            uptime_24h: index === 2 ? null : 99.5, last_latency_ms: index === 2 ? null : 24, last_check: new Date(now).toISOString(),
            history: Array.from({ length: 48 }, (_, i) => ({
                start: new Date(now - (48-i)*1800000).toISOString(), samples: index === 2 || i < 3 ? 0 : 60,
                status: index === 2 || i < 3 ? 'unknown' : i === 30 ? 'down' : i === 32 ? 'degraded' : 'up',
                uptime: index === 2 || i < 3 ? null : 100,
                latency_ms: index === 2 || i < 3 || i === 30 ? null : 12 + (i % 8)*3,
            })),
        })),
    };
}

test('public layouts support both themes, Chinese and mobile without overflow', async ({ page }, info) => {
    let layout = 'list';
    await page.route('**/api/v1/status-pages/layout-demo', route => route.fulfill({ json: fixture(layout) }));
    await page.goto('/status/layout-demo');
    for (const mode of ['light', 'dark']) {
        for (layout of ['list', 'cards']) {
            await page.evaluate(({ mode }) => { localStorage.setItem('updu_theme', mode); localStorage.setItem('updu_language', 'zh-CN'); }, { mode });
            await page.setViewportSize({ width: 1280, height: 960 });
            await page.goto('/status/layout-demo');
            await page.reload();
            // 项目通过移除 light 类启用深色，而不是添加 dark 类。
            if (mode === 'light') await expect(page.locator('html')).toHaveClass(/light/);
            else await expect(page.locator('html')).not.toHaveClass(/light/);
            await expect(page.getByTestId('status-monitor')).toHaveCount(3);
            await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', layout);
            await expect(page.getByText('24 小时可用率').first()).toBeVisible();
            await expect(page.getByText('暂无延迟数据')).toBeVisible();
            await expect(page.getByRole('img', { name: '最近 24 小时状态历史' }).first().locator('div')).toHaveCount(48);
            await page.screenshot({ path: info.outputPath(`${layout}-${mode}.png`), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
            await page.screenshot({ path: info.outputPath(`${layout}-${mode}-mobile.png`), fullPage: true });
        }
    }
});

test('status page refreshes and retains missing history instead of reporting healthy', async ({ page }) => {
    await page.clock.install();
    let requests = 0;
    await page.route('**/api/v1/status-pages/layout-demo', route => {
        requests++;
        if (requests === 2) return route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
        const data = fixture();
        data.monitors = [data.monitors[2]];
        data.monitors[0].name = requests > 1 ? 'Refreshed service' : 'Waiting service';
        return route.fulfill({ json: data });
    });
    await page.goto('/status/layout-demo');
    await expect(page.getByText('Waiting service')).toBeVisible();
    await expect(page.getByText('Some services are paused or awaiting checks')).toBeVisible();
    await expect(page.getByText('All Systems Operational')).toHaveCount(0);
    await page.clock.fastForward(31000);
    await expect(page.getByText('Refresh failed; retrying shortly')).toBeVisible();
    await expect(page.getByText('Waiting service')).toBeVisible();
    await page.clock.fastForward(31000);
    await expect(page.getByText('Refreshed service')).toBeVisible();
    expect(requests).toBeGreaterThan(1);
});

test('administrator can save layouts and anonymous visitor sees saved choice', async ({ page, request, browser }) => {
    const slug = `layout-${Date.now()}`;
    const monitorResponse = await request.post('/api/v1/monitors', { data: { name: slug, type: 'ping', config: { host: '127.0.0.1' }, enabled: false, groups: [slug], timeout_s: 10 } });
    expect(monitorResponse.ok()).toBeTruthy();
    const monitor = await monitorResponse.json();
    let pageID = '';
    try {
        await page.goto('/status-pages');
        await page.getByRole('button', { name: 'New Status Page', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('#sp-name').fill(slug);
        await dialog.locator('#sp-slug').fill(slug);
        await expect(dialog.getByLabel('Simple list', { exact: true })).toBeChecked();
        await dialog.getByLabel('Card grid', { exact: true }).check();
        // 分组使用隐藏复选框配合标签样式，点击可见标签而非隐藏输入。
        await dialog.locator('label').filter({ hasText: slug }).first().click();
        const saved = page.waitForResponse(response => response.url().endsWith('/api/v1/status-pages') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create Page', exact: true }).click();
        const response = await saved;
        expect(response.ok()).toBeTruthy();
        pageID = (await response.json()).id;
        const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
        try {
            const publicPage = await visitor.newPage();
            await publicPage.goto(`/status/${slug}`);
            await expect(publicPage.getByTestId('status-layout')).toHaveAttribute('data-layout', 'cards');
            // 保存为列表后刷新，验证服务端持久化而非仅浏览器本地切换。
            expect((await request.put(`/api/v1/status-pages/${pageID}`, { data: { layout: 'list', is_public: true, groups: [{ name: slug }] } })).ok()).toBeTruthy();
            await publicPage.reload();
            await expect(publicPage.getByTestId('status-layout')).toHaveAttribute('data-layout', 'list');
        } finally { await visitor.close(); }
    } finally {
        if (pageID) await request.delete(`/api/v1/status-pages/${pageID}`).catch(() => {});
        await request.delete(`/api/v1/monitors/${monitor.id}`).catch(() => {});
    }
});
