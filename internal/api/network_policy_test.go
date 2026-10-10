package api

import (
	"context"
	"testing"

	"github.com/updu/updu/internal/checker"
	"github.com/updu/updu/internal/config"
	"github.com/updu/updu/internal/notifier/channels"
)

func TestMonitorAndNotificationContextsAreSeparate(t *testing.T) {
	server := &Server{config: &config.Config{}}
	for _, restrict := range []bool{false, true} {
		server.config.RestrictMonitorTargets = restrict
		probeCtx := server.withMonitorContext(context.Background())
		if err := checker.CheckHostSSRF(probeCtx, "192.168.0.88"); (err != nil) != restrict {
			t.Fatalf("monitor restriction=%v, error=%v", restrict, err)
		}
		// 两个入口都不得因监控策略而携带通知放行键。
		for _, ctx := range []context.Context{probeCtx, server.withNotificationContext(context.Background())} {
			if allow, _ := ctx.Value(channels.AllowLocalhostKey).(bool); allow {
				t.Fatal("monitor policy leaked into notification context")
			}
		}
	}
	server.config.AllowLocalhost = true
	if allow, _ := server.withNotificationContext(context.Background()).Value(channels.AllowLocalhostKey).(bool); !allow {
		t.Fatal("explicit legacy notification opt-in must remain supported")
	}
}
