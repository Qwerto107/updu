package storage

import (
	"context"
	"github.com/updu/updu/internal/models"
	"testing"
	"time"
)

func TestStatusHistoryBuckets(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	monitor := &models.Monitor{ID: "history", Name: "history", Type: "ping", Config: []byte(`{"host":"localhost"}`)}
	if err := db.CreateMonitor(ctx, monitor); err != nil {
		t.Fatal(err)
	}
	latency := 20
	for _, row := range []struct {
		status models.MonitorStatus
		at     time.Time
	}{
		{models.StatusUp, now.Add(-10 * time.Minute)},
		{models.StatusDown, now.Add(-5 * time.Minute)},
		// 不同时区的同一时刻必须进入同一区间；24 小时前和未来记录不能计入。
		{models.StatusUp, now.Add(-8 * time.Minute).In(time.FixedZone("SGT", 8*3600))},
		{models.StatusUp, now.Add(-25 * time.Hour)},
		{models.StatusUp, now.Add(time.Minute)},
	} {
		if err := db.InsertCheckResult(ctx, &models.CheckResult{MonitorID: monitor.ID, Status: row.status, LatencyMs: &latency, CheckedAt: row.at}); err != nil {
			t.Fatal(err)
		}
	}
	buckets, uptime, err := db.GetStatusHistory(ctx, monitor.ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(buckets) != 48 || uptime == nil || *uptime < 66.66 || *uptime > 66.67 {
		t.Fatalf("unexpected history: %v %v", buckets, uptime)
	}
	last := buckets[47]
	if last.Status != "down" || last.Samples != 3 || last.LatencyMs == nil || *last.LatencyMs != 20 {
		t.Fatalf("unexpected bucket: %+v", last)
	}
	if buckets[0].Status != "unknown" || buckets[0].Uptime != nil || buckets[0].LatencyMs != nil {
		t.Fatal("missing data was filled")
	}
	empty, rate, err := db.GetStatusHistory(ctx, "missing", now)
	if err != nil || rate != nil || len(empty) != 48 {
		t.Fatalf("empty history: %v %v %v", empty, rate, err)
	}
}
