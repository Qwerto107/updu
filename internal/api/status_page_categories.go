package api

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/updu/updu/internal/models"
)

// 分类顺序直接采用提交顺序；限制数量和长度，避免公开页面被异常配置拖慢。
func normalizeStatusPageCategories(categories []models.StatusPageCategory) ([]models.StatusPageCategory, error) {
	if len(categories) > 50 {
		return nil, fmt.Errorf("a status page can contain at most 50 categories")
	}
	names := make(map[string]bool)
	monitorIDs := make(map[string]bool)
	result := make([]models.StatusPageCategory, 0, len(categories))
	for _, category := range categories {
		category.Name = strings.TrimSpace(category.Name)
		category.Description = strings.TrimSpace(category.Description)
		if category.Name == "" || utf8.RuneCountInString(category.Name) > 100 {
			return nil, fmt.Errorf("category names must contain 1 to 100 characters")
		}
		nameKey := strings.ToLower(category.Name)
		if names[nameKey] {
			return nil, fmt.Errorf("category names must be unique")
		}
		names[nameKey] = true
		if utf8.RuneCountInString(category.Description) > 500 {
			return nil, fmt.Errorf("category descriptions must contain at most 500 characters")
		}
		ids := make([]string, 0, len(category.MonitorIDs))
		for _, id := range category.MonitorIDs {
			id = strings.TrimSpace(id)
			if id == "" || len(id) > 128 {
				return nil, fmt.Errorf("invalid category monitor ID")
			}
			if monitorIDs[id] {
				return nil, fmt.Errorf("a monitor can appear in only one category")
			}
			monitorIDs[id] = true
			if len(monitorIDs) > 1000 {
				return nil, fmt.Errorf("categories can contain at most 1000 monitors")
			}
			ids = append(ids, id)
		}
		category.MonitorIDs = ids
		result = append(result, category)
	}
	return result, nil
}
