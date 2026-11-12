package store

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"strings"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct{ DB *sql.DB }

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "db"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "db", "workbench.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); err != nil {
		db.Close()
		return nil, err
	}
	if err = applyMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db}, nil
}

// applyMigrations runs embedded migrations in filename order. Each file is
// atomic, and every migration is idempotent so reopening an existing workspace
// repairs missing objects without duplicating data.
func applyMigrations(db *sql.DB) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", entry.Name(), err)
		}
		if _, err = tx.Exec(string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %s: %w", entry.Name(), err)
		}
		if err = tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}
func table(t string) string {
	switch t {
	case "mobile_handoffs":
		return t
	case "angle_generations", "creation_workflows", "title_generations", "copy_generations", "image_plans", "notes", "revisions", "assets", "extractions", "projects", "versions", "publications", "jobs", "settings", "own_posts", "post_syncs", "video_scripts":
		return t
	}
	panic("invalid table")
}

type Querier interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
	Exec(string, ...any) (sql.Result, error)
}

func Get[T any](q Querier, t, id string) (T, error) {
	var v T
	var b string
	err := q.QueryRow("SELECT data FROM "+table(t)+" WHERE id=?", id).Scan(&b)
	if err != nil {
		return v, err
	}
	err = json.Unmarshal([]byte(b), &v)
	return v, err
}
func List[T any](q Querier, t string) ([]T, error) {
	rows, err := q.Query("SELECT data FROM " + table(t) + " ORDER BY rowid DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		var b string
		var v T
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(b), &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Uses jobs_queue instead of decoding every historical job on each worker tick.
func NextJob[T any](q Querier, kind string) (T, error) {
	var v T
	var b string
	err := q.QueryRow("SELECT data FROM jobs WHERE json_extract(data,'$.kind')=? AND json_extract(data,'$.state')='queued' ORDER BY rowid LIMIT 1", kind).Scan(&b)
	if err == nil {
		err = json.Unmarshal([]byte(b), &v)
	}
	return v, err
}
func Put(q Querier, t, id string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = q.Exec("INSERT INTO "+table(t)+"(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", id, string(b))
	return err
}
func Delete(q Querier, t, id string) error {
	_, err := q.Exec("DELETE FROM "+table(t)+" WHERE id=?", id)
	return err
}
func (s *Store) Transaction(fn func(*sql.Tx) error) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = fn(tx); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
