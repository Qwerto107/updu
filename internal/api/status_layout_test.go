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

func TestStatusPageLayoutsAndHistoryAccess(t *testing.T) {
	srv, db, cleanup := setupAPITest(t)
	defer cleanup()
	router := srv.Router()
	admin := registerAndLoginAdmin(t, router)
	call := func(method, path, body string, authenticated bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		if authenticated {
			req.AddCookie(admin)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	for _, id := range []string{"visible", "hidden"} {
		if err := db.CreateMonitor(t.Context(), &models.Monitor{ID: id, Name: id, Type: "ping", Config: []byte(`{"host":"127.0.0.1"}`), Groups: []string{id}, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if err := db.InsertCheckResult(t.Context(), &models.CheckResult{MonitorID: id, Status: models.StatusUp, CheckedAt: time.Now().Add(-time.Minute), Message: "private diagnostic"}); err != nil {
			t.Fatal(err)
		}
	}
	created := call("POST", "/api/v1/status-pages", `{"name":"Public","slug":"public-layout","is_public":true,"groups":[{"name":"visible"}]}`, true)
	if created.Code != http.StatusCreated {
		t.Fatal(created.Body.String())
	}
	var page models.StatusPage
	if err := json.Unmarshal(created.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Layout != "cards" {
		t.Fatal("missing layout must default to cards")
	}
	update := call("PUT", "/api/v1/status-pages/"+page.ID, `{"layout":"table","is_public":true,"groups":[{"name":"visible"}]}`, true)
	if update.Code != http.StatusOK {
		t.Fatal(update.Body.String())
	}
	public := call("GET", "/api/v1/status-pages/public-layout", "", false)
	var response struct {
		Page     models.StatusPage `json:"page"`
		Monitors []map[string]any  `json:"monitors"`
	}
	if err := json.Unmarshal(public.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if public.Code != 200 || response.Page.Layout != "table" || len(response.Monitors) != 1 {
		t.Fatal(public.Body.String())
	}
	history := response.Monitors[0]["history"].([]any)
	if len(history) != 48 || response.Monitors[0]["uptime_24h"] != float64(100) {
		t.Fatal(public.Body.String())
	}
	if strings.Contains(public.Body.String(), "hidden") || strings.Contains(public.Body.String(), "private diagnostic") || strings.Contains(public.Body.String(), "127.0.0.1") {
		t.Fatal("private data leaked")
	}
	invalid := call("PUT", "/api/v1/status-pages/"+page.ID, `{"layout":"invalid"}`, true)
	if invalid.Code != 400 {
		t.Fatal("invalid layout accepted")
	}
	protected := call("PUT", "/api/v1/status-pages/"+page.ID, `{"is_public":true,"password":"password123","groups":[{"name":"visible"}]}`, true)
	if protected.Code != 200 {
		t.Fatal(protected.Body.String())
	}
	denied := call("GET", "/api/v1/status-pages/public-layout", "", false)
	if denied.Code != 403 || strings.Contains(denied.Body.String(), "history") {
		t.Fatal("protected history exposed")
	}
	// 旧客户端不传布局字段时，已保存的表格布局必须保留。
	saved, err := db.GetStatusPageByID(t.Context(), page.ID)
	if err != nil || saved.Layout != "table" {
		t.Fatal("layout lost on legacy update")
	}
	// 创建入口同样接受新布局，并继续兼容旧客户端提交的 list。
	for _, layout := range []string{"cards", "table", "list", "invalid"} {
		result := call("POST", "/api/v1/status-pages", `{"name":"Layout","slug":"create-`+layout+`","layout":"`+layout+`"}`, true)
		if layout == "invalid" {
			if result.Code != http.StatusBadRequest {
				t.Fatal("invalid create layout accepted")
			}
			continue
		}
		if result.Code != http.StatusCreated {
			t.Fatalf("create %s layout: %s", layout, result.Body.String())
		}
		var createdPage models.StatusPage
		if err := json.Unmarshal(result.Body.Bytes(), &createdPage); err != nil || createdPage.Layout != layout {
			t.Fatalf("create %s layout was not preserved: %+v, %v", layout, createdPage, err)
		}
	}
}
