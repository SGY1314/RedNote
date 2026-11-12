package store

import (
	"reflect"
	"testing"
)

func TestOpenAppliesAllMigrationsAndReopensExistingData(t *testing.T) {
	dir := t.TempDir()
	first, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := first.DB.Query("SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatal(err)
	}
	var versions []int
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	rows.Close()
	if want := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}; !reflect.DeepEqual(versions, want) {
		t.Fatalf("migration records = %v, want %v", versions, want)
	}
	saved := map[string]string{"value": "保留"}
	if err := Put(first.DB, "settings", "migration-test", saved); err != nil {
		t.Fatal(err)
	}
	if err := first.DB.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	got, err := Get[map[string]string](reopened.DB, "settings", "migration-test")
	if err != nil || got["value"] != saved["value"] {
		t.Fatalf("data after reopen = %#v, %v", got, err)
	}
}
