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
	"github.com/restic/restic/app/resticadapter"
	scheduler "github.com/restic/restic/app/schedule"
	"github.com/restic/restic/app/service"
)

type runtime struct {
	mu          sync.Mutex
	store       *config.Store
	repository  *resticadapter.Repository
	coordinator service.Coordinator
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
	Preferences domain.Preferences `json:"preferences"`
	Snapshots   []domain.Snapshot  `json:"snapshots"`
	Status      string             `json:"status"`
}

func newRuntime(preferencesPath string) *runtime {
	return &runtime{store: config.NewStore(preferencesPath), repository: &resticadapter.Repository{}}
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
	case "repository.create":
		data, err = r.createRepository(ctx, req.Payload)
	case "repository.unlock":
		data, err = r.unlockRepository(ctx, req.Payload)
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
	case "snapshot.list":
		data, err = r.listSnapshot(ctx, req.Payload)
	case "snapshot.restore":
		data, err = r.restoreSnapshot(ctx, req.Payload)
	default:
		err = fmt.Errorf("unsupported request type %q", req.Type)
	}
	if err != nil {
		return failed(err)
	}
	return response{OK: true, Data: data}
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
	if err != nil || state.Status != "ready" || len(state.Preferences.Sources) == 0 {
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
	state := applicationState{Preferences: preferences, Snapshots: []domain.Snapshot{}, Status: "unconfigured"}
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

func (r *runtime) createRepository(ctx context.Context, payload json.RawMessage) (applicationState, error) {
	var input struct {
		Repository domain.Repository `json:"repository"`
		Password   string            `json:"password"`
	}
	if err := json.Unmarshal(payload, &input); err != nil {
		return applicationState{}, fmt.Errorf("decode repository: %w", err)
	}
	if err := r.repository.Initialize(ctx, input.Repository, []byte(input.Password)); err != nil {
		return applicationState{}, err
	}
	preferences, err := r.store.Load()
	if err != nil {
		_ = r.repository.Close()
		return applicationState{}, err
	}
	preferences.Repository = &input.Repository
	if err := r.store.Save(preferences); err != nil {
		_ = r.repository.Close()
		return applicationState{}, err
	}
	return r.state(ctx)
}

func (r *runtime) unlockRepository(ctx context.Context, payload json.RawMessage) (applicationState, error) {
	var input struct {
		Password string `json:"password"`
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
	if err := r.repository.Unlock(ctx, *preferences.Repository, []byte(input.Password)); err != nil {
		return applicationState{}, err
	}
	return r.state(ctx)
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
	if _, err := r.repository.Backup(operationContext, preferences.Sources, nil); err != nil {
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
