package main

import (
	"reflect"
	"testing"
	"time"

	"github.com/restic/restic/app/domain"
)

func TestApplicationPresetDefinitionsIncludeSupportedAppData(t *testing.T) {
	expected := map[string][]string{
		"signal":           {"Library/Application Support/Signal"},
		"whatsapp":         {"Library/Containers/net.whatsapp.WhatsApp", "Library/Group Containers/group.net.whatsapp.WhatsApp.shared", "Library/Group Containers/group.net.whatsapp.WhatsApp.private", "Library/Group Containers/group.net.whatsapp.family"},
		"imhex":            {"Library/Application Support/imhex"},
		"mongodb-compass":  {"Library/Application Support/MongoDB Compass"},
		"beekeeper-studio": {"Library/Application Support/beekeeper-studio"},
		"sol":              {".config/sol", "Library/Preferences/com.ospfranco.sol.plist"},
		"rectangle":        {"Library/Preferences/com.knollsoft.Rectangle.plist"},
		"snapshotter":      {"Library/Application Support/Snapshotter"},
		"btop":             {".config/btop"},
		"wakatime":         {".wakatime.cfg", ".wakatime"},
	}

	definitions := make(map[string][]string, len(presetDefinitions))
	for _, definition := range presetDefinitions {
		definitions[definition.id] = definition.paths
	}
	for id, paths := range expected {
		if !reflect.DeepEqual(definitions[id], paths) {
			t.Errorf("preset %q paths = %#v, want %#v", id, definitions[id], paths)
		}
	}
}

func TestBackupMetadataRecordsSelectedAppsAndConfiguration(t *testing.T) {
	createdAt := time.Date(2026, time.August, 17, 12, 0, 0, 0, time.UTC)
	preferences := domain.Preferences{
		Sources: []domain.Source{
			{ID: "documents", Path: "/Users/test/Documents", Enabled: true},
			{ID: "disabled", Path: "/Users/test/Disabled", Enabled: false},
			{ID: "excluded", Path: "/Users/test/Excluded", Enabled: true, Excluded: true},
		},
		Exclusions:   []domain.Exclusion{{ID: "cache", Pattern: "**/Cache", Enabled: true}},
		SelectedApps: []string{"chrome"},
	}
	presets := []domain.ApplicationPreset{
		{ID: "firefox", Name: "Firefox", Paths: []string{"/Users/test/Library/Firefox"}},
		{ID: "chrome", Name: "Google Chrome", Paths: []string{"/Users/test/Library/Chrome"}, Enabled: true},
	}

	captured := map[string][]domain.BackupKeychainItem{
		"chrome": {{Service: "Chrome Safe Storage", Account: "Chrome", Value: "captured secret"}},
	}
	applicationSources := []domain.Source{{ID: "chrome", Path: "/Users/test/Library/Chrome", Enabled: true}}
	metadata := backupMetadata(preferences, presets, applicationSources, captured, createdAt)

	if metadata.Version != 1 || !metadata.CreatedAt.Equal(createdAt) {
		t.Fatalf("unexpected metadata header: %#v", metadata)
	}
	if len(metadata.Sources) != 1 || metadata.Sources[0].Path != "/Users/test/Documents" {
		t.Fatalf("unexpected metadata sources: %#v", metadata.Sources)
	}
	if len(metadata.Exclusions) != 1 || metadata.Exclusions[0].Pattern != "**/Cache" {
		t.Fatalf("unexpected metadata exclusions: %#v", metadata.Exclusions)
	}
	if len(metadata.Applications) != 1 || metadata.Applications[0].ID != "chrome" {
		t.Fatalf("unexpected metadata applications: %#v", metadata.Applications)
	}
	items := metadata.Applications[0].KeychainItems
	if len(items) != 1 || items[0].Service != "Chrome Safe Storage" || items[0].Account != "Chrome" || items[0].Value != "captured secret" {
		t.Fatalf("unexpected Chrome restore requirements: %#v", items)
	}
}
