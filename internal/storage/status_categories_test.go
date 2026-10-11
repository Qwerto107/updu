package storage

import (
	"reflect"
	"testing"

	"github.com/updu/updu/internal/models"
)

func TestStatusPageCategoryPersistence(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	page := &models.StatusPage{
		ID: "categories", Name: "Categories", Slug: "categories", IsPublic: true,
		Groups: []models.StatusPageGroup{{Name: "legacy"}},
		Categories: []models.StatusPageCategory{
			{Name: "家庭网络", Description: "自定义说明", MonitorIDs: []string{"router", "nas"}},
			{Name: "网站", MonitorIDs: []string{"blog"}},
		},
	}
	if err := db.CreateStatusPage(t.Context(), page); err != nil {
		t.Fatal(err)
	}
	check := func(got *models.StatusPage, err error) {
		t.Helper()
		if err != nil || got == nil {
			t.Fatalf("load page: %v", err)
		}
		if !reflect.DeepEqual(got.Categories, page.Categories) || !reflect.DeepEqual(got.Groups, page.Groups) {
			t.Fatalf("category order or legacy groups changed: %+v", got)
		}
	}
	check(db.GetStatusPageByID(t.Context(), page.ID))
	check(db.GetStatusPageBySlug(t.Context(), page.Slug))
	// 更新分类排序与服务顺序后，所有读取入口都应保留顺序。
	page.Categories[0], page.Categories[1] = page.Categories[1], page.Categories[0]
	page.Categories[1].MonitorIDs = []string{"nas", "router"}
	if err := db.UpdateStatusPage(t.Context(), page); err != nil {
		t.Fatal(err)
	}
	check(db.GetStatusPageByID(t.Context(), page.ID))
	pages, err := db.ListStatusPages(t.Context())
	if err != nil || len(pages) != 1 {
		t.Fatalf("list pages: %v, %d pages", err, len(pages))
	}
	check(pages[0], nil)
}

func TestStatusPageCategoryMigrationPreservesLegacyPage(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	// 在临时库重建升级前的状态页结构，确认迁移不会改变已有选择与布局。
	for _, statement := range []string{
		"ALTER TABLE status_pages DROP COLUMN categories",
		"DELETE FROM schema_migrations WHERE version = 13",
		`INSERT INTO status_pages (id, name, slug, description, password, groups, layout) VALUES ('legacy', 'Legacy', 'legacy', '', '', '[{"name":"家庭网络","monitor_ids":["router"]}]', 'cards')`,
	} {
		if _, err := db.ExecContext(t.Context(), statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrate(t.Context()); err != nil {
		t.Fatal(err)
	}
	page, err := db.GetStatusPageByID(t.Context(), "legacy")
	if err != nil || page == nil {
		t.Fatalf("load migrated page: %v", err)
	}
	if page.Categories == nil || len(page.Categories) != 0 || page.Layout != "cards" || len(page.Groups) != 1 || page.Groups[0].Name != "家庭网络" || page.Groups[0].MonitorIDs[0] != "router" {
		t.Fatalf("legacy page changed during migration: %+v", page)
	}
}
