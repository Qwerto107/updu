<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import SystemSettingsSection from '$lib/components/settings/SystemSettingsSection.svelte';
</script>

<svelte:head>
    <title>{translateUI("Settings / System – updu")}</title>
</svelte:head>

<SystemSettingsSection />