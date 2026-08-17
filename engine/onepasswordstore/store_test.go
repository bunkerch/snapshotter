package onepasswordstore

import (
	"context"
	"errors"
	"strings"
	"testing"

	onepassword "github.com/1password/onepassword-sdk-go"
	"github.com/restic/restic/app/domain"
)

func TestDesktopErrorsUseCurrentSettingName(t *testing.T) {
	err := currentDesktopSetting(errors.New("Make sure Settings > Developer > Integrate with other apps is enabled"))
	if strings.Contains(err.Error(), "other apps") || !strings.Contains(err.Error(), "Integrate with 1Password SDKs") {
		t.Fatalf("unexpected error: %v", err)
	}
}

type fakeClient struct {
	created  onepassword.ItemCreateParams
	item     onepassword.Item
	updated  onepassword.Item
	archived [2]string
}

func (f *fakeClient) create(_ context.Context, params onepassword.ItemCreateParams) (onepassword.Item, error) {
	f.created = params
	return onepassword.Item{ID: "item-id"}, nil
}

func (f *fakeClient) get(context.Context, string, string) (onepassword.Item, error) {
	return f.item, nil
}
func (f *fakeClient) put(_ context.Context, item onepassword.Item) (onepassword.Item, error) {
	f.updated = item
	return item, nil
}
func (f *fakeClient) archive(_ context.Context, vaultID, itemID string) error {
	f.archived = [2]string{vaultID, itemID}
	return nil
}
func (f *fakeClient) listVaults(context.Context) ([]onepassword.VaultOverview, error) {
	return []onepassword.VaultOverview{{ID: "vault-id", Title: "Private"}}, nil
}
func (f *fakeClient) listItems(context.Context, string) ([]onepassword.ItemOverview, error) {
	return []onepassword.ItemOverview{
		{ID: "snapshotter-item", Title: "Snapshotter: Photos"},
		{ID: "other-item", Title: "Other password"},
	}, nil
}

func TestStoreRoundTrip(t *testing.T) {
	fake := &fakeClient{}
	store := newStore(func(context.Context, string) (client, error) { return fake, nil })
	repository := domain.Repository{
		Name:          "Photos",
		Kind:          domain.RepositoryS3,
		Location:      "s3:s3.amazonaws.com/archive/photos",
		SecretStorage: &domain.SecretStorage{Provider: "onepassword", Account: "example.1password.com", VaultID: "vault-id"},
	}
	wantCredentials := domain.RepositoryCredentials{AccessKey: "access", SecretKey: "secret"}
	itemID, err := store.Save(context.Background(), repository, wantCredentials, "repository-password")
	if err != nil {
		t.Fatal(err)
	}
	if itemID != "item-id" || fake.created.VaultID != "vault-id" || len(fake.created.Fields) != 4 {
		t.Fatalf("unexpected created item: %#v", fake.created)
	}
	if itemField(fake.created.Fields, kindFieldID) != "s3" || itemField(fake.created.Fields, locationFieldID) != repository.Location {
		t.Fatalf("repository metadata was not saved: %#v", fake.created.Fields)
	}
	if fake.created.Notes == nil || !strings.Contains(*fake.created.Notes, recoveryMarker) {
		t.Fatalf("recovery instructions were not saved: %#v", fake.created.Notes)
	}
	fake.item = onepassword.Item{Fields: fake.created.Fields}
	credentials, password, err := store.Load(context.Background(), domain.SecretStorage{Account: "example.1password.com", VaultID: "vault-id", ItemID: itemID})
	if err != nil {
		t.Fatal(err)
	}
	if password != "repository-password" || credentials != wantCredentials {
		t.Fatalf("unexpected loaded secrets: %#v %q", credentials, password)
	}
}

func TestStoreListsVaultsAndArchivesItem(t *testing.T) {
	fake := &fakeClient{item: onepassword.Item{Fields: []onepassword.ItemField{
		{ID: kindFieldID, Value: "sftp"},
		{ID: locationFieldID, Value: "sftp:backup@example.com:/archive"},
	}}}
	store := newStore(func(context.Context, string) (client, error) { return fake, nil })
	vaults, err := store.Vaults(context.Background(), "example")
	if err != nil || len(vaults) != 1 || vaults[0].Title != "Private" {
		t.Fatalf("unexpected vaults: %#v, %v", vaults, err)
	}
	items, err := store.Items(context.Background(), "example", "vault-id")
	if err != nil || len(items) != 1 || items[0].ID != "snapshotter-item" || items[0].Title != "Photos" || items[0].Kind != domain.RepositorySFTP || items[0].Location != "sftp:backup@example.com:/archive" {
		t.Fatalf("unexpected items: %#v, %v", items, err)
	}
	storage := domain.SecretStorage{Account: "example", VaultID: "vault-id", ItemID: "item-id"}
	if err := store.Archive(context.Background(), storage); err != nil {
		t.Fatal(err)
	}
	if fake.archived != [2]string{"vault-id", "item-id"} {
		t.Fatalf("unexpected archive request: %#v", fake.archived)
	}
}

func TestUpdateMetadataPreservesSecretsAndExistingNotes(t *testing.T) {
	sectionID := "secrets"
	fake := &fakeClient{item: onepassword.Item{
		ID:      "item-id",
		VaultID: "vault-id",
		Title:   "Snapshotter: Old name",
		Fields: []onepassword.ItemField{
			{ID: passwordFieldID, Value: "repository-password"},
			{ID: credentialsFieldID, SectionID: &sectionID, Value: `{"accessKey":"access"}`},
		},
		Notes: "Keep this user note.",
	}}
	store := newStore(func(context.Context, string) (client, error) { return fake, nil })
	repository := domain.Repository{
		Name:     "Photos",
		Kind:     domain.RepositoryS3,
		Location: "s3:s3.amazonaws.com/archive/photos",
		SecretStorage: &domain.SecretStorage{
			Provider: "onepassword", Account: "example", VaultID: "vault-id", ItemID: "item-id",
		},
	}
	if err := store.UpdateMetadata(context.Background(), repository); err != nil {
		t.Fatal(err)
	}
	if fake.updated.Title != "Snapshotter: Photos" || itemField(fake.updated.Fields, kindFieldID) != "s3" || itemField(fake.updated.Fields, locationFieldID) != repository.Location {
		t.Fatalf("repository metadata was not updated: %#v", fake.updated)
	}
	if itemField(fake.updated.Fields, passwordFieldID) != "repository-password" || itemField(fake.updated.Fields, credentialsFieldID) != `{"accessKey":"access"}` {
		t.Fatalf("secret fields changed: %#v", fake.updated.Fields)
	}
	if !strings.Contains(fake.updated.Notes, "Keep this user note.") || strings.Count(fake.updated.Notes, recoveryMarker) != 1 {
		t.Fatalf("notes were not preserved: %q", fake.updated.Notes)
	}
}
