package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/restic/restic/app/domain"
)

func TestStoreMigratesLegacyHourlyPolicies(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	preferences := domain.DefaultPreferences()
	preferences.Schedule.Kind = domain.ScheduleHourly
	preferences.Schedule.Interval = 2
	preferences.Retention.Hourly = 24
	encoded, err := json.Marshal(preferences)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Schedule.Kind != domain.ScheduleDaily || loaded.Retention.Hourly != 0 {
		t.Fatalf("legacy hourly policy was not migrated: %#v", loaded)
	}
}

func TestStoreReturnsDefaultsWhenMissing(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "preferences.json"))
	preferences, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !preferences.Schedule.Enabled || preferences.Schedule.Kind != domain.ScheduleDaily || preferences.Retention.Daily != 7 {
		t.Fatalf("unexpected defaults: %#v", preferences)
	}
}

func TestStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "preferences.json")
	store := NewStore(path)
	preferences := domain.DefaultPreferences()
	preferences.Sources = []domain.Source{{ID: "documents", Path: "/Users/example/Documents", Enabled: true}}

	if err := store.Save(preferences); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Sources) != 1 || loaded.Sources[0].Path != preferences.Sources[0].Path {
		t.Fatalf("unexpected preferences: %#v", loaded)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("preferences permissions are %o", info.Mode().Perm())
	}
}

func TestStoreRejectsInvalidPreferences(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "preferences.json"))
	preferences := domain.DefaultPreferences()
	preferences.Schedule.Hour = 25
	if err := store.Save(preferences); err == nil {
		t.Fatal("expected validation error")
	}
}
