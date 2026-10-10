package checker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"runtime"
	"sync"
	"testing"

	"github.com/updu/updu/internal/models"
)

func TestHTTPChecker_CancelDuringTLSHandshake(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	config, err := json.Marshal(models.HTTPMonitorConfig{URL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	monitor := &models.Monitor{ID: "cancel-tls", Type: "http", TimeoutS: 5, Config: config}

	// 取消时机覆盖握手开始到证书验证，-race 检测后台回调与结果构造的竞争。
	var checks sync.WaitGroup
	for attempt := 0; attempt < 64; attempt++ {
		checks.Add(1)
		go func(delay int) {
			defer checks.Done()
			ctx, cancel := context.WithCancel(context.WithValue(context.Background(), AllowLocalhostKey, true))
			defer cancel()
			ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
				TLSHandshakeStart: func() {
					go func() {
						for range delay {
							runtime.Gosched()
						}
						cancel()
					}()
				},
			})
			result, err := (&HTTPChecker{}).Check(ctx, monitor)
			if err != nil {
				t.Errorf("canceled check returned an unexpected error: %v", err)
				return
			}
			if result == nil || result.Status != models.StatusDown {
				t.Errorf("expected a down result for canceled or untrusted TLS, got %+v", result)
			}
		}(attempt % 8)
	}
	checks.Wait()
}
