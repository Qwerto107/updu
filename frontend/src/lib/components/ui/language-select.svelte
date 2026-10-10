<script lang="ts">
    import { languageStore, t } from '$lib/i18n/index.svelte';
    import { locales } from '$lib/i18n/locales';
    import { RotateCcw } from 'lucide-svelte';

    // 常用语言显示短标签；新增语言直接使用注册表名称，不限制可选语言数量。
    const shortLabels: Record<string, string> = { 'zh-CN': '中', en: 'EN' };
    const switchLocales = [...locales].sort((a, b) =>
        Number(b.code === 'zh-CN') - Number(a.code === 'zh-CN'),
    );
</script>

<div
    role="group"
    aria-label={t('Language')}
    class="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-0.5"
>
    {#each switchLocales as locale (locale.code)}
        <button
            type="button"
            lang={locale.code}
            aria-label={locale.name}
            aria-pressed={languageStore.current === locale.code}
            title={locale.name}
            onclick={() => languageStore.select(locale.code)}
            class={`min-w-8 h-7 rounded-full px-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                languageStore.current === locale.code
                    ? 'bg-surface text-text shadow-sm ring-1 ring-border/60'
                    : 'text-text-muted hover:text-text hover:bg-surface/60'
            }`}
        >
            {shortLabels[locale.code] ?? locale.name}
        </button>
    {/each}
    <!-- 保留恢复实例默认语言的入口，避免分段开关丢失原来的跟随设置功能。 -->
    <button
        type="button"
        aria-label={t('Use instance default')}
        aria-pressed={languageStore.preference === ''}
        title={t('Use instance default')}
        onclick={() => languageStore.select('')}
        class="flex h-7 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
        <RotateCcw class="h-3 w-3" aria-hidden="true" />
    </button>
</div>
