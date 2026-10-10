-- 旧状态页沿用列表展示，卡片布局由管理员按页面选择。
ALTER TABLE status_pages ADD COLUMN layout TEXT NOT NULL DEFAULT 'list';
