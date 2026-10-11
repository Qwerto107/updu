import { expect, test } from '@playwright/test';

test('custom categories persist service membership and ordering without changing monitor groups', async ({ page, request, browser }, info) => {
    const slug = `categories-${Date.now()}`;
    const monitors: { id: string; name: string; groups: string[] }[] = [];
    let pageID = '';
    try {
        // 使用停用探针，测试分类配置而不依赖外部网络或调度时序。
        for (const name of ['Website', 'Gateway', 'Database']) {
            const response = await request.post('/api/v1/monitors', { data: {
                name: `${slug}-${name}`, type: 'ping', config: { host: '127.0.0.1' },
                enabled: false, groups: [`${slug}-original`], timeout_s: 10,
            } });
            expect(response.ok()).toBeTruthy();
            monitors.push(await response.json());
        }
        await page.goto('/status-pages');
        await page.getByRole('button', { name: 'New Status Page', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('#sp-name').fill(slug);
        await dialog.locator('#sp-slug').fill(slug);
        await dialog.getByRole('button', { name: 'Add category', exact: true }).click();
        const categories = dialog.getByTestId('category-editor');
        await categories.nth(0).getByLabel('Category name', { exact: true }).fill('Web services');
        await categories.nth(0).getByLabel('Category description', { exact: true }).fill('Customer facing applications');
        await categories.nth(0).getByLabel('Add service to category', { exact: true }).selectOption(monitors[0].id);
        await categories.nth(0).getByLabel('Add service to category', { exact: true }).selectOption(monitors[1].id);
        await categories.nth(0).getByTestId('category-service').nth(1).getByRole('button', { name: 'Move service up', exact: true }).click();
        await expect(categories.nth(0).getByTestId('category-service').nth(0)).toContainText(monitors[1].name);

        await dialog.getByRole('button', { name: 'Add category', exact: true }).click();
        await categories.nth(1).getByLabel('Category name', { exact: true }).fill('Infrastructure');
        await categories.nth(1).getByLabel('Category description', { exact: true }).fill('Storage and gateways');
        await categories.nth(1).getByLabel('Add service to category', { exact: true }).selectOption(monitors[2].id);
        // 已分配服务移动到另一分类时，原分类必须同步移除，避免公开页重复展示。
        await categories.nth(1).getByLabel('Add service to category', { exact: true }).selectOption(monitors[1].id);
        await expect(categories.nth(0).getByTestId('category-service')).toHaveCount(1);
        await categories.nth(1).getByTestId('category-service').nth(1).getByRole('button', { name: 'Move service up', exact: true }).click();
        await categories.nth(1).getByRole('button', { name: 'Move category up', exact: true }).click();
        await expect(categories.nth(0).getByLabel('Category name', { exact: true })).toHaveValue('Infrastructure');
        await page.screenshot({ path: info.outputPath('category-editor.png'), fullPage: true });
        const created = page.waitForResponse(response => response.url().endsWith('/api/v1/status-pages') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create Page', exact: true }).click();
        const createResponse = await created;
        expect(createResponse.ok()).toBeTruthy();
        pageID = (await createResponse.json()).id;
        await expect(dialog).toBeHidden();

        await page.reload();
        await page.getByRole('button', { name: `Edit status page ${slug}`, exact: true }).click();
        await expect(categories).toHaveCount(2);
        await expect(categories.nth(0).getByLabel('Category description', { exact: true })).toHaveValue('Storage and gateways');
        await expect(categories.nth(0).getByTestId('category-service').nth(0)).toContainText(monitors[1].name);
        await expect(categories.nth(0).getByTestId('category-service').nth(1)).toContainText(monitors[2].name);
        await categories.nth(1).getByLabel('Category name', { exact: true }).fill('Applications');
        await categories.nth(1).getByLabel('Category description', { exact: true }).fill('Renamed public category');
        const updated = page.waitForResponse(response => response.url().endsWith(`/api/v1/status-pages/${pageID}`) && response.request().method() === 'PUT');
        await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
        expect((await updated).ok()).toBeTruthy();
        await expect(dialog).toBeHidden();

        // 未选后台分组，单独选择分类中的服务也应对匿名访客可见。
        const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
        try {
            const publicPage = await visitor.newPage();
            await publicPage.goto(`/status/${slug}`);
            const publicCategories = publicPage.getByTestId('status-category');
            await expect(publicCategories).toHaveCount(2);
            await expect(publicPage.getByTestId('status-monitor')).toHaveCount(3);
            await expect(publicCategories.nth(0).getByRole('button', { name: /Infrastructure.*Operational: 0 \/ 2/ })).toHaveAttribute('aria-expanded', 'true');
            await expect(publicCategories.nth(0).getByTestId('status-monitor').getByRole('heading')).toHaveText([monitors[1].name, monitors[2].name]);
            await expect(publicCategories.nth(1).getByRole('button', { name: /Applications/ })).toBeVisible();
            await expect(publicCategories.nth(1).getByText('Renamed public category', { exact: true })).toBeVisible();
            await publicPage.screenshot({ path: info.outputPath('custom-categories.png'), fullPage: true });
            await publicPage.reload();
            await expect(publicCategories.nth(1).getByText('Renamed public category', { exact: true })).toBeVisible();
        } finally { await visitor.close(); }

        for (const monitor of monitors) {
            const response = await request.get(`/api/v1/monitors/${monitor.id}`);
            expect(response.ok()).toBeTruthy();
            expect((await response.json()).groups).toEqual([`${slug}-original`]);
        }
    } finally {
        if (pageID) await request.delete(`/api/v1/status-pages/${pageID}`).catch(() => {});
        for (const monitor of monitors) await request.delete(`/api/v1/monitors/${monitor.id}`).catch(() => {});
    }
});

test('public categories keep unassigned services visible and collapse in both layouts', async ({ page }, info) => {
    let layout = 'list';
    await page.route('**/api/v1/status-pages/category-demo', route => route.fulfill({ json: {
        page: {
            name: '分类展示', slug: 'category-demo', layout, groups: [{ name: 'Legacy' }],
            categories: [{ name: '网站服务', description: '自定义分类说明', monitor_ids: ['website', 'gateway'] }],
        },
        incidents: [], maintenance: [],
        monitors: [
            { id: 'website', name: 'Website', status: 'up', groups: ['Legacy'] },
            { id: 'gateway', name: 'Gateway', status: 'down', groups: ['Legacy'] },
            { id: 'unassigned', name: 'Unassigned service', status: 'pending', groups: ['Legacy'] },
        ].map(monitor => ({ ...monitor, type: 'http', history: [], uptime_24h: null, last_latency_ms: null })),
    } }));
    await page.goto('/status/category-demo');
    for (layout of ['list', 'cards']) {
        await page.reload();
        const categories = page.getByTestId('status-category');
        await expect(categories).toHaveCount(2);
        await expect(categories.nth(0).getByText('自定义分类说明', { exact: true })).toBeVisible();
        const toggle = categories.nth(0).getByRole('button', { name: /网站服务.*Operational: 1 \/ 2/ });
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(categories.nth(0).getByTestId('status-layout')).toHaveAttribute('data-layout', layout);
        await expect(categories.nth(1).getByRole('button', { name: /Other services/ })).toBeVisible();
        await expect(categories.nth(1).getByText('Unassigned service', { exact: true })).toBeVisible();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(categories.nth(0).getByText('Website', { exact: true })).toBeHidden();
        await expect(categories.nth(1).getByText('Unassigned service', { exact: true })).toBeVisible();
        await toggle.click();
        await expect(categories.nth(0).getByTestId('status-monitor')).toHaveCount(2);

        // 窄屏中文翻译不能覆盖管理员填写的分类名称，也不能挤出页面横向滚动。
        await page.evaluate(() => localStorage.setItem('updu_language', 'zh-CN'));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await expect(categories.nth(0).getByRole('button', { name: /网站服务/ })).toBeVisible();
        await expect(categories.nth(1).getByRole('button', { name: /其他服务/ })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        await page.screenshot({ path: info.outputPath(`categories-${layout}-mobile.png`), fullPage: true });
        await page.evaluate(() => localStorage.setItem('updu_language', 'en'));
        await page.setViewportSize({ width: 1280, height: 960 });
    }
});
