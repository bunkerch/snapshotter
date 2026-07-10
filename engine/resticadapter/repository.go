package resticadapter

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/internal/backend/local"
	"github.com/restic/restic/internal/repository"
	"github.com/restic/restic/internal/restic"
)

var ErrRepositoryOpen = errors.New("a repository is already open")

type Repository struct {
	mu   sync.Mutex
	repo *repository.Repository
}

func (r *Repository) Initialize(ctx context.Context, configured domain.Repository, password []byte) error {
	if configured.Kind != domain.RepositoryLocal {
		return fmt.Errorf("repository kind %q is not supported by this adapter", configured.Kind)
	}
	if len(password) == 0 {
		return errors.New("repository password is required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo != nil {
		return ErrRepositoryOpen
	}

	backend, err := local.Create(ctx, local.Config{Path: configured.Location, Connections: 2}, discardLog)
	if err != nil {
		return fmt.Errorf("create local backend: %w", err)
	}
	repo, err := repository.New(backend, repository.Options{})
	if err != nil {
		_ = backend.Close()
		return fmt.Errorf("create repository: %w", err)
	}
	if err := repo.Init(ctx, restic.StableRepoVersion, string(password), nil); err != nil {
		_ = repo.Close()
		return fmt.Errorf("initialize repository: %w", err)
	}
	r.repo = repo
	return nil
}

func (r *Repository) Unlock(ctx context.Context, configured domain.Repository, password []byte) error {
	if configured.Kind != domain.RepositoryLocal {
		return fmt.Errorf("repository kind %q is not supported by this adapter", configured.Kind)
	}
	if len(password) == 0 {
		return errors.New("repository password is required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo != nil {
		return ErrRepositoryOpen
	}

	backend, err := local.Open(ctx, local.Config{Path: configured.Location, Connections: 2}, discardLog)
	if err != nil {
		return fmt.Errorf("open local backend: %w", err)
	}
	repo, err := repository.New(backend, repository.Options{})
	if err != nil {
		_ = backend.Close()
		return fmt.Errorf("create repository: %w", err)
	}
	if err := repo.SearchKey(ctx, string(password), 0, ""); err != nil {
		_ = repo.Close()
		return fmt.Errorf("unlock repository: %w", err)
	}
	r.repo = repo
	return nil
}

func (r *Repository) ID() (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return "", false
	}
	return r.repo.Config().ID, true
}

func (r *Repository) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return nil
	}
	err := r.repo.Close()
	r.repo = nil
	return err
}

func discardLog(string, ...interface{}) {}
