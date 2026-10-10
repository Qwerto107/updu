import { fallbackLocale, locales, normalizeLocale, translate, type Locale } from './locales';

const storageKey = 'updu_language';
let current = $state<Locale>(fallbackLocale);
let defaultLanguage = $state<Locale>(fallbackLocale);
let override = $state<Locale | null>(null);

function apply() {
    current = override ?? defaultLanguage;
    if (typeof document !== 'undefined') document.documentElement.lang = current;
}

function readOverride() {
    try {
        const stored = localStorage.getItem(storageKey);
        override = locales.some(locale => locale.code === stored) ? normalizeLocale(stored) : null;
    } catch {
        // 浏览器禁止本地存储时，仍允许在当前页面切换语言。
    }
}

export const languageStore = {
    get current() { return current; },
    get defaultLanguage() { return defaultLanguage; },
    get preference() { return override ?? ''; },
    async init() {
        readOverride();
        apply();
        try {
            // 公开启动接口只提供默认语言，不暴露管理员设置或秘密。
            const response = await fetch('/api/v1/auth/setup');
            if (response.ok) {
                const data = await response.json();
                defaultLanguage = normalizeLocale(data.default_language);
                apply();
            }
        } catch {
            // 离线或请求失败时保留本地选择，并回退到英文。
        }
        const sync = (event: StorageEvent) => {
            if (event.key === storageKey || event.key === null) { readOverride(); apply(); }
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    },
    select(value: string) {
        override = value === '' ? null : normalizeLocale(value);
        try {
            if (override) localStorage.setItem(storageKey, override);
            else localStorage.removeItem(storageKey);
        } catch {
            // 存储不可用时，只保留当前页面的选择。
        }
        apply();
    },
    setDefault(value: string) {
        defaultLanguage = normalizeLocale(value);
        this.select('');
    },
};

// 在组件的模板或派生值中调用，Svelte 会追踪语言变更并即时更新文案。
export function t(message: string, values: Record<string, string | number> = {}): string {
    // 错误前缀与内容分开翻译，兼容已有接口返回的英文错误消息。
    if (message.startsWith('Error: ')) {
        return translate(current, 'Error: {message}', { message: t(message.slice(7)) });
    }
    return translate(current, message, values);
}
