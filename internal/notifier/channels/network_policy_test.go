package channels

import (
	"context"
	"net"
	"testing"

	"github.com/updu/updu/internal/checker"
)

func TestMonitorPolicyDoesNotRelaxNotifications(t *testing.T) {
	// 即使误传了允许任意目标的监控上下文，通知也必须继续拦截非公网地址。
	ctx := checker.WithTargetPolicy(context.Background(), false, false)
	for _, host := range []string{"127.0.0.1", "::1", "192.168.0.88", "fd00::1", "169.254.169.254", "fe80::1"} {
		t.Run(host, func(t *testing.T) {
			if err := checkHostSSRF(ctx, host); err == nil {
				t.Fatal("notification host check allowed private target")
			}
			if err := ssrfControl(ctx)("tcp", net.JoinHostPort(host, "443"), nil); err == nil {
				t.Fatal("notification dialer allowed private target")
			}
		})
	}
	if err := checkHostSSRF(ctx, "8.8.8.8"); err != nil {
		t.Fatal(err)
	}
}
