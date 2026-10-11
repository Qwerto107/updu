package storage

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/updu/updu/internal/models"
)

func TestPublicCertificatesUseExactServiceAssociation(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	for _, id := range []string{"visible", "hidden"} {
		if err := db.CreateMonitor(t.Context(), &models.Monitor{ID: id, Name: "Shared service name", Type: "http", Config: []byte(`{"url":"https://shared.example.com"}`)}); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	ids := map[string]string{}
	for _, source := range []string{"visible", "hidden", "standalone"} {
		cert := &models.TLSCertificate{Domain: "shared.example.com", Issuer: source, Subject: "private subject", SANs: []string{"private.internal"}, SerialNumber: "private serial", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(24 * time.Hour), LastVerifiedAt: now, OCSPStatus: "untrusted: private diagnostic"}
		if source != "standalone" {
			endpointID := source + "-default"
			cert.AssociatedEndpointID = &endpointID
		}
		if err := db.UpsertTLSCertificate(t.Context(), cert); err != nil {
			t.Fatal(err)
		}
		ids[source] = cert.ID
	}
	if ids["visible"] == ids["hidden"] || ids["visible"] == ids["standalone"] || ids["hidden"] == ids["standalone"] {
		t.Fatal("same-domain certificate identities collided")
	}
	public, err := db.ListPublicTLSCertificates(t.Context(), []string{"visible"})
	if err != nil || len(public) != 1 {
		t.Fatalf("public certificate scope: %+v, %v", public, err)
	}
	if public[0].Issuer != "visible" || public[0].VerificationStatus != "untrusted" || public[0].ServiceName != "Shared service name" {
		t.Fatalf("wrong certificate associated: %+v", public[0])
	}
	encoded, err := json.Marshal(public[0])
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"private", "subject", "sans", "serial", "ocsp_status", "associated_endpoint", "visible-default"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("public certificate leaked %q: %s", forbidden, encoded)
		}
	}
	all, err := db.ListTLSCertificates(t.Context())
	if err != nil || len(all) != 3 {
		t.Fatalf("same-domain certificates overwritten: %+v, %v", all, err)
	}
	empty, err := db.ListPublicTLSCertificates(t.Context(), nil)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty scope exposed certificates: %+v, %v", empty, err)
	}
	// 端点删除后即使证书记录仍存在，也不能通过名称重新关联到状态页。
	if err := db.DeleteMonitor(t.Context(), "visible"); err != nil {
		t.Fatal(err)
	}
	deleted, err := db.ListPublicTLSCertificates(t.Context(), []string{"visible"})
	if err != nil || len(deleted) != 0 {
		t.Fatalf("deleted service still exposed: %+v, %v", deleted, err)
	}
}

func TestCertificateMigrationSeparatesLegacyAuditIdentity(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	monitor := &models.Monitor{ID: "legacy", Name: "Legacy", Type: "http", Config: []byte(`{"url":"https://legacy.example.com"}`)}
	if err := db.CreateMonitor(t.Context(), monitor); err != nil {
		t.Fatal(err)
	}
	page := &models.StatusPage{ID: "legacy-page", Slug: "legacy-page", Name: "Legacy page", Layout: "table", ShowCertificates: true, Groups: []models.StatusPageGroup{{Name: "Legacy"}}}
	if err := db.CreateStatusPage(t.Context(), page); err != nil {
		t.Fatal(err)
	}
	endpointID := "legacy-default"
	now := time.Now().UTC()
	linked := &models.TLSCertificate{Domain: "legacy.example.com", Issuer: "legacy linked", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(24 * time.Hour), AssociatedEndpointID: &endpointID}
	if err := db.UpsertTLSCertificate(t.Context(), linked); err != nil {
		t.Fatal(err)
	}
	// 临时库模拟旧版本：关联证书也使用 cert-domain 主键，页面还没有公开开关。
	for _, sql := range []string{
		"UPDATE tls_certificates SET id='cert-legacy.example.com'",
		"ALTER TABLE status_pages DROP COLUMN show_certificates",
		"DELETE FROM schema_migrations WHERE version=14",
	} {
		if _, err := db.ExecContext(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	upgraded, err := db.GetStatusPageByID(t.Context(), page.ID)
	if err != nil || upgraded == nil || upgraded.ShowCertificates || upgraded.Layout != "table" || len(upgraded.Groups) != 1 {
		t.Fatalf("legacy page was changed or exposed during upgrade: %+v, %v", upgraded, err)
	}
	before, err := db.ListTLSCertificates(t.Context())
	if err != nil || len(before) != 1 || before[0].ID == "cert-legacy.example.com" {
		t.Fatalf("legacy certificate identity not isolated: %+v, %v", before, err)
	}
	migratedID := before[0].ID
	audit := &models.TLSCertificate{Domain: linked.Domain, Issuer: "standalone audit", ValidFrom: linked.ValidFrom, ValidUntil: linked.ValidUntil}
	if err := db.UpsertTLSCertificate(t.Context(), audit); err != nil {
		t.Fatal(err)
	}
	public, err := db.ListPublicTLSCertificates(t.Context(), []string{monitor.ID})
	if err != nil || len(public) != 1 || public[0].Issuer != "legacy linked" {
		t.Fatalf("manual audit overwrote linked certificate: %+v, %v", public, err)
	}
	linked.Issuer = "fresh linked"
	if err := db.UpsertTLSCertificate(t.Context(), linked); err != nil {
		t.Fatal(err)
	}
	if linked.ID != migratedID {
		t.Fatalf("renewed probe changed legacy ID: got %s, want %s", linked.ID, migratedID)
	}
	audit.Issuer = "latest standalone audit"
	if err := db.UpsertTLSCertificate(t.Context(), audit); err != nil {
		t.Fatal(err)
	}
	after, err := db.ListTLSCertificates(t.Context())
	if err != nil || len(after) != 2 {
		t.Fatalf("migration or probes created duplicate certificates: %+v, %v", after, err)
	}
	public, err = db.ListPublicTLSCertificates(t.Context(), []string{monitor.ID})
	if err != nil || len(public) != 1 || public[0].Issuer != "fresh linked" {
		t.Fatalf("repeated audit mixed certificate sources: %+v, %v", public, err)
	}
}

func TestPublicCertificateVerificationIsAllowlisted(t *testing.T) {
	for input, want := range map[string]string{
		"verified": "verified", "unverified": "unverified", "expired": "expired",
		"not yet valid": "not_yet_valid", "not_yet_valid": "not_yet_valid",
		"untrusted": "untrusted", "untrusted: private.internal:8443": "untrusted",
		" Verified ": "verified", "": "unknown", "diagnostic with private.internal": "unknown",
	} {
		if got := publicCertificateVerification(input); got != want {
			t.Errorf("verification %q: got %q, want %q", input, got, want)
		}
	}
}
