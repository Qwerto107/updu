<script lang="ts">
    import { ChevronDown } from 'lucide-svelte';
    import { t, languageStore } from '$lib/i18n/index.svelte';
    import type { StatusLayout } from '$lib/status-layout';

    type Bucket = { start: string; status: string; samples: number; uptime: number | null; latency_ms: number | null };
    let { monitor, layout = 'cards' } = $props<{ monitor: any; layout?: StatusLayout }>();
    let expanded = $state(false);
    let history = $derived<Bucket[]>(monitor.history ?? []);
    const labels: Record<string, string> = { up: 'Operational', down: 'Outage', degraded: 'Degraded', paused: 'Paused', pending: 'Pending', unknown: 'No data' };
    function label(status: string) { return t(labels[status] ?? 'Unknown'); }
    function tone(status: string) {
        return status === 'up' ? 'bg-emerald-500' : status === 'down' ? 'bg-red-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-slate-600 light:bg-slate-300';
    }
    function date(value: string) { return new Date(value).toLocaleString(languageStore.current); }
    function tooltip(bucket: Bucket) {
        return `${date(bucket.start)} · ${label(bucket.status)} · ${bucket.samples} ${t('Checks')}${bucket.uptime == null ? '' : ` · ${bucket.uptime.toFixed(2)}%`}`;
    }
    let uptime = $derived(monitor.uptime_24h == null ? t('No data') : `${monitor.uptime_24h.toFixed(2)}%`);
    let latency = $derived(monitor.last_latency_ms == null ? '—' : `${monitor.last_latency_ms} ms`);
    let maxLatency = $derived(Math.max(1, ...history.map(bucket => bucket.latency_ms ?? 0)));
    // 缺测时断开折线，避免把没有采集的时段画成连续在线。
    let segments = $derived.by(() => {
        const groups: string[][] = [];
        let points: string[] = [];
        history.forEach((bucket, i) => {
            if (bucket.latency_ms == null) {
                if (points.length) groups.push(points);
                points = [];
            } else {
                points.push(`${4 + i / Math.max(1, history.length - 1) * 292},${48 - bucket.latency_ms / maxLatency * 40}`);
            }
        });
        if (points.length) groups.push(points);
        return groups;
    });
</script>

{#snippet historyBar()}
    <div class="flex gap-0.5 h-3.5 min-w-0" role="img" aria-label={t('Status history · last 24 hours')}>
        {#each history as bucket}
            <div class={`flex-1 min-w-0 rounded-[2px] transition-opacity hover:opacity-70 ${tone(bucket.status)}`} title={tooltip(bucket)}></div>
        {/each}
        {#if !history.length}<span class="text-[11px] text-text-muted">{t('No data')}</span>{/if}
    </div>
{/snippet}

{#snippet nameButton()}
    <button class="flex w-full min-w-0 items-center justify-between gap-2 rounded text-left text-text hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={t('Service details: {name}', { name: monitor.name })} aria-expanded={expanded}
        onclick={() => expanded = !expanded}>
        <span class="truncate font-medium text-sm" title={monitor.name}>{monitor.name}</span>
        <ChevronDown class={`size-3.5 shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
{/snippet}

{#snippet statusLabel()}
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-text-muted">
        <span class={`size-1.5 shrink-0 rounded-full ${tone(monitor.status)}`}></span>{label(monitor.status)}
    </span>
{/snippet}

{#snippet details()}
    <div class="space-y-3 text-xs" data-testid="status-monitor-details">
        <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 text-text-muted">
            <span>{t('Last checked')}: <span class="text-text">{monitor.last_check ? date(monitor.last_check) : t('No data')}</span></span>
            <span>{t('Service type')}: <span class="uppercase text-text">{monitor.type}</span></span>
        </div>
        <div class="text-text-muted">{t('Successful probe latency · 24 hours')}</div>
        {#if segments.length}
            <svg viewBox="0 0 300 54" class="w-full h-14 text-primary" preserveAspectRatio="none" role="img" aria-label={t('Successful probe latency · 24 hours')}>
                {#each segments as points}
                    {#if points.length === 1}
                        <circle cx={points[0].split(',')[0]} cy={points[0].split(',')[1]} r="2" fill="currentColor" />
                    {:else}
                        <polyline points={points.join(' ')} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
                    {/if}
                {/each}
            </svg>
        {:else}
            <p class="text-text-muted">{t('No latency data')}</p>
        {/if}
        <div class="flex justify-between text-[11px] text-text-muted"><span>{t('24 hours ago')}</span><span>{t('Now')}</span></div>
        <p class="text-[11px] text-text-muted">{t('Based on recorded probes; missing periods are excluded')}</p>
    </div>
{/snippet}

{#if layout === 'table'}
    <tr class="monitor-row" data-testid="status-monitor" data-layout="table">
        <td class="service-cell">{@render nameButton()}</td>
        <td class="status-cell">{@render statusLabel()}</td>
        <td class="uptime-cell tabular-nums"><span class="mobile-label">{t('Availability · 24 hours')}</span>{uptime}</td>
        <td class="latency-cell tabular-nums"><span class="mobile-label">{t('Latency')}</span>{latency}</td>
        <td class="history-cell">{@render historyBar()}</td>
    </tr>
    {#if expanded}
        <tr class="details-row"><td colspan="5">{@render details()}</td></tr>
    {/if}
{:else}
    <article class="rounded-xl border border-border bg-surface min-w-0" data-testid="status-monitor" data-layout="cards">
        <div class="p-4">
            <h3>{@render nameButton()}</h3>
            <div class="flex items-center justify-between gap-2 mt-1">
                <span class="text-[11px] text-text-muted uppercase truncate">{monitor.type}</span>
                {@render statusLabel()}
            </div>
            <div class="mt-3 mb-3 flex items-end justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-base font-medium tabular-nums text-text">{uptime}</p>
                    <p class="text-[11px] text-text-muted" title={t('Based on recorded probes; missing periods are excluded')}>{t('Availability · 24 hours')}</p>
                </div>
                <div class="text-right">
                    <p class="text-base font-medium tabular-nums text-text whitespace-nowrap">{latency}</p>
                    <p class="text-[11px] text-text-muted">{t('Latency')}</p>
                </div>
            </div>
            {@render historyBar()}
        </div>
        {#if expanded}<div class="border-t border-border px-4 py-3">{@render details()}</div>{/if}
    </article>
{/if}

<style>
    /* 桌面使用真实表格对齐指标，手机重排成紧凑行，避免横向滚动。 */
    .monitor-row td { padding: 12px 16px; border-top: 1px solid var(--color-border); color: var(--color-text); font-size: 12px; }
    .monitor-row:hover { background: var(--color-surface-elevated); }
    .uptime-cell, .latency-cell { text-align: right; white-space: nowrap; }
    .mobile-label { display: none; }
    .details-row td { padding: 16px; background: var(--color-surface-elevated); border-top: 1px solid var(--color-border); }
    @media (min-width: 768px) and (max-width: 1023px) {
        .monitor-row td { padding: 12px 10px; }
    }
    @media (max-width: 767px) {
        .monitor-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 16px; padding: 14px 16px; border-top: 1px solid var(--color-border); }
        .monitor-row td { display: block; border: 0; padding: 0; min-width: 0; }
        .status-cell { text-align: right; }
        .uptime-cell { text-align: left; }
        .mobile-label { display: inline; margin-right: 8px; color: var(--color-text-muted); font-size: 11px; }
        .history-cell { grid-column: 1 / -1; }
        .details-row, .details-row td { display: block; }
    }
</style>
