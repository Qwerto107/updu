<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import { invalidateAll } from "$app/navigation";
    import {
        CheckCircle2,
        AlertTriangle,
        XCircle,
        Activity,
        Lock,
        Wrench,
        Info,
    } from "lucide-svelte";
    import Button from "$lib/components/ui/button.svelte";
    import StatusMonitor from "$lib/components/StatusMonitor.svelte";
    import { onMount } from "svelte";

    let refreshing = $state(false);
    let refreshFailed = $state(false);
    // 避免后台标签页持续轮询；销毁组件时清理定时器，慢请求不会重叠。
    onMount(() => {
        const controller = new AbortController();
        const timer = setInterval(async () => {
            if (document.hidden || refreshing) return;
            refreshing = true;
            try {
                const response = await fetch(`/api/v1/status-pages/${encodeURIComponent(data.slug)}`, {
                    cache: 'no-store', signal: controller.signal,
                });
                // 权限变化交给路由重新校验，临时网络故障则保留页面并在下轮重试。
                if (response.status === 403 || response.status === 404) {
                    await invalidateAll();
                } else {
                    if (!response.ok) throw new Error('refresh failed');
                    data = { ...(await response.json()), slug: data.slug };
                }
                refreshFailed = false;
            }
            catch { refreshFailed = true; }
            finally { refreshing = false; }
        }, 30000);
        return () => { clearInterval(timer); controller.abort(); };
    });

    let { data } = $props<{ data: any }>();
    let password = $state("");
    let unlockError = $state("");
    let unlocking = $state(false);

    let sp = $derived(data.page);
    let allMonitors = $derived(data.monitors || []);
    let incidents = $derived(data.incidents || []);
    let maintenance = $derived(data.maintenance || []);
    let locked = $derived(Boolean(data.locked));

    function monitorGroups(monitor: any): string[] {
        return monitor.groups && monitor.groups.length > 0
            ? monitor.groups
            : ["Core"];
    }

    // Filter monitors assigned to this page
    let relevantMonitors = $derived(
        allMonitors.filter((m: any) => {
            if (!sp?.groups) return false;
            return sp.groups.some((g: any) => {
                if (g.name && monitorGroups(m).includes(g.name)) return true;
                if (g.monitor_ids?.includes(m.id)) return true;
                return false;
            });
        }),
    );

    let monitorBucketKeys = $state(new Map<string, string>());

    $effect(() => {
        const buckets = new Map<string, string>();

        for (const monitor of relevantMonitors) {
            const bucket = sp?.groups?.find(
                (g: any) =>
                    (g.name && monitorGroups(monitor).includes(g.name)) ||
                    g.monitor_ids?.includes(monitor.id),
            );
            if (!bucket) {
                continue;
            }

            buckets.set(
                monitor.id,
                bucket.name ? `group:${bucket.name}` : "standalone",
            );
        }

        monitorBucketKeys = buckets;
    });

    let isAllUp = $derived(
        relevantMonitors.length > 0 &&
            relevantMonitors.every((m: any) => m.status === "up"),
    );
    let hasDown = $derived(
        relevantMonitors.some((m: any) => m.status === "down"),
    );
    let hasDegraded = $derived(
        relevantMonitors.some((m: any) => m.status === "degraded"),
    );

    type HumanState =
        | "fixing"
        | "maintenance"
        | "unacknowledged"
        | "nominal";

    let humanState = $derived.by<HumanState>(() => {
        if (maintenance.length > 0) return "maintenance";
        if (incidents.length > 0) return "fixing";
        if (hasDown || hasDegraded) return "unacknowledged";
        return "nominal";
    });

    async function unlockPage(event: SubmitEvent) {
        event.preventDefault();
        if (!password.trim()) {
            unlockError = "Password is required";
            return;
        }

        unlocking = true;
        unlockError = "";

        try {
            const response = await fetch(`/api/v1/status-pages/${data.slug}/unlock`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ password }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                unlockError = payload?.error || "Failed to unlock status page";
                return;
            }

            password = "";
            await invalidateAll();
        } catch {
            unlockError = "Failed to unlock status page";
        } finally {
            unlocking = false;
        }
    }
</script>

<svelte:head>
    <title>{sp?.name ? `${sp.name} Status` : locked ? translateUI("Protected Status Page") : translateUI("Status Page")}</title>
</svelte:head>

{#if locked}
    <div class="max-w-md mx-auto py-16 px-4 sm:px-6 lg:px-8">
        <div class="rounded-3xl border border-border bg-surface/95 p-8 shadow-[0_24px_64px_hsl(224_71%_4%/0.16)] space-y-6">
            <div class="space-y-3 text-center">
                <div class="mx-auto size-14 rounded-2xl bg-warning/10 border border-warning/20 flex items-center justify-center text-warning">
                    <Lock class="size-6" />
                </div>
                <div>
                    <h1 class="text-2xl font-bold tracking-tight text-text">{translateUI("Protected Status Page")}</h1>
                    <p class="text-sm text-text-muted mt-2">
                        {translateUI("Enter the page password to view current service status.")}
                    </p>
                </div>
            </div>

            <form class="space-y-4" onsubmit={unlockPage}>
                <div class="space-y-1.5">
                    <label class="text-sm font-medium text-text-muted" for="status-page-password">
                        {translateUI("Password")}
                    </label>
                    <input
                        id="status-page-password"
                        type="password"
                        bind:value={password}
                        class="input-base"
                        autocomplete="current-password"
                        placeholder={translateUI("Enter password")}
                    />
                </div>

                {#if unlockError}
                    <div class="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {unlockError}
                    </div>
                {/if}

                <Button class="w-full" loading={unlocking} type="submit">
                    {unlocking ? "Unlocking..." : translateUI("Unlock Status Page")}
                </Button>
            </form>
        </div>
    </div>
{:else}
    <div class="mx-auto py-10 px-4 sm:px-6 lg:px-8 space-y-8" class:max-w-6xl={sp.layout === 'cards'} class:max-w-4xl={sp.layout !== 'cards'}>
        <div class="text-center space-y-3 pt-6 pb-4 border-b border-border/50">
            <h1 class="text-3xl font-extrabold tracking-tight text-text">
                {sp.name}
            </h1>
            {#if sp.description}
                <p class="text-sm text-text-muted max-w-2xl mx-auto">
                    {sp.description}
                </p>
            {/if}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
            <span>{translateUI("Services")}: {relevantMonitors.length} · {translateUI("Operational")}: {relevantMonitors.filter((m: any) => m.status === 'up').length}</span>
            <span role="status">{refreshFailed ? translateUI("Refresh failed; retrying shortly") : translateUI("Refreshes every 30 seconds")}</span>
        </div>

        {#if relevantMonitors.length === 0}
            <div
                class="p-6 rounded-2xl bg-surface-elevated border border-border flex items-center justify-center gap-3"
            >
                <Activity class="size-6 text-text-muted" />
                <h2 class="text-lg font-medium text-text-muted">
                    {translateUI("No services configured")}
                </h2>
            </div>
        {:else if humanState === "fixing"}
            <div
                class="p-6 rounded-2xl bg-warning/10 border border-warning/30 flex items-start gap-4 text-warning light:text-amber-800 shadow-[0_0_24px_hsl(38_92%_50%/0.15)]"
            >
                <AlertTriangle class="size-8 shrink-0 mt-0.5" />
                <div class="space-y-1">
                    <h2 class="text-xl font-bold">{translateUI("Active Incident:")} {incidents[0]?.title || translateUI("Service Disturbance")}</h2>
                    <p class="text-sm opacity-90">
                        {translateUI("We are aware of this issue and actively investigating / working on a fix (Status:")} {incidents[0]?.status || "investigating"}).
                    </p>
                    {#if incidents[0]?.description}
                        <p class="text-xs text-text-muted mt-1">
                            {incidents[0].description}
                        </p>
                    {/if}
                </div>
            </div>
        {:else if humanState === "maintenance"}
            <div
                class="p-6 rounded-2xl bg-primary/10 border border-primary/30 flex items-start gap-4 text-primary light:text-blue-700 shadow-[0_0_24px_hsl(217_91%_60%/0.15)]"
            >
                <Wrench class="size-8 shrink-0 mt-0.5" />
                <div class="space-y-1">
                    <h2 class="text-xl font-bold">{translateUI("Scheduled Maintenance:")} {maintenance[0]?.title || translateUI("System Maintenance")}</h2>
                    <p class="text-sm opacity-90">
                        {translateUI("Scheduled maintenance is currently in progress. Affected services will resume nominal operation upon completion.")}
                    </p>
                </div>
            </div>
        {:else if humanState === "unacknowledged"}
            <div
                class="p-6 rounded-2xl bg-danger/10 border border-danger/30 flex items-start gap-4 text-danger light:text-red-700 shadow-[0_0_24px_hsl(0_84%_60%/0.15)]"
            >
                <XCircle class="size-8 shrink-0 mt-0.5" />
                <div class="space-y-1">
                    <h2 class="text-xl font-bold">{translateUI("Automated Alert: Service Outage Detected")}</h2>
                    <p class="text-sm opacity-90">
                        {translateUI("Canary probes report reachability failures across one or more failure domains.")}
                    </p>
                    <p class="text-xs text-text-muted mt-1">
                        {translateUI("Status: Unacknowledged by on-call administrator. Automated alerts have been dispatched.")}
                    </p>
                </div>
            </div>
        {:else if !isAllUp}
            <div class="p-6 rounded-2xl bg-surface-elevated border border-border text-text flex items-center gap-3">
                <Info class="size-6 text-text-muted" />
                <h2 class="text-lg font-semibold">{translateUI("Some services are paused or awaiting checks")}</h2>
            </div>
        {:else}
            <div
                class="p-6 rounded-2xl bg-success/10 border border-success/20 flex items-start gap-4 text-success light:text-emerald-700 shadow-[0_0_24px_hsl(142_71%_45%/0.1)]"
            >
                <CheckCircle2 class="size-8 shrink-0 mt-0.5" />
                <div class="space-y-1">
                    <h2 class="text-xl font-bold">{translateUI("All Systems Operational")}</h2>
                    <p class="text-sm opacity-90">
                        {translateUI("All monitored services are reachable from all server vantage points.")}
                    </p>
                    <p class="text-xs text-text-subtle mt-0.5">
                        {translateUI("If a service is unreachable for you, verify your local network connection, Tailscale overlay daemon, or DNS.")}
                    </p>
                </div>
            </div>
        {/if}

        <div class="flex flex-wrap gap-4 text-xs text-text-muted" aria-label={translateUI("History legend")}>
            {#each [{label: 'Operational', color: 'bg-emerald-500'}, {label: 'Outage', color: 'bg-red-500'}, {label: 'Degraded', color: 'bg-amber-500'}, {label: 'No data', color: 'bg-slate-600 light:bg-slate-300'}] as item}
                <span class="inline-flex items-center gap-1.5"><span class={`size-2 rounded-sm ${item.color}`}></span>{translateUI(item.label)}</span>
            {/each}
        </div>
        <div class="space-y-8">
            {#if sp.groups}
                {#each sp.groups as group}
                    {@const nameStr = group.name}
                    {@const isStandalone = !nameStr}
                    {@const bucketKey = isStandalone ? 'standalone' : `group:${nameStr}`}
                    {@const groupMonitors = relevantMonitors.filter(
                        (m: any) => monitorBucketKeys.get(m.id) === bucketKey,
                    )}

                    {#if groupMonitors.length > 0}
                        <div class="space-y-4">
                            {#if !isStandalone}
                                <h3
                                    class="text-lg font-bold text-text border-b border-border/50 pb-2"
                                >
                                    {nameStr}
                                </h3>
                            {/if}

                            <div class={sp.layout === "cards" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-4"} data-testid="status-layout" data-layout={sp.layout === "cards" ? "cards" : "list"}>
                                {#each groupMonitors as m (m.id)}
                                    <StatusMonitor monitor={m} cards={sp.layout === "cards"} />
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>
    </div>
{/if}
