import { expect, test } from '@playwright/test';

const now = new Date('2026-10-11T12:00:00Z');
const day = 24 * 60 * 60 * 1000;
const timestamp = (offset: number) => new Date(now.getTime() + offset * day).toISOString();

// 故意打乱返回顺序，并令六小时后到期的证书 days_remaining=0，防止重新依赖截断的天数。
const certificates = [
    { id: 'valid', domain: 'valid.example.test', valid_until: timestamp(90), verification_status: 'verified', service_name: 'Main website', days_remaining: 90 },
    { id: 'untrusted', domain: 'nas.example.test', valid_until: timestamp(60), verification_status: 'untrusted', service_name: 'Home NAS', days_remaining: 60 },
    { id: 'soon', domain: 'soon.example.test', valid_until: timestamp(0.25), verification_status: 'verified', service_name: 'Public API', days_remaining: 0 },
    { id: 'expired', domain: 'expired.example.test', valid_until: timestamp(-1), verification_status: 'expired', service_name: 'Legacy website', days_remaining: -1 },
    { id: 'unverified', domain: 'pending.example.test', valid_until: timestamp(20), verification_status: 'unverified', service_name: 'Pending verification', days_remaining: 20 },
    { id: 'future', domain: 'future.example.test', valid_until: timestamp(31), verification_status: 'not_yet_valid', service_name: 'Future deployment', days_remaining: 31 },
    { id: 'unknown', domain: 'unknown.example.test', valid_until: 'invalid-date', verification_status: 'unknown', service_name: 'Missing validity dates', days_remaining: 90 },
].map(certificate => ({
    ...certificate, issuer: 'Example Test CA', subject: certificate.domain,
    valid_from: certificate.id === 'future' ? timestamp(1) : timestamp(-30),
    last_verified_at: timestamp(-0.01), sans: [certificate.domain, 'additional.example.test'],
    serial_number: 'TEST-SERIAL-001', signature_algorithm: 'SHA256-RSA',
}));

const publicCertificates = certificates.map(({ id, domain, issuer, valid_from, valid_until, last_verified_at, service_name, verification_status }) => ({
    id, domain, issuer, valid_from, valid_until, last_verified_at, service_name, verification_status,
}));

function publicFixture(showCertificates: boolean) {
    return {
        page: { name: 'Certificate status', slug: 'tls-demo', layout: 'cards', groups: [], show_certificates: showCertificates },
        monitors: [], incidents: [], maintenance: [], certificates: publicCertificates,
    };
}

test('certificate risk table sorts by expiry and keeps certificate verification separate', async ({ page }) => {
    await page.clock.setFixedTime(now);
    await page.route('**/api/v1/certificates', route => route.fulfill({ json: certificates }));
    await page.goto('/certificates');
    const component = page.getByTestId('tls-certificates');
    const rows = component.getByTestId('tls-certificate');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toHaveAttribute('data-domain', 'expired.example.test');
    const soon = rows.filter({ hasText: 'soon.example.test' });
    await expect(soon).toContainText('Less than 1 day');
    await expect(soon).toContainText('Verified');
    await expect(soon.getByText('Expired', { exact: true })).toHaveCount(0);
    const untrusted = rows.filter({ hasText: 'nas.example.test' });
    await expect(untrusted).toContainText('Untrusted');
    await expect(untrusted).toContainText('60 days');
    await expect(untrusted.getByText('Expired', { exact: true })).toHaveCount(0);
    const future = rows.filter({ hasText: 'future.example.test' });
    await expect(future.locator('.expiry-badge')).toHaveText('Not yet valid');
    await expect(future.locator('.expiry-badge')).toHaveAttribute('data-tone', 'warning');
    const unknown = rows.filter({ hasText: 'unknown.example.test' });
    await expect(unknown.locator('.expiry-badge')).toHaveText('No data');
    await expect(unknown.locator('.expiry-badge')).toHaveAttribute('data-tone', 'neutral');

    const filters = component.getByRole('group', { name: 'Certificate risk filters', exact: true });
    await filters.getByRole('button', { name: 'Expired', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-domain', 'expired.example.test');
    await filters.getByRole('button', { name: 'Within 14 days', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-domain', 'soon.example.test');
    await filters.getByRole('button', { name: 'Unknown / not yet valid', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute('data-domain', 'future.example.test');
    await expect(rows.last()).toHaveAttribute('data-domain', 'unknown.example.test');
    await filters.getByRole('button', { name: 'All', exact: true }).click();
    const search = component.getByLabel('Search certificates', { exact: true });
    await search.fill('HOME NAS');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-domain', 'nas.example.test');
    await rows.first().getByRole('button', { name: 'Certificate details: nas.example.test', exact: true }).click();
    const details = component.getByTestId('tls-certificate-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText('additional.example.test');
    await search.fill('no-matching-certificate');
    await expect(rows).toHaveCount(0);
    await search.clear();
    await expect(rows).toHaveCount(7);
});

test('public certificates require the page toggle and remain readable in both themes on mobile', async ({ page }, info) => {
    await page.clock.setFixedTime(now);
    let enabled = false;
    await page.route('**/api/v1/status-pages/tls-demo', route => route.fulfill({ json: publicFixture(enabled) }));
    await page.goto('/status/tls-demo');
    // 即使响应里意外仍含证书数据，未开启的状态页也不能展示证书区块。
    await expect(page.getByTestId('status-certificates')).toHaveCount(0);
    enabled = true;
    await page.reload();
    await page.getByRole('button', { name: 'Certificate details: expired.example.test', exact: true }).click();
    const details = page.getByTestId('tls-certificate-details');
    await expect(details).toBeVisible();
    // 公开详情仅展示摘要信息，不出现管理端的 SAN、序列号和证书主体字段。
    for (const label of ['SANs:', 'Serial number', 'Subject', 'Signature algorithm']) {
        await expect(details.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const mode of ['light', 'dark']) {
        await page.evaluate(mode => {
            localStorage.setItem('updu_theme', mode);
            localStorage.setItem('updu_language', 'zh-CN');
        }, mode);
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.reload();
        const section = page.getByTestId('status-certificates');
        await expect(section).toBeVisible();
        await expect(section.getByTestId('tls-certificate')).toHaveCount(7);
        if (mode === 'light') await expect(page.locator('html')).toHaveClass(/light/);
        else await expect(page.locator('html')).not.toHaveClass(/light/);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        await page.screenshot({ path: info.outputPath(`public-certificates-${mode}.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        await expect(section.getByTestId('tls-certificate').first()).toBeVisible();
        await page.screenshot({ path: info.outputPath(`public-certificates-${mode}-mobile.png`), fullPage: true });
    }
});

test('administrator can persist and disable public TLS certificate visibility', async ({ page, request, browser }) => {
    const slug = `certificate-toggle-${Date.now()}`;
    let pageID = '';
    try {
        await page.goto('/status-pages');
        await page.getByRole('button', { name: 'New Status Page', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('#sp-name').fill(slug);
        await dialog.locator('#sp-slug').fill(slug);
        const toggle = dialog.getByLabel('Show TLS certificates', { exact: true });
        await expect(toggle).not.toBeChecked();
        await toggle.check();
        const created = page.waitForResponse(response => response.url().endsWith('/api/v1/status-pages') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create Page', exact: true }).click();
        const response = await created;
        expect(response.ok()).toBeTruthy();
        const saved = await response.json();
        pageID = saved.id;
        expect(saved.show_certificates).toBe(true);
        await expect(dialog).toBeHidden();
        await page.reload();
        await page.getByRole('button', { name: `Edit status page ${slug}`, exact: true }).click();
        await expect(toggle).toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

        // 全新匿名上下文验证服务端保存结果，不沿用管理员 Cookie 或本地偏好。
        const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
        try {
            const publicPage = await visitor.newPage();
            await publicPage.goto(`/status/${slug}`);
            await expect(publicPage.getByTestId('status-certificates')).toBeVisible();
            await page.getByRole('button', { name: `Edit status page ${slug}`, exact: true }).click();
            await toggle.uncheck();
            const updated = page.waitForResponse(result => result.url().endsWith(`/api/v1/status-pages/${pageID}`) && result.request().method() === 'PUT');
            await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
            expect((await updated).ok()).toBeTruthy();
            await expect(dialog).toBeHidden();
            await publicPage.reload();
            await expect(publicPage.getByTestId('status-certificates')).toHaveCount(0);
        } finally { await visitor.close(); }
    } finally {
        if (pageID) await request.delete(`/api/v1/status-pages/${pageID}`).catch(() => {});
    }
});
