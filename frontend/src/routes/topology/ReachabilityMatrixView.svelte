<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
	import type { NetworkTopology, Service, ServiceEndpoint } from "$lib/api/services";
	import {
		Grid3X3,
		CheckCircle2,
		AlertTriangle,
		XCircle,
		Shield,
		ShieldAlert,
		RefreshCw,
		Plus,
		Search,
		GitBranch,
		ArrowUpRight,
		SlidersHorizontal,
		HelpCircle,
	} from "lucide-svelte";
	import Button from "$lib/components/ui/button.svelte";

	interface Props {
		topology: NetworkTopology;
		probingId: string | null;
		onSelectService: (service: Service, focusedScopeId?: string) => void;
		onRunProbe: (serviceId: string) => void;
		onAddEndpoint: (service: Service, scopeId?: string) => void;
		onMarkIsolated?: (service: Service, scopeId: string) => void;
	}

	let {
		topology,
		probingId,
		onSelectService,
		onRunProbe,
		onAddEndpoint,
		onMarkIsolated,
	}: Props = $props();

	let searchQuery = $state("");
	let filterMode = $state<"all" | "asymmetric" | "degraded">("all");

	function getStatusColor(status?: string): string {
		switch (status) {
			case "up":
				return "#10b981"; // emerald-500
			case "degraded":
				return "#f59e0b"; // amber-500
			case "down":
				return "#ef4444"; // rose-500
			case "isolated":
				return "#94a3b8"; // slate-400
			default:
				return "#64748b"; // slate-500
		}
	}

	function getStatusBadgeClass(status?: string): string {
		switch (status) {
			case "up":
				return "bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/20";
			case "degraded":
				return "bg-amber-500/10 text-amber-400 light:text-amber-800 border-amber-500/20";
			case "down":
				return "bg-rose-500/10 text-rose-400 light:text-rose-700 border-rose-500/20";
			case "isolated":
				return "bg-background text-text border-border";
			default:
				return "bg-text-muted/10 text-text-muted border-border";
		}
	}

	function isAsymmetric(service: Service): boolean {
		if (!service.endpoints || service.endpoints.length < 2) return false;
		const activeEndpoints = service.endpoints.filter((e) => !e.is_isolated && e.status !== "isolated");
		if (activeEndpoints.length < 2) return false;
		const statuses = new Set(activeEndpoints.map((e) => e.status || "pending"));
		return statuses.size > 1;
	}

	const scopes = $derived(topology?.scopes || []);

	const filteredServices = $derived(
		(topology?.services || []).filter((s) => {
			if (filterMode === "asymmetric" && !isAsymmetric(s)) return false;
			if (filterMode === "degraded" && s.status !== "degraded" && s.status !== "down") return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const nameMatch = s.name.toLowerCase().includes(q);
				const zoneMatch = s.zone_id?.toLowerCase().includes(q);
				const haMatch = s.ha_group?.toLowerCase().includes(q);
				if (!nameMatch && !zoneMatch && !haMatch) return false;
			}
			return true;
		})
	);

	function getEndpointForScope(service: Service, scopeId: string): ServiceEndpoint | undefined {
		return service.endpoints?.find((e) => e.scope_id === scopeId);
	}

	function getFailingHop(endpoint: ServiceEndpoint): string | null {
		if (!endpoint.last_metadata) return null;
		const meta = endpoint.last_metadata as any;
		if (meta?.trace?.failing_hop) {
			return String(meta.trace.failing_hop).toUpperCase();
		}
		return null;
	}
</script>

<div class="space-y-4">
	<!-- Control Bar -->
	<div class="flex flex-wrap items-center justify-between gap-3 bg-surface-elevated border border-border p-3 rounded-xl text-xs">
		<div class="flex items-center gap-2 flex-1 max-w-sm">
			<Search class="w-4 h-4 text-text-muted shrink-0" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder={translateUI("Filter services by name, zone, or HA group...")}
				class="bg-transparent border-none text-text placeholder-text-muted focus:outline-none w-full text-xs"
			/>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<div class="inline-flex rounded-lg bg-surface p-0.5 border border-border">
				<button
					type="button"
					onclick={() => (filterMode = "all")}
					class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
						filterMode === "all"
							? "bg-background text-text font-bold shadow-sm"
							: "text-text-muted hover:text-text"
					}`}
				>
					{translateUI("All Services")}
				</button>
				<button
					type="button"
					onclick={() => (filterMode = "asymmetric")}
					class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
						filterMode === "asymmetric"
							? "bg-amber-500/20 text-amber-300 light:text-amber-800 font-bold border border-amber-500/30"
							: "text-text-muted hover:text-text"
					}`}
				>
					<ShieldAlert class="w-3 h-3 text-amber-400 light:text-amber-800" />
					{translateUI("Asymmetric Reachability")}
				</button>
				<button
					type="button"
					onclick={() => (filterMode = "degraded")}
					class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
						filterMode === "degraded"
							? "bg-rose-500/20 text-rose-300 light:text-rose-700 font-bold border border-rose-500/30"
							: "text-text-muted hover:text-text"
					}`}
				>
					{translateUI("Degraded Only")}
				</button>
			</div>
		</div>
	</div>

	<!-- Dense Reachability Matrix Table -->
	<div class="rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-left border-collapse text-xs">
				<thead>
					<tr class="border-b border-border bg-surface-elevated text-text-muted uppercase tracking-wider text-[10px] font-mono">
						<th class="py-3.5 px-4 font-bold min-w-[220px]">{translateUI("Monitored Service")}</th>
						<th class="py-3.5 px-4 font-bold min-w-[110px]">{translateUI("Zone")}</th>
						<th class="py-3.5 px-4 font-bold min-w-[120px]">{translateUI("Overall")}</th>
						{#each scopes as sc (sc.id)}
							<th class="py-3.5 px-4 font-bold min-w-[180px]">
								<div class="flex items-center gap-1.5">
									<span class="text-text font-bold">{sc.name}</span>
									<span class="text-[9px] px-1.5 py-0.2 rounded bg-background text-text-muted font-normal">
										{sc.id}
									</span>
								</div>
								<div class="text-[9px] text-text-muted font-normal normal-case truncate max-w-[160px] mt-0.5">
									{sc.description || ""}
								</div>
							</th>
						{/each}
						<th class="py-3.5 px-4 font-bold text-right min-w-[100px]">{translateUI("Actions")}</th>
					</tr>
				</thead>

				<tbody class="divide-y divide-border">
					{#if filteredServices.length === 0}
						<tr>
							<td colspan={scopes.length + 4} class="py-12 text-center text-text-muted">
								{translateUI("No services match your active search or filters.")}
							</td>
						</tr>
					{:else}
						{#each filteredServices as svc (svc.id)}
							{@const isAsymm = isAsymmetric(svc)}
							<tr
								class={`hover:bg-surface-elevated transition-colors group ${
									isAsymm ? "bg-amber-500/10" : ""
								}`}
							>
								<!-- Service Name & Type -->
								<td class="py-3 px-4">
									<div class="flex items-center gap-2">
										<button
											type="button"
											onclick={() => onSelectService(svc)}
											class="font-bold text-text text-sm text-left hover:text-emerald-400 light:hover:text-emerald-700 transition-colors flex items-center gap-1.5"
										>
											<span class="w-2 h-2 rounded-full shrink-0" style={`background-color: ${getStatusColor(svc.status)}`}></span>
											<span>{svc.name}</span>
										</button>
									</div>

									<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted font-mono">
										<span class="uppercase text-text-muted">{svc.type}</span>
										{#if svc.ha_group}
											<span>•</span>
											<span class="inline-flex items-center gap-0.5 text-indigo-400 light:text-indigo-700">
												<GitBranch class="w-2.5 h-2.5" />
												{svc.ha_group}
											</span>
										{/if}
										{#if isAsymm}
											<span>•</span>
											<span class="text-amber-400 light:text-amber-800 font-semibold flex items-center gap-0.5">
												<ShieldAlert class="w-2.5 h-2.5" />
												{translateUI("Asymmetric")}
											</span>
										{/if}
									</div>
								</td>

								<!-- Zone -->
								<td class="py-3 px-4 font-mono text-text text-xs">
									<span class="px-2 py-0.5 rounded bg-surface-elevated border border-border text-[11px]">
										{svc.zone_id || "default"}
									</span>
								</td>

								<!-- Overall Status -->
								<td class="py-3 px-4">
									<span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(svc.status)}`}>
										{svc.status?.toUpperCase() || "PENDING"}
									</span>
									{#if svc.primary_latency_ms != null}
										<div class="text-[10px] font-mono text-text-muted mt-1">
											{svc.primary_latency_ms}ms
										</div>
									{/if}
								</td>

								<!-- Scope Cells -->
								{#each scopes as sc (sc.id)}
									{@const ep = getEndpointForScope(svc, sc.id)}
									{@const failingHop = ep ? getFailingHop(ep) : null}
									<td class="py-3 px-4">
										{#if ep}
											{#if ep.is_isolated || ep.status === "isolated"}
												<button
													type="button"
													onclick={() => onSelectService(svc, sc.id)}
													class="w-full text-left p-2 rounded-xl border transition-all hover:scale-[1.02] cursor-pointer bg-surface-elevated border-border hover:border-border text-text-muted group/iso"
												>
													<div class="flex items-center justify-between gap-1">
														<div class="flex items-center gap-1.5 font-bold text-[11px] text-text">
															<Shield class="w-3 h-3 text-text-muted shrink-0" />
															<span class="truncate max-w-[90px]">{ep.name}</span>
														</div>
														<span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-background text-text-muted border border-border">
															{translateUI("Isolated")}
														</span>
													</div>
													<div class="mt-1 text-[9px] text-text-muted font-mono truncate">
														{translateUI("Not reachable by design")}
													</div>
												</button>
											{:else}
												<button
													type="button"
													onclick={() => onSelectService(svc, sc.id)}
													class={`w-full text-left p-2 rounded-xl border transition-all hover:scale-[1.02] cursor-pointer ${
														ep.status === "up"
															? "bg-emerald-500/10 border-emerald-500/25 hover:border-emerald-500/60"
															: ep.status === "degraded"
															? "bg-amber-500/10 border-amber-500/25 hover:border-amber-500/70"
															: ep.status === "down"
															? "bg-rose-500/10 border-rose-500/25 hover:border-rose-500/70"
															: "bg-surface-elevated border-border hover:border-border"
													}`}
												>
													<div class="flex items-center justify-between gap-1">
														<div class="flex items-center gap-1.5 font-bold text-[11px] text-text">
															<span class="w-1.5 h-1.5 rounded-full" style={`background-color: ${getStatusColor(ep.status)}`}></span>
															<span class="truncate max-w-[90px]">{ep.name}</span>
														</div>
														{#if ep.last_latency_ms != null}
															<span class="text-[10px] font-mono font-semibold text-emerald-400 light:text-emerald-700">
																{ep.last_latency_ms}ms
															</span>
														{/if}
													</div>

													{#if failingHop}
														<div class="mt-1 inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/25 text-[9px] font-mono text-rose-400 light:text-rose-700 font-bold">
															<span>{translateUI("HOP:")} {failingHop}</span>
														</div>
													{:else if ep.last_status_code}
														<div class="mt-1 text-[10px] font-mono text-text-muted">
															HTTP {ep.last_status_code}
														</div>
													{/if}
												</button>
											{/if}
										{:else}
											<div class="flex items-center gap-1">
												<button
													type="button"
													onclick={() => onAddEndpoint(svc, sc.id)}
													class="flex-1 text-center py-2 px-2 rounded-xl border border-dashed border-border hover:border-border text-text-muted hover:text-text text-[10px] flex items-center justify-center gap-1 transition-all truncate"
													title={`Add probe endpoint for ${sc.id}`}
												>
													<Plus class="w-3 h-3 shrink-0" />
													<span>{translateUI("Add")} {sc.id}</span>
												</button>
												{#if onMarkIsolated}
													<button
														type="button"
														onclick={() => onMarkIsolated(svc, sc.id)}
														class="py-2 px-2 rounded-xl border border-dashed border-border hover:border-amber-500/50 hover:bg-amber-500/10 text-text-muted hover:text-amber-400 light:hover:text-amber-800 text-[10px] flex items-center justify-center gap-1 transition-all shrink-0"
														title={`Mark ${sc.id} as Isolated / Not Reachable`}
														aria-label={`Mark ${sc.id} as Isolated`}
													>
														<Shield class="w-3 h-3" />
														<span class="hidden 2xl:inline">{translateUI("Isolate")}</span>
													</button>
												{/if}
											</div>
										{/if}
									</td>
								{/each}

								<!-- Actions -->
								<td class="py-3 px-4 text-right">
									<div class="inline-flex items-center gap-1">
										<button
											type="button"
											onclick={() => onRunProbe(svc.id)}
											disabled={probingId === svc.id}
											class="p-1.5 rounded-lg text-text-muted hover:text-emerald-400 light:hover:text-emerald-700 hover:bg-background transition-all disabled:opacity-50"
											title={translateUI("Run Probe")}
											aria-label={translateUI("Run Probe")}
										>
											<RefreshCw class={`w-3.5 h-3.5 ${probingId === svc.id ? "animate-spin text-emerald-400 light:text-emerald-700" : ""}`} />
										</button>

										<button
											type="button"
											onclick={() => onSelectService(svc)}
											class="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-background transition-all"
											title={translateUI("Inspect Hop Trace")}
											aria-label={translateUI("Inspect Hop Trace")}
										>
											<ArrowUpRight class="w-3.5 h-3.5 text-emerald-400 light:text-emerald-700" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>
