-- 页面分类独立保存；空数组让已有状态页继续使用原来的监控分组。
ALTER TABLE status_pages ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
