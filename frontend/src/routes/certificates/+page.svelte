<script lang="ts">
    // 管理页和公共状态页复用风险表格，避免两处证书状态出现差异。
    import { t as translateUI, languageStore } from '$lib/i18n/index.svelte';
    import TLSCertificateTable from '$lib/components/TLSCertificateTable.svelte';
    import { certificateExpiry, certificateVerification, verificationLabels } from '$lib/tls-certificate';
	import { onMount } from "svelte";
	import {
		listCertificates,
		testCertificate,
		type TLSCertificate,
	} from "$lib/api/certificates";
	import { ShieldCheck, Lock, RefreshCw } from "lucide-svelte";
	import Button from "$lib/components/ui/button.svelte";
	import Spinner from "$lib/components/ui/spinner.svelte";
	import { Dialog } from "bits-ui";

	let certs = $state<TLSCertificate[]>([]);
	let loading = $state(true);
	let error = $state("");

	// 握手检测仍保留独立弹窗，结果与列表共用有效期计算。
	let testDialogOpen = $state(false);
	let testHost = $state("");
	let testPort = $state(443);
	let testLoading = $state(false);
	let testResult = $state<TLSCertificate | null>(null);
	let testError = $state("");

	async function loadCerts() {
		try {
			loading = true;
			error = "";
			certs = (await listCertificates()) || [];
		} catch (e: any) {
			error = e?.message || "Failed to load TLS certificates";
		} finally {
			loading = false;
		}
	}

	async function runTestHandshake() {
		if (!testHost.trim()) return;
		try {
			testLoading = true;
			testError = "";
			testResult = null;
			testResult = await testCertificate(testHost.trim(), testPort);
			await loadCerts();
		} catch (e: any) {
			testError = e?.message || "Handshake failed";
		} finally {
			testLoading = false;
		}
	}

	onMount(() => {
		void loadCerts();
	});

	function getExpiryBadge(cert: TLSCertificate) {
        const expiry = certificateExpiry(cert);
        const colors = {
            danger: "bg-rose-500/10 text-rose-400 light:text-rose-700 border-rose-500/20",
            warning: "bg-amber-500/10 text-amber-400 light:text-amber-800 border-amber-500/20",
            positive: "bg-emerald-500/10 text-emerald-400 light:text-emerald-700 border-emerald-500/20",
            neutral: "text-text-muted border-border",
        };
        return { ...expiry, class: colors[expiry.tone] };
    }

    function formatDate(iso: string): string {
        const timestamp = Date.parse(iso);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return translateUI('No data');
        return new Date(timestamp).toLocaleDateString(languageStore.current, { month: 'short', day: 'numeric', year: 'numeric' });
    }
</script>

<svelte:head>
	<title>{translateUI("TLS Certificates Dashboard – updu")}</title>
</svelte:head>

<div class="space-y-6">
	<!-- 风险优先展示，操作入口保留在页面顶部。 -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-text flex items-center gap-2.5">
				<Lock class="w-7 h-7 text-emerald-400 light:text-emerald-700" />
				{translateUI("TLS Certificates")}
			</h1>
			<p class="text-sm text-text-muted mt-1">
				{translateUI("Review certificate expiry and validation, with the most urgent certificates first.")}
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Button
				variant="secondary"
				class="gap-1.5 text-xs font-semibold text-emerald-400 light:text-emerald-700 border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20"
				onclick={() => {
					testHost = "";
					testPort = 443;
					testResult = null;
					testError = "";
					testDialogOpen = true;
				}}
			>
				<ShieldCheck class="w-4 h-4" />
				{translateUI("Test TLS Handshake")}
			</Button>

			<Button variant="secondary" onclick={loadCerts} disabled={loading} class="gap-1.5 text-xs">
				<RefreshCw class={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400 light:text-emerald-700" : ""}`} />
				{translateUI("Refresh")}
			</Button>
		</div>
	</div>

	{#if error}
        <div role="alert" class="p-4 rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-300 light:text-rose-700">
            <p class="font-medium text-sm">{translateUI('Failed to load certificates')}</p>
            <p class="text-xs mt-1">{translateUI(error)}</p>
        </div>
    {/if}
    {#if loading && certs.length === 0}
        <div class="flex items-center justify-center gap-3 min-h-40 border border-border rounded-xl bg-surface-elevated">
            <Spinner class="w-5 h-5 text-emerald-400 light:text-emerald-700" />
            <p class="text-sm text-text-muted">{translateUI('Loading certificates...')}</p>
        </div>
    {:else}
        <TLSCertificateTable certificates={certs} />
        {#if !certs.length && !error}
            <p class="text-xs text-text-muted">{translateUI('Run a probe on an HTTP/HTTPS endpoint or click "Test TLS Handshake" above to audit a domain.')}</p>
        {/if}
    {/if}

    <!-- 握手检测保留管理权限，公共表格不提供操作入口。 -->
	<Dialog.Root bind:open={testDialogOpen}>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fade-in" />
			<Dialog.Content class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto bg-surface-elevated border border-border rounded-2xl p-6 z-50 shadow-2xl space-y-4">
				<div class="flex items-center justify-between border-b border-border pb-3">
					<div class="flex items-center gap-2">
						<ShieldCheck class="w-5 h-5 text-emerald-400 light:text-emerald-700" />
						<Dialog.Title class="font-bold text-base text-text">{translateUI("Audit Live TLS Handshake")}</Dialog.Title>
					</div>
					<Dialog.Close aria-label={translateUI("Close")} class="text-text-muted hover:text-text">✕</Dialog.Close>
				</div>

				<Dialog.Description class="sr-only">{translateUI('Enter a hostname and port to inspect its TLS certificate.')}</Dialog.Description>

                <div class="space-y-3">
					<div>
						<label for="test-host-input" class="text-xs font-semibold text-text">{translateUI("Hostname / FQDN")}</label>
						<input
							id="test-host-input"
							type="text"
							placeholder={translateUI("e.g. vault.kn8design.com or google.com")}
							bind:value={testHost}
							class="w-full mt-1 px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text focus:outline-none focus:border-emerald-500"
						/>
					</div>
					<div>
						<label for="test-port-input" class="text-xs font-semibold text-text">{translateUI("Port (Default 443)")}</label>
						<input
							id="test-port-input"
							type="number"
							min="1"
							max="65535"
							bind:value={testPort}
							class="w-full mt-1 px-3 py-2 rounded-xl bg-surface border border-border text-sm text-text focus:outline-none focus:border-emerald-500"
						/>
					</div>
					<Button
						variant="default"
						class="w-full mt-2"
						disabled={testLoading || !testHost.trim()}
						onclick={runTestHandshake}
					>
						{#if testLoading}
							<Spinner class="w-4 h-4 text-slate-950 mr-2" />
							{translateUI("Auditing Handshake...")}
						{:else}
							{translateUI("Perform TLS Audit")}
						{/if}
					</Button>
				</div>

				{#if testError}
					<div role="alert" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 light:text-rose-700 text-xs break-words">
						{testError}
					</div>
				{/if}

				{#if testResult}
					{@const testBadge = getExpiryBadge(testResult)}
					<div class="p-4 rounded-xl bg-surface border border-border space-y-2.5 text-xs animate-fade-in">
						<div class="flex items-start justify-between gap-3">
							<span class="font-bold text-sm text-text break-all">{testResult.domain}</span>
							<span class={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${testBadge.class}`}>
								{translateUI(testBadge.label, { count: testBadge.days })}
							</span>
						</div>
						<div class="flex justify-between text-text-muted">
							<span>{translateUI("Issuer:")}</span>
							<span class="text-text font-semibold text-right break-words min-w-0">{testResult.issuer}</span>
						</div>
						<div class="flex justify-between text-text-muted">
							<span>{translateUI("Verification:")}</span>
                            <span class="text-text font-semibold">{translateUI(verificationLabels[certificateVerification(testResult)])}</span>
                        </div>
                        <div class="flex justify-between text-text-muted">
                            <span>{translateUI("Valid Until:")}</span>
							<span class="text-text font-semibold">{formatDate(testResult.valid_until)}</span>
						</div>
						<div class="flex justify-between text-text-muted">
							<span>{translateUI("Signature Algorithm:")}</span>
							<span class="text-text font-mono text-right break-words min-w-0">{testResult.signature_algorithm}</span>
						</div>
						{#if testResult.sans && testResult.sans.length > 0}
							<div>
								<span class="text-text-muted block mb-1">{translateUI("SANs:")}</span>
								<div class="flex flex-wrap gap-1">
									{#each testResult.sans as san}
										<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background text-text break-all">{san}</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
</div>
