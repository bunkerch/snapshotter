package onepasswordstore

import (
	"context"
	"testing"

	onepassword "github.com/1password/onepassword-sdk-go"
	"github.com/restic/restic/app/domain"
)

type fakeClient struct {
	created  onepassword.ItemCreateParams
	item     onepassword.Item
	archived [2]string
}

func (f *fakeClient) create(_ context.Context, params onepassword.ItemCreateParams) (onepassword.Item, error) {
	f.created = params
	return onepassword.Item{ID: "item-id"}, nil
}

func (f *fakeClient) get(context.Context, string, string) (onepassword.Item, error) {
	return f.item, nil
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
		SecretStorage: &domain.SecretStorage{Provider: "onepassword", Account: "example.1password.com", VaultID: "vault-id"},
	}
	wantCredentials := domain.RepositoryCredentials{AccessKey: "access", SecretKey: "secret"}
	itemID, err := store.Save(context.Background(), repository, wantCredentials, "repository-password")
	if err != nil {
		t.Fatal(err)
	}
	if itemID != "item-id" || fake.created.VaultID != "vault-id" || len(fake.created.Fields) != 2 {
		t.Fatalf("unexpected created item: %#v", fake.created)
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
	fake := &fakeClient{}
	store := newStore(func(context.Context, string) (client, error) { return fake, nil })
	vaults, err := store.Vaults(context.Background(), "example")
	if err != nil || len(vaults) != 1 || vaults[0].Title != "Private" {
		t.Fatalf("unexpected vaults: %#v, %v", vaults, err)
	}
	items, err := store.Items(context.Background(), "example", "vault-id")
	if err != nil || len(items) != 1 || items[0].ID != "snapshotter-item" || items[0].Title != "Photos" {
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
