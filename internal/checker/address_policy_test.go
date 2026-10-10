package checker

import (
	"context"
	"net"
	"testing"
)

func TestProbeAddressPolicy(t *testing.T) {
	addresses := []struct {
		ip      string
		blocked bool
	}{
		{"8.8.8.8", false}, {"2001:4860:4860::8888", false},
		{"127.0.0.1", true}, {"::1", true},
		{"10.0.0.1", true}, {"172.16.0.1", true}, {"192.168.0.88", true}, {"fd00::1", true},
		{"169.254.1.1", true}, {"169.254.169.254", true}, {"fe80::1", true}, {"ff02::1", true},
	}
	for _, restrict := range []bool{false, true} {
		mode := "default"
		if restrict {
			mode = "restricted"
		}
		for _, address := range addresses {
			t.Run(mode+"/"+address.ip, func(t *testing.T) {
				ctx := WithTargetPolicy(context.Background(), restrict, false)
				wantBlocked := restrict && address.blocked
				// 字面 IP 预检与拨号回调均不建立连接，避免测试触碰真实内网或元数据服务。
				if err := CheckHostSSRF(ctx, address.ip); (err != nil) != wantBlocked {
					t.Errorf("host check blocked=%v, want %v: %v", err != nil, wantBlocked, err)
				}
				err := SafeDialer(ctx)("tcp", net.JoinHostPort(address.ip, "443"), nil)
				if (err != nil) != wantBlocked {
					t.Errorf("dial check blocked=%v, want %v: %v", err != nil, wantBlocked, err)
				}
			})
		}
	}
}

func TestRestrictedProbeLegacyLocalhostOverride(t *testing.T) {
	ctx := WithTargetPolicy(context.Background(), true, true)
	for _, host := range []string{"127.0.0.1", "192.168.0.88"} {
		if err := CheckHostSSRF(ctx, host); err != nil {
			t.Fatal(err)
		}
	}
	// 旧开关原本不放行链路本地地址；开启限制模式时继续保持该语义。
	if err := CheckHostSSRF(ctx, "169.254.169.254"); err == nil {
		t.Fatal("restricted mode must retain the legacy link-local block")
	}
}
