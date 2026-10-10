import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginThroughUI, createAuthenticatedRequestContext } from './helpers/auth';
import {
    clearIncidents,
    clearMonitors,
    clearStatusPages,
    createMonitor,
    listMonitors,
} from './helpers/api';
import { appBaseUrl, fixtureBaseUrl } from './helpers/env';

function monitorRows(page: Page): Locator {
    return page.locator('[data-testid^="monitor-row-"]');
}

async function monitorNames(page: Page): Promise<string[]> {
    return page
        .locator('[data-testid^="monitor-row-"] td:nth-child(2) a')
        .allTextContents();
}

async function documentOverflow(page: Page): Promise<number> {
    return page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
}

test.describe('monitors', () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async () => {
        const api = await createAuthenticatedRequestContext();
        await clearStatusPages(api);
        await clearIncidents(api);
        await clearMonitors(api);
        await api.dispose();
    });

    test.afterEach(async () => {
        const api = await createAuthenticatedRequestContext();
        await clearStatusPages(api);
        await clearIncidents(api);
        await clearMonitors(api);
        await api.dispose();
    });

    test('monitor list search, sorting, and empty state are stable', async ({ page }) => {
        await loginThroughUI(page);
        await page.route('**/api/v1/dashboard', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    monitors: [
                        {
                            id: 'alpha-fast',
                            name: 'Alpha Fast',
                            type: 'http',
                            groups: ['Core'],
                            enabled: true,
                            interval_s: 10,
                            status: 'up',
                            last_latency_ms: 80,
                            recent_checks: [
                                {
                                    status: 'up',
                                    latency_ms: 80,
                                    checked_at: '2026-04-28T06:00:00Z',
                                },
                            ],
                        },
                        {
                            id: 'bravo-slow',
                            name: 'Bravo Slow',
                            type: 'http',
                            groups: ['Core'],
                            enabled: true,
                            interval_s: 10,
                            status: 'up',
                            last_latency_ms: 1200,
                            recent_checks: [
                                {
                                    status: 'up',
                                    latency_ms: 1200,
                                    checked_at: '2026-04-28T06:00:00Z',
                                },
                            ],
                        },
                        {
                            id: 'charlie-down',
                            name: 'Charlie Down',
                            type: 'http',
                            groups: ['Core'],
                            enabled: true,
                            interval_s: 10,
                            status: 'down',
                            recent_checks: [
                                {
                                    status: 'down',
                                    checked_at: '2026-04-28T06:00:00Z',
                                },
                            ],
                        },
                    ],
                }),
            });
        });
        await page.goto('/monitors');
        await expect(
            page.getByRole('heading', { name: 'Services', level: 1 }),
        ).toBeVisible();
        await expect(monitorRows(page)).toHaveCount(3);

        await page.getByTestId('search-services').fill('bravo');
        await expect(monitorRows(page)).toHaveCount(1);
        await expect(monitorRows(page).first()).toContainText('Bravo Slow');

        await page.getByTestId('search-services').fill('missing-monitor');
        await expect(page.getByTestId('services-empty-state')).toContainText(
            'No services matching "missing-monitor"',
        );

        await page.getByTestId('search-services').fill('');
        await expect(monitorRows(page)).toHaveCount(3);

        await page.getByTestId('sort-name').click();
        await expect(await monitorNames(page)).toEqual([
            'Alpha Fast',
            'Bravo Slow',
            'Charlie Down',
        ]);

        await page.getByTestId('sort-name').click();
        await expect(await monitorNames(page)).toEqual([
            'Charlie Down',
            'Bravo Slow',
            'Alpha Fast',
        ]);

        await page.getByTestId('sort-status').click();
        await expect(monitorRows(page).first()).toContainText('Charlie Down');

        await page.getByTestId('sort-latency').click();
        const latencyAscending = await monitorNames(page);
        await expect(
            latencyAscending.indexOf('Alpha Fast'),
        ).toBeLessThan(latencyAscending.indexOf('Bravo Slow'));

        await page.getByTestId('sort-latency').click();
        const latencyDescending = await monitorNames(page);
        await expect(
            latencyDescending.indexOf('Alpha Fast'),
        ).toBeGreaterThan(latencyDescending.indexOf('Bravo Slow'));
    });

    test('monitor CRUD works through the UI', async ({ page }) => {
        await loginThroughUI(page);
        await page.goto('/monitors');

        await page.getByRole('button', { name: 'New Service' }).click();
        const createDialog = page.getByRole('dialog', {
            name: 'Add New Monitor',
        });

        await createDialog.locator('#cm-name').fill('UI HTTP Monitor');
        await createDialog.locator('#cm-host').fill(`${fixtureBaseUrl}/ok`);
        const createResponsePromise = page.waitForResponse(
            (response) =>
                response.url().includes('/api/v1/monitors') &&
                response.request().method() === 'POST',
        );
        await createDialog.locator('form').evaluate((form) => {
            (form as HTMLFormElement).requestSubmit();
        });
        const createResponse = await createResponsePromise;
        expect(createResponse.ok()).toBeTruthy();
        const createdMonitor = (await createResponse.json()) as { id: string };
        const monitorUrlSuffix = `/api/v1/monitors/${createdMonitor.id}`;
        await expect(createDialog).toBeHidden();

        const createdRow = monitorRows(page).filter({ hasText: 'UI HTTP Monitor' });
        await expect(createdRow).toHaveCount(1);

        await createdRow.locator('[data-testid^="monitor-actions-"]').click();
        await page.getByRole('menuitem', { name: 'Edit' }).click();

        const editDialog = page.getByRole('dialog', { name: 'Edit Monitor' });
        await editDialog.locator('#em-name').fill('UI HTTP Monitor Updated');
        await editDialog.locator('#em-host').fill(`${fixtureBaseUrl}/ok`);
        const updateResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith(monitorUrlSuffix) &&
                response.request().method() === 'PUT',
        );
        await editDialog.locator('form').evaluate((form) => {
            (form as HTMLFormElement).requestSubmit();
        });
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok()).toBeTruthy();
        await expect(editDialog).toBeHidden();

        const updatedRow = monitorRows(page).filter({
            hasText: 'UI HTTP Monitor Updated',
        });
        await expect(updatedRow).toHaveCount(1);
        await expect(updatedRow).toContainText(/paused/i);

        const resumeResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith(monitorUrlSuffix) &&
                response.request().method() === 'PUT',
        );
        await updatedRow.locator('[data-testid^="monitor-actions-"]').click();
        await page.getByRole('menuitem', { name: 'Resume' }).click();
        const resumeResponse = await resumeResponsePromise;
        expect(resumeResponse.ok()).toBeTruthy();
        await expect(updatedRow).not.toContainText(/paused/i, { timeout: 10000 });

        const deleteResponsePromise = page.waitForResponse(
            (response) =>
                response.url().endsWith(monitorUrlSuffix) &&
                response.request().method() === 'DELETE',
        );
        await updatedRow.locator('[data-testid^="monitor-actions-"]').click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        // 服务列表使用统一确认弹窗，仍须确认后才能删除。
        const deleteDialog = page.getByRole('dialog', { name: 'Delete service?' });
        await deleteDialog.getByLabel('Type DELETE to confirm').fill('DELETE');
        await deleteDialog.getByRole('button', { name: 'Delete service' }).click();
        const deleteResponse = await deleteResponsePromise;
        expect(deleteResponse.ok()).toBeTruthy();
        await expect(updatedRow).toHaveCount(0);
    });

    test('push monitors can set a late check-in tolerance through the UI', async ({ page }) => {
        await loginThroughUI(page);
        await page.goto('/monitors');

        await page.getByRole('button', { name: 'New Service' }).click();
        const createDialog = page.getByRole('dialog', {
            name: 'Add New Monitor',
        });

        await createDialog.locator('#cm-name').fill('UI Push Monitor');
        await createDialog.getByRole('radio', { name: /push/i }).click();
        await createDialog.locator('#cm-host').fill('ui-push-monitor-token');
        await createDialog.getByLabel('Late Check-in Tolerance').fill('90');
        await expect(createDialog).toContainText('Passive Behavior');
        await expect(createDialog).toContainText('2m 30s');

        const createResponsePromise = page.waitForResponse(
            (response) =>
                response.url().includes('/api/v1/monitors') &&
                response.request().method() === 'POST',
        );
        await createDialog.locator('form').evaluate((form) => {
            (form as HTMLFormElement).requestSubmit();
        });
        const createResponse = await createResponsePromise;
        expect(createResponse.ok()).toBeTruthy();

        const createdMonitor = (await createResponse.json()) as { id: string };
        await expect(createDialog).toBeHidden();

        await page.goto(`/monitors/${createdMonitor.id}`);
        await page.getByRole('button', { name: /detailed config/i }).click();
        const details = page.getByTestId('monitor-check-details');
        await expect(details).toContainText('Late Check-in Tolerance');
        await expect(details).toContainText('1m 30s');
        await expect(details).toContainText('No check-in for 2m 30s');
    });

    test('monitor details explain what each monitor actually checks', async ({ page }) => {
        const api = await createAuthenticatedRequestContext();
        const httpMonitor = await createMonitor(api, {
            name: 'HTTP Detail Monitor',
            type: 'http',
            config: {
                url: `${fixtureBaseUrl}/ok`,
                method: 'GET',
                expected_status: 200,
            },
        });
        // 只测试当前支持的核心类型，TCP 与 HTTP 都需展示实际配置。
        const tcpMonitor = await createMonitor(api, {
            name: 'TCP Detail Monitor',
            type: 'tcp',
            config: {
                host: '127.0.0.1',
                port: Number(new URL(fixtureBaseUrl).port),
            },
        });
        await api.dispose();

        await loginThroughUI(page);

        await page.goto(`/monitors/${httpMonitor.id}`);
        await expect(
            page.getByRole('heading', { name: 'HTTP Detail Monitor', level: 1 }),
        ).toBeVisible();
        const httpSummary = page.getByTestId('monitor-check-summary');
        await expect(httpSummary).toContainText('GET');
        await expect(httpSummary).toContainText(`${fixtureBaseUrl}/ok`);
        await expect(httpSummary).toContainText('200');

        await page.getByRole('button', { name: /detailed config/i }).click();
        const httpDetails = page.getByTestId('monitor-check-details');
        await expect(httpDetails).toContainText('URL');
        await expect(httpDetails).toContainText(`${fixtureBaseUrl}/ok`);

        await page.goto(`/monitors/${tcpMonitor.id}`);
        await expect(
            page.getByRole('heading', {
                name: 'TCP Detail Monitor',
                level: 1,
            }),
        ).toBeVisible();
        const tcpSummary = page.getByTestId('monitor-check-summary');
        await expect(tcpSummary).toContainText(`127.0.0.1:${new URL(fixtureBaseUrl).port}`);

        await page.getByRole('button', { name: /detailed config/i }).click();
        const tcpDetails = page.getByTestId('monitor-check-details');
        await expect(tcpDetails).toContainText('Host');
        await expect(tcpDetails).toContainText('127.0.0.1');
        await expect(tcpDetails).toContainText('Port');
        await expect(tcpDetails).toContainText(new URL(fixtureBaseUrl).port);
    });

    test('monitor details surface latest HTTPS certificate basics', async ({ page }) => {
        const monitorId = 'https-runtime-monitor';
        const monitorUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}`;
        const checksUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/checks`;
        const uptimeUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/uptime`;
        const eventsUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/events?limit=5`;

        await loginThroughUI(page);

        await page.route(monitorUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: monitorId,
                    name: 'HTTPS Runtime Monitor',
                    type: 'https',
                    config: {
                        url: 'https://secure.example.test/health',
                        method: 'GET',
                        expected_status: 200,
                        warn_days: 14,
                    },
                    groups: ['Core'],
                    interval_s: 60,
                    enabled: true,
                    status: 'degraded',
                    last_check: '2026-04-18T12:00:00Z',
                    last_latency_ms: 182,
                }),
            });
        });

        await page.route(checksUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        id: 1,
                        monitor_id: monitorId,
                        status: 'degraded',
                        latency_ms: 182,
                        status_code: 200,
                        message: 'TLS certificate expires in 9 day(s)',
                        metadata: {
                            cert_not_after: '2026-04-27T00:00:00Z',
                            cert_not_before: '2026-01-01T00:00:00Z',
                            cert_days_remaining: 9,
                            cert_subject: 'CN=secure.example.test',
                            cert_issuer: 'CN=Acme Root',
                            cert_warn_days: 14,
                            cert_serial_number: '01A2B3C4',
                            cert_fingerprint_sha256:
                                '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                            cert_signature_algorithm: 'SHA256-RSA',
                            cert_public_key_algorithm: 'RSA',
                            cert_public_key_bits: 2048,
                            cert_dns_names: ['secure.example.test', 'api.example.test'],
                            cert_ip_addresses: ['127.0.0.1'],
                            cert_tls_verification_mode: 'skipped',
                            cert_tls_verified: false,
                            cert_chain_length: 2,
                            cert_chain_summary: [
                                'CN=secure.example.test',
                                'CN=Acme Root',
                            ],
                        },
                        checked_at: '2026-04-18T12:00:00Z',
                    },
                ]),
            });
        });

        await page.route(uptimeUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    '24h': 99.98,
                    '7d': 99.91,
                    '30d': 99.87,
                }),
            });
        });

        await page.route(eventsUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        });

        await page.goto(`/monitors/${monitorId}`);
        await expect(
            page.getByRole('heading', { name: 'HTTPS Runtime Monitor', level: 1 }),
        ).toBeVisible();

        const basics = page.getByTestId('monitor-current-basics');
        await expect(basics).toContainText('Cert Expires');
        await expect(page.getByTestId('monitor-basic-certificate-expires')).toContainText(
            '2026-04-27',
        );
        await expect(page.getByTestId('monitor-basic-days-left')).toContainText('9');
        await page.getByRole('button', { name: /detailed config/i }).click();
        const details = page.getByTestId('monitor-check-details');
        // 验证方式位于展开后的 TLS 详情，基本信息只展示到期时间。
        await expect(details).toContainText('TLS Certificate');
        await expect(details).toContainText('Verification');
        await expect(details).toContainText('Skipped');
        await expect(details).toContainText('CN=secure.example.test');
        await expect(details).toContainText('CN=Acme Root');
        await expect(details).toContainText('RSA');
        await expect(details).toContainText('2048');
        await expect(details).toContainText('secure.example.test');
        await expect(details).toContainText('api.example.test');
    });

    test('monitor detail uses a two-column layout on wide screens', async ({ page }) => {
        const monitorId = 'detail-layout-monitor';
        const monitorUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}`;
        const checksUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/checks`;
        const uptimeUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/uptime`;
        const eventsUrl = `${appBaseUrl}/api/v1/monitors/${monitorId}/events?limit=5`;

        await loginThroughUI(page);

        await page.route(monitorUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: monitorId,
                    name: 'Detail Layout Monitor',
                    type: 'http',
                    config: {
                        url: 'https://layout.example.test/health',
                        method: 'GET',
                        expected_status: 200,
                    },
                    groups: ['Core'],
                    interval_s: 60,
                    enabled: true,
                    status: 'up',
                    last_check: '2026-04-28T06:00:00Z',
                    last_latency_ms: 157,
                }),
            });
        });

        await page.route(checksUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        id: 1,
                        monitor_id: monitorId,
                        status: 'up',
                        latency_ms: 157,
                        status_code: 200,
                        message: 'OK',
                        checked_at: '2026-04-28T06:00:00Z',
                    },
                    {
                        id: 2,
                        monitor_id: monitorId,
                        status: 'up',
                        latency_ms: 181,
                        status_code: 200,
                        message: 'OK',
                        checked_at: '2026-04-28T05:59:00Z',
                    },
                ]),
            });
        });

        await page.route(uptimeUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ '24h': 100, '7d': 99.99, '30d': 99.97 }),
            });
        });

        await page.route(eventsUrl, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        });

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/monitors/${monitorId}`);
        await expect(
            page.getByRole('heading', { name: 'Detail Layout Monitor', level: 1 }),
        ).toBeVisible();

        const primary = page.getByTestId('monitor-detail-primary');
        const secondary = page.getByTestId('monitor-detail-secondary');
        await expect(primary).toBeVisible();
        await expect(secondary).toBeVisible();

        const isSideBySide = async (): Promise<boolean> => {
            const primaryBox = await primary.boundingBox();
            const secondaryBox = await secondary.boundingBox();
            if (!primaryBox || !secondaryBox) return false;
            return (
                secondaryBox.x > primaryBox.x + primaryBox.width - 4 &&
                Math.abs(primaryBox.y - secondaryBox.y) <= 4
            );
        };

        const isStacked = async (): Promise<boolean> => {
            const primaryBox = await primary.boundingBox();
            const secondaryBox = await secondary.boundingBox();
            if (!primaryBox || !secondaryBox) return false;
            return secondaryBox.y > primaryBox.y + primaryBox.height - 4;
        };

        await expect.poll(isSideBySide).toBe(true);
        await expect(await documentOverflow(page)).toBeLessThanOrEqual(5);

        await page.setViewportSize({ width: 1280, height: 900 });
        await expect.poll(isSideBySide).toBe(true);
        await expect(await documentOverflow(page)).toBeLessThanOrEqual(5);

        await page.setViewportSize({ width: 768, height: 900 });
        await expect.poll(isStacked).toBe(true);
        await expect(await documentOverflow(page)).toBeLessThanOrEqual(5);
    });

    test('push monitor explains its check-in workflow clearly', async ({ page }) => {
        const api = await createAuthenticatedRequestContext();
        const pushMonitor = await createMonitor(api, {
            name: 'Push Detail Monitor',
            type: 'push',
            config: {
                token: 'e2e-push-token-abc123',
                grace_period_s: 60,
            },
        });
        await api.dispose();

        await loginThroughUI(page);
        await page.goto(`/monitors/${pushMonitor.id}`);
        await expect(
            page.getByRole('heading', { name: 'Push Detail Monitor', level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        const pingUrl = page.getByTestId('monitor-push-url');
        await expect(pingUrl).toBeVisible();
        await expect(pingUrl).toContainText('/heartbeat/e2e-push-token-abc123');

        const curlSnippet = page.getByTestId('monitor-push-curl');
        await expect(curlSnippet).toContainText('/heartbeat/e2e-push-token-abc123');
        await expect(curlSnippet).not.toContainText(`/api/v1/heartbeat/${pushMonitor.id}`);

        await page.getByRole('button', { name: /detailed config/i }).click();
        const details = page.getByTestId('monitor-check-details');
        await expect(details).toContainText('Check-In Endpoints');
        await expect(details).toContainText('Recommended Endpoint');
        await expect(details).toContainText('Legacy Slug Endpoint');
        await expect(details).toContainText('Late Check-in Tolerance');
        await expect(details).toContainText('1m');
        await expect(details).toContainText('No check-in for 1m 10s');

        await expect(
            page.getByRole('button', { name: /copy.*check-in url/i }).first(),
        ).toBeVisible();
    });

    test('removed monitor types are rejected without creating records', async () => {
        const api = await createAuthenticatedRequestContext();
        try {
            // 删除的类型应返回明确错误，不能静默创建不可执行的监控。
            for (const type of ['transaction', 'composite']) {
                const response = await api.post('/api/v1/monitors', {
                    data: { name: `Unsupported ${type}`, type, interval_s: 10, config: {} },
                });
                expect(response.status()).toBe(400);
                expect(await response.json()).toEqual({ error: `unknown monitor type: ${type}` });
            }
            expect(await listMonitors(api)).toEqual([]);
        } finally {
            await api.dispose();
        }
    });

    test('edit failures surface a user-visible error', async ({ page }) => {
        const api = await createAuthenticatedRequestContext();
        const monitor = await createMonitor(api, {
            name: 'Edit Failure Monitor',
            type: 'http',
            config: {
                url: `${fixtureBaseUrl}/ok`,
                method: 'GET',
                expected_status: 200,
            },
        });
        await api.dispose();

        await loginThroughUI(page);
        await page.goto('/monitors');

        const monitorDetailUrl = `${appBaseUrl}/api/v1/monitors/${monitor.id}`;
        await page.route(monitorDetailUrl, async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Failed to load monitor details' }),
            });
        });

        const monitorRow = monitorRows(page).filter({
            hasText: 'Edit Failure Monitor',
        });
        await expect(monitorRow).toHaveCount(1, { timeout: 10000 });

        await monitorRow.locator('[data-testid^="monitor-actions-"]').click();
        const failedResponsePromise = page.waitForResponse(
            (response) =>
                response.url() === monitorDetailUrl &&
                response.request().method() === 'GET',
        );
        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toContain('Failed to load monitor details');
            await dialog.accept();
        });
        await page.getByRole('menuitem', { name: 'Edit' }).click();
        const failedResponse = await failedResponsePromise;
        expect(failedResponse.status()).toBe(500);
        await expect(page.getByRole('dialog', { name: 'Edit Monitor' })).toHaveCount(0);
    });
});
