package storage

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/updu/updu/internal/models"
)

// ListPublicTLSCertificates 通过 monitor/service 共用的 ID 限定范围，不按域名或名称猜测关联。
func (db *DB) ListPublicTLSCertificates(ctx context.Context, monitorIDs []string) ([]models.PublicTLSCertificate, error) {
	certificates := []models.PublicTLSCertificate{}
	if len(monitorIDs) == 0 {
		return certificates, nil
	}
	ids, err := json.Marshal(monitorIDs)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT c.id, c.domain, c.issuer, c.valid_from, c.valid_until,
		       c.last_verified_at, s.name, COALESCE(c.ocsp_status, '')
		FROM tls_certificates c
		JOIN service_endpoints ep ON ep.id = c.associated_endpoint_id
		JOIN services s ON s.id = ep.service_id
		JOIN monitors m ON m.id = s.id
		WHERE m.id IN (SELECT value FROM json_each(?))
		ORDER BY c.valid_until, c.domain, c.id
	`, string(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var certificate models.PublicTLSCertificate
		var verification string
		if err := rows.Scan(&certificate.ID, &certificate.Domain, &certificate.Issuer,
			&certificate.ValidFrom, &certificate.ValidUntil, &certificate.LastVerifiedAt,
			&certificate.ServiceName, &verification); err != nil {
			return nil, err
		}
		certificate.VerificationStatus = publicCertificateVerification(verification)
		certificates = append(certificates, certificate)
	}
	return certificates, rows.Err()
}

// 后台 ocsp_status 实际保存证书校验结果；公开接口只给枚举，不泄露错误中的内网诊断。
func publicCertificateVerification(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "verified", "unverified", "expired":
		return value
	case "not yet valid", "not_yet_valid":
		return "not_yet_valid"
	case "untrusted":
		return "untrusted"
	default:
		if strings.HasPrefix(value, "untrusted:") {
			return "untrusted"
		}
		return "unknown"
	}
}
