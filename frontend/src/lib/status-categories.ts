// 分类只属于当前状态页，顺序由数组决定，不修改后台的监控分组。
export interface StatusCategory {
    name: string;
    description: string;
    monitor_ids: string[];
}
