import { expect, test, type Locator } from '@playwright/test';
import type { TLSCertificate } from '../src/lib/api/certificates';

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

// 有效期相对测试开始时间生成，不能只伪造 days_remaining；不会触发外部 TLS 探测。
const certificates: TLSCertificate[] = [
    { domain: 'valid.example.test', days_remaining: 60 },
    { domain: 'expiring.example.test', days_remaining: 20 },
    { domain: 'expired.example.test', days_remaining: -1 },
].map((certificate, index) => ({
    ...certificate,
    id: `theme-cert-${index}`,
    issuer: 'Theme Test CA',
    subject: certificate.domain,
    sans: [certificate.domain],
    valid_from: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    valid_until: new Date(Date.now() + certificate.days_remaining * 86_400_000).toISOString(),
    last_verified_at: new Date(Date.now()).toISOString(),
    ocsp_status: certificate.days_remaining < 0 ? 'expired' : 'verified',
    signature_algorithm: 'SHA256-RSA',
}));

test('certificate risk table, expiry badges and audit dialog follow both themes', async ({ page }, testInfo) => {
    await page.route('**/api/v1/certificates', route => route.fulfill({ json: certificates }));
    let auditFailed = false;
    await page.route('**/api/v1/certificates/test', route => route.fulfill(auditFailed
        ? { status: 400, json: { error: 'Theme test handshake failed' } }
        : { json: certificates[0] }));
    await page.goto('/certificates');
    for (const mode of ['light', 'dark']) {
        const heading = page.getByRole('heading', { name: 'TLS Certificates', exact: true });
        await expect(heading).toBeVisible();
        expect(await contrast(heading), `${mode} certificate heading`).toBeGreaterThanOrEqual(4.5);
        for (const certificate of certificates) {
            const domain = page.getByText(certificate.domain, { exact: true }).first();
            await expect(domain).toBeVisible();
            // 主题切换包含颜色过渡，等待最终配色后再检查，避免读到中间动画帧。
            await expect.poll(() => contrast(domain), { message: `${mode} certificate domain` }).toBeGreaterThanOrEqual(4.5);
        }
        for (const [index, badge] of ['60 days remaining', '20 days remaining', 'Expired'].entries()) {
            const row = page.getByTestId('tls-certificate').filter({ hasText: certificates[index].domain });
            const expiryBadge = row.locator('.expiry-badge');
            await expect(expiryBadge).toHaveText(badge);
            await expect.poll(() => contrast(expiryBadge), { message: `${mode} ${badge}` }).toBeGreaterThanOrEqual(4.5);
        }
        await page.screenshot({ path: testInfo.outputPath(`certificates-${mode}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Test TLS Handshake', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Audit Live TLS Handshake' });
        const host = dialog.getByLabel('Hostname / FQDN', { exact: true });
        await expect(host).toBeVisible();
        expect(await contrast(host), `${mode} audit input`).toBeGreaterThanOrEqual(4.5);
        await host.fill('valid.example.test');
        auditFailed = false;
        await dialog.getByRole('button', { name: 'Perform TLS Audit', exact: true }).click();
        const result = dialog.getByText('Theme Test CA', { exact: true });
        await expect(result).toBeVisible();
        expect(await contrast(result), `${mode} audit result`).toBeGreaterThanOrEqual(4.5);
        auditFailed = true;
        await dialog.getByRole('button', { name: 'Perform TLS Audit', exact: true }).click();
        const error = dialog.getByText('Theme test handshake failed', { exact: true });
        await expect(error).toBeVisible();
        expect(await contrast(error), `${mode} audit error`).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({ path: testInfo.outputPath(`certificate-audit-${mode}.png`), fullPage: true });
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        if (mode === 'light') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    }
});

test('certificate empty and error states remain readable in light mode', async ({ page }) => {
    let failed = false;
    await page.route('**/api/v1/certificates', route => route.fulfill(failed
        ? { status: 500, json: { error: 'Theme test certificate list failed' } }
        : { json: [] }));
    await page.goto('/certificates');
    const empty = page.getByText('No certificates discovered yet', { exact: true });
    await expect(empty).toBeVisible();
    expect(await contrast(empty)).toBeGreaterThanOrEqual(4.5);
    failed = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const error = page.getByText('Theme test certificate list failed', { exact: true });
    await expect(error).toBeVisible();
    expect(await contrast(error)).toBeGreaterThanOrEqual(4.5);
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
