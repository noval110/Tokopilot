package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"tokopilot/backend/internal/db"
	"tokopilot/backend/internal/domain"
)

// CategoryWithCount adds the number of active products in the category.
type CategoryWithCount struct {
	domain.Category
	ProductCount int
}

func ListCategories(ctx context.Context, q db.DBTX, storeID string, includeArchived bool) ([]CategoryWithCount, error) {
	rows, err := q.Query(ctx, `
		SELECT c.id, c.name, c.archived_at, c.created_at, c.updated_at,
		       count(p.id) FILTER (WHERE p.is_active)
		FROM categories c
		LEFT JOIN products p ON p.category_id = c.id AND p.store_id = c.store_id
		WHERE c.store_id = $1 AND ($2 OR c.archived_at IS NULL)
		GROUP BY c.id
		ORDER BY lower(c.name), c.id`, storeID, includeArchived)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (CategoryWithCount, error) {
		var c CategoryWithCount
		err := r.Scan(&c.ID, &c.Name, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt, &c.ProductCount)
		return c, err
	})
}

// GetActiveCategory returns a non-archived category of the store, or ErrNotFound.
func GetActiveCategory(ctx context.Context, q db.DBTX, storeID, id string) (domain.Category, error) {
	var c domain.Category
	err := q.QueryRow(ctx, `
		SELECT id, name, archived_at, created_at, updated_at FROM categories
		WHERE store_id = $1 AND id = $2 AND archived_at IS NULL`, storeID, id,
	).Scan(&c.ID, &c.Name, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Category{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Category{}, fmt.Errorf("get category: %w", err)
	}
	return c, nil
}

func CreateCategory(ctx context.Context, q db.DBTX, storeID, name, createdBy string) (domain.Category, error) {
	var c domain.Category
	err := q.QueryRow(ctx, `
		INSERT INTO categories (store_id, name, created_by) VALUES ($1, $2, $3)
		RETURNING id, name, archived_at, created_at, updated_at`, storeID, name, createdBy,
	).Scan(&c.ID, &c.Name, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt)
	if db.IsUniqueViolation(err, "categories_store_name_active_idx") {
		return domain.Category{}, domain.ErrDuplicateCategory
	}
	if err != nil {
		return domain.Category{}, fmt.Errorf("insert category: %w", err)
	}
	return c, nil
}

func RenameCategory(ctx context.Context, q db.DBTX, storeID, id, name string) (domain.Category, error) {
	var c domain.Category
	err := q.QueryRow(ctx, `
		UPDATE categories SET name = $3, updated_at = now()
		WHERE store_id = $1 AND id = $2 AND archived_at IS NULL
		RETURNING id, name, archived_at, created_at, updated_at`, storeID, id, name,
	).Scan(&c.ID, &c.Name, &c.ArchivedAt, &c.CreatedAt, &c.UpdatedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return domain.Category{}, domain.ErrNotFound
	case db.IsUniqueViolation(err, "categories_store_name_active_idx"):
		return domain.Category{}, domain.ErrDuplicateCategory
	case err != nil:
		return domain.Category{}, fmt.Errorf("rename category: %w", err)
	}
	return c, nil
}

// ArchiveCategory hides a category from pickers. Products keep their link so
// history and filters stay intact.
func ArchiveCategory(ctx context.Context, q db.DBTX, storeID, id string, now time.Time) error {
	tag, err := q.Exec(ctx, `
		UPDATE categories SET archived_at = $3, updated_at = $3
		WHERE store_id = $1 AND id = $2 AND archived_at IS NULL`, storeID, id, now)
	if err != nil {
		return fmt.Errorf("archive category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
