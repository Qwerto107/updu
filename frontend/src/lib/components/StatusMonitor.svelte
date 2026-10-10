<script lang="ts">
    import { t, languageStore } from '$lib/i18n/index.svelte';

    type Bucket = { start: string; status: string; samples: number; uptime: number | null; latency_ms: number | null };
    let { monitor, cards = false } = $props<{ monitor: any; cards?: boolean }>();
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

<article class="rounded-2xl border border-border bg-surface p-5 min-w-0 shadow-sm" data-testid="status-monitor" data-layout={cards ? 'cards' : 'list'}>
    <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
            <h3 class="font-semibold text-text break-words">{monitor.name}</h3>
            <p class="text-xs text-text-muted mt-1 uppercase">{monitor.type}</p>
        </div>
        <span class="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-text shrink-0">
            <span class={`size-2 rounded-full ${tone(monitor.status)}`}></span>{label(monitor.status)}
        </span>
    </div>
    <div class={cards ? 'mt-5 space-y-4' : 'mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_160px]'}>
        <div class="min-w-0">
            <div class="flex flex-wrap justify-between gap-2 text-xs mb-3">
                <span class="text-text-muted" title={t('Based on recorded probes; missing periods are excluded')}>{t('Availability · 24 hours')}</span>
                <span class="font-semibold tabular-nums text-text">{monitor.uptime_24h == null ? t('No data') : `${monitor.uptime_24h.toFixed(2)}%`}</span>
            </div>
            <div class="flex gap-[3px] h-8" role="img" aria-label={t('Status history · last 24 hours')}>
                {#each history as bucket}
                    <div class={`flex-1 min-w-0 rounded-sm transition-opacity hover:opacity-70 ${tone(bucket.status)}`} title={tooltip(bucket)}></div>
                {/each}
            </div>
            <div class="flex justify-between text-[11px] text-text-muted mt-2"><span>{t('24 hours ago')}</span><span>{t('Now')}</span></div>
        </div>
        <div>
            <div class="flex justify-between gap-2 text-xs text-text-muted"><span>{t('Latency')}</span><span class="text-text font-semibold tabular-nums">{monitor.last_latency_ms == null ? '—' : `${monitor.last_latency_ms} ms`}</span></div>
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
                <p class="h-14 flex items-center text-xs text-text-muted">{t('No latency data')}</p>
            {/if}
        </div>
    </div>
    <p class="text-[11px] text-text-muted mt-3 border-t border-border/60 pt-3">{t('Last checked')}: {monitor.last_check ? date(monitor.last_check) : t('No data')}</p>
</article>
