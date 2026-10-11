import { expect, test } from '@playwright/test';

function fixture(layout = 'cards', slug = 'layout-demo') {
    const now = Date.now();
    return {
        page: { name: 'Service health', slug, layout, groups: [{ name: 'Core' }] },
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

test('compact public layouts support both themes, Chinese and mobile without overflow', async ({ page }, info) => {
    let layout = 'cards';
    await page.route('**/api/v1/status-pages/layout-demo', route => route.fulfill({ json: fixture(layout) }));
    await page.goto('/status/layout-demo');
    for (const mode of ['light', 'dark']) {
        for (layout of ['cards', 'table']) {
            await page.evaluate(({ mode }) => { localStorage.setItem('updu_theme', mode); localStorage.setItem('updu_language', 'zh-CN'); }, { mode });
            await page.setViewportSize({ width: 1280, height: 960 });
            await page.goto('/status/layout-demo');
            await page.reload();
            // 项目通过移除 light 类启用深色，而不是添加 dark 类。
            if (mode === 'light') await expect(page.locator('html')).toHaveClass(/light/);
            else await expect(page.locator('html')).not.toHaveClass(/light/);
            await expect(page.getByTestId('status-monitor')).toHaveCount(3);
            await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', layout);
            // 缺测服务必须保留无数据状态，不能因紧凑展示被误写成 100% 在线或零延迟。
            const pending = page.getByTestId('status-monitor').filter({ hasText: 'New service' });
            await expect(pending).toContainText('暂无数据');
            await expect(pending).not.toContainText('100.00%');
            await expect(pending).not.toContainText(/\b0\s*ms\b/);
            await expect(page.getByRole('img', { name: '最近 24 小时状态历史' }).first().locator('div')).toHaveCount(48);
            const heights = () => page.getByTestId('status-monitor').evaluateAll(monitors => monitors.map(monitor => monitor.getBoundingClientRect().height));
            const initialHeights = await heights();
            // 字体或样式刚加载时可能尚未完成重排，等待稳定后的真实尺寸，阈值不放宽。
            await expect.poll(async () => Math.max(...await heights())).toBeLessThanOrEqual(layout === 'cards' ? 170 : 76);
            await info.attach(`${layout}-${mode}-heights`, { body: JSON.stringify({ initial: initialHeights, final: await heights() }), contentType: 'application/json' });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
            await page.screenshot({ path: info.outputPath(`${layout}-${mode}.png`), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
            await page.screenshot({ path: info.outputPath(`${layout}-${mode}-mobile.png`), fullPage: true });
        }
    }
});

test('operations table avoids overlapping content at medium widths and retains mobile column headers', async ({ page }) => {
    const data = fixture('table');
    data.monitors[0].name = 'Production website with a deliberately long service name that must remain inside its column';
    data.monitors[0].last_latency_ms = 12345;
    await page.addInitScript(() => localStorage.setItem('updu_language', 'en'));
    await page.route('**/api/v1/status-pages/layout-demo', route => route.fulfill({ json: data }));
    await page.goto('/status/layout-demo');
    await expect(page.getByTestId('status-monitor')).toHaveCount(3);
    for (const width of [640, 768, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
        const latencyCell = page.getByTestId('status-monitor').first().locator('td').nth(3);
        await expect(latencyCell).toBeVisible();
        await expect(latencyCell).toContainText('12345 ms');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`).toBeTruthy();
        // 测量单元格直接内容的实际矩形；名称按钮内部的省略号不算溢出文本。
        const overlaps = await page.getByTestId('status-monitor').evaluateAll(rows => rows.flatMap((row, rowIndex) => {
            const contents = [...row.querySelectorAll('td')].map(cell => [...cell.childNodes].flatMap(node => {
                let rectangles: DOMRect[] = [];
                if (node.nodeType === Node.ELEMENT_NODE) {
                    rectangles = [(node as Element).getBoundingClientRect()];
                } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    rectangles = [...range.getClientRects()];
                }
                return rectangles.filter(rect => rect.width > 0 && rect.height > 0);
            }));
            const collisions: { row: number; leftCell: number; rightCell: number }[] = [];
            for (let left = 0; left < contents.length; left++) {
                for (let right = left + 1; right < contents.length; right++) {
                    const overlap = contents[left].some(a => contents[right].some(b =>
                        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
                    ));
                    if (overlap) collisions.push({ row: rowIndex, leftCell: left, rightCell: right });
                }
            }
            return collisions;
        }));
        expect(overlaps, `Separate cell contents at ${width}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // 手机只做视觉隐藏，读屏用户仍应能理解五列分别代表什么。
    await expect(page.getByRole('columnheader')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('service details expand and collapse in both compact layouts', async ({ page }) => {
    let layout = 'cards';
    await page.route('**/api/v1/status-pages/layout-demo', route => route.fulfill({ json: fixture(layout) }));
    for (layout of ['cards', 'table']) {
        await page.goto('/status/layout-demo');
        const toggle = page.getByRole('button', { name: 'Service details: Website', exact: true });
        const details = page.getByTestId('status-monitor-details');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(details).toHaveCount(0);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(details).toBeVisible();
        await expect(details).toContainText('Last checked');
        await expect(details).toContainText('Service type');
        await expect(details.getByRole('img', { name: 'Successful probe latency · 24 hours', exact: true })).toBeVisible();
        // 表格的展开详情是附加行，不应被计算成第四个监控服务。
        await expect(page.getByTestId('status-monitor')).toHaveCount(3);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(details).toHaveCount(0);

        await page.getByRole('button', { name: 'Service details: New service', exact: true }).click();
        await expect(details.getByText('No latency data', { exact: true })).toBeVisible();
        await expect(details.getByRole('img')).toHaveCount(0);
        await page.getByRole('button', { name: 'Service details: New service', exact: true }).click();
        await expect(details).toHaveCount(0);
    }
});

test('layout selection survives background refresh when browser storage is unavailable', async ({ page }) => {
    // 只模拟布局偏好的存储失败，保留主题、语言与登录相关存储的正常行为。
    await page.addInitScript(() => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
            if (key.startsWith('updu_status_layout:')) throw new DOMException('Storage unavailable', 'SecurityError');
            return getItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('updu_status_layout:')) throw new DOMException('Storage unavailable', 'SecurityError');
            return setItem.call(this, key, value);
        };
    });
    await page.clock.install();
    let requests = 0;
    await page.route('**/api/v1/status-pages/layout-demo', route => {
        requests++;
        const data = fixture('cards');
        data.monitors[0].name = requests > 1 ? 'Website refreshed' : 'Website';
        return route.fulfill({ json: data });
    });
    await page.goto('/status/layout-demo');
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'cards');
    const tableButton = page.getByRole('group', { name: 'Display layout', exact: true }).getByRole('button', { name: 'Operations table', exact: true });
    await tableButton.click();
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
    await page.clock.fastForward(31000);
    // 服务名称变化证明后台数据已实际刷新，布局应保留本次页面内的选择。
    await expect(page.getByText('Website refreshed', { exact: true })).toBeVisible();
    expect(requests).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
    await expect(tableButton).toHaveAttribute('aria-pressed', 'true');
});

test('visitor layout choice persists per page without changing the server default', async ({ page, browser }) => {
    const layouts = { 'layout-demo': 'cards', 'another-layout': 'table' };
    const mutations: string[] = [];
    await page.route('**/api/v1/status-pages/*', route => {
        const slug = new URL(route.request().url()).pathname.split('/').pop() as keyof typeof layouts;
        if (route.request().method() !== 'GET') mutations.push(route.request().method());
        return route.fulfill({ json: fixture(layouts[slug], slug) });
    });
    await page.goto('/status/layout-demo');
    const controls = page.getByRole('group', { name: 'Display layout', exact: true });
    await expect(controls.getByRole('button', { name: 'Lightweight cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await controls.getByRole('button', { name: 'Operations table', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Operations table', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
    expect(await page.evaluate(() => localStorage.getItem('updu_status_layout:layout-demo'))).toBe('table');
    await page.reload();
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');

    // 两张状态页的选择互不覆盖，返回原页面时仍使用之前的访客偏好。
    await page.goto('/status/another-layout');
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
    await controls.getByRole('button', { name: 'Lightweight cards', exact: true }).click();
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'cards');
    expect(await page.evaluate(() => localStorage.getItem('updu_status_layout:another-layout'))).toBe('cards');
    await page.goto('/status/layout-demo');
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'table');
    expect(mutations).toEqual([]);

    // 全新浏览器没有本地选择，应分别采用这两张页面的后台默认布局。
    const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
    try {
        await visitor.route('**/api/v1/status-pages/*', route => {
            const slug = new URL(route.request().url()).pathname.split('/').pop() as keyof typeof layouts;
            return route.fulfill({ json: fixture(layouts[slug], slug) });
        });
        const publicPage = await visitor.newPage();
        for (const [slug, layout] of Object.entries(layouts)) {
            await publicPage.goto(`/status/${slug}`);
            await expect(publicPage.getByTestId('status-layout')).toHaveAttribute('data-layout', layout);
        }
    } finally { await visitor.close(); }
});

test('legacy list pages use lightweight cards', async ({ page }) => {
    await page.route('**/api/v1/status-pages/layout-demo', route => route.fulfill({ json: fixture('list') }));
    await page.goto('/status/layout-demo');
    await expect(page.getByTestId('status-layout')).toHaveAttribute('data-layout', 'cards');
    await expect(page.getByRole('group', { name: 'Display layout', exact: true }).getByRole('button', { name: 'Lightweight cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
        await expect(dialog.getByLabel('Lightweight cards', { exact: true })).toBeChecked();
        // 分组使用隐藏复选框配合标签样式，点击可见标签而非隐藏输入。
        await dialog.locator('label').filter({ hasText: slug }).first().click();
        const saved = page.waitForResponse(response => response.url().endsWith('/api/v1/status-pages') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create Page', exact: true }).click();
        const response = await saved;
        expect(response.ok()).toBeTruthy();
        pageID = (await response.json()).id;
        await expect(dialog).toBeHidden();
        async function expectAnonymousDefault(layout: string) {
            const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
            try {
                const publicPage = await visitor.newPage();
                await publicPage.goto(`/status/${slug}`);
                await expect(publicPage.getByTestId('status-layout')).toHaveAttribute('data-layout', layout);
            } finally { await visitor.close(); }
        }
        await expectAnonymousDefault('cards');

        // 通过真实后台表单修改，确认重载持久化以及新访客收到的默认布局。
        await page.reload();
        await page.getByRole('button', { name: `Edit status page ${slug}`, exact: true }).click();
        await expect(dialog.getByLabel('Lightweight cards', { exact: true })).toBeChecked();
        await dialog.getByLabel('Operations table', { exact: true }).check();
        const updated = page.waitForResponse(result => result.url().endsWith(`/api/v1/status-pages/${pageID}`) && result.request().method() === 'PUT');
        await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
        expect((await updated).ok()).toBeTruthy();
        await expect(dialog).toBeHidden();
        await page.reload();
        await page.getByRole('button', { name: `Edit status page ${slug}`, exact: true }).click();
        await expect(dialog.getByLabel('Operations table', { exact: true })).toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expectAnonymousDefault('table');
    } finally {
        if (pageID) await request.delete(`/api/v1/status-pages/${pageID}`).catch(() => {});
        await request.delete(`/api/v1/monitors/${monitor.id}`).catch(() => {});
    }
});
