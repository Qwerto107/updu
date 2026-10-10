<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
	import type { NetworkTopology, Service, ServiceEndpoint, HopTrace } from "$lib/api/services";
	import {
		Activity,
		RefreshCw,
		Plus,
		Trash2,
		Shield,
		ShieldAlert,
		CheckCircle2,
		AlertTriangle,
		XCircle,
		ArrowRight,
		Server,
		Radio,
		Network,
		Lock,
		Cpu,
		Globe,
		GitBranch,
		Layers,
		Check,
		Clock,
	} from "lucide-svelte";
	import Button from "$lib/components/ui/button.svelte";

	interface Props {
		topology: NetworkTopology;
		service: Service | null;
		focusedScopeId?: string | null;
		probingId: string | null;
		onSelectService: (service: Service) => void;
		onRunProbe: (serviceId: string) => void;
		onAddEndpoint: (service: Service) => void;
		onDeleteEndpoint: (serviceId: string, endpointId: string) => void;
		onDeleteService: (serviceId: string) => void;
		onClose?: () => void;
	}

	let {
		topology,
		service,
		focusedScopeId = null,
		probingId,
		onSelectService,
		onRunProbe,
		onAddEndpoint,
		onDeleteEndpoint,
		onDeleteService,
		onClose,
	}: Props = $props();

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

	function getScopeBadge(scopeId: string): { label: string; class: string } {
		switch (scopeId) {
			case "lan":
				return { label: "Local LAN (RFC1918)", class: "text-emerald-400 light:text-emerald-700 bg-emerald-500/10 border-emerald-500/25" };
			case "tailnet":
				return { label: "Tailscale Overlay (WireGuard)", class: "text-indigo-400 light:text-indigo-700 bg-indigo-500/10 border-indigo-500/25" };
			case "public":
				return { label: "Public WAN (Internet)", class: "text-sky-400 light:text-sky-700 bg-sky-500/10 border-sky-500/25" };
			default:
				return { label: scopeId.toUpperCase(), class: "text-text bg-surface-elevated border-border" };
		}
	}

	function getEndpointTrace(ep: ServiceEndpoint): HopTrace | null {
		if (!ep.last_metadata) return null;
		const meta = ep.last_metadata as any;
		return (meta?.trace as HopTrace) || null;
	}

	function getHAPeers(svc: Service): Service[] {
		if (!svc.ha_group) return [];
		return (topology?.services || []).filter(
			(s) => s.id !== svc.id && s.ha_group === svc.ha_group
		);
	}
</script>

<div class="space-y-6">
	<!-- Top Bar & Service Selector -->
	<div class="rounded-2xl border border-border bg-surface p-4 sm:p-5 shadow-[var(--shadow-card)]">
		<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<div class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 light:text-emerald-700 shrink-0">
					<Activity class="w-6 h-6" />
				</div>
				<div>
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-xs text-text-muted font-semibold uppercase tracking-wider">{translateUI("Troubleshooting & Hop Inspector")}</span>
						{#if service?.ha_group}
							<span class="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 light:text-indigo-700 border border-indigo-500/25">
								<GitBranch class="w-3 h-3 text-indigo-400 light:text-indigo-700" />
								{translateUI("HA:")} {service.ha_group}
							</span>
						{/if}
					</div>

					<!-- Service Selection Dropdown -->
					<div class="mt-1 flex items-center gap-3">
						<select
							class="bg-surface-elevated border border-border text-text font-bold text-base rounded-xl px-3 py-1.5 focus:outline-none focus:border-emerald-500"
							value={service?.id || ""}
							onchange={(e) => {
								const targetId = (e.target as HTMLSelectElement).value;
								const found = (topology?.services || []).find((s) => s.id === targetId);
								if (found) onSelectService(found);
							}}
						>
							{#each topology?.services || [] as s}
								<option value={s.id}>
									{s.name} ({s.zone_id || "default"}) [{s.status?.toUpperCase() || "PENDING"}]
								</option>
							{/each}
						</select>

						{#if service}
							<span class={`text-xs font-bold px-2.5 py-1 rounded-full border ${getStatusBadgeClass(service.status)}`}>
								{service.status?.toUpperCase() || "PENDING"}
							</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Actions -->
			{#if service}
				<div class="flex items-center gap-2 flex-wrap">
					<Button
						variant="default"
						onclick={() => onRunProbe(service!.id)}
						disabled={probingId === service.id}
						class="gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
					>
						<RefreshCw class={`w-3.5 h-3.5 ${probingId === service.id ? "animate-spin" : ""}`} />
						{translateUI("Run Probe Now")}
					</Button>

					<Button
						variant="secondary"
						onclick={() => onAddEndpoint(service!)}
						class="gap-1 text-xs bg-background hover:bg-border text-text"
					>
						<Plus class="w-3.5 h-3.5 text-emerald-400 light:text-emerald-700" />
						{translateUI("Add Scope Endpoint")}
					</Button>

					<Button
						variant="outline"
						onclick={() => onDeleteService(service!.id)}
						class="gap-1 text-xs text-rose-400 light:text-rose-700 border-rose-500/25 hover:bg-rose-500/10"
					>
						<Trash2 class="w-3.5 h-3.5" />
						{translateUI("Delete")}
					</Button>

					{#if onClose}
						<button
							type="button"
							onclick={onClose}
							class="text-text-muted hover:text-text px-2 py-1 text-sm rounded-lg hover:bg-background transition-colors"
						>
							{translateUI("✕ Close")}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if !service}
		<div class="p-12 text-center rounded-2xl border border-border bg-surface-elevated text-text-muted text-sm">
			{translateUI("Select a service above to inspect its hop-by-hop reachability pipelines.")}
		</div>
	{:else}
		<!-- Diagnostic Autopsy Summary Banner -->
		{#if service.status === "degraded" || service.status === "down" || service.diagnosis}
			<div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-[var(--shadow-card)] space-y-3 animate-fade-in">
				<div class="flex items-start justify-between gap-3">
					<div class="flex items-start gap-3">
						<div class="p-2 rounded-xl bg-amber-500/20 text-amber-400 light:text-amber-800 shrink-0 mt-0.5">
							<ShieldAlert class="w-6 h-6" />
						</div>
						<div>
							<h3 class="font-bold text-text text-base">{translateUI("Diagnostic Autopsy:")} {service.name}</h3>
							<p class="text-xs text-amber-300 light:text-amber-800 font-medium mt-0.5">
								{service.diagnosis || translateUI("Probe discrepancy detected across reachability scopes.")}
							</p>
						</div>
					</div>
					<span class="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 light:text-amber-800">
						{translateUI("Differential Root-Cause")}
					</span>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
					<div class="p-3 rounded-xl bg-surface border border-border space-y-1">
						<span class="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{translateUI("Probable Cause")}</span>
						<p class="text-text">
							{translateUI("Backend responded on some scopes (e.g. LAN/Tailnet), but external or local routing failed on others.")}
						</p>
					</div>

					<div class="p-3 rounded-xl bg-surface border border-border space-y-1">
						<span class="text-[11px] font-semibold text-emerald-400 light:text-emerald-700 uppercase tracking-wide">{translateUI("Actionable Recommendation")}</span>
						<p class="text-text">
							{translateUI("Check reverse proxy (Caddy / Traefik), Cloudflare tunnel / WAN port forward, or host firewall bindings.")}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- HA Cluster Peers Summary (if in HA Group) -->
		{@const haPeers = getHAPeers(service)}
		{#if service.ha_group && haPeers.length > 0}
			<div class="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4 space-y-2">
				<div class="flex items-center justify-between text-xs">
					<div class="flex items-center gap-2 font-bold text-text">
						<GitBranch class="w-4 h-4 text-indigo-400 light:text-indigo-700" />
						<span>{translateUI("High Availability Cluster:")} {service.ha_group}</span>
					</div>
					<span class="text-[11px] font-mono text-indigo-300 light:text-indigo-700">
						{haPeers.length + 1} {translateUI("Replicas across zones")}
					</span>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs pt-1">
					<!-- Current Service Replica -->
					<div class="p-3 rounded-xl bg-surface border border-indigo-500/40 space-y-1">
						<div class="flex items-center justify-between">
							<span class="font-bold text-text">{service.name} {translateUI("(Active View)")}</span>
							<span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(service.status)}`}>
								{service.status?.toUpperCase()}
							</span>
						</div>
						<div class="text-[11px] text-text-muted font-mono">{translateUI("Zone:")} {service.zone_id || "default"}</div>
					</div>

					<!-- Peer Replicas -->
					{#each haPeers as peer}
						<div
							role="button"
							tabindex="0"
							onclick={() => onSelectService(peer)}
							onkeydown={(e) => {
								if (e.key === "Enter" || e.key === " ") onSelectService(peer);
							}}
							class="p-3 rounded-xl bg-surface border border-border hover:border-indigo-500 transition-all cursor-pointer space-y-1"
						>
							<div class="flex items-center justify-between">
								<span class="font-bold text-text hover:text-indigo-300 light:hover:text-indigo-700">{peer.name}</span>
								<span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadgeClass(peer.status)}`}>
									{peer.status?.toUpperCase()}
								</span>
							</div>
							<div class="text-[11px] text-text-muted font-mono">{translateUI("Zone:")} {peer.zone_id || "default"} {translateUI("(Click to inspect)")}</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Multi-Vantage Hop Pipelines -->
		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="font-bold text-base text-text flex items-center gap-2">
					<Network class="w-5 h-5 text-emerald-400 light:text-emerald-700" />
					{translateUI("Multi-Vantage Reachability Pipelines (")}{service.endpoints?.length || 0} {translateUI("Scopes)")}
				</h3>
				<span class="text-xs text-text-muted">
					{translateUI("Sequential Hop-by-Hop Stage Attribution")}
				</span>
			</div>

			{#if !service.endpoints || service.endpoints.length === 0}
				<div class="p-8 text-center rounded-xl border border-border bg-surface-elevated text-text-muted text-xs">
					{translateUI("No endpoints configured for this service. Click \"Add Scope Endpoint\" to add a LAN, Tailnet, or Public WAN ingress check.")}
				</div>
			{:else}
				{#each service.endpoints as ep (ep.id)}
					{@const trace = getEndpointTrace(ep)}
					{@const scopeMeta = getScopeBadge(ep.scope_id)}
					{@const isFailing = ep.status === "down" || ep.status === "degraded"}
					{@const failingHop = trace?.failing_hop || (isFailing ? "app" : null)}
					{@const isFocused = focusedScopeId === ep.scope_id}
					{@const isDnsFailing = failingHop === "dns"}
					{@const isIngressFailing = failingHop === "tcp" || failingHop === "tls" || failingHop === "ingress"}
					{@const isAppFailing = failingHop === "app"}

					<div
						class={`rounded-2xl border transition-all p-5 space-y-4 shadow-md ${
							isFocused
								? "border-emerald-500 bg-surface-elevated ring-1 ring-emerald-500/20"
								: "border-border bg-surface"
						}`}
					>
						<!-- Scope Endpoint Header -->
						<div class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
							<div class="flex items-center gap-2.5">
								<span class={`text-xs font-bold font-mono px-2.5 py-1 rounded-lg border ${scopeMeta.class}`}>
									{ep.scope_id.toUpperCase()}
								</span>
								<div>
									<h4 class="font-bold text-sm text-text flex items-center gap-2">
										{ep.name}
										{#if ep.is_primary}
											<span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border border-emerald-500/25 font-semibold">
												{translateUI("Primary")}
											</span>
										{/if}
										{#if ep.is_isolated || ep.status === "isolated"}
											<span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-background text-text border border-border font-semibold flex items-center gap-1">
												<Shield class="w-2.5 h-2.5 text-text-muted" />
												{translateUI("Isolated")}
											</span>
										{/if}
									</h4>
									<div class="text-[11px] text-text-muted font-mono mt-0.5">
										{#if ep.is_isolated || ep.status === "isolated"}
											{translateUI("Status: Segmented from scope • Outbound probes inactive")}
										{:else}
											{translateUI("Target:")} {ep.target_type} {translateUI("• Config:")} {JSON.stringify(ep.config)}
										{/if}
									</div>
								</div>
							</div>

							<div class="flex items-center gap-3">
								{#if ep.last_latency_ms != null && !ep.is_isolated && ep.status !== "isolated"}
									<div class="text-right">
										<div class="text-sm font-bold text-text font-mono">{ep.last_latency_ms}ms</div>
										<div class="text-[10px] text-text-muted">{translateUI("Total Latency")}</div>
									</div>
								{/if}

								<span class={`text-[11px] font-bold px-3 py-1 rounded-full border ${getStatusBadgeClass(ep.status)}`}>
									{ep.status?.toUpperCase() || "PENDING"}
								</span>

								<button
									type="button"
									onclick={() => onDeleteEndpoint(service.id, ep.id)}
									class="text-text-muted hover:text-rose-400 light:hover:text-rose-700 p-1 rounded hover:bg-background transition-colors"
									title={translateUI("Delete Endpoint")}
									aria-label={translateUI("Delete Endpoint")}
								>
									<Trash2 class="w-3.5 h-3.5" />
								</button>
							</div>
						</div>

						{#if ep.is_isolated || ep.status === "isolated"}
							<div class="p-4 rounded-xl border border-border bg-surface-elevated flex items-start gap-3">
								<Shield class="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
								<div class="space-y-1">
									<div class="text-xs font-bold text-text">{translateUI("Segmented / Air-Gapped Route")}</div>
									<p class="text-xs text-text-muted leading-relaxed">
										{translateUI("This service is marked as intentionally unreachable from the")} <span class="font-mono text-text">{ep.scope_id.toUpperCase()}</span> {translateUI("scope. Probes will not dial this network path and differential diagnostics treat this isolation as healthy architecture.")}
									</p>
								</div>
							</div>
						{:else}
							<!-- 4-Stage Sequential Hop Pipeline Graphic -->
							<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
							<!-- Hop 1: Prober Node -->
							<div
								class="p-3.5 rounded-xl border bg-surface-elevated border-border flex flex-col justify-between space-y-2 relative"
							>
								<div class="flex items-center justify-between">
									<span class="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
										<Radio class="w-3 h-3 text-emerald-400 light:text-emerald-700" />
										{translateUI("Hop 1: Origin")}
									</span>
									<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
								</div>
								<div>
									<div class="font-bold text-xs text-text">{translateUI("Local Prober Node")}</div>
									<div class="text-[11px] text-text-muted mt-0.5">{translateUI("Source prober engine")}</div>
								</div>
								<div class="text-[10px] font-mono text-emerald-400 light:text-emerald-700 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25 inline-block self-start">
									{translateUI("PASS • 0ms")}
								</div>
							</div>

							<!-- Hop 2: Network Fabric & DNS -->
							<div
								class={`p-3.5 rounded-xl border flex flex-col justify-between space-y-2 relative ${
									isDnsFailing
										? "bg-rose-500/10 border-rose-500/60 shadow-[var(--shadow-card)] shadow-rose-500/10"
										: "bg-surface-elevated border-border"
								}`}
							>
								<div class="flex items-center justify-between">
									<span class="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
										<Globe class="w-3 h-3 text-sky-400 light:text-sky-700" />
										{translateUI("Hop 2: Fabric & DNS")}
									</span>
									{#if isDnsFailing}
										<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
									{:else}
										<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
									{/if}
								</div>
								<div>
									<div class="font-bold text-xs text-text">
										{ep.scope_id.toUpperCase()} {translateUI("Transport")}
									</div>
									<div class="text-[11px] text-text-muted mt-0.5 truncate font-mono">
										{#if trace?.resolved_ip}
											{translateUI("IP:")} {trace.resolved_ip}
										{:else if ep.scope_id === "lan"}
											{translateUI("Direct RFC1918 Route")}
										{:else if ep.scope_id === "tailnet"}
											{translateUI("WireGuard Mesh Peer")}
										{:else}
											{translateUI("DNS Resolution")}
										{/if}
									</div>
								</div>
								<div class={`text-[10px] font-mono px-2 py-0.5 rounded border inline-block self-start ${
									isDnsFailing
										? 'text-rose-400 light:text-rose-700 bg-rose-500/10 border-rose-500/25'
										: 'text-sky-400 light:text-sky-700 bg-sky-500/10 border-sky-500/25'
								}`}>
									{#if isDnsFailing}
										{translateUI("FAIL • DNS Unreachable")}
									{:else if trace?.dns_lookup_ms != null}
										{translateUI("PASS •")} {trace.dns_lookup_ms}{translateUI("ms DNS")}
									{:else}
										{translateUI("PASS • Direct")}
									{/if}
								</div>
							</div>

							<!-- Hop 3: Ingress Gateway & TLS Handshake -->
							<div
								class={`p-3.5 rounded-xl border flex flex-col justify-between space-y-2 relative ${
									isIngressFailing
										? "bg-rose-500/10 border-rose-500/60 shadow-[var(--shadow-card)] shadow-rose-500/10"
										: "bg-surface-elevated border-border"
								}`}
							>
								<div class="flex items-center justify-between">
									<span class="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
										<Lock class="w-3 h-3 text-indigo-400 light:text-indigo-700" />
										{translateUI("Hop 3: Ingress & TLS")}
									</span>
									{#if isIngressFailing}
										<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
									{:else}
										<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
									{/if}
								</div>
								<div>
									<div class="font-bold text-xs text-text truncate">
										{#if trace?.connected_addr}
											{trace.connected_addr}
										{:else}
											{translateUI("Edge Gateway / Proxy")}
										{/if}
									</div>
									<div class="text-[11px] text-text-muted mt-0.5 truncate font-mono">
										{#if trace?.tls_version}
											{trace.tls_version} ({trace.tls_cipher || "Encrypted"})
										{:else}
											{translateUI("TCP Handshake & Certs")}
										{/if}
									</div>
								</div>
								<div class={`text-[10px] font-mono px-2 py-0.5 rounded border inline-block self-start ${
									isIngressFailing
										? 'text-rose-400 light:text-rose-700 bg-rose-500/10 border-rose-500/25'
										: 'text-indigo-400 light:text-indigo-700 bg-indigo-500/10 border-indigo-500/25'
								}`}>
									{#if isIngressFailing}
										{translateUI("FAIL •")} {failingHop?.toUpperCase()} {translateUI("Error")}
									{:else if trace?.tls_handshake_ms != null || trace?.tcp_connect_ms != null}
										{translateUI("PASS •")} {(trace.tcp_connect_ms || 0) + (trace.tls_handshake_ms || 0)}{translateUI("ms Handshake")}
									{:else}
										{translateUI("PASS • Gateway OK")}
									{/if}
								</div>
							</div>

							<!-- Hop 4: Target Application Response -->
							<div
								class={`p-3.5 rounded-xl border flex flex-col justify-between space-y-2 relative ${
									isAppFailing
										? "bg-rose-500/10 border-rose-500/60 shadow-[var(--shadow-card)] shadow-rose-500/10"
										: "bg-surface-elevated border-border"
								}`}
							>
								<div class="flex items-center justify-between">
									<span class="text-[10px] font-mono font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
										<Server class="w-3 h-3 text-emerald-400 light:text-emerald-700" />
										{translateUI("Hop 4: Target App")}
									</span>
									{#if isAppFailing}
										<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
									{:else if ep.status === "up"}
										<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
									{:else}
										<span class="w-2 h-2 rounded-full bg-text-muted/10"></span>
									{/if}
								</div>
								<div>
									<div class="font-bold text-xs text-text">
										{#if ep.last_status_code}
											HTTP {ep.last_status_code}
										{:else}
											{translateUI("Target Service")}
										{/if}
									</div>
									<div class="text-[11px] text-text-muted mt-0.5 truncate font-mono">
										{#if trace?.ttfb_ms != null}
											{translateUI("TTFB:")} {trace.ttfb_ms}ms
										{:else if ep.last_message}
											{ep.last_message}
										{:else}
											{translateUI("Container Response")}
										{/if}
									</div>
								</div>
								<div class={`text-[10px] font-mono px-2 py-0.5 rounded border inline-block self-start ${
									isAppFailing
										? 'text-rose-400 light:text-rose-700 bg-rose-500/10 border-rose-500/25'
										: 'text-emerald-400 light:text-emerald-700 bg-emerald-500/10 border-emerald-500/25'
								}`}>
									{#if isAppFailing}
										{translateUI("FAIL •")} {ep.last_message || "Non-200 Status"}
									{:else if ep.status === "up"}
										{translateUI("PASS • Verified")}
									{:else}
										{translateUI("Pending")}
									{/if}
								</div>
							</div>
						</div>

						<!-- Failure Diagnostic Hint Bar -->
						{#if isFailing && ep.last_message}
							<div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between gap-3 text-xs">
								<div class="flex items-center gap-2 text-rose-300 light:text-rose-700">
									<XCircle class="w-4 h-4 text-rose-400 light:text-rose-700 shrink-0" />
									<span><strong class="font-semibold">{translateUI("Failing Point:")}</strong> {ep.last_message}</span>
								</div>
								{#if failingHop}
									<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-200 light:text-rose-700 uppercase font-bold">
										{translateUI("Hop:")} {failingHop}
									</span>
								{/if}
							</div>
						{/if}
					{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
