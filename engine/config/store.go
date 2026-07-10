package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/manaf/restic-app/engine/domain"
)

type Store struct {
	path string
	mu   sync.RWMutex
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Load() (domain.Preferences, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return domain.DefaultPreferences(), nil
	}
	if err != nil {
		return domain.Preferences{}, fmt.Errorf("read preferences: %w", err)
	}

	preferences := domain.DefaultPreferences()
	if err := json.Unmarshal(data, &preferences); err != nil {
		return domain.Preferences{}, fmt.Errorf("decode preferences: %w", err)
	}
	if err := Validate(preferences); err != nil {
		return domain.Preferences{}, err
	}
	return preferences, nil
}

func (s *Store) Save(preferences domain.Preferences) error {
	if err := Validate(preferences); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(preferences, "", "  ")
	if err != nil {
		return fmt.Errorf("encode preferences: %w", err)
	}
	data = append(data, '\n')

	directory := filepath.Dir(s.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create preferences directory: %w", err)
	}

	temporary, err := os.CreateTemp(directory, ".preferences-*")
	if err != nil {
		return fmt.Errorf("create temporary preferences: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary preferences: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return fmt.Errorf("write preferences: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync preferences: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close preferences: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace preferences: %w", err)
	}
	return nil
}
