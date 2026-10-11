<script lang="ts">
    import { onMount } from 'svelte';
    import { ChevronDown, Search, ShieldCheck, ShieldAlert, Lock } from 'lucide-svelte';
    import { t, languageStore } from '$lib/i18n/index.svelte';
    import { certificateExpiry, certificateVerification, verificationLabels, type CertificateDisplay, type CertificateRisk, type CertificateVerification } from '$lib/tls-certificate';
    import type { TLSCertificate } from '$lib/api/certificates';

    let { certificates, publicView = false } = $props<{ certificates: CertificateDisplay[]; publicView?: boolean }>();
    type CertificateRow = { certificate: CertificateDisplay; expiry: ReturnType<typeof certificateExpiry>; verification: CertificateVerification };
    type RiskCounts = Record<CertificateRisk | 'all', number>;
    let query = $state('');
    let selectedRisk = $state<CertificateRisk | 'all'>('all');
    let expanded = $state<Set<string>>(new Set());
    let now = $state(Date.now());
    const filters: { value: CertificateRisk | 'all'; label: string }[] = [
        { value: 'all', label: 'All' }, { value: 'expired', label: 'Expired' },
        { value: 'critical', label: 'Within 14 days' }, { value: 'soon', label: '15–30 days' },
        { value: 'healthy', label: 'Over 30 days' }, { value: 'review', label: 'Unknown / not yet valid' },
    ];

    // 到期时间不依赖后台重新采集；长时间打开状态页也会更新剩余时间和排序。
    onMount(() => {
        const timer = window.setInterval(() => { now = Date.now(); }, 60_000);
        return () => window.clearInterval(timer);
    });
    const rows = $derived<CertificateRow[]>(certificates.map((certificate: CertificateDisplay) => ({ certificate, expiry: certificateExpiry(certificate, now), verification: certificateVerification(certificate) })));
    const counts = $derived.by((): RiskCounts => {
        const result: RiskCounts = { all: rows.length, expired: 0, critical: 0, soon: 0, healthy: 0, review: 0 };
        for (const row of rows) result[row.expiry.risk]++;
        return result;
    });
    const visibleRows = $derived(rows.filter(row => {
        const text = `${row.certificate.domain} ${row.certificate.issuer} ${row.certificate.service_name ?? ''}`.toLowerCase();
        return (selectedRisk === 'all' || row.expiry.risk === selectedRisk) && text.includes(query.trim().toLowerCase());
    }).sort((a, b) => a.expiry.order - b.expiry.order || (a.expiry.expiresAt || Infinity) - (b.expiry.expiresAt || Infinity) || a.certificate.domain.localeCompare(b.certificate.domain)));

    function formatDate(value: string, includeTime = false) {
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return t('No data');
        return new Date(timestamp).toLocaleString(languageStore.current, includeTime
            ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function toggle(id: string) {
        const next = new Set(expanded);
        if (next.has(id)) next.delete(id); else next.add(id);
        expanded = next;
    }
    function adminDetails(certificate: CertificateDisplay): TLSCertificate | null {
        return !publicView && 'sans' in certificate ? certificate : null;
    }
</script>

<div class="certificate-panel" data-testid="tls-certificates">
    <div class="panel-toolbar">
        <div class="summary" aria-live="polite">
            <span class="summary-count"><Lock size={14} aria-hidden="true" />{t('{count} certificates', { count: certificates.length })}</span>
            {#if counts.expired}<span class="risk-text" data-tone="danger">{t('{count} expired', { count: counts.expired })}</span>{/if}
            {#if counts.critical}<span class="risk-text" data-tone="warning">{t('{count} expiring within 14 days', { count: counts.critical })}</span>{/if}
        </div>
        <label class="search-box">
            <Search size={15} aria-hidden="true" />
            <span class="sr-only">{t('Search certificates')}</span>
            <input type="search" bind:value={query} placeholder={t('Domain, issuer, or service')} />
        </label>
    </div>

    <div class="filter-row" role="group" aria-label={t('Certificate risk filters')}>
        {#each filters as filter}
            {#if filter.value !== 'review' || counts.review > 0 || selectedRisk === 'review'}
                <button type="button" class:active={selectedRisk === filter.value} aria-label={t(filter.label)} aria-pressed={selectedRisk === filter.value} onclick={() => selectedRisk = filter.value}>
                    {t(filter.label)}<span aria-hidden="true">{counts[filter.value]}</span>
                </button>
            {/if}
        {/each}
    </div>

    {#if visibleRows.length}
        <table aria-label={t('TLS certificates')}>
            <colgroup><col class="domain-column" /><col class="issuer-column" /><col class="date-column" /><col class="remaining-column" /></colgroup>
            <thead><tr><th scope="col">{t('Domain / service')}</th><th scope="col">{t('Issuer / verification')}</th><th scope="col">{t('Expires on')}</th><th scope="col">{t('Time remaining')}</th></tr></thead>
            <tbody>
                {#each visibleRows as { certificate, expiry, verification } (certificate.id)}
                    {@const isExpanded = expanded.has(certificate.id)}
                    <tr class="certificate-row" data-testid="tls-certificate" data-domain={certificate.domain}>
                        <td class="domain-cell">
                            <button type="button" class="domain-button" aria-label={t('Certificate details: {domain}', { domain: certificate.domain })} aria-expanded={isExpanded} onclick={() => toggle(certificate.id)}>
                                <span class="domain-copy"><strong>{certificate.domain}</strong><small>{certificate.service_name || t('Standalone certificate')}</small></span>
                                <span class="chevron" class:expanded={isExpanded} aria-hidden="true"><ChevronDown size={15} /></span>
                            </button>
                        </td>
                        <td class="issuer-cell">
                            <span class="issuer-name" title={certificate.issuer}>{certificate.issuer || t('No data')}</span>
                            <span class="verification" data-tone={verification === 'untrusted' || verification === 'expired' ? 'danger' : verification === 'not_yet_valid' ? 'warning' : 'neutral'}>
                                {#if verification === 'verified'}<ShieldCheck size={12} aria-hidden="true" />{:else if verification === 'untrusted' || verification === 'expired'}<ShieldAlert size={12} aria-hidden="true" />{/if}
                                {t(verificationLabels[verification])}
                            </span>
                        </td>
                        <td class="date-cell"><span class="mobile-label">{t('Expires on')}</span><time datetime={certificate.valid_until}>{formatDate(certificate.valid_until)}</time></td>
                        <td class="remaining-cell"><span class="expiry-badge" data-tone={expiry.tone}>{t(expiry.label, { count: expiry.days })}</span></td>
                    </tr>
                    {#if isExpanded}
                        {@const admin = adminDetails(certificate)}
                        <tr class="details-row" data-testid="tls-certificate-details"><td colspan="4">
                            <dl>
                                <div><dt>{t('Domain')}</dt><dd>{certificate.domain}</dd></div>
                                <div><dt>{t('Service')}</dt><dd>{certificate.service_name || t('Standalone certificate')}</dd></div>
                                <div><dt>{t('Issuer')}</dt><dd>{certificate.issuer || t('No data')}</dd></div>
                                <div><dt>{t('Valid from')}</dt><dd>{formatDate(certificate.valid_from, true)}</dd></div>
                                <div><dt>{t('Expires on')}</dt><dd>{formatDate(certificate.valid_until, true)}</dd></div>
                                <div><dt>{t('Last checked')}</dt><dd>{formatDate(certificate.last_verified_at, true)}</dd></div>
                                <div><dt>{t('Verification')}</dt><dd>{t(verificationLabels[verification])}</dd></div>
                                {#if admin}
                                    <div><dt>{t('Subject')}</dt><dd>{admin.subject || t('No data')}</dd></div>
                                    <div><dt>{t('Signature algorithm')}</dt><dd>{admin.signature_algorithm || t('No data')}</dd></div>
                                    <div><dt>{t('Serial number')}</dt><dd class="mono">{admin.serial_number || t('No data')}</dd></div>
                                    <div class="sans"><dt>{t('SANs:')}</dt><dd>{admin.sans?.join(', ') || t('No data')}</dd></div>
                                {/if}
                            </dl>
                            <p class="verification-note">{t('Verification reflects the last TLS check; expiration is calculated from the certificate validity period.')}</p>
                        </td></tr>
                    {/if}
                {/each}
            </tbody>
        </table>
    {:else}
        <div class="empty-state"><Lock size={24} aria-hidden="true" /><p>{t(certificates.length ? 'No matching certificates' : publicView ? 'No certificates linked to the selected services yet' : 'No certificates discovered yet')}</p></div>
    {/if}
</div>

<style>
    .certificate-panel { min-width: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-surface); color: var(--color-text); }
    .panel-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 18px 12px; }
    .summary { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; }
    .summary-count { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }
    .risk-text { font-size: 11px; }
    .search-box { display: flex; align-items: center; gap: 8px; width: 270px; max-width: 100%; flex-shrink: 0; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 9px; color: var(--color-text-muted); background: var(--color-surface-elevated); }
    .search-box:focus-within { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .search-box input { width: 100%; min-width: 0; outline: none; background: transparent; color: var(--color-text); font-size: 12px; }
    .search-box input::placeholder { color: var(--color-text-muted); }
    .filter-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 18px 14px; }
    .filter-row button { display: inline-flex; align-items: center; gap: 7px; padding: 5px 9px; min-height: 30px; border: 1px solid transparent; border-radius: 7px; color: var(--color-text-muted); font-size: 11px; cursor: pointer; }
    .filter-row button:hover, .filter-row button.active { background: var(--color-surface-elevated); color: var(--color-text); border-color: var(--color-border); }
    .filter-row button.active { font-weight: 600; }
    .filter-row button span { opacity: .65; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .domain-column { width: 34%; } .issuer-column { width: 29%; } .date-column { width: 20%; } .remaining-column { width: 17%; }
    th { padding: 10px 18px; text-align: left; font-weight: 500; color: var(--color-text-muted); font-size: 11px; background: var(--color-surface-elevated); border-top: 1px solid var(--color-border); }
    th:last-child { text-align: right; }
    .certificate-row td { padding: 13px 18px; border-top: 1px solid var(--color-border); font-size: 12px; }
    .certificate-row:hover { background: var(--color-surface-elevated); }
    .domain-button { width: 100%; display: flex; align-items: center; gap: 12px; justify-content: space-between; text-align: left; cursor: pointer; border-radius: 4px; }
    .domain-button:focus-visible, .filter-row button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
    .domain-copy { min-width: 0; }
    .domain-copy strong, .domain-copy small, .issuer-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .domain-copy strong { font-weight: 600; font-size: 12px; }
    .domain-copy small { margin-top: 3px; color: var(--color-text-muted); font-size: 11px; }
    .chevron { flex-shrink: 0; color: var(--color-text-muted); transition: transform 150ms; }
    .chevron.expanded { transform: rotate(180deg); }
    .verification { display: inline-flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 10px; }
    .remaining-cell { text-align: right; }
    .expiry-badge { display: inline-flex; align-items: center; padding: 4px 7px; border-radius: 6px; background: color-mix(in srgb, currentColor 9%, transparent); font-size: 10px; font-weight: 600; text-align: center; }
    [data-tone='danger'] { color: #fb7185; } [data-tone='warning'] { color: #fbbf24; } [data-tone='positive'] { color: #34d399; } [data-tone='neutral'] { color: var(--color-text-muted); }
    :global(html.light) [data-tone='danger'] { color: #be123c; } :global(html.light) [data-tone='warning'] { color: #92400e; } :global(html.light) [data-tone='positive'] { color: #047857; }
    .mobile-label { display: none; }
    .details-row td { padding: 16px 18px; border-top: 1px solid var(--color-border); background: var(--color-surface-elevated); }
    dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 24px; }
    dt { color: var(--color-text-muted); font-size: 10px; margin-bottom: 4px; }
    dd { font-size: 11px; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, monospace; }
    .sans { grid-column: 1 / -1; }
    .verification-note { margin-top: 14px; color: var(--color-text-muted); font-size: 10px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; border-top: 1px solid var(--color-border); color: var(--color-text-muted); padding: 35px 18px; text-align: center; font-size: 12px; }
    @media (max-width: 767px) {
        .panel-toolbar { align-items: stretch; flex-direction: column; gap: 12px; padding: 14px; }
        .search-box { width: 100%; }
        .filter-row { padding: 0 14px 12px; }
        .filter-row button { min-height: 36px; }
        table, tbody { display: block; }
        colgroup { display: none; }
        thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        .certificate-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px 12px; padding: 14px; border-top: 1px solid var(--color-border); }
        .certificate-row td { display: block; padding: 0; border: 0; min-width: 0; }
        .domain-cell { grid-column: 1; grid-row: 1; }
        .remaining-cell { grid-column: 2; grid-row: 1; align-self: start; }
        .issuer-cell { grid-column: 1; grid-row: 2; }
        .date-cell { grid-column: 2; grid-row: 2; text-align: right; font-size: 10px !important; }
        .mobile-label { display: block; margin-bottom: 4px; color: var(--color-text-muted); font-size: 10px; }
        .domain-button { min-height: 36px; }
        .details-row, .details-row td { display: block; }
        .details-row td { padding: 14px; }
        dl { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    }
</style>
