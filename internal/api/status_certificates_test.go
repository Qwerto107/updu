package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/updu/updu/internal/models"
)

func TestStatusPageCertificatesRequireOptInAndExactScope(t *testing.T) {
	srv, db, cleanup := setupAPITest(t)
	defer cleanup()
	router := srv.Router()
	admin, viewer := setupAdminAndViewer(t, srv)
	call := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	now := time.Now().UTC()
	for _, id := range []string{"legacy-monitor", "category-monitor", "hidden-monitor"} {
		// 同名服务和同域名证书仍只能通过真实 ID 关联。
		monitor := &models.Monitor{ID: id, Name: "Shared service", Type: "http", Groups: []string{id}, Config: []byte(`{"url":"https://shared.example.com/private-target"}`), Enabled: true}
		if err := db.CreateMonitor(t.Context(), monitor); err != nil {
			t.Fatal(err)
		}
		endpointID := id + "-default"
		cert := &models.TLSCertificate{Domain: "shared.example.com", Issuer: id, Subject: "private subject", SANs: []string{"private.internal"}, SerialNumber: "private serial", SignatureAlgorithm: "private algorithm", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(24 * time.Hour), LastVerifiedAt: now, AssociatedEndpointID: &endpointID, OCSPStatus: "untrusted: private diagnostic at 192.168.1.8"}
		if err := db.UpsertTLSCertificate(t.Context(), cert); err != nil {
			t.Fatal(err)
		}
	}
	standalone := &models.TLSCertificate{Domain: "shared.example.com", Issuer: "standalone audit", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(24 * time.Hour)}
	if err := db.UpsertTLSCertificate(t.Context(), standalone); err != nil {
		t.Fatal(err)
	}
	created := call("POST", "/api/v1/status-pages", `{"name":"Legacy selection","slug":"legacy-certificates","is_public":true,"groups":[{"name":"legacy-monitor"}]}`, admin)
	if created.Code != http.StatusCreated {
		t.Fatal(created.Body.String())
	}
	var legacy models.StatusPage
	if err := json.Unmarshal(created.Body.Bytes(), &legacy); err != nil || legacy.ShowCertificates {
		t.Fatalf("new pages must not expose certificates by default: %s, %v", created.Body.String(), err)
	}
	readCertificates := func(slug string) []map[string]any {
		t.Helper()
		result := call("GET", "/api/v1/status-pages/"+slug, "", nil)
		if result.Code != http.StatusOK {
			t.Fatal(result.Body.String())
		}
		var response struct {
			Certificates []map[string]any `json:"certificates"`
		}
		if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Certificates == nil {
			t.Fatal("certificate response must be an array even when disabled")
		}
		return response.Certificates
	}
	if certs := readCertificates(legacy.Slug); len(certs) != 0 {
		t.Fatal("certificates exposed without opt-in")
	}
	const legacyGroups = `"is_public":true,"groups":[{"name":"legacy-monitor"}]`
	denied := call("PUT", "/api/v1/status-pages/"+legacy.ID, `{`+legacyGroups+`,"show_certificates":true}`, viewer)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("viewer enabled certificate publication: %d", denied.Code)
	}
	for _, body := range []string{`{` + legacyGroups + `,"show_certificates":true}`, `{` + legacyGroups + `,"name":"Legacy client update"}`} {
		result := call("PUT", "/api/v1/status-pages/"+legacy.ID, body, admin)
		if result.Code != http.StatusOK {
			t.Fatal(result.Body.String())
		}
	}
	for _, path := range []string{"/api/v1/status-pages/" + legacy.ID + "/detail", "/api/v1/status-pages"} {
		result := call("GET", path, "", admin)
		if result.Code != http.StatusOK || !strings.Contains(result.Body.String(), `"show_certificates":true`) {
			t.Fatalf("saved visibility not returned by %s: %s", path, result.Body.String())
		}
	}
	legacyCerts := readCertificates(legacy.Slug)
	if len(legacyCerts) != 1 || legacyCerts[0]["issuer"] != "legacy-monitor" || legacyCerts[0]["verification_status"] != "untrusted" {
		t.Fatalf("legacy group certificate scope incorrect: %+v", legacyCerts)
	}
	allowedFields := map[string]bool{"id": true, "domain": true, "issuer": true, "valid_from": true, "valid_until": true, "last_verified_at": true, "service_name": true, "verification_status": true}
	if len(legacyCerts[0]) != len(allowedFields) {
		t.Fatalf("unexpected public DTO fields: %+v", legacyCerts[0])
	}
	for key := range legacyCerts[0] {
		if !allowedFields[key] {
			t.Errorf("private field exposed: %s", key)
		}
	}
	encoded, err := json.Marshal(legacyCerts)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private", "192.168", "hidden-monitor", "standalone", "-default"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("certificate DTO leaked %q: %s", secret, encoded)
		}
	}
	category := call("POST", "/api/v1/status-pages", `{"name":"Custom category","slug":"category-certificates","is_public":true,"show_certificates":true,"categories":[{"name":"Sites","monitor_ids":["category-monitor"]}]}`, admin)
	if category.Code != http.StatusCreated {
		t.Fatal(category.Body.String())
	}
	categoryCerts := readCertificates("category-certificates")
	if len(categoryCerts) != 1 || categoryCerts[0]["issuer"] != "category-monitor" {
		t.Fatalf("category-only selection did not scope certificates: %+v", categoryCerts)
	}
	// 明确关闭、清空选择均必须移除公共证书，不能退回“展示全部”。
	for _, body := range []string{`{` + legacyGroups + `,"show_certificates":false}`, `{"is_public":true,"show_certificates":true,"groups":[]}`} {
		result := call("PUT", "/api/v1/status-pages/"+legacy.ID, body, admin)
		if result.Code != http.StatusOK {
			t.Fatal(result.Body.String())
		}
		if certs := readCertificates(legacy.Slug); len(certs) != 0 {
			t.Fatalf("disabled or empty scope exposed certificates: %+v", certs)
		}
	}
}

func TestStatusPageCertificatesRemainBehindPageAccess(t *testing.T) {
	srv, db, cleanup := setupAPITest(t)
	defer cleanup()
	router := srv.Router()
	admin, viewer := setupAdminAndViewer(t, srv)
	monitor := &models.Monitor{ID: "protected", Name: "Protected service", Type: "http", Config: []byte(`{"url":"https://private.example.com"}`)}
	if err := db.CreateMonitor(t.Context(), monitor); err != nil {
		t.Fatal(err)
	}
	endpointID := "protected-default"
	cert := &models.TLSCertificate{Domain: "private.example.com", Issuer: "Private CA", ValidFrom: time.Now().Add(-time.Hour), ValidUntil: time.Now().Add(time.Hour), AssociatedEndpointID: &endpointID}
	if err := db.UpsertTLSCertificate(t.Context(), cert); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		for _, cookie := range cookies {
			if cookie != nil {
				req.AddCookie(cookie)
			}
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	for _, page := range []struct {
		slug   string
		access string
	}{
		{"private-tls", `"is_public":false`},
		{"password-tls", `"is_public":true,"password":"password123"`},
	} {
		created := call("POST", "/api/v1/status-pages", `{"name":"Protected","slug":"`+page.slug+`",`+page.access+`,"show_certificates":true,"groups":[{"monitor_ids":["protected"]}]}`, admin)
		if created.Code != http.StatusCreated {
			t.Fatal(created.Body.String())
		}
		denied := call("GET", "/api/v1/status-pages/"+page.slug, "")
		if denied.Code != http.StatusForbidden || strings.Contains(denied.Body.String(), "certificates") || strings.Contains(denied.Body.String(), cert.Domain) {
			t.Fatalf("protected certificates exposed: %s", denied.Body.String())
		}
	}
	denied := call("GET", "/api/v1/status-pages/password-tls", "", viewer)
	if denied.Code != http.StatusForbidden || strings.Contains(denied.Body.String(), cert.Domain) {
		t.Fatal("viewer bypassed password-protected certificate access")
	}
	unlocked := call("POST", "/api/v1/status-pages/password-tls/unlock", `{"password":"password123"}`)
	if unlocked.Code != http.StatusOK || len(unlocked.Result().Cookies()) == 0 {
		t.Fatal(unlocked.Body.String())
	}
	allowed := call("GET", "/api/v1/status-pages/password-tls", "", unlocked.Result().Cookies()...)
	if allowed.Code != http.StatusOK || !strings.Contains(allowed.Body.String(), cert.Domain) {
		t.Fatalf("unlocked page omitted selected certificate: %s", allowed.Body.String())
	}
}
