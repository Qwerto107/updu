package checker

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/updu/updu/internal/models"
)

func TestPingPlatformArgs(t *testing.T) {
	// 在任意测试平台上同时检查 Windows 毫秒参数和 Linux 秒参数。
	for _, tc := range []struct {
		goos string
		want []string
	}{
		{"windows", []string{"-n", "2", "-w", "5000", "192.168.0.88"}},
		{"linux", []string{"-c", "2", "-W", "5", "192.168.0.88"}},
	} {
		t.Run(tc.goos, func(t *testing.T) {
			if got := pingArgs(tc.goos, 2, 5, "192.168.0.88"); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("arguments=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestPingFailureDetails(t *testing.T) {
	for _, tc := range []struct {
		name, output, want string
		cancel             bool
	}{
		{"empty output", "", "ping failed: executable unavailable", false},
		{"command output", " request timed out \n", "ping failed: executable unavailable: request timed out", false},
		{"canceled", "", "ping failed: context canceled", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancel {
				cancel()
			}
			c := &PingChecker{commander: &mockCommander{output: []byte(tc.output), err: errors.New("executable unavailable")}}
			// 字面 IP 加模拟命令，不访问真实网络。
			m := &models.Monitor{ID: "ping-errors", Config: json.RawMessage(`{"host":"127.0.0.1"}`), TimeoutS: 5}
			result, err := c.Check(ctx, m)
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != models.StatusDown || !strings.Contains(result.Message, tc.want) {
				t.Fatalf("unexpected result: %+v", result)
			}
		})
	}
}
