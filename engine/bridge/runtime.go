package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/restic/restic/app/config"
	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/app/onepasswordstore"
	"github.com/restic/restic/app/resticadapter"
	scheduler "github.com/restic/restic/app/schedule"
	"github.com/restic/restic/app/service"
)

type runtime struct {
	mu          sync.Mutex
	progressMu  sync.RWMutex
	progress    service.Progress
	store       *config.Store
	repository  *resticadapter.Repository
	onePassword secretStore
	coordinator service.Coordinator
}

type secretStore interface {
	Vaults(context.Context, string) ([]onepasswordstore.Vault, error)
	Items(context.Context, string, string) ([]onepasswordstore.Item, error)
	Save(context.Context, domain.Repository, domain.RepositoryCredentials, string) (string, error)
	UpdateMetadata(context.Context, domain.Repository) error
	Load(context.Context, domain.SecretStorage) (domain.RepositoryCredentials, string, error)
	Archive(context.Context, domain.SecretStorage) error
}

func (r *runtime) backupProgress() service.Progress {
	r.progressMu.RLock()
	defer r.progressMu.RUnlock()
	return r.progress
}

func (r *runtime) setBackupProgress(progress service.Progress) {
	r.progressMu.Lock()
	r.progress = progress
	r.progressMu.Unlock()
}

type request struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type response struct {
	OK    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error string      `json:"error,omitempty"`
}

type applicationState struct {
	Preferences        domain.Preferences         `json:"preferences"`
	ApplicationPresets []domain.ApplicationPreset `json:"applicationPresets"`
	Snapshots          []domain.Snapshot          `json:"snapshots"`
	Status             string                     `json:"status"`
}

func newRuntime(preferencesPath string) *runtime {
	return &runtime{
		store:       config.NewStore(preferencesPath),
		repository:  &resticadapter.Repository{},
		onePassword: onepasswordstore.New(),
	}
}

func (r *runtime) handle(ctx context.Context, raw []byte) response {
	r.mu.Lock()
	defer r.mu.Unlock()
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return failed(fmt.Errorf("decode request: %w", err))
	}
	var data interface{}
	var err error
	switch req.Type {
	case "state.get":
		data, err = r.state(ctx)
	case "source.add":
		data, err = r.addSources(req.Payload)
	case "source.setEnabled":
		data, err = r.setSourceEnabled(req.Payload)
	case "source.remove":
		data, err = r.removeSource(req.Payload)
	case "exclusion.add":
		data, err = r.addExclusion(req.Payload)
	case "exclusion.setEnabled":
		data, err = r.setExclusionEnabled(req.Payload)
	case "exclusion.remove":
		data, err = r.removeExclusion(req.Payload)
	case "application.setEnabled":
		data, err = r.setApplicationEnabled(req.Payload)
	case "repository.configure":
		data, err = r.configureRepository(ctx, req.Payload)
	case "repository.unlock":
		data, err = r.unlockRepository(ctx, req.Payload)
	case "repository.disconnect":
		data, err = r.disconnectRepository(ctx)
	case "onepassword.vaults":
		data, err = r.onePasswordVaults(ctx, req.Payload)
	case "onepassword.items":
		data, err = r.onePasswordItems(ctx, req.Payload)
	case "backup.start":
		data, err = r.backup(ctx)
	case "schedule.set":
		data, err = r.setSchedule(req.Payload)
	case "schedule.tick":
		data, err = r.scheduleTick(ctx, time.Now())
	case "retention.set":
		data, err = r.setRetention(req.Payload)
	case "launchAtLogin.set":
		data, err = r.setLaunchAtLogin(req.Payload)
	case "repository.check":
		data, err = r.checkRepository(ctx)
	case "repository.repairIndex":
		data, err = r.repairRepositoryIndex(ctx)
	case "snapshot.list":
		data, err = r.listSnapshot(ctx, req.Payload)
	case "snapshot.restore":
		data, err = r.restoreSnapshot(ctx, req.Payload)
	case "snapshot.delete":
		data, err = r.deleteSnapshot(ctx, req.Payload)
	default:
		err = fmt.Errorf("unsupported request type %q", req.Type)
	}
	if err != nil {
		return failed(err)
	}
	return response{OK: true, Data: data}
}

func (r *runtime) disconnectRepository(ctx context.Context) (applicationState, error) {
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	if err := r.repository.Close(); err != nil {
		return applicationState{}, fmt.Errorf("close repository: %w", err)
	}
	preferences.Repository = nil
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) onePasswordVaults(ctx context.Context, payload json.RawMessage) ([]onepasswordstore.Vault, error) {
	var input struct {
		Account string `json:"account"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return nil, fmt.Errorf("decode 1Password account: %w", err)
	}
	return r.onePassword.Vaults(ctx, input.Account)
}

func (r *runtime) onePasswordItems(ctx context.Context, payload json.RawMessage) ([]onepasswordstore.Item, error) {
	var input struct {
		Account string `json:"account"`
		VaultID string `json:"vaultID"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return nil, fmt.Errorf("decode 1Password vault: %w", err)
	}
	return r.onePassword.Items(ctx, input.Account, input.VaultID)
}

func (r *runtime) deleteSnapshot(ctx context.Context, payload json.RawMessage) (applicationState, error) {
	var input struct {
		SnapshotID string `json:"snapshotID"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode snapshot deletion: %w", err)
	}
	if strings.TrimSpace(input.SnapshotID) == "" {
		return applicationState{}, errors.New("snapshot identifier is required")
	}
	operationContext, done, err := r.coordinator.Start(ctx)
	if err != nil {
		return applicationState{}, err
	}
	defer done()
	if err := r.repository.DeleteSnapshot(operationContext, input.SnapshotID); err != nil {
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) listSnapshot(ctx context.Context, payload json.RawMessage) ([]domain.Entry, error) {
	var input struct {
		SnapshotID string `json:"snapshotID"`
		Path       string `json:"path"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return nil, fmt.Errorf("decode snapshot path: %w", err)
	}
	return r.repository.List(ctx, input.SnapshotID, input.Path)
}

func (r *runtime) restoreSnapshot(ctx context.Context, payload json.RawMessage) (map[string]uint64, error) {
	var input struct {
		SnapshotID  string `json:"snapshotID"`
		Path        string `json:"path"`
		Destination string `json:"destination"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return nil, fmt.Errorf("decode restore request: %w", err)
	}
	operationContext, done, err := r.coordinator.Start(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	count, err := r.repository.Restore(operationContext, input.SnapshotID, input.Path, input.Destination)
	if err != nil {
		return nil, err
	}
	return map[string]uint64{"restoredFiles": count}, nil
}

func (r *runtime) checkRepository(ctx context.Context) (applicationState, error) {
	operationContext, done, err := r.coordinator.Start(ctx)
	if err != nil {
		return applicationState{}, err
	}
	defer done()
	if err := r.repository.Check(operationContext, nil); err != nil {
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) repairRepositoryIndex(ctx context.Context) (applicationState, error) {
	operationContext, done, err := r.coordinator.Start(ctx)
	if err != nil {
		return applicationState{}, err
	}
	defer done()
	if err := r.repository.RepairIndex(operationContext, nil); err != nil {
		return applicationState{}, err
	}
	if err := r.repository.Check(operationContext, nil); err != nil {
		return applicationState{}, fmt.Errorf("verify repaired repository: %w", err)
	}
	return r.state(ctx)
}

func (r *runtime) setRetention(payload json.RawMessage) (applicationState, error) {
	var retention domain.RetentionPolicy
	if err := json.Unmarshal(payload, &retention); err != nil {
		return applicationState{}, fmt.Errorf("decode retention: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	preferences.Retention = retention
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) setLaunchAtLogin(payload json.RawMessage) (applicationState, error) {
	var input struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode launch at login: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	preferences.LaunchAtLogin = input.Enabled
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) setSchedule(payload json.RawMessage) (applicationState, error) {
	var configured domain.Schedule
	if err := json.Unmarshal(payload, &configured); err != nil {
		return applicationState{}, fmt.Errorf("decode schedule: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	preferences.Schedule = configured
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) scheduleTick(ctx context.Context, now time.Time) (applicationState, error) {
	state, err := r.state(ctx)
	if err != nil || state.Status != "ready" || (len(state.Preferences.Sources) == 0 && len(state.Preferences.SelectedApps) == 0) {
		return state, err
	}
	var lastBackup time.Time
	if len(state.Snapshots) > 0 {
		lastBackup = state.Snapshots[0].Time
	}
	due, _, err := scheduler.Due(now, lastBackup, state.Preferences.Schedule)
	if err != nil || !due {
		return state, err
	}
	return r.backup(ctx)
}

func (r *runtime) state(ctx context.Context) (applicationState, error) {
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	if preferences.Sources == nil {
		preferences.Sources = []domain.Source{}
	}
	presets, err := applicationPresets(preferences.SelectedApps)
	if err != nil {
		return applicationState{}, fmt.Errorf("resolve application presets: %w", err)
	}
	state := applicationState{Preferences: preferences, ApplicationPresets: presets, Snapshots: []domain.Snapshot{}, Status: "unconfigured"}
	if preferences.Repository == nil {
		return state, nil
	}
	state.Status = "locked"
	if _, open := r.repository.ID(); !open {
		return state, nil
	}
	snapshots, err := r.repository.Snapshots(ctx)
	if err != nil {
		return applicationState{}, err
	}
	state.Status = "ready"
	state.Snapshots = snapshots
	return state, nil
}

func (r *runtime) addSources(payload json.RawMessage) (applicationState, error) {
	var input struct {
		Paths []string `json:"paths"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode sources: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	existing := make(map[string]bool, len(preferences.Sources))
	for _, source := range preferences.Sources {
		existing[source.Path] = true
	}
	for _, path := range input.Paths {
		cleaned, err := normalizeSourcePath(path)
		if err != nil {
			return applicationState{}, err
		}
		if existing[cleaned] {
			continue
		}
		preferences.Sources = append(preferences.Sources, domain.Source{ID: sourceID(cleaned), Path: cleaned, Enabled: true})
		existing[cleaned] = true
	}
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) setSourceEnabled(payload json.RawMessage) (applicationState, error) {
	var input struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode source update: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	found := false
	for index := range preferences.Sources {
		if preferences.Sources[index].ID == input.ID {
			preferences.Sources[index].Enabled = input.Enabled
			found = true
			break
		}
	}
	if !found {
		return applicationState{}, fmt.Errorf("backup source %q was not found", input.ID)
	}
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) removeSource(payload json.RawMessage) (applicationState, error) {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode source removal: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	filtered := preferences.Sources[:0]
	for _, source := range preferences.Sources {
		if source.ID != input.ID {
			filtered = append(filtered, source)
		}
	}
	if len(filtered) == len(preferences.Sources) {
		return applicationState{}, fmt.Errorf("backup source %q was not found", input.ID)
	}
	preferences.Sources = filtered
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) addExclusion(payload json.RawMessage) (applicationState, error) {
	var input struct {
		Pattern string `json:"pattern"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode exclusion: %w", err)
	}
	pattern := strings.TrimSpace(input.Pattern)
	if pattern == "" {
		return applicationState{}, errors.New("exclusion pattern is required")
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	for _, exclusion := range preferences.Exclusions {
		if exclusion.Pattern == pattern {
			return applicationState{}, fmt.Errorf("exclusion pattern %q already exists", pattern)
		}
	}
	preferences.Exclusions = append(preferences.Exclusions, domain.Exclusion{
		ID: "custom-" + sourceID(pattern), Pattern: pattern, Enabled: true,
	})
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) setExclusionEnabled(payload json.RawMessage) (applicationState, error) {
	var input struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode exclusion update: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	found := false
	for index := range preferences.Exclusions {
		if preferences.Exclusions[index].ID == input.ID {
			preferences.Exclusions[index].Enabled = input.Enabled
			found = true
			break
		}
	}
	if !found {
		return applicationState{}, fmt.Errorf("exclusion %q was not found", input.ID)
	}
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) removeExclusion(payload json.RawMessage) (applicationState, error) {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode exclusion removal: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	filtered := preferences.Exclusions[:0]
	found := false
	for _, exclusion := range preferences.Exclusions {
		if exclusion.ID == input.ID {
			if exclusion.Builtin {
				return applicationState{}, errors.New("built-in exclusions can be disabled but not removed")
			}
			found = true
			continue
		}
		filtered = append(filtered, exclusion)
	}
	if !found {
		return applicationState{}, fmt.Errorf("exclusion %q was not found", input.ID)
	}
	preferences.Exclusions = filtered
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func (r *runtime) setApplicationEnabled(payload json.RawMessage) (applicationState, error) {
	var input struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode application update: %w", err)
	}
	if !knownPreset(input.ID) {
		return applicationState{}, fmt.Errorf("application preset %q was not found", input.ID)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	selected := make(map[string]bool, len(preferences.SelectedApps))
	for _, id := range preferences.SelectedApps {
		selected[id] = true
	}
	selected[input.ID] = input.Enabled
	preferences.SelectedApps = preferences.SelectedApps[:0]
	for _, definition := range presetDefinitions {
		if selected[definition.id] {
			preferences.SelectedApps = append(preferences.SelectedApps, definition.id)
		}
	}
	if err := r.store.Save(preferences); err != nil {
		return applicationState{}, err
	}
	return r.state(context.Background())
}

func normalizeSourcePath(path string) (string, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "", errors.New("source path is required")
	}
	if trimmed == "~" || strings.HasPrefix(trimmed, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		trimmed = filepath.Join(home, strings.TrimPrefix(trimmed, "~/"))
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("resolve source path: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("open source path: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("source path %q is not a directory", absolute)
	}
	return filepath.Clean(absolute), nil
}

func (r *runtime) configureRepository(ctx context.Context, payload json.RawMessage) (applicationState, error) {
	var input struct {
		Repository  domain.Repository            `json:"repository"`
		Credentials domain.RepositoryCredentials `json:"credentials"`
		Password    string                       `json:"password"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode repository: %w", err)
	}
	if storage := input.Repository.SecretStorage; storage != nil && storage.ItemID != "" {
		var err error
		input.Credentials, input.Password, err = r.onePassword.Load(ctx, *storage)
		if err != nil {
			return applicationState{}, err
		}
	}
	if _, err := r.repository.Configure(ctx, input.Repository, input.Credentials, []byte(input.Password)); err != nil {
		return applicationState{}, err
	}
	createdItem, err := r.persistOnePasswordSecrets(ctx, &input.Repository, input.Credentials, input.Password)
	if err != nil {
		_ = r.repository.Close()
		return applicationState{}, err
	}
	preferences, err := r.store.Load()
	if err != nil {
		_ = r.repository.Close()
		r.archiveCreatedItem(ctx, input.Repository.SecretStorage, createdItem)
		return applicationState{}, err
	}
	preferences.Repository = &input.Repository
	if err := r.store.Save(preferences); err != nil {
		_ = r.repository.Close()
		r.archiveCreatedItem(ctx, input.Repository.SecretStorage, createdItem)
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) unlockRepository(ctx context.Context, payload json.RawMessage) (applicationState, error) {
	var input struct {
		Credentials domain.RepositoryCredentials `json:"credentials"`
		Password    string                       `json:"password"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode password: %w", err)
	}
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	if preferences.Repository == nil {
		return applicationState{}, errors.New("repository is not configured")
	}
	if storage := preferences.Repository.SecretStorage; storage != nil {
		input.Credentials, input.Password, err = r.onePassword.Load(ctx, *storage)
		if err != nil {
			return applicationState{}, err
		}
	}
	if err := r.repository.Unlock(ctx, *preferences.Repository, input.Credentials, []byte(input.Password)); err != nil {
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) persistOnePasswordSecrets(ctx context.Context, repository *domain.Repository, credentials domain.RepositoryCredentials, password string) (string, error) {
	if repository.SecretStorage == nil {
		return "", nil
	}
	if repository.SecretStorage.ItemID != "" {
		return "", r.onePassword.UpdateMetadata(ctx, *repository)
	}
	itemID, err := r.onePassword.Save(ctx, *repository, credentials, password)
	if err != nil {
		return "", err
	}
	repository.SecretStorage.ItemID = itemID
	return itemID, nil
}

func (r *runtime) archiveCreatedItem(ctx context.Context, storage *domain.SecretStorage, itemID string) {
	if storage == nil || itemID == "" {
		return
	}
	_ = r.onePassword.Archive(ctx, *storage)
}

func (r *runtime) backup(ctx context.Context) (applicationState, error) {
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
	}
	operationContext, done, err := r.coordinator.Start(ctx)
	if err != nil {
		return applicationState{}, err
	}
	defer done()
	r.setBackupProgress(service.Progress{Phase: "backing-up"})
	applicationSources, err := presetSources(preferences.SelectedApps)
	if err != nil {
		return applicationState{}, fmt.Errorf("resolve application sources: %w", err)
	}
	sources := append(append([]domain.Source{}, preferences.Sources...), applicationSources...)
	if _, err := r.repository.Backup(operationContext, sources, preferences.Exclusions, r.setBackupProgress); err != nil {
		r.setBackupProgress(service.Progress{Phase: "error"})
		return applicationState{}, err
	}
	if err := r.repository.Forget(operationContext, preferences.Retention); err != nil {
		return applicationState{}, fmt.Errorf("apply retention policy: %w", err)
	}
	return r.state(ctx)
}

func failed(err error) response { return response{OK: false, Error: err.Error()} }

func sourceID(path string) string {
	sum := sha256.Sum256([]byte(path))
	return hex.EncodeToString(sum[:8])
}
