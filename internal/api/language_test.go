package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPI_DefaultLanguage(t *testing.T) {
	srv, _, cleanup := setupAPITest(t)
	defer cleanup()
	admin, viewer := setupAdminAndViewer(t, srv)
	router := srv.Router()

	// 未设置语言时回退英文；公开接口只返回语言，不暴露管理员设置。
	checkDefault := func(want string) {
		t.Helper()
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, httptest.NewRequest("GET", "/api/v1/auth/setup", nil))
		var data map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		if rr.Code != http.StatusOK || data["default_language"] != want {
			t.Fatalf("default language: status=%d data=%v, want %s", rr.Code, data, want)
		}
		if _, exists := data["site_name"]; exists {
			t.Fatal("public setup response leaked admin settings")
		}
	}
	checkDefault("en")

	for _, language := range []string{"zh-CN", "en"} {
		body, _ := json.Marshal(map[string]string{"default_language": language})
		req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewReader(body))
		req.AddCookie(admin)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("save language: %d %s", rr.Code, rr.Body.String())
		}
		checkDefault(language)
		// 管理员读取时必须返回持久化值。
		req = httptest.NewRequest("GET", "/api/v1/settings", nil)
		req.AddCookie(admin)
		rr = httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		var saved map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &saved); err != nil {
			t.Fatal(err)
		}
		if saved["default_language"] != language {
			t.Fatalf("saved language: %v", saved)
		}
	}

	// 非管理员不能更改默认语言；无效值必须在任何其他写入前被拒绝。
	for _, tc := range []struct {
		body   string
		cookie *http.Cookie
		status int
	}{
		{`{"default_language":"zh-CN"}`, viewer, http.StatusForbidden},
		{`{"default_language":"fr","site_name":"unexpected"}`, admin, http.StatusBadRequest},
		{`{"default_language":""}`, admin, http.StatusBadRequest},
		{`{"default_language":"<script>"}`, admin, http.StatusBadRequest},
	} {
		req := httptest.NewRequest("POST", "/api/v1/settings", bytes.NewBufferString(tc.body))
		req.AddCookie(tc.cookie)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != tc.status {
			t.Fatalf("expected %d, got %d: %s", tc.status, rr.Code, rr.Body.String())
		}
		checkDefault("en")
	}
}
