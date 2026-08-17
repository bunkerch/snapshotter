package resticadapter

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/restic/restic/app/domain"
)

func TestLiveRemoteRepository(t *testing.T) {
	kind := domain.RepositoryKind(os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_KIND"))
	location := os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_LOCATION")
	password := os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_PASSWORD")
	if kind == "" || location == "" || password == "" {
		t.Skip("live repository environment is not configured")
	}
	credentials := domain.RepositoryCredentials{
		Username:  os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_USERNAME"),
		Password:  os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_SERVICE_PASSWORD"),
		AccessKey: os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_ACCESS_KEY"),
		SecretKey: os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_SECRET_KEY"),
		Region:    os.Getenv("SNAPSHOTTER_TEST_REPOSITORY_REGION"),
	}
	repository := domain.Repository{ID: "live-test", Name: "Live Test", Kind: kind, Location: location}
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "live.txt"), []byte("snapshotter live backend verification"), 0o600); err != nil {
		t.Fatal(err)
	}

	adapter := &Repository{}
	if err := adapter.Initialize(context.Background(), repository, credentials, []byte(password)); err != nil {
		t.Fatalf("initialize live repository: %v", err)
	}
	repositoryID, ok := adapter.ID()
	if !ok || repositoryID == "" {
		t.Fatal("initialized live repository has no ID")
	}
	if err := adapter.Close(); err != nil {
		t.Fatalf("close live repository: %v", err)
	}
	adapter = &Repository{}
	if err := adapter.Unlock(context.Background(), repository, credentials, []byte(password)); err != nil {
		t.Fatalf("reopen live repository: %v", err)
	}
	reopenedID, ok := adapter.ID()
	if !ok || reopenedID != repositoryID {
		t.Fatalf("reopened repository ID %q does not match %q", reopenedID, repositoryID)
	}
	defer adapter.Close()
	snapshot, err := adapter.Backup(context.Background(), []domain.Source{{ID: "live", Path: source, Enabled: true}}, nil, domain.BackupMetadata{Version: 1}, nil)
	if err != nil {
		t.Fatalf("backup to live repository: %v", err)
	}
	if err := adapter.Check(context.Background(), nil); err != nil {
		t.Fatalf("check live repository: %v", err)
	}
	entries, err := adapter.List(context.Background(), snapshot.ID, source)
	if err != nil || len(entries) != 1 || entries[0].Name != "live.txt" {
		t.Fatalf("list live snapshot: entries=%#v error=%v", entries, err)
	}
	destination := t.TempDir()
	if _, err := adapter.Restore(context.Background(), snapshot.ID, entries[0].Path, destination); err != nil {
		t.Fatalf("restore from live repository: %v", err)
	}
	restored := filepath.Join(destination, strings.TrimPrefix(source, string(filepath.Separator)), "live.txt")
	if content, err := os.ReadFile(restored); err != nil || string(content) != "snapshotter live backend verification" {
		t.Fatalf("verify restored live file: content=%q error=%v", content, err)
	}
	if err := adapter.DeleteSnapshot(context.Background(), snapshot.ID); err != nil {
		t.Fatalf("delete live snapshot: %v", err)
	}
	if snapshots, err := adapter.Snapshots(context.Background()); err != nil || len(snapshots) != 0 {
		t.Fatalf("verify live snapshot deletion: snapshots=%#v error=%v", snapshots, err)
	}
}
