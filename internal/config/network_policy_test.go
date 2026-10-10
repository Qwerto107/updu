package config

import "testing"

func TestMonitorNetworkPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		restrict    bool
	}{
		{"default", "", false}, {"unrestricted", "false", false}, {"restricted", "true", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// 分别检查监控和通知默认值，不清空进程中 Windows 所需的临时目录环境。
			t.Setenv("UPDU_RESTRICT_MONITOR_TARGETS", tc.value)
			t.Setenv("UPDU_ALLOW_LOCALHOST", "")
			cfg := Load()
			if cfg.RestrictMonitorTargets != tc.restrict {
				t.Fatalf("RestrictMonitorTargets=%v, want %v", cfg.RestrictMonitorTargets, tc.restrict)
			}
			if cfg.AllowLocalhost {
				t.Fatal("monitor policy must not allow private notification targets")
			}
		})
	}
}
