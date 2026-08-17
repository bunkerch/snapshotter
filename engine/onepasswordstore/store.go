package onepasswordstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	onepassword "github.com/1password/onepassword-sdk-go"
	"github.com/restic/restic/app/domain"
)

const (
	passwordFieldID      = "password"
	credentialsFieldID   = "credentials"
	kindFieldID          = "repository-kind"
	locationFieldID      = "repository-location"
	recoveryMarker       = "Reconnect with Snapshotter"
	recoveryInstructions = `Reconnect with Snapshotter

1. Install Snapshotter and the 1Password desktop app.
2. In 1Password, enable Settings > Developer > Integrate with 1Password SDKs.
3. In Snapshotter, select 1Password, load this vault, and choose this Snapshotter item.
4. Confirm the destination shown below and continue. Snapshotter will detect and unlock the existing repository.`
)

type Vault struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type Item struct {
	ID       string                `json:"id"`
	Title    string                `json:"title"`
	Kind     domain.RepositoryKind `json:"kind,omitempty"`
	Location string                `json:"location,omitempty"`
}

type client interface {
	create(context.Context, onepassword.ItemCreateParams) (onepassword.Item, error)
	get(context.Context, string, string) (onepassword.Item, error)
	put(context.Context, onepassword.Item) (onepassword.Item, error)
	archive(context.Context, string, string) error
	listVaults(context.Context) ([]onepassword.VaultOverview, error)
	listItems(context.Context, string) ([]onepassword.ItemOverview, error)
}

type sdkClient struct{ client *onepassword.Client }

func (c sdkClient) create(ctx context.Context, params onepassword.ItemCreateParams) (onepassword.Item, error) {
	return c.client.Items().Create(ctx, params)
}

func (c sdkClient) get(ctx context.Context, vaultID, itemID string) (onepassword.Item, error) {
	return c.client.Items().Get(ctx, vaultID, itemID)
}

func (c sdkClient) put(ctx context.Context, item onepassword.Item) (onepassword.Item, error) {
	return c.client.Items().Put(ctx, item)
}

func (c sdkClient) archive(ctx context.Context, vaultID, itemID string) error {
	return c.client.Items().Archive(ctx, vaultID, itemID)
}

func (c sdkClient) listVaults(ctx context.Context) ([]onepassword.VaultOverview, error) {
	return c.client.Vaults().List(ctx)
}

func (c sdkClient) listItems(ctx context.Context, vaultID string) ([]onepassword.ItemOverview, error) {
	return c.client.Items().List(ctx, vaultID)
}

type Store struct {
	mu      sync.Mutex
	clients map[string]client
	connect func(context.Context, string) (client, error)
}

func New() *Store {
	return newStore(func(ctx context.Context, account string) (client, error) {
		connected, err := onepassword.NewClient(
			ctx,
			onepassword.WithDesktopAppIntegration(account),
			onepassword.WithIntegrationInfo("Snapshotter", "0.1.0"),
		)
		if err != nil {
			return nil, fmt.Errorf("connect to 1Password: %w", currentDesktopSetting(err))
		}
		return sdkClient{client: connected}, nil
	})
}

func newStore(connect func(context.Context, string) (client, error)) *Store {
	return &Store{clients: make(map[string]client), connect: connect}
}

func (s *Store) Vaults(ctx context.Context, account string) ([]Vault, error) {
	connected, err := s.client(ctx, account)
	if err != nil {
		return nil, err
	}
	listed, err := connected.listVaults(ctx)
	if err != nil {
		return nil, fmt.Errorf("list 1Password vaults: %w", currentDesktopSetting(err))
	}
	vaults := make([]Vault, 0, len(listed))
	for _, vault := range listed {
		vaults = append(vaults, Vault{ID: vault.ID, Title: vault.Title})
	}
	return vaults, nil
}

func (s *Store) Items(ctx context.Context, account, vaultID string) ([]Item, error) {
	connected, err := s.client(ctx, account)
	if err != nil {
		return nil, err
	}
	listed, err := connected.listItems(ctx, vaultID)
	if err != nil {
		return nil, fmt.Errorf("list 1Password items: %w", currentDesktopSetting(err))
	}
	items := make([]Item, 0)
	for _, item := range listed {
		if strings.HasPrefix(item.Title, "Snapshotter: ") {
			details, err := connected.get(ctx, vaultID, item.ID)
			if err != nil {
				return nil, fmt.Errorf("load 1Password repository metadata: %w", currentDesktopSetting(err))
			}
			items = append(items, Item{
				ID:       item.ID,
				Title:    strings.TrimPrefix(item.Title, "Snapshotter: "),
				Kind:     repositoryKind(itemField(details.Fields, kindFieldID)),
				Location: itemField(details.Fields, locationFieldID),
			})
		}
	}
	return items, nil
}

func (s *Store) Save(ctx context.Context, repository domain.Repository, credentials domain.RepositoryCredentials, password string) (string, error) {
	storage := repository.SecretStorage
	if storage == nil || storage.Provider != "onepassword" {
		return "", errors.New("1Password storage configuration is required")
	}
	connected, err := s.client(ctx, storage.Account)
	if err != nil {
		return "", err
	}
	encodedCredentials, err := json.Marshal(credentials)
	if err != nil {
		return "", fmt.Errorf("encode repository credentials: %w", err)
	}
	sectionID := "repository"
	notes := recoveryInstructions
	item, err := connected.create(ctx, onepassword.ItemCreateParams{
		Category: onepassword.ItemCategoryPassword,
		VaultID:  storage.VaultID,
		Title:    "Snapshotter: " + repository.Name,
		Fields: []onepassword.ItemField{
			{ID: passwordFieldID, Title: "Repository password", FieldType: onepassword.ItemFieldTypeConcealed, Value: password},
			{ID: credentialsFieldID, Title: "Backend credentials", SectionID: &sectionID, FieldType: onepassword.ItemFieldTypeConcealed, Value: string(encodedCredentials)},
			{ID: kindFieldID, Title: "Repository type", SectionID: &sectionID, FieldType: onepassword.ItemFieldTypeText, Value: string(repository.Kind)},
			{ID: locationFieldID, Title: "Repository destination", SectionID: &sectionID, FieldType: onepassword.ItemFieldTypeText, Value: repository.Location},
		},
		Sections: []onepassword.ItemSection{{ID: sectionID, Title: "Repository"}},
		Tags:     []string{"Snapshotter"},
		Notes:    &notes,
	})
	if err != nil {
		return "", fmt.Errorf("save secrets in 1Password: %w", currentDesktopSetting(err))
	}
	return item.ID, nil
}

func (s *Store) UpdateMetadata(ctx context.Context, repository domain.Repository) error {
	storage := repository.SecretStorage
	if storage == nil || storage.Provider != "onepassword" || storage.ItemID == "" {
		return errors.New("existing 1Password storage configuration is required")
	}
	connected, err := s.client(ctx, storage.Account)
	if err != nil {
		return err
	}
	item, err := connected.get(ctx, storage.VaultID, storage.ItemID)
	if err != nil {
		return fmt.Errorf("load 1Password item for update: %w", currentDesktopSetting(err))
	}
	sectionID := "repository"
	item.Title = "Snapshotter: " + repository.Name
	item.Fields = upsertField(item.Fields, onepassword.ItemField{ID: kindFieldID, Title: "Repository type", SectionID: &sectionID, FieldType: onepassword.ItemFieldTypeText, Value: string(repository.Kind)})
	item.Fields = upsertField(item.Fields, onepassword.ItemField{ID: locationFieldID, Title: "Repository destination", SectionID: &sectionID, FieldType: onepassword.ItemFieldTypeText, Value: repository.Location})
	if !hasSection(item.Sections, sectionID) {
		item.Sections = append(item.Sections, onepassword.ItemSection{ID: sectionID, Title: "Repository"})
	}
	if !strings.Contains(item.Notes, recoveryMarker) {
		if strings.TrimSpace(item.Notes) != "" {
			item.Notes += "\n\n"
		}
		item.Notes += recoveryInstructions
	}
	if !contains(item.Tags, "Snapshotter") {
		item.Tags = append(item.Tags, "Snapshotter")
	}
	if _, err := connected.put(ctx, item); err != nil {
		return fmt.Errorf("update 1Password repository metadata: %w", currentDesktopSetting(err))
	}
	return nil
}

func (s *Store) Load(ctx context.Context, storage domain.SecretStorage) (domain.RepositoryCredentials, string, error) {
	connected, err := s.client(ctx, storage.Account)
	if err != nil {
		return domain.RepositoryCredentials{}, "", err
	}
	item, err := connected.get(ctx, storage.VaultID, storage.ItemID)
	if err != nil {
		return domain.RepositoryCredentials{}, "", fmt.Errorf("load secrets from 1Password: %w", currentDesktopSetting(err))
	}
	var password, encodedCredentials string
	for _, field := range item.Fields {
		switch field.ID {
		case passwordFieldID:
			password = field.Value
		case credentialsFieldID:
			encodedCredentials = field.Value
		}
	}
	if password == "" || encodedCredentials == "" {
		return domain.RepositoryCredentials{}, "", errors.New("the 1Password item is missing Snapshotter secret fields")
	}
	var credentials domain.RepositoryCredentials
	if err := json.Unmarshal([]byte(encodedCredentials), &credentials); err != nil {
		return domain.RepositoryCredentials{}, "", fmt.Errorf("decode credentials from 1Password: %w", err)
	}
	return credentials, password, nil
}

func (s *Store) Archive(ctx context.Context, storage domain.SecretStorage) error {
	connected, err := s.client(ctx, storage.Account)
	if err != nil {
		return err
	}
	if err := connected.archive(ctx, storage.VaultID, storage.ItemID); err != nil {
		return fmt.Errorf("archive 1Password item: %w", currentDesktopSetting(err))
	}
	return nil
}

func currentDesktopSetting(err error) error {
	return errors.New(strings.ReplaceAll(
		err.Error(),
		"Settings > Developer > Integrate with other apps",
		"Settings > Developer > Integrate with 1Password SDKs",
	))
}

func itemField(fields []onepassword.ItemField, id string) string {
	for _, field := range fields {
		if field.ID == id {
			return field.Value
		}
	}
	return ""
}

func repositoryKind(value string) domain.RepositoryKind {
	switch domain.RepositoryKind(value) {
	case domain.RepositoryLocal, domain.RepositorySFTP, domain.RepositoryS3, domain.RepositoryREST:
		return domain.RepositoryKind(value)
	default:
		return ""
	}
}

func upsertField(fields []onepassword.ItemField, updated onepassword.ItemField) []onepassword.ItemField {
	for index := range fields {
		if fields[index].ID == updated.ID {
			fields[index] = updated
			return fields
		}
	}
	return append(fields, updated)
}

func hasSection(sections []onepassword.ItemSection, id string) bool {
	for _, section := range sections {
		if section.ID == id {
			return true
		}
	}
	return false
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func (s *Store) client(ctx context.Context, account string) (client, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return nil, errors.New("1Password account is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if connected := s.clients[account]; connected != nil {
		return connected, nil
	}
	connected, err := s.connect(ctx, account)
	if err != nil {
		return nil, err
	}
	s.clients[account] = connected
	return connected, nil
}
