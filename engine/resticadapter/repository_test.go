package resticadapter

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	minio "github.com/minio/minio-go/v7"
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
	if err := creator.Initialize(context.Background(), configured, domain.RepositoryCredentials{}, password); err != nil {
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
	if err := opener.Unlock(context.Background(), configured, domain.RepositoryCredentials{}, password); err != nil {
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

func TestConfigureCreatesOrUnlocksWithoutFallingBackOnWrongPassword(t *testing.T) {
	configured := domain.Repository{
		ID: "test", Name: "Test Repository", Kind: domain.RepositoryLocal, Location: t.TempDir(),
	}
	password := []byte("correct password")
	creator := &Repository{}
	created, err := creator.Configure(context.Background(), configured, domain.RepositoryCredentials{}, password)
	if err != nil || !created {
		t.Fatalf("expected a new repository, got created=%v err=%v", created, err)
	}
	if err := creator.Close(); err != nil {
		t.Fatal(err)
	}

	opener := &Repository{}
	created, err = opener.Configure(context.Background(), configured, domain.RepositoryCredentials{}, password)
	if err != nil || created {
		t.Fatalf("expected an existing repository, got created=%v err=%v", created, err)
	}
	if err := opener.Close(); err != nil {
		t.Fatal(err)
	}

	created, err = (&Repository{}).Configure(context.Background(), configured, domain.RepositoryCredentials{}, []byte("wrong password"))
	if err == nil || created || !strings.Contains(err.Error(), "unlock repository") {
		t.Fatalf("wrong password must not initialize: created=%v err=%v", created, err)
	}
}

func TestConfigureRecognizesOnlyMissingS3BucketAsAbsent(t *testing.T) {
	missing := minio.ErrorResponse{Code: minio.NoSuchBucket}
	denied := minio.ErrorResponse{Code: "AccessDenied"}
	if !isMissingS3Bucket(domain.RepositoryS3, missing) {
		t.Fatal("missing S3 bucket was not recognized")
	}
	if isMissingS3Bucket(domain.RepositoryS3, denied) || isMissingS3Bucket(domain.RepositoryREST, missing) {
		t.Fatal("non-absence error was treated as a missing S3 bucket")
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
	if err := os.MkdirAll(filepath.Join(sourcePath, "node_modules", "package"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "node_modules", "package", "index.js"), []byte("downloadable"), 0o600); err != nil {
		t.Fatal(err)
	}

	configured := domain.Repository{
		ID:       "test",
		Name:     "Test Repository",
		Kind:     domain.RepositoryLocal,
		Location: repositoryPath,
	}
	adapter := &Repository{}
	if err := adapter.Initialize(context.Background(), configured, domain.RepositoryCredentials{}, []byte("backup password")); err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	var progress []service.Progress
	snapshot, err := adapter.Backup(context.Background(), []domain.Source{{
		ID:      "source",
		Path:    sourcePath,
		Enabled: true,
	}}, []domain.Exclusion{{ID: "node-modules", Pattern: "**/node_modules", Enabled: true}}, func(update service.Progress) {
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
	if err := adapter.Check(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if err := adapter.RepairIndex(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Check(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	entries, err := adapter.List(context.Background(), snapshot.ID, sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "hello.txt" || entries[0].Type != "file" {
		t.Fatalf("unexpected snapshot entries: %#v", entries)
	}
	restoreDestination := t.TempDir()
	restored, err := adapter.Restore(
		context.Background(),
		snapshot.ID,
		filepath.Join(sourcePath, "hello.txt"),
		restoreDestination,
	)
	if err != nil {
		t.Fatal(err)
	}
	if restored != 1 {
		t.Fatalf("restored %d files, want 1", restored)
	}
	restoredPath := filepath.Join(restoreDestination, strings.TrimPrefix(sourcePath, string(filepath.Separator)), "hello.txt")
	content, err := os.ReadFile(restoredPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "hello from restic app" {
		t.Fatalf("unexpected restored content: %q", content)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "hello.txt"), []byte("updated content"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.Backup(context.Background(), []domain.Source{{ID: "source", Path: sourcePath, Enabled: true}}, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Forget(context.Background(), domain.RetentionPolicy{Daily: 1}); err != nil {
		t.Fatal(err)
	}
	retained, err := adapter.Snapshots(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(retained) != 1 {
		t.Fatalf("retained %d snapshots, want 1", len(retained))
	}
	if err := adapter.Check(context.Background(), nil); err != nil {
		t.Fatalf("check pruned repository: %v", err)
	}
	postPruneDestination := t.TempDir()
	if _, err := adapter.Restore(context.Background(), retained[0].ID, filepath.Join(sourcePath, "hello.txt"), postPruneDestination); err != nil {
		t.Fatalf("restore retained snapshot after prune: %v", err)
	}
	if err := adapter.DeleteSnapshot(context.Background(), retained[0].ID); err != nil {
		t.Fatalf("delete retained snapshot: %v", err)
	}
	remaining, err := adapter.Snapshots(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("remaining snapshots after deletion: %d", len(remaining))
	}
	if err := adapter.Check(context.Background(), nil); err != nil {
		t.Fatalf("check repository after snapshot deletion: %v", err)
	}
}

func TestBackupCanRestartAfterCancellation(t *testing.T) {
	repositoryPath := filepath.Join(t.TempDir(), "repository")
	sourcePath := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourcePath, 0o700); err != nil {
		t.Fatal(err)
	}
	for index := range 20 {
		name := filepath.Join(sourcePath, fmt.Sprintf("file-%02d", index))
		if err := os.WriteFile(name, bytes.Repeat([]byte{byte(index)}, 1024*1024), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	configured := domain.Repository{ID: "test", Name: "Test Repository", Kind: domain.RepositoryLocal, Location: repositoryPath}
	adapter := &Repository{}
	if err := adapter.Initialize(context.Background(), configured, domain.RepositoryCredentials{}, []byte("backup password")); err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	ctx, cancel := context.WithCancel(context.Background())
	_, err := adapter.Backup(ctx, []domain.Source{{ID: "source", Path: sourcePath, Enabled: true}}, nil, func(service.Progress) {
		cancel()
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled backup error = %v, want context.Canceled", err)
	}

	if _, err := adapter.Backup(context.Background(), []domain.Source{{ID: "source", Path: sourcePath, Enabled: true}}, nil, nil); err != nil {
		t.Fatalf("restart backup after cancellation: %v", err)
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
	if err := creator.Initialize(context.Background(), configured, domain.RepositoryCredentials{}, []byte("right password")); err != nil {
		t.Fatal(err)
	}
	if err := creator.Close(); err != nil {
		t.Fatal(err)
	}

	opener := &Repository{}
	if err := opener.Unlock(context.Background(), configured, domain.RepositoryCredentials{}, []byte("wrong password")); err == nil {
		t.Fatal("expected wrong password to fail")
	}
}

func TestRemoteRepositoryLocationsRejectInvalidOrEmbeddedCredentials(t *testing.T) {
	tests := []struct {
		name        string
		kind        domain.RepositoryKind
		location    string
		wantMessage string
	}{
		{name: "s3", kind: domain.RepositoryS3, location: "not-s3", wantMessage: "parse S3 destination"},
		{name: "sftp", kind: domain.RepositorySFTP, location: "not-sftp", wantMessage: "parse SFTP destination"},
		{name: "rest credentials", kind: domain.RepositoryREST, location: "rest:https://user:secret@example.com/archive", wantMessage: "entered separately"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configured := domain.Repository{Kind: test.kind, Location: test.location}
			_, err := openBackend(context.Background(), configured, domain.RepositoryCredentials{}, false)
			if err == nil || !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("openBackend() error = %v, want containing %q", err, test.wantMessage)
			}
		})
	}
}
