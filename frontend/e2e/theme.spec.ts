import { expect, test, type Locator } from '@playwright/test';

// 按浏览器实际渲染颜色计算对比度，防止硬编码白字或深色卡片再次混入浅色主题。
async function contrast(locator: Locator): Promise<number> {
    return locator.evaluate(element => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        const parents: Element[] = [];
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            parents.unshift(parent);
        }
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1, 1);
        for (const parent of parents) {
            ctx.fillStyle = getComputedStyle(parent).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
        }
        const luminance = (rgb: Uint8ClampedArray) => {
            const linear = Array.from(rgb).slice(0, 3).map(value => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const background = luminance(ctx.getImageData(0, 0, 1, 1).data);
        ctx.fillStyle = getComputedStyle(element).color;
        ctx.fillRect(0, 0, 1, 1);
        const foreground = luminance(ctx.getImageData(0, 0, 1, 1).data);
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    });
}

test('light is the default and a deliberate dark preference survives reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/light/);
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/light/);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Switch to light mode', exact: true })).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/light/);
});

test('topology views and forms remain readable in both themes', async ({ page }, testInfo) => {
    // 使用固定响应覆盖服务与端点视图，不向运行实例写入监控数据。
    await page.route('**/api/v1/topology', route => route.fulfill({ json: {
        nodes: [], edges: [],
        zones: [{ id: 'default', name: 'Theme test zone' }],
        scopes: [{ id: 'public', name: 'Public WAN' }],
        services: [{
            id: 'theme-service', name: 'Theme test service', type: 'web',
            zone_id: 'default', enabled: true, status: 'up',
            endpoints: [{ id: 'theme-endpoint', service_id: 'theme-service', name: 'Theme endpoint',
                scope_id: 'public', target_type: 'http', config: {}, is_primary: true,
                interval_s: 60, timeout_s: 10, retries: 0, status: 'up' }],
        }],
    } }));
    await page.goto('/topology');
    for (const mode of ['light', 'dark']) {
        await page.getByRole('button', { name: 'Zone Overview', exact: true }).click();
        const heading = page.getByRole('heading', { name: 'Network Topology & Diagnostics', exact: true });
        await expect(heading).toBeVisible();
        expect(await contrast(heading), `${mode} page heading`).toBeGreaterThanOrEqual(4.5);
        const zone = page.getByRole('heading', { name: 'Theme test zone', exact: true });
        expect(await contrast(zone), `${mode} zone heading`).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({ path: testInfo.outputPath(`topology-${mode}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Reachability Matrix', exact: true }).click();
        const service = page.getByRole('button', { name: 'Theme test service', exact: true });
        await expect(service).toBeVisible();
        expect(await contrast(service), `${mode} matrix service`).toBeGreaterThanOrEqual(4.5);
        await page.getByRole('button', { name: 'Hop Inspector', exact: true }).click();
        const endpoint = page.getByRole('heading', { name: /Theme endpoint/ });
        await expect(endpoint).toBeVisible();
        expect(await contrast(endpoint), `${mode} endpoint heading`).toBeGreaterThanOrEqual(4.5);
        await page.getByRole('button', { name: 'Add Zone', exact: true }).click();
        const field = page.getByLabel('Zone Display Name *', { exact: true });
        await expect(field).toBeVisible();
        expect(await contrast(field), `${mode} form field`).toBeGreaterThanOrEqual(4.5);
        await page.keyboard.press('Escape');
        if (mode === 'light') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    }
});
