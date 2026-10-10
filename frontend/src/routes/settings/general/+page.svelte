<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import GeneralSettingsSection from '$lib/components/settings/GeneralSettingsSection.svelte';
</script>

<svelte:head>
    <title>{translateUI("Settings / General – updu")}</title>
</svelte:head>

<GeneralSettingsSection />