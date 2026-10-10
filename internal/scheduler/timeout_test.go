package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/updu/updu/internal/models"
)

func TestSchedulerDefaultsMissingTimeout(t *testing.T) {
	sched, db, cleanup := setupSchedulerTest(t)
	defer cleanup()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	for _, timeout := range []int{0, -1} {
		t.Run(fmt.Sprint(timeout), func(t *testing.T) {
			ctx := context.Background()
			config, _ := json.Marshal(map[string]string{"url": server.URL})
			monitor := &models.Monitor{ID: fmt.Sprintf("timeout-%d", timeout), Name: "timeout", Type: "http", Config: config, TimeoutS: timeout}
			if err := db.CreateMonitor(ctx, monitor); err != nil {
				t.Fatal(err)
			}
			// 本地 HTTP 请求必须真正成功，防止测试只验证默认值而漏掉外层立即取消。
			sched.RunCheckSync(ctx, monitor)
			results, err := db.GetRecentChecks(ctx, monitor.ID, 1)
			if err != nil {
				t.Fatal(err)
			}
			if len(results) != 1 || results[0].Status != models.StatusUp {
				t.Fatalf("expected successful check, got %+v", results)
			}
			if monitor.TimeoutS != timeout {
				t.Fatal("shared monitor was modified")
			}
		})
	}
}
