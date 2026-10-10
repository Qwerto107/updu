<script lang="ts">
    import { languageStore, t } from '$lib/i18n/index.svelte';
    import { locales } from '$lib/i18n/locales';
</script>

<select
    aria-label={t('Language')}
    class="input-base text-xs w-auto max-w-40 py-1.5"
    value={languageStore.preference}
    onchange={(event) => languageStore.select(event.currentTarget.value)}
>
    <option value="">{t('Use instance default')}</option>
    {#each locales as locale (locale.code)}
        <option value={locale.code}>{locale.name}</option>
    {/each}
</select>
