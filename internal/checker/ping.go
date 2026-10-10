package checker

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/updu/updu/internal/models"
)

// PingChecker monitors hosts via ICMP ping.
// Uses the system `ping` command for portability (no raw socket needed without CAP_NET_RAW).
type PingChecker struct {
	commander Commander
}

func (c *PingChecker) Type() string { return "ping" }

func (c *PingChecker) Validate(config json.RawMessage) error {
	var cfg models.PingMonitorConfig
	if err := json.Unmarshal(config, &cfg); err != nil {
		return fmt.Errorf("invalid ping config: %w", err)
	}
	if cfg.Host == "" {
		return fmt.Errorf("host is required")
	}
	return nil
}

var pingTimeRegex = regexp.MustCompile(`time[=<]\s*([\d.]+)\s*ms`)

// Windows 使用 -n 指定次数、-w 指定毫秒；Linux 的 -W 使用秒。
func pingArgs(goos string, count, timeoutS int, host string) []string {
	if goos == "windows" {
		return []string{"-n", strconv.Itoa(count), "-w", strconv.FormatInt(int64(timeoutS)*1000, 10), host}
	}
	return []string{"-c", strconv.Itoa(count), "-W", strconv.Itoa(timeoutS), host}
}

func (c *PingChecker) Check(ctx context.Context, monitor *models.Monitor) (*models.CheckResult, error) {
	var cfg models.PingMonitorConfig
	if err := json.Unmarshal(monitor.Config, &cfg); err != nil {
		return failResult(monitor.ID, "invalid config: "+err.Error()), nil
	}

	count := cfg.Count
	if count <= 0 {
		count = 3
	}

	// SSRF protection: check host before connecting
	if err := CheckHostSSRF(ctx, cfg.Host); err != nil {
		return failResult(monitor.ID, err.Error()), nil
	}

	// Resolve hostname first to check validity
	if _, err := net.LookupHost(cfg.Host); err != nil {
		return &models.CheckResult{
			MonitorID: monitor.ID,
			Status:    models.StatusDown,
			Message:   "dns resolution failed: " + err.Error(),
			CheckedAt: time.Now(),
		}, nil
	}

	// 直接调用探测器时也使用与监控创建接口一致的默认超时。
	timeoutS := monitor.TimeoutS
	if timeoutS <= 0 {
		timeoutS = 10
	}
	timeout := time.Duration(timeoutS) * time.Second
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	commander := c.commander
	if commander == nil {
		commander = &defaultCommander{}
	}

	start := time.Now()
	command := "ping"
	// 后台服务的 PATH 可能不包含系统目录，Windows 直接使用系统自带的程序。
	if runtime.GOOS == "windows" && os.Getenv("SystemRoot") != "" {
		command = filepath.Join(os.Getenv("SystemRoot"), "System32", "PING.EXE")
	}
	output, err := commander.CombinedOutput(ctx, command, pingArgs(runtime.GOOS, count, timeoutS, cfg.Host)...)
	totalTime := int(time.Since(start).Milliseconds())

	result := &models.CheckResult{
		MonitorID: monitor.ID,
		CheckedAt: time.Now(),
	}

	if err != nil {
		result.Status = models.StatusDown
		// 启动失败和超时可能没有输出，必须保留实际执行错误作为诊断依据。
		cause := err
		if ctx.Err() != nil {
			cause = ctx.Err()
		}
		result.Message = "ping failed: " + cause.Error()
		if detail := strings.TrimSpace(string(output)); detail != "" {
			result.Message += ": " + detail
		}
		result.LatencyMs = &totalTime
		return result, nil
	}

	// Parse average latency from ping output
	matches := pingTimeRegex.FindAllStringSubmatch(string(output), -1)
	if len(matches) > 0 {
		var totalLatency float64
		for _, m := range matches {
			if v, err := strconv.ParseFloat(m[1], 64); err == nil {
				totalLatency += v
			}
		}
		avgLatency := int(totalLatency / float64(len(matches)))
		result.LatencyMs = &avgLatency
	} else {
		result.LatencyMs = &totalTime
	}

	result.Status = models.StatusUp
	result.Message = fmt.Sprintf("%d packets sent, avg %dms", count, *result.LatencyMs)
	return result, nil
}
