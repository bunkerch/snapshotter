package resticadapter

import (
	"context"
	"errors"
	"fmt"
	"os"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strings"
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
	"github.com/restic/restic/internal/restorer"
	"github.com/restic/restic/internal/ui/progress"
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
		ProgramVersion: "Snapshotter",
	})
	if err != nil {
		return domain.Snapshot{}, fmt.Errorf("save snapshot: %w", err)
	}
	progress.Phase = "complete"
	progress.Fraction = 1
	emitProgress(sink, progress)

	result := domain.Snapshot{
		ID:       id.String(),
		Time:     snapshot.Time,
		Hostname: snapshot.Hostname,
		Paths:    append([]string(nil), snapshot.Paths...),
		Tags:     append([]string(nil), snapshot.Tags...),
	}
	if snapshot.Summary != nil {
		result.FileCount = uint64(snapshot.Summary.TotalFilesProcessed)
		result.TotalSize = snapshot.Summary.TotalBytesProcessed
	}
	return result, nil
}

func (r *Repository) Snapshots(ctx context.Context) ([]domain.Snapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return nil, errors.New("repository is not open")
	}

	snapshots := make([]domain.Snapshot, 0)
	err := data.ForAllSnapshots(ctx, r.repo, r.repo, nil, func(id restic.ID, snapshot *data.Snapshot, loadErr error) error {
		if loadErr != nil {
			return loadErr
		}
		item := domain.Snapshot{
			ID:       id.String(),
			Time:     snapshot.Time,
			Hostname: snapshot.Hostname,
			Paths:    append([]string(nil), snapshot.Paths...),
			Tags:     append([]string(nil), snapshot.Tags...),
		}
		if snapshot.Summary != nil {
			item.FileCount = uint64(snapshot.Summary.TotalFilesProcessed)
			item.TotalSize = snapshot.Summary.TotalBytesProcessed
		}
		snapshots = append(snapshots, item)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].Time.After(snapshots[j].Time)
	})
	return snapshots, nil
}

func (r *Repository) Check(ctx context.Context, sink service.ProgressSink) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return errors.New("repository is not open")
	}
	emitProgress(sink, service.Progress{Phase: "checking-index"})
	checker := r.repo.Checker()
	hints, indexErrors := checker.LoadIndex(ctx, nil)
	if len(indexErrors) > 0 {
		return fmt.Errorf("check repository index: %w", indexErrors[0])
	}
	if len(hints) > 0 {
		return fmt.Errorf("repository index requires attention: %w", hints[0])
	}
	emitProgress(sink, service.Progress{Phase: "checking-packs"})
	packErrors := make(chan error)
	go checker.Packs(ctx, packErrors)
	for packError := range packErrors {
		if packError != nil {
			return fmt.Errorf("check repository packs: %w", packError)
		}
	}
	emitProgress(sink, service.Progress{Phase: "complete", Fraction: 1})
	return nil
}

func (r *Repository) RepairIndex(ctx context.Context, sink service.ProgressSink) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return errors.New("repository is not open")
	}
	unlocker, lockContext, err := repository.Lock(ctx, r.repo, true, 0, func(string) {}, discardLog)
	if err != nil {
		return fmt.Errorf("lock repository for index repair: %w", err)
	}
	defer unlocker.Unlock()
	emitProgress(sink, service.Progress{Phase: "repairing-index"})
	if err := repository.RepairIndex(lockContext, r.repo, repository.RepairIndexOptions{}, &progress.NoopPrinter{}); err != nil {
		return fmt.Errorf("repair repository index: %w", err)
	}
	emitProgress(sink, service.Progress{Phase: "complete", Fraction: 1})
	return nil
}

func (r *Repository) Forget(ctx context.Context, policy domain.RetentionPolicy) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return errors.New("repository is not open")
	}
	unlocker, lockContext, err := repository.Lock(ctx, r.repo, true, 0, func(string) {}, discardLog)
	if err != nil {
		return fmt.Errorf("lock repository for retention: %w", err)
	}
	defer unlocker.Unlock()
	ctx = lockContext

	snapshots := make(data.Snapshots, 0)
	if err := data.ForAllSnapshots(ctx, r.repo, r.repo, nil, func(_ restic.ID, snapshot *data.Snapshot, loadErr error) error {
		if loadErr != nil {
			return loadErr
		}
		snapshots = append(snapshots, snapshot)
		return nil
	}); err != nil {
		return fmt.Errorf("load snapshots for retention: %w", err)
	}
	groups, _, err := data.GroupSnapshots(snapshots, data.SnapshotGroupByOptions{Host: true, Path: true})
	if err != nil {
		return fmt.Errorf("group snapshots for retention: %w", err)
	}
	expires := data.ExpirePolicy{
		Last:    1,
		Hourly:  policy.Hourly,
		Daily:   policy.Daily,
		Weekly:  policy.Weekly,
		Monthly: policy.Monthly,
		Yearly:  policy.Yearly,
	}
	for _, group := range groups {
		_, remove, _ := data.ApplyPolicy(group, expires)
		for _, snapshot := range remove {
			if snapshot.ID() == nil {
				continue
			}
			if err := r.repo.RemoveUnpacked(ctx, restic.WriteableSnapshotFile, *snapshot.ID()); err != nil {
				return fmt.Errorf("remove expired snapshot %s: %w", snapshot.ID().Str(), err)
			}
		}
	}
	if err := r.repo.LoadIndex(ctx, nil); err != nil {
		return fmt.Errorf("load index for pruning: %w", err)
	}
	printer := &progress.NoopPrinter{}
	plan, err := repository.PlanPrune(ctx, repository.PruneOptions{
		MaxUnusedBytes: func(used uint64) uint64 { return used / 20 },
	}, r.repo, func(ctx context.Context, repo restic.Repository, usedBlobs restic.FindBlobSet) error {
		var trees restic.IDs
		if err := data.ForAllSnapshots(ctx, repo, repo, nil, func(_ restic.ID, snapshot *data.Snapshot, loadErr error) error {
			if loadErr != nil {
				return loadErr
			}
			if snapshot.Tree != nil {
				trees = append(trees, *snapshot.Tree)
			}
			return nil
		}); err != nil {
			return err
		}
		return data.FindUsedBlobs(ctx, repo, trees, usedBlobs, nil)
	}, printer)
	if err != nil {
		return fmt.Errorf("plan repository prune: %w", err)
	}
	if err := plan.Execute(ctx, printer); err != nil {
		return fmt.Errorf("prune repository: %w", err)
	}
	return nil
}

func (r *Repository) List(ctx context.Context, snapshotID, directory string) ([]domain.Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return nil, errors.New("repository is not open")
	}
	if err := r.repo.LoadIndex(ctx, nil); err != nil {
		return nil, fmt.Errorf("load repository index: %w", err)
	}
	snapshot, err := r.loadSnapshot(ctx, snapshotID)
	if err != nil {
		return nil, err
	}
	if snapshot.Tree == nil {
		return nil, errors.New("snapshot has no tree")
	}
	treeID := *snapshot.Tree
	cleaned := pathpkg.Clean("/" + strings.TrimSpace(directory))
	if cleaned != "/" {
		for _, component := range strings.Split(strings.TrimPrefix(cleaned, "/"), "/") {
			tree, err := data.LoadTree(ctx, r.repo, treeID)
			if err != nil {
				return nil, fmt.Errorf("load snapshot directory: %w", err)
			}
			found := false
			for item := range tree {
				if item.Error != nil {
					return nil, item.Error
				}
				if item.Node.Name == component && item.Node.Type == data.NodeTypeDir && item.Node.Subtree != nil {
					treeID = *item.Node.Subtree
					found = true
					break
				}
			}
			if !found {
				return nil, fmt.Errorf("snapshot directory %q was not found", cleaned)
			}
		}
	}
	tree, err := data.LoadTree(ctx, r.repo, treeID)
	if err != nil {
		return nil, fmt.Errorf("load snapshot directory: %w", err)
	}
	entries := make([]domain.Entry, 0)
	for item := range tree {
		if item.Error != nil {
			return nil, item.Error
		}
		entries = append(entries, domain.Entry{
			Name:    item.Node.Name,
			Path:    pathpkg.Join(cleaned, item.Node.Name),
			Type:    string(item.Node.Type),
			Size:    item.Node.Size,
			ModTime: item.Node.ModTime,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Type == entries[j].Type {
			return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
		}
		return entries[i].Type == string(data.NodeTypeDir)
	})
	return entries, nil
}

func (r *Repository) Restore(ctx context.Context, snapshotID, selectedPath, destination string) (uint64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.repo == nil {
		return 0, errors.New("repository is not open")
	}
	if err := r.repo.LoadIndex(ctx, nil); err != nil {
		return 0, fmt.Errorf("load repository index: %w", err)
	}
	snapshot, err := r.loadSnapshot(ctx, snapshotID)
	if err != nil {
		return 0, err
	}
	selected := pathpkg.Clean("/" + strings.TrimSpace(selectedPath))
	restore := restorer.NewRestorer(r.repo, snapshot, restorer.Options{Overwrite: restorer.OverwriteIfChanged})
	restore.SelectFilter = func(item string, _ bool) (bool, bool) {
		item = filepath.ToSlash(filepath.Clean(item))
		if !strings.HasPrefix(item, "/") {
			item = "/" + item
		}
		if selected == "/" {
			return true, true
		}
		selectedForRestore := item == selected || strings.HasPrefix(item, selected+"/")
		childMayBeSelected := selectedForRestore || item == "/" || strings.HasPrefix(selected, item+"/")
		return selectedForRestore, childMayBeSelected
	}
	count, err := restore.RestoreTo(ctx, destination)
	if err != nil {
		return count, fmt.Errorf("restore snapshot path: %w", err)
	}
	return count, nil
}

func (r *Repository) loadSnapshot(ctx context.Context, snapshotID string) (*data.Snapshot, error) {
	id, err := restic.Find(ctx, r.repo, restic.SnapshotFile, snapshotID)
	if err != nil {
		return nil, fmt.Errorf("find snapshot: %w", err)
	}
	snapshot, err := data.LoadSnapshot(ctx, r.repo, id)
	if err != nil {
		return nil, fmt.Errorf("load snapshot: %w", err)
	}
	return snapshot, nil
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
