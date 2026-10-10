<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import BackupSettingsSection from '$lib/components/settings/BackupSettingsSection.svelte';
</script>

<svelte:head>
    <title>{translateUI("Settings / Backup – updu")}</title>
</svelte:head>

<BackupSettingsSection />