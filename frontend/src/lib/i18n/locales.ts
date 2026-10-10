import zhCN from './zh-CN.json' with { type: 'json' };

// 英文文案作为稳定的翻译键；新增语言时补充资源文件和此注册表即可。
export const locales = [
    { code: 'en', name: 'English', messages: {} as Record<string, string> },
    { code: 'zh-CN', name: '简体中文', messages: zhCN as Record<string, string> },
] as const;

export type Locale = (typeof locales)[number]['code'];
export const fallbackLocale: Locale = 'en';

export function normalizeLocale(value: unknown): Locale {
    return locales.find(locale => locale.code === value)?.code ?? fallbackLocale;
}

// 缺失翻译回退英文；插值只替换文本，不生成 HTML，避免注入风险。
export function translate(locale: Locale, message: string, values: Record<string, string | number> = {}): string {
    const catalog = locales.find(item => item.code === locale)?.messages;
    // 只读取资源自身的键，避免 constructor 等原型属性被误当作译文。
    const translated = catalog && Object.hasOwn(catalog, message) ? catalog[message] : message;
    return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : match,
    );
}
