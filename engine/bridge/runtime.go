package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/restic/restic/app/config"
	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/app/resticadapter"
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
	default:
		err = fmt.Errorf("unsupported request type %q", req.Type)
	}
	if err != nil {
		return failed(err)
	}
	return response{OK: true, Data: data}
}

func (r *runtime) state(ctx context.Context) (applicationState, error) {
	preferences, err := r.store.Load()
	if err != nil {
		return applicationState{}, err
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
		cleaned := filepath.Clean(path)
		if cleaned == "." || existing[cleaned] {
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
	return r.state(ctx)
}

func failed(err error) response { return response{OK: false, Error: err.Error()} }

func sourceID(path string) string {
	sum := sha256.Sum256([]byte(path))
	return hex.EncodeToString(sum[:8])
}
