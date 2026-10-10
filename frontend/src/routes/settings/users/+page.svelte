<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import UsersSettingsSection from '$lib/components/settings/UsersSettingsSection.svelte';
</script>

<svelte:head>
    <title>{translateUI("Settings / Users – updu")}</title>
</svelte:head>

<UsersSettingsSection />