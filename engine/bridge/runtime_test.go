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
	"github.com/restic/restic/app/onepasswordstore"
	"github.com/restic/restic/app/resticadapter"
)

type fakeSecretStore struct {
	credentials domain.RepositoryCredentials
	password    string
	archived    *domain.SecretStorage
	updated     *domain.Repository
}

func (f *fakeSecretStore) Vaults(context.Context, string) ([]onepasswordstore.Vault, error) {
	return []onepasswordstore.Vault{{ID: "vault-id", Title: "Private"}}, nil
}
func (f *fakeSecretStore) Items(context.Context, string, string) ([]onepasswordstore.Item, error) {
	return []onepasswordstore.Item{{ID: "item-id", Title: "Archive"}}, nil
}
func (f *fakeSecretStore) Save(context.Context, domain.Repository, domain.RepositoryCredentials, string) (string, error) {
	return "item-id", nil
}
func (f *fakeSecretStore) UpdateMetadata(_ context.Context, repository domain.Repository) error {
	f.updated = &repository
	return nil
}
func (f *fakeSecretStore) Load(context.Context, domain.SecretStorage) (domain.RepositoryCredentials, string, error) {
	return f.credentials, f.password, nil
}
func (f *fakeSecretStore) Archive(_ context.Context, storage domain.SecretStorage) error {
	f.archived = &storage
	return nil
}

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

func TestCancellationHasDistinctProgressAndResponse(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	err := fmt.Errorf("stop backup: %w", context.Canceled)
	runtime.setOperationErrorProgress(err)

	if phase := runtime.backupProgress().Phase; phase != "cancelled" {
		t.Fatalf("cancellation progress phase = %q, want cancelled", phase)
	}
	if result := failed(err); result.OK || result.Error != "Operation cancelled" {
		t.Fatalf("unexpected cancellation response: %#v", result)
	}
}

func TestExclusionsAndApplicationPresetsPersist(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	initial := runtime.handle(context.Background(), []byte(`{"type":"state.get"}`))
	if !initial.OK {
		t.Fatal(initial.Error)
	}
	state := initial.Data.(applicationState)
	if len(state.Preferences.Exclusions) == 0 || len(state.ApplicationPresets) == 0 {
		t.Fatalf("missing built-in backup choices: %#v", state)
	}

	added := runtime.handle(context.Background(), []byte(`{"type":"exclusion.add","payload":{"pattern":"**/.generated"}}`))
	if !added.OK {
		t.Fatal(added.Error)
	}
	state = added.Data.(applicationState)
	custom := state.Preferences.Exclusions[len(state.Preferences.Exclusions)-1]
	if custom.Pattern != "**/.generated" || !custom.Enabled || custom.Builtin {
		t.Fatalf("unexpected custom exclusion: %#v", custom)
	}

	selected := runtime.handle(context.Background(), []byte(`{"type":"application.setEnabled","payload":{"id":"firefox","enabled":true}}`))
	if !selected.OK {
		t.Fatal(selected.Error)
	}
	state = selected.Data.(applicationState)
	if len(state.Preferences.SelectedApps) != 1 || state.Preferences.SelectedApps[0] != "firefox" {
		t.Fatalf("application selection was not persisted: %#v", state.Preferences.SelectedApps)
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

func TestConfigureExistingRepository(t *testing.T) {
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
	payload, err := json.Marshal(request{Type: "repository.configure", Payload: mustJSON(t, map[string]any{
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
	result = runtime.handle(context.Background(), []byte(`{"type":"repository.disconnect"}`))
	if !result.OK {
		t.Fatal(result.Error)
	}
	state = result.Data.(applicationState)
	if state.Status != "unconfigured" || state.Preferences.Repository != nil {
		t.Fatalf("unexpected disconnected state: %#v", state)
	}
}

func TestConfigureExistingRepositoryLoadsSyncedOnePasswordItem(t *testing.T) {
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
	secrets := &fakeSecretStore{password: "secret"}
	runtime.onePassword = secrets
	configured.SecretStorage = &domain.SecretStorage{
		Provider: "onepassword", Account: "example", VaultID: "vault-id", ItemID: "item-id",
	}
	result := runtime.handle(context.Background(), mustJSON(t, request{
		Type: "repository.configure",
		Payload: mustJSON(t, map[string]any{
			"repository": configured,
		}),
	}))
	if !result.OK {
		t.Fatal(result.Error)
	}
	state := result.Data.(applicationState)
	if state.Status != "ready" || state.Preferences.Repository.SecretStorage.ItemID != "item-id" {
		t.Fatalf("unexpected connected state: %#v", state)
	}
	if secrets.updated == nil || secrets.updated.Location != repositoryPath {
		t.Fatalf("1Password metadata was not updated: %#v", secrets.updated)
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
