export type StatusLayout = 'cards' | 'table';

export const statusLayoutOptions: { value: StatusLayout; label: string }[] = [
    { value: 'cards', label: 'Lightweight cards' },
    { value: 'table', label: 'Operations table' },
];

// 旧 list 配置与缺省值统一使用轻量卡片，不需要改写已有页面数据。
export function normalizeStatusLayout(input: unknown): StatusLayout {
    return input === 'table' ? 'table' : 'cards';
}
