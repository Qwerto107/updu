<script lang="ts">
    import { t as translateUI } from '$lib/i18n/index.svelte';
    import NotificationChannelsSection from '$lib/components/settings/NotificationChannelsSection.svelte';
</script>

<svelte:head>
    <title>{translateUI("Settings / Notifications – updu")}</title>
</svelte:head>

<NotificationChannelsSection />