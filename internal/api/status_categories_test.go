package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/updu/updu/internal/models"
)

func TestStatusPageCategoriesAccessAndLegacyUpdates(t *testing.T) {
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
	for _, id := range []string{"category-service", "group-service", "hidden-service"} {
		monitor := &models.Monitor{ID: id, Name: id, Type: "ping", Config: []byte(`{"host":"private.example"}`), Groups: []string{id}, Enabled: true}
		if err := db.CreateMonitor(t.Context(), monitor); err != nil {
			t.Fatal(err)
		}
		if err := db.InsertCheckResult(t.Context(), &models.CheckResult{MonitorID: id, Status: models.StatusUp, CheckedAt: time.Now().Add(-time.Minute), Message: "private diagnostic"}); err != nil {
			t.Fatal(err)
		}
	}
	const categories = `[{"name":" 家庭网络 ","description":" 分类说明 ","monitor_ids":["category-service"]},{"name":"网站","monitor_ids":[]}]`
	body := `{"name":"Custom","slug":"custom","is_public":true,"groups":[{"name":"group-service"}],"categories":` + categories + `}`
	if denied := call("POST", "/api/v1/status-pages", body, viewer); denied.Code != http.StatusForbidden {
		t.Fatalf("viewer created page: %d", denied.Code)
	}
	created := call("POST", "/api/v1/status-pages", body, admin)
	if created.Code != http.StatusCreated {
		t.Fatal(created.Body.String())
	}
	var page models.StatusPage
	if err := json.Unmarshal(created.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Categories) != 2 || page.Categories[0].Name != "家庭网络" || page.Categories[0].Description != "分类说明" || page.Categories[1].MonitorIDs == nil {
		t.Fatalf("unexpected categories: %+v", page.Categories)
	}
	if denied := call("PUT", "/api/v1/status-pages/"+page.ID, body, viewer); denied.Code != http.StatusForbidden {
		t.Fatalf("viewer updated categories: %d", denied.Code)
	}
	invalid := call("PUT", "/api/v1/status-pages/"+page.ID, `{"is_public":true,"categories":[{"name":" "}]}`, admin)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid category update accepted: %d", invalid.Code)
	}
	public := call("GET", "/api/v1/status-pages/custom", "", nil)
	var response struct {
		Page     models.StatusPage `json:"page"`
		Monitors []map[string]any  `json:"monitors"`
	}
	if public.Code != http.StatusOK {
		t.Fatal(public.Body.String())
	}
	if err := json.Unmarshal(public.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(response.Page.Categories, page.Categories) || len(response.Monitors) != 2 {
		t.Fatalf("category and legacy membership not combined: %s", public.Body.String())
	}
	for _, monitor := range response.Monitors {
		if len(monitor["history"].([]any)) != 48 || monitor["uptime_24h"] != float64(100) {
			t.Fatalf("category history unavailable: %+v", monitor)
		}
	}
	for _, secret := range []string{"hidden-service", "private.example", "private diagnostic"} {
		if strings.Contains(public.Body.String(), secret) {
			t.Fatalf("public response leaked %q", secret)
		}
	}
	// 旧客户端仅修改布局时保留分类；分类只能影响状态页，不能改写监控分组。
	legacy := call("PUT", "/api/v1/status-pages/"+page.ID, `{"layout":"cards","is_public":true,"groups":[{"name":"group-service"}]}`, admin)
	if legacy.Code != http.StatusOK {
		t.Fatal(legacy.Body.String())
	}
	saved, err := db.GetStatusPageByID(t.Context(), page.ID)
	if err != nil || saved == nil || !reflect.DeepEqual(saved.Categories, page.Categories) {
		t.Fatalf("legacy update lost categories: %+v, %v", saved, err)
	}
	monitor, err := db.GetMonitor(t.Context(), "category-service")
	if err != nil || monitor == nil || !reflect.DeepEqual(monitor.Groups, []string{"category-service"}) {
		t.Fatalf("monitor groups changed: %+v, %v", monitor, err)
	}
	// 密码页和内部页必须在加载分类历史之前完成原有鉴权。
	protected := call("PUT", "/api/v1/status-pages/"+page.ID, `{"is_public":true,"password":"password123"}`, admin)
	if protected.Code != http.StatusOK {
		t.Fatal(protected.Body.String())
	}
	for _, cookie := range []*http.Cookie{nil, viewer} {
		denied := call("GET", "/api/v1/status-pages/custom", "", cookie)
		if denied.Code != http.StatusForbidden || strings.Contains(denied.Body.String(), "history") || strings.Contains(denied.Body.String(), "category-service") {
			t.Fatalf("protected history exposed: %s", denied.Body.String())
		}
	}
	unlocked := call("POST", "/api/v1/status-pages/custom/unlock", `{"password":"password123"}`, nil)
	if unlocked.Code != http.StatusOK || len(unlocked.Result().Cookies()) == 0 {
		t.Fatal(unlocked.Body.String())
	}
	accessible := call("GET", "/api/v1/status-pages/custom", "", unlocked.Result().Cookies()[0])
	if accessible.Code != http.StatusOK || !strings.Contains(accessible.Body.String(), "category-service") || !strings.Contains(accessible.Body.String(), "history") {
		t.Fatal(accessible.Body.String())
	}
	internal := call("PUT", "/api/v1/status-pages/"+page.ID, `{"is_public":false,"clear_password":true}`, admin)
	if internal.Code != http.StatusOK {
		t.Fatal(internal.Body.String())
	}
	denied := call("GET", "/api/v1/status-pages/custom", "", nil)
	if denied.Code != http.StatusForbidden || strings.Contains(denied.Body.String(), "history") {
		t.Fatal("internal page history exposed")
	}
	cleared := call("PUT", "/api/v1/status-pages/"+page.ID, `{"is_public":true,"categories":[]}`, admin)
	if cleared.Code != http.StatusOK {
		t.Fatal(cleared.Body.String())
	}
	saved, err = db.GetStatusPageByID(t.Context(), page.ID)
	if err != nil || saved == nil || saved.Categories == nil || len(saved.Categories) != 0 {
		t.Fatalf("explicit empty array did not clear categories: %+v, %v", saved, err)
	}
}

func TestStatusPageCategoryValidation(t *testing.T) {
	srv, _, cleanup := setupAPITest(t)
	defer cleanup()
	router := srv.Router()
	admin := registerAndLoginAdmin(t, router)
	tooMany := make([]models.StatusPageCategory, 51)
	tooManyMonitors := make([]string, 1001)
	for i := range tooManyMonitors {
		tooManyMonitors[i] = "monitor-" + strconv.Itoa(i)
	}
	tests := map[string][]models.StatusPageCategory{
		"blank name":                {{Name: "  "}},
		"long name":                 {{Name: strings.Repeat("中", 101)}},
		"long description":          {{Name: "Category", Description: strings.Repeat("中", 501)}},
		"duplicate name":            {{Name: "Home"}, {Name: " home "}},
		"duplicate monitor":         {{Name: "Home", MonitorIDs: []string{"router"}}, {Name: "Network", MonitorIDs: []string{"router"}}},
		"duplicate within category": {{Name: "Home", MonitorIDs: []string{"router", "router"}}},
		"blank monitor":             {{Name: "Home", MonitorIDs: []string{" "}}},
		"long monitor ID":           {{Name: "Home", MonitorIDs: []string{strings.Repeat("x", 129)}}},
		"too many monitors":         {{Name: "Home", MonitorIDs: tooManyMonitors}},
		"too many categories":       tooMany,
	}
	for name, categories := range tests {
		t.Run(name, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{"name": "Invalid", "slug": "invalid", "categories": categories})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/api/v1/status-pages", bytes.NewReader(body))
			req.AddCookie(admin)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("invalid categories accepted: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}
