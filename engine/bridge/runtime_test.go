package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/app/resticadapter"
)

func TestStateCollectionsEncodeAsArrays(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	result := runtime.handle(context.Background(), []byte(`{"type":"state.get"}`))
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"sources":null`)) || bytes.Contains(encoded, []byte(`"snapshots":null`)) {
		t.Fatalf("state contains null collection: %s", encoded)
	}
}

func TestStateStartsUnconfiguredAndPersistsSources(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	initial := runtime.handle(context.Background(), []byte(`{"type":"state.get"}`))
	if !initial.OK {
		t.Fatal(initial.Error)
	}
	state := initial.Data.(applicationState)
	if state.Status != "unconfigured" || len(state.Preferences.Sources) != 0 {
		t.Fatalf("unexpected initial state: %#v", state)
	}
	sourcePath := t.TempDir()
	payload, err := json.Marshal(request{Type: "source.add", Payload: json.RawMessage(fmt.Sprintf(`{"paths":[%q]}`, sourcePath))})
	if err != nil {
		t.Fatal(err)
	}
	updated := runtime.handle(context.Background(), payload)
	if !updated.OK {
		t.Fatal(updated.Error)
	}
	state = updated.Data.(applicationState)
	if len(state.Preferences.Sources) != 1 || state.Preferences.Sources[0].Path != sourcePath {
		t.Fatalf("unexpected sources: %#v", state.Preferences.Sources)
	}
	updated = runtime.handle(context.Background(), []byte(fmt.Sprintf(`{"type":"source.setEnabled","payload":{"id":%q,"enabled":false}}`, state.Preferences.Sources[0].ID)))
	if !updated.OK || updated.Data.(applicationState).Preferences.Sources[0].Enabled {
		t.Fatalf("source was not disabled: %#v", updated)
	}
	updated = runtime.handle(context.Background(), []byte(fmt.Sprintf(`{"type":"source.remove","payload":{"id":%q}}`, state.Preferences.Sources[0].ID)))
	if !updated.OK || len(updated.Data.(applicationState).Preferences.Sources) != 0 {
		t.Fatalf("source was not removed: %#v", updated)
	}
}

func TestAddSourcesRejectsFiles(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	file := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(file, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(request{Type: "source.add", Payload: json.RawMessage(fmt.Sprintf(`{"paths":[%q]}`, file))})
	if err != nil {
		t.Fatal(err)
	}
	result := runtime.handle(context.Background(), payload)
	if result.OK || result.Error == "" {
		t.Fatalf("expected directory validation error, got %#v", result)
	}
}

func TestConnectExistingRepository(t *testing.T) {
	repositoryPath := filepath.Join(t.TempDir(), "repository")
	configured := domain.Repository{
		ID: "existing", Name: "Existing", Kind: domain.RepositoryLocal, Location: repositoryPath,
	}
	creator := &resticadapter.Repository{}
	if err := creator.Initialize(context.Background(), configured, domain.RepositoryCredentials{}, []byte("secret")); err != nil {
		t.Fatal(err)
	}
	if err := creator.Close(); err != nil {
		t.Fatal(err)
	}

	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	payload, err := json.Marshal(request{Type: "repository.connect", Payload: mustJSON(t, map[string]any{
		"repository": configured,
		"password":   "secret",
	})})
	if err != nil {
		t.Fatal(err)
	}
	result := runtime.handle(context.Background(), payload)
	if !result.OK {
		t.Fatal(result.Error)
	}
	state := result.Data.(applicationState)
	if state.Status != "ready" || state.Preferences.Repository == nil || state.Preferences.Repository.Location != repositoryPath {
		t.Fatalf("unexpected connected state: %#v", state)
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
