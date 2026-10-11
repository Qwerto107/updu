<script lang="ts">
    import { ArrowUp, ArrowDown, Plus, Trash2, X } from 'lucide-svelte';
    import { t } from '$lib/i18n/index.svelte';
    import Button from '$lib/components/ui/button.svelte';
    import type { StatusCategory } from '$lib/status-categories';

    type Props = {
        categories?: StatusCategory[];
        monitors: { id: string; name: string }[];
        loading?: boolean;
    };
    let { categories = $bindable([]), monitors, loading = false }: Props = $props();

    function moveCategory(index: number, step: number) {
        const next = [...categories];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        categories = next;
    }

    function addService(index: number, id: string) {
        if (!id) return;
        // 选择已有归属的服务时直接移动，保证公开页面只展示一次。
        categories = categories.map((category, i) => ({
            ...category,
            monitor_ids: i === index
                ? [...category.monitor_ids.filter(value => value !== id), id]
                : category.monitor_ids.filter(value => value !== id),
        }));
    }

    function moveService(category: StatusCategory, index: number, step: number) {
        const next = [...category.monitor_ids];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        category.monitor_ids = next;
    }

    function serviceLabel(id: string) {
        return monitors.find(monitor => monitor.id === id)?.name ?? t('Unavailable service');
    }

    function currentCategory(id: string) {
        return categories.find(category => category.monitor_ids.includes(id))?.name;
    }
</script>

<div class="space-y-3 border-t border-border pt-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-text">{t('Custom categories')}</h3>
        <Button variant="outline" size="sm" disabled={categories.length >= 50} onclick={() => categories = [...categories, { name: '', description: '', monitor_ids: [] }]}>
            <Plus class="size-3.5" />{t('Add category')}
        </Button>
    </div>
    <p class="text-xs text-text-muted">{t('Create your own categories and add services directly. This does not change monitor groups.')}</p>
    {#each categories as category, index}
        <div class="space-y-3 rounded-xl border border-border bg-surface-elevated p-3" data-testid="category-editor">
            <div class="flex items-center justify-between gap-2">
                <span class="text-xs text-text-muted">{t('Category {number}', { number: index + 1 })}</span>
                <div class="flex gap-1">
                    <Button variant="ghost" size="sm" aria-label={t('Move category up')} disabled={index === 0} onclick={() => moveCategory(index, -1)}><ArrowUp class="size-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label={t('Move category down')} disabled={index === categories.length - 1} onclick={() => moveCategory(index, 1)}><ArrowDown class="size-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label={t('Remove category')} onclick={() => categories = categories.filter((_, i) => i !== index)}><Trash2 class="size-4" /></Button>
                </div>
            </div>
            <div class="space-y-1">
                <label for={`category-name-${index}`} class="text-xs font-medium text-text">{t('Category name')}</label>
                <input id={`category-name-${index}`} class="input-base" maxlength="100" bind:value={category.name} placeholder={t('For example: Websites')} />
            </div>
            <div class="space-y-1">
                <label for={`category-description-${index}`} class="text-xs font-medium text-text">{t('Category description')}</label>
                <input id={`category-description-${index}`} class="input-base" maxlength="500" bind:value={category.description} placeholder={t('Optional description')} />
            </div>
            <div class="space-y-1">
                <label for={`category-service-${index}`} class="text-xs font-medium text-text">{t('Add service to category')}</label>
                <select id={`category-service-${index}`} class="input-base" disabled={loading} onchange={event => {
                    addService(index, event.currentTarget.value);
                    event.currentTarget.value = '';
                }}>
                    <option value="">{t('Select a service')}</option>
                    {#each monitors.filter(monitor => !category.monitor_ids.includes(monitor.id)) as monitor}
                        <option value={monitor.id}>{monitor.name}{currentCategory(monitor.id) ? ` · ${t('Move from {category}', { category: currentCategory(monitor.id)! })}` : ''}</option>
                    {/each}
                </select>
            </div>
            {#if category.monitor_ids.length === 0}
                <p class="text-xs text-text-muted py-2">{t('No services in this category')}</p>
            {:else}
                <ul class="space-y-1">
                    {#each category.monitor_ids as id, serviceIndex (id)}
                        <li class="flex items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5" data-testid="category-service">
                            <span class="text-sm text-text break-all">{serviceLabel(id)}</span>
                            <div class="flex shrink-0">
                                <Button variant="ghost" size="sm" aria-label={t('Move service up')} disabled={serviceIndex === 0} onclick={() => moveService(category, serviceIndex, -1)}><ArrowUp class="size-3.5" /></Button>
                                <Button variant="ghost" size="sm" aria-label={t('Move service down')} disabled={serviceIndex === category.monitor_ids.length - 1} onclick={() => moveService(category, serviceIndex, 1)}><ArrowDown class="size-3.5" /></Button>
                                <Button variant="ghost" size="sm" aria-label={t('Remove service')} onclick={() => category.monitor_ids = category.monitor_ids.filter(value => value !== id)}><X class="size-3.5" /></Button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {/each}
    {#if categories.length > 0}
        <p class="text-xs text-text-muted">{t('Additional services selected below appear under Other services.')}</p>
    {/if}
</div>
