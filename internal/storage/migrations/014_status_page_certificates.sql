-- 公共证书展示需要管理员明确开启，升级时保持已有页面的公开范围不变。
ALTER TABLE status_pages ADD COLUMN show_certificates BOOLEAN NOT NULL DEFAULT 0;

-- 旧记录按域名共用主键。先隔离已关联端点的记录，防止独立手动检查覆盖其公开来源。
-- 随机 ID 只在迁移时生成一次，之后按端点与域名查找并沿用，避免重复记录。
UPDATE tls_certificates
SET id = 'endpoint-cert-' || lower(hex(randomblob(32)))
WHERE associated_endpoint_id IS NOT NULL AND associated_endpoint_id <> '';

CREATE INDEX IF NOT EXISTS idx_tls_certs_endpoint_domain
ON tls_certificates(associated_endpoint_id, domain);
