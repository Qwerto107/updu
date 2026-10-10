package storage

import (
	"context"
	"database/sql"
	"time"
)

// StatusHistoryBucket 仅公开统计值，不包含探测目标、响应内容或故障详情。
type StatusHistoryBucket struct {
	Start     time.Time `json:"start"`
	Status    string    `json:"status"`
	Samples   int       `json:"samples"`
	Uptime    *float64  `json:"uptime"`
	LatencyMs *float64  `json:"latency_ms"`
}

// GetStatusHistory 固定返回最近 24 小时的 48 个半小时区间，无数据保留 unknown。
func (db *DB) GetStatusHistory(ctx context.Context, monitorID string, now time.Time) ([]StatusHistoryBucket, *float64, error) {
	start := now.Add(-24 * time.Hour)
	buckets := make([]StatusHistoryBucket, 48)
	var upCounts, latencyCounts [48]int
	var latencySums [48]float64
	for i := range buckets {
		buckets[i] = StatusHistoryBucket{Start: start.Add(time.Duration(i) * 30 * time.Minute), Status: "unknown"}
	}
	// 旧记录可能含不同的时区偏移；先用索引缩小范围，再按真实时间精确筛选。
	rows, err := db.QueryContext(ctx, `SELECT status, latency_ms, checked_at FROM check_results WHERE monitor_id=? AND checked_at>=?`, monitorID, start.UTC().Add(-24*time.Hour))
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	total, up := 0, 0
	for rows.Next() {
		var status string
		var latency sql.NullFloat64
		var at time.Time
		if err := rows.Scan(&status, &latency, &at); err != nil {
			return nil, nil, err
		}
		if at.Before(start) || !at.Before(now) {
			continue
		}
		if status != "up" && status != "down" && status != "degraded" {
			continue
		}
		i := int(at.Sub(start) / (30 * time.Minute))
		b := &buckets[i]
		b.Samples++
		total++
		if status == "up" {
			upCounts[i]++
			up++
		}
		// 一个区间出现故障就标红，避免平均值掩盖短时故障。
		if b.Status == "unknown" || status == "down" || (status == "degraded" && b.Status != "down") {
			b.Status = status
		}
		if latency.Valid && status == "up" {
			latencySums[i] += latency.Float64
			latencyCounts[i]++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	for i := range buckets {
		if buckets[i].Samples > 0 {
			value := float64(upCounts[i]) / float64(buckets[i].Samples) * 100
			buckets[i].Uptime = &value
		}
		if latencyCounts[i] > 0 {
			value := latencySums[i] / float64(latencyCounts[i])
			buckets[i].LatencyMs = &value
		}
	}
	if total == 0 {
		return buckets, nil, nil
	}
	uptime := float64(up) / float64(total) * 100
	return buckets, &uptime, nil
}
