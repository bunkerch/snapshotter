package resticadapter

import (
	"context"
	"testing"

	"github.com/restic/restic/app/domain"
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
