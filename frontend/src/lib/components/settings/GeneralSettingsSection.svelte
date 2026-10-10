<script lang="ts">
    import { onMount } from 'svelte';
    import { Bell, Globe, Image, Lock, Palette } from 'lucide-svelte';
    import Button from '$lib/components/ui/button.svelte';
    import Skeleton from '$lib/components/ui/skeleton.svelte';
    import {
        GENERAL_SETTINGS_KEYS,
        changePassword as changePasswordRequest,
        getSettings,
        type GeneralSettingKey,
        type SettingsMap,
        updateSettings,
    } from '$lib/api/settings';
    import { settingsStore } from '$lib/stores/settings.svelte';
    import { authStore } from '$lib/stores/auth.svelte';
    import { languageStore, t as translateUI } from '$lib/i18n/index.svelte';
    import { locales, normalizeLocale } from '$lib/i18n/locales';

    const themeOptions = [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
    ];

    let settings = $state<SettingsMap>({});
    let settingsLoading = $state(true);
    let settingsSaving = $state(false);
    let settingsMsg = $state('');

    let pwCurrent = $state('');
    let pwNew = $state('');
    let pwConfirm = $state('');
    let pwSaving = $state(false);
    let pwMsg = $state('');

    function syncSettings(source: SettingsMap) {
        const nextSettings = { ...source };
        nextSettings.default_language = normalizeLocale(nextSettings.default_language);

        if (!nextSettings.theme) {
            nextSettings.theme = 'dark';
        }

        if (!nextSettings.enable_custom_css) {
            nextSettings.enable_custom_css = 'false';
        }

        settings = nextSettings;
    }

    async function loadSettings() {
        try {
            settingsLoading = true;
            syncSettings((await getSettings()) || {});
        } catch {
            settings = {};
        } finally {
            settingsLoading = false;
        }
    }

    function updateSetting(key: GeneralSettingKey, value: string) {
        settings = {
            ...settings,
            [key]: value,
        };
    }

    function settingValue(key: GeneralSettingKey): string {
        return settings[key] ?? '';
    }

    function booleanSetting(key: GeneralSettingKey, fallback = false): boolean {
        const value = settings[key];

        if (value === undefined || value === '') {
            return fallback;
        }

        return value === 'true';
    }

    function toggleSetting(key: GeneralSettingKey, nextValue: boolean) {
        updateSetting(key, nextValue ? 'true' : 'false');
    }

    function selectedThemeLabel(): string {
        return (
            themeOptions.find((option) => option.value === settingValue('theme'))
                ?.label ?? 'Dark'
        );
    }

    function instanceVisibilityLabel(): string {
        return booleanSetting('enable_public') ? 'Public' : 'Private';
    }

    function buildSettingsPayload(): SettingsMap {
        const payload: SettingsMap = {};

        for (const key of GENERAL_SETTINGS_KEYS) {
            const value = settings[key];

            if (value !== undefined) {
                payload[key] = value;
            }
        }

        return payload;
    }

    async function saveSettings() {
        settingsSaving = true;
        settingsMsg = '';

        try {
            await updateSettings(buildSettingsPayload());
            await settingsStore.refresh();
            await loadSettings();
            // 保存成功后采用新的默认语言；失败时保留原有浏览器偏好。
            languageStore.setDefault(settings.default_language);
            settingsMsg = 'Settings saved successfully.';
            setTimeout(() => (settingsMsg = ''), 3000);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Failed to save settings';
            settingsMsg = `Error: ${message}`;
        } finally {
            settingsSaving = false;
        }
    }

    async function changePassword() {
        if (pwNew !== pwConfirm) {
            pwMsg = 'Error: Passwords do not match';
            return;
        }

        pwSaving = true;
        pwMsg = '';

        try {
            await changePasswordRequest(pwCurrent, pwNew);
            pwMsg = 'Password changed successfully.';
            pwCurrent = '';
            pwNew = '';
            pwConfirm = '';
            setTimeout(() => (pwMsg = ''), 3000);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to change password';
            pwMsg = `Error: ${message}`;
        } finally {
            pwSaving = false;
        }
    }

    onMount(() => {
        void loadSettings();
    });
</script>

<div class="settings-stack">
    {#if settingsMsg}
        <div
            class={[
                'settings-banner',
                settingsMsg.startsWith('Error')
                    ? 'settings-banner-danger'
                    : 'settings-banner-success',
            ]}
            aria-live="polite"
        >
            {translateUI(settingsMsg ?? '')}
        </div>
    {/if}

    <section class="card settings-section">
        <div class="settings-section-header">
            <div class="settings-section-icon">
                <Globe class="size-4 text-primary" />
            </div>
            <div>
                <h2 class="text-base font-semibold text-text">{translateUI("Instance Profile")}</h2>
                <p class="text-[11px] text-text-subtle mt-0.5">
                    {translateUI("Define the public identity and core URLs for this updu instance.")}
                </p>
                {#if !settingsLoading}
                    <div class="settings-meta-row">
                        <span class="settings-pill settings-pill-primary">
                            {translateUI(selectedThemeLabel())} {translateUI("theme")}
                        </span>
                        <span class="settings-pill settings-pill-muted">
                            {translateUI(instanceVisibilityLabel())}
                        </span>
                        <span class="settings-pill settings-pill-muted">
                            {booleanSetting('enable_custom_css') ? translateUI("Custom CSS enabled") : translateUI("Default styling")}
                        </span>
                    </div>
                {/if}
            </div>
        </div>

        {#if settingsLoading}
            <div class="grid gap-4 lg:grid-cols-2">
                {#each Array.from({ length: 6 }) as _, index (index)}
                    <div class="space-y-2">
                        <Skeleton height="h-4" width="w-28" />
                        <Skeleton height="h-10" />
                    </div>
                {/each}
            </div>
        {:else}
            <div class="grid gap-4 lg:grid-cols-2">
                <div class="space-y-1.5 lg:col-span-2">
                    <label class="text-sm font-medium text-text-muted" for="site-name">
                        {translateUI("Site Name")}
                    </label>
                    <input
                        id="site-name"
                        name="site_name"
                        type="text"
                        value={settingValue('site_name')}
                        oninput={(event) =>
                            updateSetting(
                                'site_name',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="updu"
                    />
                </div>

                <div class="space-y-1.5 lg:col-span-2">
                    <label
                        class="text-sm font-medium text-text-muted"
                        for="site-description"
                    >
                        {translateUI("Site Description")}
                    </label>
                    <textarea
                        id="site-description"
                        name="site_description"
                        class="input-base min-h-28 resize-y"
                        value={settingValue('site_description')}
                        placeholder={translateUI("Describe who this instance serves and what it monitors.")}
                        oninput={(event) =>
                            updateSetting(
                                'site_description',
                                (event.currentTarget as HTMLTextAreaElement).value,
                            )}
                    ></textarea>
                </div>

                <div class="space-y-1.5 lg:col-span-2">
                    <label class="text-sm font-medium text-text-muted" for="base-url">
                        {translateUI("Base URL")}
                    </label>
                    <input
                        id="base-url"
                        name="base_url"
                        type="url"
                        value={settingValue('base_url')}
                        oninput={(event) =>
                            updateSetting(
                                'base_url',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="https://status.example.com"
                    />
                    <p class="text-[11px] text-text-subtle">
                        {translateUI("Used in exported links, notifications, and status page references.")}
                    </p>
                </div>
            </div>
        {/if}
    </section>

    <section class="card settings-section">
        <div class="settings-section-header">
            <div class="settings-section-icon">
                <Image class="size-4 text-primary" />
            </div>
            <div>
                <h2 class="text-base font-semibold text-text">{translateUI("Branding & Appearance")}</h2>
                <p class="text-[11px] text-text-subtle mt-0.5">
                    {translateUI("Configure branding assets and the default UI theme for new sessions.")}
                </p>
            </div>
        </div>

        {#if settingsLoading}
            <div class="grid gap-4 lg:grid-cols-2">
                {#each Array.from({ length: 3 }) as _, index (index)}
                    <div class="space-y-2">
                        <Skeleton height="h-4" width="w-24" />
                        <Skeleton height="h-10" />
                    </div>
                {/each}
            </div>
        {:else}
            <div class="grid gap-4 lg:grid-cols-2">
                <div class="space-y-1.5">
                    <label class="text-sm font-medium text-text-muted" for="logo-url">
                        {translateUI("Logo URL")}
                    </label>
                    <input
                        id="logo-url"
                        type="url"
                        value={settingValue('logo_url')}
                        oninput={(event) =>
                            updateSetting(
                                'logo_url',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="https://cdn.example.com/logo.svg"
                    />
                </div>

                <div class="space-y-1.5">
                    <label
                        class="text-sm font-medium text-text-muted"
                        for="favicon-url"
                    >
                        {translateUI("Favicon URL")}
                    </label>
                    <input
                        id="favicon-url"
                        type="url"
                        value={settingValue('favicon_url')}
                        oninput={(event) =>
                            updateSetting(
                                'favicon_url',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="https://cdn.example.com/favicon.ico"
                    />
                </div>

                <div class="space-y-1.5">
                    <label class="text-sm font-medium text-text-muted" for="theme">
                        {translateUI("Default Theme")}
                    </label>
                    <select
                        id="theme"
                        class="input-base text-sm"
                        value={settingValue('theme')}
                        onchange={(event) =>
                            updateSetting(
                                'theme',
                                (event.currentTarget as HTMLSelectElement).value,
                            )}
                    >
                        {#each themeOptions as option (option.value)}
                            <option value={option.value}>{translateUI(option.label ?? '')}</option>
                        {/each}
                    </select>
                </div>

                <div class="space-y-1.5">
                    <label class="text-sm font-medium text-text-muted" for="default-language">
                        {translateUI('Default Language')}
                    </label>
                    <select id="default-language" class="input-base text-sm"
                        value={settingValue('default_language')}
                        onchange={(event) => updateSetting('default_language', event.currentTarget.value)}
                    >
                        {#each locales as locale (locale.code)}
                            <option value={locale.code}>{locale.name}</option>
                        {/each}
                    </select>
                    <p class="text-[11px] text-text-subtle">
                        {translateUI('Used on the login page and for visitors without a personal language preference.')}
                    </p>
                </div>

                <div class="space-y-1.5">
                    <label class="text-sm font-medium text-text-muted" for="timezone">
                        {translateUI("Timezone")}
                    </label>
                    <input
                        id="timezone"
                        type="text"
                        value={settingValue('timezone')}
                        oninput={(event) =>
                            updateSetting(
                                'timezone',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="UTC"
                    />
                </div>

                <div class="space-y-1.5 lg:col-span-2">
                    <label class="text-sm font-medium text-text-muted" for="date-format">
                        {translateUI("Date Format")}
                    </label>
                    <input
                        id="date-format"
                        type="text"
                        value={settingValue('date_format')}
                        oninput={(event) =>
                            updateSetting(
                                'date_format',
                                (event.currentTarget as HTMLInputElement).value,
                            )}
                        class="input-base"
                        placeholder="2006-01-02 15:04"
                    />
                    <p class="text-[11px] text-text-subtle">
                        {translateUI("Keep this readable and consistent with the timezone above.")}
                    </p>
                </div>
            </div>
        {/if}
    </section>

    <section class="card settings-section">
        <div class="settings-section-header">
            <div class="settings-section-icon">
                <Bell class="size-4 text-primary" />
            </div>
            <div>
                <h2 class="text-base font-semibold text-text">{translateUI("Access & Alerts")}</h2>
                <p class="text-[11px] text-text-subtle mt-0.5">
                    {translateUI("Control public visibility, maintenance mode, and default notification behavior.")}
                </p>
            </div>
        </div>

        {#if settingsLoading}
            <div class="space-y-3">
                {#each Array.from({ length: 4 }) as _, index (index)}
                    <div class="rounded-xl border border-border/60 p-4 flex items-center justify-between gap-4">
                        <div class="space-y-2 flex-1">
                            <Skeleton height="h-4" width="w-36" />
                            <Skeleton height="h-3" width="w-56" />
                        </div>
                        <Skeleton height="h-6" width="w-10" rounded="rounded-full" />
                    </div>
                {/each}
            </div>
        {:else}
            <div class="grid gap-3 lg:grid-cols-2">
                <label class="settings-toggle-card">
                    <div>
                        <p class="text-sm font-medium text-text">{translateUI("Enable Public Access")}</p>
                        <p class="text-[11px] text-text-subtle mt-1">
                            {translateUI("Allow public-facing pages and links to surface this instance.")}
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        checked={booleanSetting('enable_public')}
                        onchange={(event) =>
                            toggleSetting(
                                'enable_public',
                                (event.currentTarget as HTMLInputElement).checked,
                            )}
                        class="mt-1 size-4 accent-primary"
                    />
                </label>

                <label class="settings-toggle-card">
                    <div>
                        <p class="text-sm font-medium text-text">{translateUI("Maintenance Mode")}</p>
                        <p class="text-[11px] text-text-subtle mt-1">
                            {translateUI("Temporarily suppress normal operations during planned work.")}
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        checked={booleanSetting('maintenance_mode')}
                        onchange={(event) =>
                            toggleSetting(
                                'maintenance_mode',
                                (event.currentTarget as HTMLInputElement).checked,
                            )}
                        class="mt-1 size-4 accent-primary"
                    />
                </label>

                <label class="settings-toggle-card">
                    <div>
                        <p class="text-sm font-medium text-text">{translateUI("Notify on Down")}</p>
                        <p class="text-[11px] text-text-subtle mt-1">
                            {translateUI("Emit a notification the moment a monitor enters a failing state.")}
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        checked={booleanSetting('notify_on_down', true)}
                        onchange={(event) =>
                            toggleSetting(
                                'notify_on_down',
                                (event.currentTarget as HTMLInputElement).checked,
                            )}
                        class="mt-1 size-4 accent-primary"
                    />
                </label>

                <label class="settings-toggle-card">
                    <div>
                        <p class="text-sm font-medium text-text">{translateUI("Notify on Recovery")}</p>
                        <p class="text-[11px] text-text-subtle mt-1">
                            {translateUI("Emit a notification when a monitor returns to a healthy state.")}
                        </p>
                    </div>
                    <input
                        type="checkbox"
                        checked={booleanSetting('notify_on_up', true)}
                        onchange={(event) =>
                            toggleSetting(
                                'notify_on_up',
                                (event.currentTarget as HTMLInputElement).checked,
                            )}
                        class="mt-1 size-4 accent-primary"
                    />
                </label>
            </div>

            <div class="flex justify-end">
                <Button loading={settingsSaving} onclick={saveSettings}>
                    {settingsSaving ? translateUI("Saving...") : translateUI("Save Settings")}
                </Button>
            </div>
        {/if}
    </section>

    <section class="card settings-section">
        <div class="settings-section-header">
            <div class="settings-section-icon">
                <Palette class="size-4 text-primary" />
            </div>
            <div>
                <h2 class="text-base font-semibold text-text">{translateUI("Custom CSS")}</h2>
                <p class="text-[11px] text-text-subtle mt-0.5">
                    {translateUI("Apply global visual overrides for your embedded frontend.")}
                </p>
            </div>
        </div>

        {#if settingsLoading}
            <div class="space-y-3">
                <Skeleton height="h-6" width="w-40" />
                <Skeleton height="h-40" />
            </div>
        {:else}
            <label class="settings-toggle-card">
                <div>
                    <p class="text-sm font-medium text-text">{translateUI("Enable Custom CSS")}</p>
                    <p class="text-[11px] text-text-subtle mt-1">
                        {translateUI("The backend still sanitizes CSS before serving it to the app shell.")}
                    </p>
                </div>
                <input
                    type="checkbox"
                    checked={booleanSetting('enable_custom_css')}
                    onchange={(event) =>
                        toggleSetting(
                            'enable_custom_css',
                            (event.currentTarget as HTMLInputElement).checked,
                        )}
                    class="mt-1 size-4 accent-primary"
                />
            </label>

            <div class="space-y-1.5">
                <label class="text-sm font-medium text-text-muted" for="custom-css-editor">
                    {translateUI("CSS Overrides")}
                </label>
                <textarea
                    id="custom-css-editor"
                    class="input-base font-mono text-xs w-full min-h-48 resize-y"
                    spellcheck="false"
                    value={settingValue('custom_css')}
                    placeholder={"/* Override colors or spacing */\n:root {\n  --color-primary: hsl(210 90% 56%);\n}"}
                    oninput={(event) =>
                        updateSetting(
                            'custom_css',
                            (event.currentTarget as HTMLTextAreaElement).value,
                        )}
                ></textarea>
                <p class="text-[11px] text-text-subtle">
                    {translateUI("Saved CSS is available at")} <span class="font-mono text-primary/80">/api/v1/custom.css</span>.
                </p>
            </div>

            <div class="flex justify-end">
                <Button variant="outline" loading={settingsSaving} onclick={saveSettings}>
                    {settingsSaving ? translateUI("Saving...") : translateUI("Save CSS")}
                </Button>
            </div>
        {/if}
    </section>

    <!-- Password Change Section (only for local auth) -->
    {#if !authStore.user?.auth_provider || authStore.user?.auth_provider === 'local'}
    <section class="card settings-section">
        <div class="settings-section-header">
            <div class="settings-section-icon">
                <Lock class="size-4 text-primary" />
            </div>
            <div>
                <h2 class="text-base font-semibold text-text">{translateUI("Change Password")}</h2>
                <p class="text-[11px] text-text-subtle mt-0.5">
                    {translateUI("Update the current administrator password for this session login.")}
                </p>
            </div>
        </div>

        {#if pwMsg}
            <div
                class={[
                    'settings-banner',
                    pwMsg.startsWith('Error')
                        ? 'settings-banner-danger'
                        : 'settings-banner-success',
                ]}
                aria-live="polite"
            >
                {translateUI(pwMsg ?? '')}
            </div>
        {/if}

        <div class="grid gap-4 lg:grid-cols-3">
            <div class="space-y-1.5">
                <label class="text-sm font-medium text-text-muted" for="pw-current">
                    {translateUI("Current Password")}
                </label>
                <input
                    id="pw-current"
                    type="password"
                    bind:value={pwCurrent}
                    class="input-base"
                />
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-medium text-text-muted" for="pw-new">
                    {translateUI("New Password")}
                </label>
                <input
                    id="pw-new"
                    type="password"
                    bind:value={pwNew}
                    class="input-base"
                    placeholder={translateUI("Must satisfy the server policy")}
                />
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-medium text-text-muted" for="pw-confirm">
                    {translateUI("Confirm Password")}
                </label>
                <input
                    id="pw-confirm"
                    type="password"
                    bind:value={pwConfirm}
                    class="input-base"
                />
            </div>
        </div>

        <div class="flex justify-end">
            <Button loading={pwSaving} onclick={changePassword}>
                {pwSaving ? translateUI("Saving...") : translateUI("Change Password")}
            </Button>
        </div>
    </section>
    {/if}
</div>
