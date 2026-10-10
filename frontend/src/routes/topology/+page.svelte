<script lang="ts">
    // 中性颜色使用主题变量，状态文字单独适配浅色，弹窗也遵循相同规则。
    import { t as translateUI } from '$lib/i18n/index.svelte';
	import { onMount, onDestroy } from "svelte";
	import {
		getNetworkTopology,
		probeService,
		createService,
		createZone,
		deleteService,
		createServiceEndpoint,
		deleteServiceEndpoint,
		type NetworkTopology,
		type Service,
		type ServiceEndpoint,
	} from "$lib/api/services";
	import {
		Network,
		Layers,
		Grid3X3,
		Activity,
		RefreshCw,
		Radio,
		Server,
		Plus,
		Shield,
		ShieldAlert,
		Trash2,
	} from "lucide-svelte";
	import Button from "$lib/components/ui/button.svelte";
	import Spinner from "$lib/components/ui/spinner.svelte";
	import Modal from "$lib/components/ui/modal.svelte";
	import ZoneCardsView from "./ZoneCardsView.svelte";
	import ReachabilityMatrixView from "./ReachabilityMatrixView.svelte";
	import HopInspectorView from "./HopInspectorView.svelte";

	let topology = $state<NetworkTopology | null>(null);
	let loading = $state(true);
	let error = $state("");
	let viewMode = $state<"zones" | "matrix" | "inspector">("zones");
	let probingId = $state<string | null>(null);
	let selectedService = $state<Service | null>(null);
	let focusedScopeId = $state<string | null>(null);

	// Modals State
	let showAddServiceModal = $state(false);
	let showAddEndpointModal = $state(false);
	let submitting = $state(false);
	let formError = $state("");

	// Add Service Form
	let newServiceName = $state("");
	let newServiceType = $state("web");
	let newServiceZoneId = $state("default");
	let newServiceHAGroup = $state("");
	let newServiceScopeId = $state("public");
	let newServiceTarget = $state("https://");
	let newServiceInterval = $state(60);
	let newServiceTimeout = $state(10);

	// Add Zone Form
	let showAddZoneModal = $state(false);
	let newZoneId = $state("");
	let newZoneName = $state("");
	let newZoneDescription = $state("");

	// Add Endpoint Form
	let newEndpointName = $state("");
	let newEndpointScopeId = $state("lan");
	let newEndpointTargetType = $state("http");
	let newEndpointTarget = $state("http://");
	let newEndpointInterval = $state(30);
	let newEndpointTimeout = $state(10);
	let newEndpointIsPrimary = $state(false);
	let newEndpointIsIsolated = $state(false);

	// Deletion progress
	let deletingEndpointId = $state<string | null>(null);
	let deletingServiceId = $state<string | null>(null);

	// SSE stream
	let eventSource: EventSource | null = null;

	async function loadTopology() {
		try {
			loading = true;
			error = "";
			topology = await getNetworkTopology();
			if (selectedService && topology?.services) {
				selectedService = topology.services.find((s) => s.id === selectedService?.id) || null;
			}
		} catch (e: any) {
			error = e?.message || "Failed to load network topology";
		} finally {
			loading = false;
		}
	}

	async function runProbe(serviceId: string) {
		probingId = serviceId;
		try {
			await probeService(serviceId);
			await loadTopology();
			if (selectedService && selectedService.id === serviceId && topology) {
				selectedService = topology?.services?.find((s) => s.id === serviceId) || null;
			}
		} catch (e: any) {
			alert("Probe failed: " + (e?.message || "Unknown error"));
		} finally {
			probingId = null;
		}
	}

	function handleSelectService(service: Service, focusedScope?: string) {
		selectedService = service;
		focusedScopeId = focusedScope || null;
		viewMode = "inspector";
	}

	function handleOpenAddService(zoneId?: string) {
		formError = "";
		newServiceName = "";
		newServiceHAGroup = "";
		newServiceTarget = "https://";
		if (zoneId) newServiceZoneId = zoneId;
		showAddServiceModal = true;
	}

	function handleOpenAddEndpoint(service: Service, scopeId?: string) {
		formError = "";
		selectedService = service;
		newEndpointName = "";
		newEndpointTarget = scopeId === "public" ? "https://" : "http://";
		if (scopeId) newEndpointScopeId = scopeId;
		newEndpointIsPrimary = false;
		newEndpointIsIsolated = false;
		showAddEndpointModal = true;
	}

	async function handleMarkIsolated(service: Service, scopeId: string) {
		try {
			await createServiceEndpoint(service.id, {
				name: `Isolated (${scopeId.toUpperCase()})`,
				scope_id: scopeId,
				target_type: "isolated",
				config: {},
				interval_s: 300,
				timeout_s: 1,
				retries: 0,
				is_primary: false,
				is_isolated: true,
			});
			await loadTopology();
			if (topology && selectedService) {
				selectedService = topology.services?.find((s) => s.id === selectedService?.id) || null;
			}
		} catch (err: any) {
			alert("Failed to mark endpoint as isolated: " + (err?.message || "Unknown error"));
		}
	}

	function connectSSE() {
		if (eventSource) return;
		eventSource = new EventSource("/api/v1/events");

		eventSource.addEventListener("service:status", (e: MessageEvent) => {
			try {
				const data = JSON.parse(e.data);
				if (!topology) return;
				if (topology.services) {
					const idx = topology.services.findIndex((s) => s.id === data.id);
					if (idx !== -1) {
						topology.services[idx].status = data.status;
						topology.services[idx].diagnosis = data.diagnosis;
						if (data.endpoints) {
							topology.services[idx].endpoints = data.endpoints;
						}
					}
				}
				if (topology.edges) {
					topology.edges = topology.edges.map((edge) => {
						if (edge.service_id === data.id) {
							const ep = data.endpoints?.find((x: any) => x.id === edge.endpoint_id);
							if (ep) {
								return {
									...edge,
									status: ep.status,
									latency_ms: ep.last_latency_ms,
									message: ep.last_message,
									metadata: ep.last_metadata,
								};
							}
						}
						return edge;
					});
				}
				if (selectedService && selectedService.id === data.id) {
					selectedService = {
						...selectedService,
						status: data.status,
						diagnosis: data.diagnosis,
						endpoints: data.endpoints || selectedService.endpoints,
					};
				}
			} catch (err) {
				console.error("SSE parse error", err);
			}
		});

		eventSource.onerror = () => {
			eventSource?.close();
			eventSource = null;
			setTimeout(() => connectSSE(), 5000);
		};
	}

	async function handleCreateService(e: Event) {
		e.preventDefault();
		if (!newServiceName.trim()) {
			formError = "Service name is required";
			return;
		}
		submitting = true;
		formError = "";
		try {
			const targetType = newServiceType === "web" ? "http" : newServiceType;
			const config = targetType === "http"
				? { url: newServiceTarget.trim() }
				: { host: newServiceTarget.trim() };

			await createService({
				name: newServiceName.trim(),
				type: newServiceType,
				zone_id: newServiceZoneId,
				ha_group: newServiceHAGroup.trim() || undefined,
				enabled: true,
				endpoints: [
					{
						id: "",
						service_id: "",
						name: "Primary Ingress",
						scope_id: newServiceScopeId,
						target_type: targetType,
						config,
						interval_s: Number(newServiceInterval) || 60,
						timeout_s: Number(newServiceTimeout) || 10,
						retries: 2,
						is_primary: true,
					},
				],
			});
			showAddServiceModal = false;
			newServiceName = "";
			newServiceHAGroup = "";
			newServiceTarget = "https://";
			await loadTopology();
		} catch (err: any) {
			formError = err?.message || "Failed to create service";
		} finally {
			submitting = false;
		}
	}

	async function handleCreateZone(e: Event) {
		e.preventDefault();
		if (!newZoneId.trim() || !newZoneName.trim()) {
			formError = "Zone ID and Name are required";
			return;
		}
		submitting = true;
		formError = "";
		try {
			await createZone({
				id: newZoneId.trim().toLowerCase(),
				name: newZoneName.trim(),
				description: newZoneDescription.trim() || undefined,
			});
			showAddZoneModal = false;
			newZoneId = "";
			newZoneName = "";
			newZoneDescription = "";
			await loadTopology();
		} catch (err: any) {
			formError = err?.message || "Failed to create zone";
		} finally {
			submitting = false;
		}
	}

	async function handleCreateEndpoint(e: Event) {
		e.preventDefault();
		if (!selectedService) return;
		const name = newEndpointName.trim() || (newEndpointIsIsolated ? `Isolated (${newEndpointScopeId.toUpperCase()})` : "");
		if (!name) {
			formError = "Endpoint name is required";
			return;
		}
		submitting = true;
		formError = "";
		try {
			const config = newEndpointIsIsolated
				? {}
				: newEndpointTargetType === "http"
				? { url: newEndpointTarget.trim() }
				: { host: newEndpointTarget.trim() };

			await createServiceEndpoint(selectedService.id, {
				name,
				scope_id: newEndpointScopeId,
				target_type: newEndpointIsIsolated ? "isolated" : newEndpointTargetType,
				config,
				interval_s: Number(newEndpointInterval) || 30,
				timeout_s: Number(newEndpointTimeout) || 10,
				retries: 2,
				is_primary: newEndpointIsIsolated ? false : newEndpointIsPrimary,
				is_isolated: newEndpointIsIsolated,
			});
			showAddEndpointModal = false;
			newEndpointName = "";
			newEndpointTarget = "http://";
			newEndpointIsPrimary = false;
			newEndpointIsIsolated = false;
			await loadTopology();
			if (topology && selectedService) {
				selectedService = topology.services?.find((s) => s.id === selectedService?.id) || null;
			}
		} catch (err: any) {
			formError = err?.message || "Failed to create endpoint";
		} finally {
			submitting = false;
		}
	}

	async function handleDeleteEndpoint(serviceId: string, endpointId: string) {
		if (!confirm("Are you sure you want to delete this endpoint?")) return;
		deletingEndpointId = endpointId;
		try {
			await deleteServiceEndpoint(serviceId, endpointId);
			await loadTopology();
			if (topology && selectedService) {
				selectedService = topology.services?.find((s) => s.id === selectedService?.id) || null;
			}
		} catch (err: any) {
			alert("Failed to delete endpoint: " + (err?.message || "Unknown error"));
		} finally {
			deletingEndpointId = null;
		}
	}

	async function handleDeleteService(serviceId: string) {
		const targetSvc = topology?.services?.find((s) => s.id === serviceId) || selectedService;
		if (!confirm(`Are you sure you want to delete service "${targetSvc?.name || serviceId}" and all its endpoints?`)) return;
		deletingServiceId = serviceId;
		try {
			await deleteService(serviceId);
			if (selectedService?.id === serviceId) {
				selectedService = null;
			}
			await loadTopology();
		} catch (err: any) {
			alert("Failed to delete service: " + (err?.message || "Unknown error"));
		} finally {
			deletingServiceId = null;
		}
	}

	onMount(() => {
		void loadTopology();
		connectSSE();
	});

	onDestroy(() => {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	});
</script>

<svelte:head>
	<title>{translateUI("Network Topology & Troubleshooting – updu")}</title>
</svelte:head>

<div class="space-y-6">
	<!-- Top Header Bar -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-text flex items-center gap-2.5">
				<Network class="w-7 h-7 text-emerald-400 light:text-emerald-700" />
				{translateUI("Network Topology & Diagnostics")}
			</h1>
			<p class="text-sm text-text-muted mt-1">
				{translateUI("Zone perimeters, cross-fabric reachability matrices, and hop-by-hop diagnostic autopsies.")}
			</p>
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<!-- View Mode Toggle: Zones | Matrix | Hop Inspector -->
			<div class="inline-flex rounded-lg bg-surface-elevated p-1 border border-border">
				<button
					type="button"
					onclick={() => (viewMode = "zones")}
					class={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
						viewMode === "zones"
							? "bg-emerald-500 text-slate-950 font-semibold shadow"
							: "text-text-muted hover:text-text"
					}`}
				>
					<Layers class="w-3.5 h-3.5" />
					{translateUI("Zone Overview")}
				</button>
				<button
					type="button"
					onclick={() => (viewMode = "matrix")}
					class={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
						viewMode === "matrix"
							? "bg-emerald-500 text-slate-950 font-semibold shadow"
							: "text-text-muted hover:text-text"
					}`}
				>
					<Grid3X3 class="w-3.5 h-3.5" />
					{translateUI("Reachability Matrix")}
				</button>
				<button
					type="button"
					onclick={() => {
						viewMode = "inspector";
						if (!selectedService && topology?.services?.length) {
							selectedService = topology.services.find((s) => s.status === "degraded" || s.status === "down") || topology.services[0];
						}
					}}
					class={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
						viewMode === "inspector"
							? "bg-emerald-500 text-slate-950 font-semibold shadow"
							: "text-text-muted hover:text-text"
					}`}
				>
					<Activity class="w-3.5 h-3.5" />
					{translateUI("Hop Inspector")}
				</button>
			</div>

			<Button variant="secondary" onclick={loadTopology} disabled={loading} class="gap-1.5 text-xs">
				<RefreshCw class={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400 light:text-emerald-700" : ""}`} />
				{translateUI("Refresh")}
			</Button>

			<Button
				variant="outline"
				onclick={() => {
					formError = "";
					newZoneId = "";
					newZoneName = "";
					newZoneDescription = "";
					showAddZoneModal = true;
				}}
				class="gap-1.5 text-xs border-border hover:bg-background text-text"
			>
				<Layers class="w-3.5 h-3.5 text-blue-400 light:text-blue-700" />
				{translateUI("Add Zone")}
			</Button>

			<Button
				variant="default"
				onclick={() => handleOpenAddService()}
				class="gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
			>
				<Plus class="w-3.5 h-3.5" />
				{translateUI("Add Service")}
			</Button>
		</div>
	</div>

	{#if loading && !topology}
		<div class="flex flex-col items-center justify-center min-h-[400px] border border-border rounded-xl bg-surface-elevated">
			<Spinner class="w-8 h-8 text-emerald-400 light:text-emerald-700" />
			<p class="text-sm text-text-muted mt-3">{translateUI("Synthesizing network topology graph...")}</p>
		</div>
	{:else if error}
		<div class="p-6 rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-300 light:text-rose-700">
			<p class="font-medium">{translateUI("Failed to load topology")}</p>
			<p class="text-sm text-rose-400 light:text-rose-700 mt-1">{translateUI(error ?? '')}</p>
			<Button variant="outline" class="mt-4 text-xs" onclick={loadTopology}>{translateUI("Try Again")}</Button>
		</div>
	{:else if topology}
		<!-- Stats Banner -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
			<div class="p-3.5 rounded-xl border border-border bg-surface-elevated flex items-center justify-between">
				<div>
					<span class="text-xs text-text-muted uppercase tracking-wider font-semibold">{translateUI("Prober Nodes")}</span>
					<div class="text-xl font-bold text-text mt-0.5">{topology.nodes?.length || 0}</div>
				</div>
				<Radio class="w-6 h-6 text-emerald-400/50 light:text-emerald-700" />
			</div>
			<div class="p-3.5 rounded-xl border border-border bg-surface-elevated flex items-center justify-between">
				<div>
					<span class="text-xs text-text-muted uppercase tracking-wider font-semibold">{translateUI("Zones")}</span>
					<div class="text-xl font-bold text-text mt-0.5">{topology.zones?.length || 0}</div>
				</div>
				<Layers class="w-6 h-6 text-blue-400/50 light:text-blue-700" />
			</div>
			<div class="p-3.5 rounded-xl border border-border bg-surface-elevated flex items-center justify-between">
				<div>
					<span class="text-xs text-text-muted uppercase tracking-wider font-semibold">{translateUI("Services")}</span>
					<div class="text-xl font-bold text-text mt-0.5">{topology.services?.length || 0}</div>
				</div>
				<Server class="w-6 h-6 text-indigo-400/50 light:text-indigo-700" />
			</div>
			<div class="p-3.5 rounded-xl border border-border bg-surface-elevated flex items-center justify-between">
				<div>
					<span class="text-xs text-text-muted uppercase tracking-wider font-semibold">{translateUI("Ingress Endpoints")}</span>
					<div class="text-xl font-bold text-text mt-0.5">{topology.edges?.length || 0}</div>
				</div>
				<Activity class="w-6 h-6 text-emerald-400/50 light:text-emerald-700" />
			</div>
		</div>

		<!-- VIEW 1: Zone Boundary Cards -->
		{#if viewMode === "zones"}
			<ZoneCardsView
				{topology}
				{probingId}
				onSelectService={handleSelectService}
				onRunProbe={runProbe}
				onAddService={handleOpenAddService}
				onAddEndpoint={(s) => handleOpenAddEndpoint(s)}
			/>
		{/if}

		<!-- VIEW 2: Reachability Matrix -->
		{#if viewMode === "matrix"}
			<ReachabilityMatrixView
				{topology}
				{probingId}
				onSelectService={handleSelectService}
				onRunProbe={runProbe}
				onAddEndpoint={handleOpenAddEndpoint}
				onMarkIsolated={handleMarkIsolated}
			/>
		{/if}

		<!-- VIEW 3: Hop-Based Troubleshooting Inspector -->
		{#if viewMode === "inspector"}
			<HopInspectorView
				{topology}
				service={selectedService || (topology.services?.length ? topology.services[0] : null)}
				{focusedScopeId}
				{probingId}
				onSelectService={(s: Service) => {
					selectedService = s;
					focusedScopeId = null;
				}}
				onRunProbe={runProbe}
				onAddEndpoint={(s: Service) => handleOpenAddEndpoint(s)}
				onDeleteEndpoint={handleDeleteEndpoint}
				onDeleteService={handleDeleteService}
				onClose={() => (viewMode = "zones")}
			/>
		{/if}
	{/if}

	<!-- Add Zone Modal -->
	<Modal
		bind:open={showAddZoneModal}
		title={translateUI("Create Infrastructure Zone")}
		description={translateUI("Define a physical location, datacenter, or administrative failure domain boundary.")}
	>
		<form onsubmit={handleCreateZone} class="space-y-4">
			{#if formError}
				<div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 light:text-rose-700">
					{translateUI(formError ?? '')}
				</div>
			{/if}

			<div class="space-y-1.5">
				<label for="zone-id" class="text-xs font-semibold text-text">{translateUI("Zone ID (slug) *")}</label>
				<input
					id="zone-id"
					type="text"
					bind:value={newZoneId}
					placeholder={translateUI("e.g. cloud-vps, home-rack, branch-office")}
					required
					class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-blue-500 focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="zone-name" class="text-xs font-semibold text-text">{translateUI("Zone Display Name *")}</label>
				<input
					id="zone-name"
					type="text"
					bind:value={newZoneName}
					placeholder={translateUI("e.g. Cloud VPS (Frankfurt), Home Rack")}
					required
					class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-blue-500 focus:outline-none"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="zone-desc" class="text-xs font-semibold text-text">{translateUI("Description (Optional)")}</label>
				<input
					id="zone-desc"
					type="text"
					bind:value={newZoneDescription}
					placeholder={translateUI("e.g. Offsite failover node and public reverse proxy")}
					class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-blue-500 focus:outline-none"
				/>
			</div>

			<div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
				<Button type="button" variant="secondary" onclick={() => (showAddZoneModal = false)}>
					{translateUI("Cancel")}
				</Button>
				<Button
					type="submit"
					disabled={submitting}
					class="bg-blue-600 hover:bg-blue-500 text-white font-bold"
				>
					{submitting ? translateUI("Creating...") : translateUI("Create Zone")}
				</Button>
			</div>
		</form>
	</Modal>

	<!-- Add Service Modal -->
	<Modal
		bind:open={showAddServiceModal}
		title={translateUI("Add Monitored Service")}
		description={translateUI("Define an application service and its primary reachability endpoint.")}
		size="lg"
	>
		<form onsubmit={handleCreateService} class="space-y-4">
			{#if formError}
				<div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 light:text-rose-700">
					{translateUI(formError ?? '')}
				</div>
			{/if}

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<label for="svc-name" class="text-xs font-semibold text-text">{translateUI("Service Name *")}</label>
					<input
						id="svc-name"
						type="text"
						bind:value={newServiceName}
						placeholder={translateUI("e.g. Vaultwarden, Plex, Home Assistant")}
						required
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="svc-zone" class="text-xs font-semibold text-text">{translateUI("Infrastructure Zone")}</label>
					<select
						id="svc-zone"
						bind:value={newServiceZoneId}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					>
						{#each topology?.zones || [{ id: "default", name: "Default Zone" }] as z}
							<option value={z.id}>{z.name} ({z.id})</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<label for="svc-type" class="text-xs font-semibold text-text">{translateUI("Service Type")}</label>
					<select
						id="svc-type"
						bind:value={newServiceType}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					>
						<option value="web">{translateUI("Web (HTTP/HTTPS)")}</option>
						<option value="ping">{translateUI("Ping (ICMP Echo)")}</option>
						<option value="tcp">{translateUI("TCP Port")}</option>
						<option value="dns">{translateUI("DNS Resolution")}</option>
						<option value="tls">{translateUI("TLS Certificate")}</option>
					</select>
				</div>

				<div class="space-y-1.5">
					<label for="svc-hagroup" class="text-xs font-semibold text-text">{translateUI("HA Cluster Group (Optional)")}</label>
					<input
						id="svc-hagroup"
						type="text"
						bind:value={newServiceHAGroup}
						placeholder={translateUI("e.g. vaultwarden-ha, adguard-cluster")}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<label for="svc-scope" class="text-xs font-semibold text-text">{translateUI("Primary Endpoint Scope")}</label>
					<select
						id="svc-scope"
						bind:value={newServiceScopeId}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					>
						<option value="public">{translateUI("Public WAN (Cloudflare / Ingress)")}</option>
						<option value="tailnet">{translateUI("Tailnet (Private VPN Overlay)")}</option>
						<option value="lan">{translateUI("Local LAN (Direct Host IP)")}</option>
					</select>
				</div>

				<div class="space-y-1.5">
					<label for="svc-target" class="text-xs font-semibold text-text">
						{newServiceType === "web" ? translateUI("Target URL *") : "Target Host / IP *"}
					</label>
					<input
						id="svc-target"
						type="text"
						bind:value={newServiceTarget}
						placeholder={newServiceType === "web" ? "https://vault.example.com" : "192.168.1.10"}
						required
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<label for="svc-interval" class="text-xs font-semibold text-text">{translateUI("Probe Interval (sec)")}</label>
					<input
						id="svc-interval"
						type="number"
						min="10"
						bind:value={newServiceInterval}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="svc-timeout" class="text-xs font-semibold text-text">{translateUI("Timeout (sec)")}</label>
					<input
						id="svc-timeout"
						type="number"
						min="1"
						bind:value={newServiceTimeout}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>
			</div>

			<div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
				<Button type="button" variant="secondary" onclick={() => (showAddServiceModal = false)}>
					{translateUI("Cancel")}
				</Button>
				<Button
					type="submit"
					disabled={submitting}
					class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
				>
					{submitting ? translateUI("Creating...") : translateUI("Create Service")}
				</Button>
			</div>
		</form>
	</Modal>

	<!-- Add Vantage Endpoint Modal -->
	<Modal
		bind:open={showAddEndpointModal}
		title={selectedService ? `Add Vantage Endpoint: ${selectedService.name}` : "Add Vantage Endpoint"}
		description={translateUI("Configure a vantage endpoint (e.g. LAN direct IP or Tailscale domain) for differential root-cause diagnostics.")}
		size="lg"
	>
		<form onsubmit={handleCreateEndpoint} class="space-y-4">
			{#if formError}
				<div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 light:text-rose-700">
					{translateUI(formError ?? '')}
				</div>
			{/if}

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="space-y-1.5">
					<label for="ep-name" class="text-xs font-semibold text-text">{translateUI("Endpoint Label *")}</label>
					<input
						id="ep-name"
						type="text"
						bind:value={newEndpointName}
						placeholder={translateUI("e.g. Tailscale Direct, LAN IP")}
						required
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="ep-scope" class="text-xs font-semibold text-text">{translateUI("Vantage Scope *")}</label>
					<select
						id="ep-scope"
						bind:value={newEndpointScopeId}
						class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
					>
						<option value="lan">{translateUI("LAN (Direct Local Network)")}</option>
						<option value="tailnet">{translateUI("Tailnet (Tailscale Mesh)")}</option>
						<option value="public">{translateUI("Public WAN (Cloudflare / Ingress)")}</option>
					</select>
				</div>
			</div>

			<!-- Scope Isolation Toggle -->
			<div class="p-3 rounded-xl bg-surface border border-border space-y-2">
				<div class="flex items-center gap-2">
					<input
						id="ep-isolated"
						type="checkbox"
						bind:checked={newEndpointIsIsolated}
						class="rounded border-border bg-surface-elevated text-amber-500 focus:ring-amber-500"
					/>
					<label for="ep-isolated" class="text-xs font-semibold text-text cursor-pointer flex items-center gap-1.5">
						<Shield class="w-3.5 h-3.5 text-amber-400 light:text-amber-700" />
						{translateUI("Mark as Isolated / Not Reachable in this scope")}
					</label>
				</div>
				<p class="text-[11px] text-text-muted pl-6 leading-relaxed">
					{translateUI("Designates that this service is intentionally segmented and unreachable from this scope (e.g. internal service not exposed to Public WAN). Active probes are disabled for this route and diagnostics treat it as healthy by design.")}
				</p>
			</div>

			{#if !newEndpointIsIsolated}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<label for="ep-type" class="text-xs font-semibold text-text">{translateUI("Target Type")}</label>
						<select
							id="ep-type"
							bind:value={newEndpointTargetType}
							class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-emerald-500 focus:outline-none"
						>
							<option value="http">HTTP / HTTPS</option>
							<option value="ping">{translateUI("Ping (ICMP)")}</option>
							<option value="tcp">TCP</option>
							<option value="dns">DNS</option>
							<option value="tls">TLS</option>
						</select>
					</div>

					<div class="space-y-1.5">
						<label for="ep-target" class="text-xs font-semibold text-text">
							{newEndpointTargetType === "http" ? translateUI("Target URL *") : "Target Host / IP *"}
						</label>
						<input
							id="ep-target"
							type="text"
							bind:value={newEndpointTarget}
							placeholder={newEndpointTargetType === "http" ? "http://192.168.1.50:8080" : "100.64.0.1"}
							required={!newEndpointIsIsolated}
							class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<label for="ep-interval" class="text-xs font-semibold text-text">{translateUI("Interval (sec)")}</label>
						<input
							id="ep-interval"
							type="number"
							min="10"
							bind:value={newEndpointInterval}
							class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
						/>
					</div>

					<div class="space-y-1.5">
						<label for="ep-timeout" class="text-xs font-semibold text-text">{translateUI("Timeout (sec)")}</label>
						<input
							id="ep-timeout"
							type="number"
							min="1"
							bind:value={newEndpointTimeout}
							class="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus:border-emerald-500 focus:outline-none"
						/>
					</div>
				</div>

				<div class="flex items-center gap-2 pt-1">
					<input
						id="ep-primary"
						type="checkbox"
						bind:checked={newEndpointIsPrimary}
						class="rounded border-border bg-surface text-emerald-500 focus:ring-emerald-500"
					/>
					<label for="ep-primary" class="text-xs text-text cursor-pointer">
						{translateUI("Set as primary routing endpoint for this service")}
					</label>
				</div>
			{/if}

			<div class="flex items-center justify-end gap-3 pt-4 border-t border-border">
				<Button type="button" variant="secondary" onclick={() => (showAddEndpointModal = false)}>
					{translateUI("Cancel")}
				</Button>
				<Button
					type="submit"
					disabled={submitting}
					class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
				>
					{submitting ? "Adding..." : translateUI("Add Endpoint")}
				</Button>
			</div>
		</form>
	</Modal>
</div>
