package resticadapter

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/app/service"
	"github.com/restic/restic/internal/archiver"
	"github.com/restic/restic/internal/backend/local"
	"github.com/restic/restic/internal/data"
	"github.com/restic/restic/internal/fs"
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

func (r *Repository) Backup(ctx context.Context, sources []domain.Source, sink service.ProgressSink) (domain.Snapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return domain.Snapshot{}, errors.New("repository is not open")
	}

	targets := make([]string, 0, len(sources))
	for _, source := range sources {
		if source.Enabled && !source.Excluded {
			targets = append(targets, source.Path)
		}
	}
	if len(targets) == 0 {
		return domain.Snapshot{}, errors.New("at least one backup source must be enabled")
	}
	if err := r.repo.LoadIndex(ctx, nil); err != nil {
		return domain.Snapshot{}, fmt.Errorf("load repository index: %w", err)
	}

	hostname, err := os.Hostname()
	if err != nil {
		return domain.Snapshot{}, fmt.Errorf("read hostname: %w", err)
	}
	started := time.Now()
	progress := service.Progress{Phase: "backing-up"}
	backup := archiver.New(r.repo, fs.Local{}, archiver.Options{})
	backup.Error = func(_ string, itemErr error) error { return itemErr }
	backup.CompleteItem = func(_ string, _, current *data.Node, _ archiver.ItemStats, _ time.Duration) {
		if current == nil {
			return
		}
		progress.FilesDone++
		progress.BytesDone += current.Size
		emitProgress(sink, progress)
	}

	snapshot, id, _, err := backup.Snapshot(ctx, targets, archiver.SnapshotOptions{
		BackupStart:    started,
		Time:           started,
		Hostname:       hostname,
		ProgramVersion: "Restic App",
	})
	if err != nil {
		return domain.Snapshot{}, fmt.Errorf("save snapshot: %w", err)
	}
	progress.Phase = "complete"
	progress.Fraction = 1
	emitProgress(sink, progress)

	return domain.Snapshot{
		ID:       id.String(),
		Time:     snapshot.Time,
		Hostname: snapshot.Hostname,
		Paths:    append([]string(nil), snapshot.Paths...),
		Tags:     append([]string(nil), snapshot.Tags...),
	}, nil
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

func emitProgress(sink service.ProgressSink, progress service.Progress) {
	if sink != nil {
		sink(progress)
	}
}
