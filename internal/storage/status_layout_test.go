package storage

import (
	"testing"

	"github.com/updu/updu/internal/models"
)

func TestStatusPageLayoutPersistence(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()
	for _, layout := range []string{"", "cards", "table", "list"} {
		t.Run("layout-"+layout, func(t *testing.T) {
			page := &models.StatusPage{ID: "page-" + layout, Name: "Page", Slug: "page-" + layout, Layout: layout}
			if err := db.CreateStatusPage(t.Context(), page); err != nil {
				t.Fatal(err)
			}
			want := layout
			if want == "" {
				want = "cards"
			}
			loaded, err := db.GetStatusPageBySlug(t.Context(), page.Slug)
			if err != nil || loaded == nil || loaded.Layout != want {
				t.Fatalf("create layout: got %+v, want %q, err %v", loaded, want, err)
			}
			// 修改其他字段不能顺带改写旧 list 或已经选择的 table。
			loaded.Name = "Renamed"
			if err := db.UpdateStatusPage(t.Context(), loaded); err != nil {
				t.Fatal(err)
			}
			updated, err := db.GetStatusPageByID(t.Context(), loaded.ID)
			if err != nil || updated == nil || updated.Layout != want {
				t.Fatalf("update layout: got %+v, want %q, err %v", updated, want, err)
			}
		})
	}
}
