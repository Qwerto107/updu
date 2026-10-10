<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
	import type { NetworkTopology, Service, ServiceEndpoint } from "$lib/api/services";
	import {
		Layers,
		Radio,
		Server,
		Activity,
		RefreshCw,
		Plus,
		GitBranch,
		AlertTriangle,
		CheckCircle2,
		XCircle,
		ShieldAlert,
		Network,
		ArrowUpRight,
		Search,
	} from "lucide-svelte";
	import Button from "$lib/components/ui/button.svelte";

	interface Props {
		topology: NetworkTopology;
		probingId: string | null;
		onSelectService: (service: Service) => void;
		onRunProbe: (serviceId: string) => void;
		onAddService: (zoneId?: string) => void;
		onAddEndpoint: (service: Service) => void;
	}

	let {
		topology,
		probingId,
		onSelectService,
		onRunProbe,
		onAddService,
		onAddEndpoint,
	}: Props = $props();

	let searchQuery = $state("");
	let statusFilter = $state<string>("all");

	function getStatusColor(status?: string): string {
		switch (status) {
			case "up":
				return "#10b981"; // emerald-500
			case "degraded":
				return "#f59e0b"; // amber-500
			case "down":
				return "#ef4444"; // rose-500
			default:
				return "#64748b"; // slate-500
		}
	}

	function getStatusBadgeClass(status?: string): string {
		switch (status) {
			case "up":
				return "bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/20";
			case "degraded":
				return "bg-amber-500/10 text-amber-400 light:text-amber-700 border-amber-500/20";
			case "down":
				return "bg-rose-500/10 text-rose-400 light:text-rose-700 border-rose-500/20";
			default:
				return "bg-text-muted/10 text-text-muted border-border";
		}
	}

	function getScopeColor(scopeId: string): string {
		switch (scopeId) {
			case "lan":
				return "text-emerald-400 light:text-emerald-700 bg-emerald-500/10 border-emerald-500/25";
			case "tailnet":
				return "text-indigo-400 light:text-indigo-700 bg-indigo-500/10 border-indigo-500/25";
			case "public":
				return "text-sky-400 light:text-sky-700 bg-sky-500/10 border-sky-500/25";
			default:
				return "text-text bg-surface-elevated border-border";
		}
	}

	function getHAPeers(service: Service): Service[] {
		if (!service.ha_group) return [];
		return (topology?.services || []).filter(
			(s) => s.id !== service.id && s.ha_group === service.ha_group
		);
	}
</script>

<div class="space-y-6">
	<!-- Sub-bar Filter & Search -->
	<div class="flex flex-wrap items-center justify-between gap-3 bg-surface-elevated border border-border p-3 rounded-xl text-xs">
		<div class="flex items-center gap-2 flex-1 max-w-sm">
			<Search class="w-4 h-4 text-text-muted shrink-0" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder={translateUI("Filter services by name, type, or HA group...")}
				class="bg-transparent border-none text-text placeholder-text-muted focus:outline-none w-full text-xs"
			/>
		</div>

		<div class="flex items-center gap-2">
			<span class="text-text-muted font-medium">{translateUI("Status:")}</span>
			<div class="inline-flex rounded-lg bg-surface p-0.5 border border-border">
				{#each ["all", "up", "degraded", "down"] as st}
					<button
						type="button"
						onclick={() => (statusFilter = st)}
						class={`px-2.5 py-1 rounded-md text-[11px] font-medium uppercase tracking-wider transition-all ${
							statusFilter === st
								? "bg-background text-text font-bold shadow-sm"
								: "text-text-muted hover:text-text"
						}`}
					>
						{st}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Zone Boundary Cards Grid -->
	<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
		{#each topology?.zones || [] as zone (zone.id)}
			{@const zoneNodes = (topology?.nodes || []).filter(
				(n) => n.zone_id === zone.id || (zone.id === "default" && (!n.zone_id || n.is_local))
			)}
			{@const allZoneServices = (topology?.services || []).filter(
				(s) => s.zone_id === zone.id || (zone.id === "default" && !s.zone_id)
			)}
			{@const filteredZoneServices = allZoneServices.filter((s) => {
				if (statusFilter !== "all" && s.status !== statusFilter) return false;
				if (searchQuery.trim()) {
					const q = searchQuery.toLowerCase();
					const nameMatch = s.name.toLowerCase().includes(q);
					const typeMatch = s.type?.toLowerCase().includes(q);
					const haMatch = s.ha_group?.toLowerCase().includes(q);
					if (!nameMatch && !typeMatch && !haMatch) return false;
				}
				return true;
			})}
			{@const upCount = allZoneServices.filter((s) => s.status === "up").length}
			{@const degradedCount = allZoneServices.filter((s) => s.status === "degraded").length}
			{@const downCount = allZoneServices.filter((s) => s.status === "down").length}

			<div class="rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] overflow-hidden flex flex-col transition-all hover:border-border">
				<!-- Zone Boundary Header -->
				<div class="p-4 sm:p-5 border-b border-border bg-surface-elevated flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 light:text-blue-700">
							<Layers class="w-5 h-5" />
						</div>
						<div>
							<div class="flex items-center gap-2">
								<h2 class="font-bold text-base text-text tracking-tight">{zone.name}</h2>
								<span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-background text-text border border-border">
									{zone.id}
								</span>
							</div>
							<p class="text-xs text-text-muted mt-0.5">
								{zone.description || translateUI("Failure domain & physical infrastructure perimeter")}
							</p>
						</div>
					</div>

					<div class="flex items-center gap-2">
						<!-- Health summary pill -->
						<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-border text-[11px] font-mono">
							<span class="text-emerald-400 light:text-emerald-700 font-bold">{upCount} {translateUI("Up")}</span>
							{#if degradedCount > 0}
								<span class="text-text-muted">•</span>
								<span class="text-amber-400 light:text-amber-700 font-bold">{degradedCount} {translateUI("Degraded")}</span>
							{/if}
							{#if downCount > 0}
								<span class="text-text-muted">•</span>
								<span class="text-rose-400 light:text-rose-700 font-bold">{downCount} {translateUI("Down")}</span>
							{/if}
						</div>

						<Button
							variant="ghost"
							size="sm"
							onclick={() => onAddService(zone.id)}
							class="text-xs gap-1 text-text hover:text-text hover:bg-background"
						>
							<Plus class="w-3.5 h-3.5" />
							{translateUI("Add")}
						</Button>
					</div>
				</div>

				<!-- Zone Infrastructure / Nodes Strip -->
				<div class="px-5 py-2.5 bg-surface-elevated border-b border-border flex flex-wrap items-center gap-3 text-xs">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1">
						<Radio class="w-3.5 h-3.5 text-emerald-400 light:text-emerald-700" />
						{translateUI("Prober Nodes:")}
					</span>
					{#if zoneNodes.length === 0}
						<span class="text-[11px] text-text-muted italic">{translateUI("No nodes assigned to this zone directly")}</span>
					{:else}
						{#each zoneNodes as node}
							<div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-elevated border border-border text-text text-[11px]">
								<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
								<span class="font-medium">{node.name}</span>
								{#if node.is_local}
									<span class="text-[9px] font-mono uppercase px-1 rounded bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border border-emerald-500/25">
										{translateUI("Origin")}
									</span>
								{/if}
							</div>
						{/each}
					{/if}
				</div>

				<!-- Zone Services Grid / List -->
				<div class="p-4 sm:p-5 space-y-3 flex-1">
					{#if filteredZoneServices.length === 0}
						<div class="text-center py-10 text-text-muted text-xs">
							{#if allZoneServices.length === 0}
								{translateUI("No services in this zone yet. Click \"Add\" above to register one.")}
							{:else}
								{translateUI("No services match the active search/status filters.")}
							{/if}
						</div>
					{:else}
						{#each filteredZoneServices as svc (svc.id)}
							{@const haPeers = getHAPeers(svc)}
							<div
								role="button"
								tabindex="0"
								onclick={() => onSelectService(svc)}
								onkeydown={(e) => {
									if (e.key === "Enter" || e.key === " ") onSelectService(svc);
								}}
								class="p-4 rounded-xl border border-border bg-surface-elevated hover:bg-surface-elevated hover:border-border transition-all cursor-pointer shadow-sm group"
							>
								<!-- Service Header -->
								<div class="flex items-start justify-between gap-3">
									<div>
										<div class="flex items-center gap-2 flex-wrap">
											<span class="w-2.5 h-2.5 rounded-full shrink-0" style={`background-color: ${getStatusColor(svc.status)}`}></span>
											<span class="font-bold text-sm text-text group-hover:text-emerald-300 light:group-hover:text-emerald-700 transition-colors">
												{svc.name}
											</span>
											<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface text-text-muted border border-border uppercase">
												{svc.type}
											</span>

											<!-- HA Cluster Badge -->
											{#if svc.ha_group}
												<div class="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 light:text-indigo-700 border border-indigo-500/25">
													<GitBranch class="w-3 h-3 text-indigo-400 light:text-indigo-700" />
													<span>{translateUI("HA:")} {svc.ha_group}</span>
												</div>
											{/if}
										</div>

										<!-- HA Peers Indicator -->
										{#if haPeers.length > 0}
											<div class="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
												<span class="text-text-muted">{translateUI("HA Peers:")}</span>
												{#each haPeers as peer}
													<span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-surface border border-border text-[10px] font-mono">
														<span class="w-1.5 h-1.5 rounded-full" style={`background-color: ${getStatusColor(peer.status)}`}></span>
														{peer.zone_id} ({peer.status})
													</span>
												{/each}
											</div>
										{/if}
									</div>

									<div class="flex items-center gap-2 shrink-0">
										<span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(svc.status)}`}>
											{svc.status?.toUpperCase() || "PENDING"}
										</span>

										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												onRunProbe(svc.id);
											}}
											disabled={probingId === svc.id}
											class="p-1.5 rounded-lg text-text-muted hover:text-emerald-400 light:hover:text-emerald-700 hover:bg-background transition-all disabled:opacity-50"
											title={translateUI("Run Probe Now")}
											aria-label={translateUI("Run Probe Now")}
										>
											<RefreshCw class={`w-3.5 h-3.5 ${probingId === svc.id ? "animate-spin text-emerald-400 light:text-emerald-700" : ""}`} />
										</button>
									</div>
								</div>

								<!-- Diagnostic Alert if Degraded/Down -->
								{#if svc.status === "degraded" || svc.status === "down"}
									<div class="mt-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
										<ShieldAlert class="w-4 h-4 text-amber-400 light:text-amber-700 shrink-0 mt-0.5" />
										<div class="text-[11px] text-amber-300 light:text-amber-700 leading-tight">
											<span class="font-semibold">{translateUI("Diagnosis:")}</span> {svc.diagnosis || translateUI("Probe failure detected")}
										</div>
									</div>
								{/if}

								<!-- Ingress Scope Reachability Pills -->
								<div class="mt-3 flex flex-wrap items-center gap-2">
									{#if !svc.endpoints || svc.endpoints.length === 0}
										<span class="text-[11px] text-text-muted italic">{translateUI("No scope ingress endpoints configured")}</span>
									{:else}
										{#each svc.endpoints as ep}
											<div class={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border ${getScopeColor(ep.scope_id)}`}>
												<span class="w-1.5 h-1.5 rounded-full" style={`background-color: ${getStatusColor(ep.status)}`}></span>
												<span class="uppercase font-bold text-[10px] font-mono">{ep.scope_id}</span>
												<span class="text-text font-normal truncate max-w-[120px]">{ep.name}</span>
												{#if ep.last_latency_ms != null}
													<span class="font-mono text-[10px] font-semibold opacity-90">{ep.last_latency_ms}ms</span>
												{/if}
											</div>
										{/each}
									{/if}

									<button
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											onAddEndpoint(svc);
										}}
										class="text-[11px] text-text-muted hover:text-text px-2 py-1 rounded border border-dashed border-border hover:border-border flex items-center gap-1"
									>
										<Plus class="w-3 h-3" />
										{translateUI("Endpoint")}
									</button>
								</div>

								<!-- Footer: Hop Inspector Deep-Link CTA -->
								<div class="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
									<span class="text-text-muted font-mono">
										{translateUI("Primary Ingress:")} {svc.endpoints?.find((e) => e.is_primary)?.name || "Default"}
									</span>
									<span class="text-emerald-400 light:text-emerald-700 group-hover:underline flex items-center gap-0.5 font-medium">
										{translateUI("Troubleshoot & Hop Trace")}
										<ArrowUpRight class="w-3 h-3" />
									</span>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
