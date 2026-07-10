package resticadapter

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/restic/restic/app/domain"
	"github.com/restic/restic/app/service"
)

func TestInitializeAndUnlockLocalRepository(t *testing.T) {
	configured := domain.Repository{
		ID:       "test",
		Name:     "Test Repository",
		Kind:     domain.RepositoryLocal,
		Location: t.TempDir(),
	}
	password := []byte("correct horse battery staple")

	creator := &Repository{}
	if err := creator.Initialize(context.Background(), configured, password); err != nil {
		t.Fatal(err)
	}
	createdID, ok := creator.ID()
	if !ok || createdID == "" {
		t.Fatal("initialized repository has no ID")
	}
	if err := creator.Close(); err != nil {
		t.Fatal(err)
	}

	opener := &Repository{}
	if err := opener.Unlock(context.Background(), configured, password); err != nil {
		t.Fatal(err)
	}
	openedID, ok := opener.ID()
	if !ok || openedID != createdID {
		t.Fatalf("opened repository ID %q does not match created ID %q", openedID, createdID)
	}
	if err := opener.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestBackupCreatesSnapshot(t *testing.T) {
	repositoryPath := filepath.Join(t.TempDir(), "repository")
	sourcePath := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourcePath, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "hello.txt"), []byte("hello from restic app"), 0o600); err != nil {
		t.Fatal(err)
	}

	configured := domain.Repository{
		ID:       "test",
		Name:     "Test Repository",
		Kind:     domain.RepositoryLocal,
		Location: repositoryPath,
	}
	adapter := &Repository{}
	if err := adapter.Initialize(context.Background(), configured, []byte("backup password")); err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	var progress []service.Progress
	snapshot, err := adapter.Backup(context.Background(), []domain.Source{{
		ID:      "source",
		Path:    sourcePath,
		Enabled: true,
	}}, func(update service.Progress) {
		progress = append(progress, update)
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ID == "" || len(snapshot.Paths) != 1 || snapshot.Paths[0] != sourcePath {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	if len(progress) == 0 || progress[len(progress)-1].Phase != "complete" {
		t.Fatalf("unexpected progress: %#v", progress)
	}
	snapshots, err := adapter.Snapshots(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 1 || snapshots[0].ID != snapshot.ID {
		t.Fatalf("unexpected snapshots: %#v", snapshots)
	}
}

func TestUnlockRejectsWrongPassword(t *testing.T) {
	configured := domain.Repository{
		ID:       "test",
		Name:     "Test Repository",
		Kind:     domain.RepositoryLocal,
		Location: t.TempDir(),
	}
	creator := &Repository{}
	if err := creator.Initialize(context.Background(), configured, []byte("right password")); err != nil {
		t.Fatal(err)
	}
	if err := creator.Close(); err != nil {
		t.Fatal(err)
	}

	opener := &Repository{}
	if err := opener.Unlock(context.Background(), configured, []byte("wrong password")); err == nil {
		t.Fatal("expected wrong password to fail")
	}
}
