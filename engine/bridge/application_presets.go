package main

import (
	"os"
	"path/filepath"
	"time"

	"github.com/restic/restic/app/domain"
)

type presetDefinition struct {
	id            string
	name          string
	paths         []string
	keychainItems []domain.BackupKeychainItem
}

var presetDefinitions = []presetDefinition{
	{id: "firefox", name: "Firefox", paths: []string{"Library/Application Support/Firefox/Profiles", "Library/Application Support/Firefox/installs.ini", "Library/Application Support/Firefox/profiles.ini"}},
	{id: "thunderbird", name: "Thunderbird", paths: []string{"Library/Thunderbird/Profiles", "Library/Thunderbird/installs.ini", "Library/Thunderbird/profiles.ini"}},
	{id: "ghostty", name: "Ghostty", paths: []string{"Library/Application Support/com.mitchellh.ghostty/config", ".config/ghostty"}},
	{id: "opencode", name: "OpenCode", paths: []string{".config/opencode", ".local/share/opencode", ".local/state/opencode"}},
	{id: "vscode", name: "Visual Studio Code", paths: []string{"Library/Application Support/Code/User", ".vscode/extensions"}},
	{id: "minecraft", name: "Minecraft saves", paths: []string{"Library/Application Support/minecraft/saves"}},
	{id: "chrome", name: "Google Chrome", paths: []string{"Library/Application Support/Google/Chrome"}, keychainItems: []domain.BackupKeychainItem{{Service: "Chrome Safe Storage", Account: "Chrome"}}},
	{id: "signal", name: "Signal", paths: []string{"Library/Application Support/Signal"}},
	{id: "whatsapp", name: "WhatsApp", paths: []string{"Library/Containers/net.whatsapp.WhatsApp", "Library/Group Containers/group.net.whatsapp.WhatsApp.shared", "Library/Group Containers/group.net.whatsapp.WhatsApp.private", "Library/Group Containers/group.net.whatsapp.family"}},
	{id: "imhex", name: "ImHex", paths: []string{"Library/Application Support/imhex"}},
	{id: "mongodb-compass", name: "MongoDB Compass", paths: []string{"Library/Application Support/MongoDB Compass"}},
	{id: "beekeeper-studio", name: "Beekeeper Studio", paths: []string{"Library/Application Support/beekeeper-studio"}},
	{id: "sol", name: "Sol", paths: []string{".config/sol", "Library/Preferences/com.ospfranco.sol.plist"}},
	{id: "rectangle", name: "Rectangle", paths: []string{"Library/Preferences/com.knollsoft.Rectangle.plist"}},
	{id: "snapshotter", name: "Snapshotter", paths: []string{"Library/Application Support/Snapshotter"}},
	{id: "btop", name: "btop", paths: []string{".config/btop"}},
	{id: "wakatime", name: "WakaTime", paths: []string{".wakatime.cfg", ".wakatime"}},
}

func applicationPresets(selected []string) ([]domain.ApplicationPreset, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	enabled := make(map[string]bool, len(selected))
	for _, id := range selected {
		enabled[id] = true
	}
	presets := make([]domain.ApplicationPreset, 0, len(presetDefinitions))
	for _, definition := range presetDefinitions {
		paths := make([]string, 0, len(definition.paths))
		available := false
		for _, relative := range definition.paths {
			path := filepath.Join(home, relative)
			paths = append(paths, path)
			if _, err := os.Stat(path); err == nil {
				available = true
			}
		}
		presets = append(presets, domain.ApplicationPreset{
			ID: definition.id, Name: definition.name, Paths: paths,
			Enabled: enabled[definition.id], Available: available,
		})
	}
	return presets, nil
}

func presetSources(selected []string) ([]domain.Source, error) {
	presets, err := applicationPresets(selected)
	if err != nil {
		return nil, err
	}
	var sources []domain.Source
	for _, preset := range presets {
		if !preset.Enabled {
			continue
		}
		for _, path := range preset.Paths {
			if _, err := os.Stat(path); err == nil {
				sources = append(sources, domain.Source{ID: sourceID(path), Path: path, Enabled: true})
			}
		}
	}
	return sources, nil
}

func knownPreset(id string) bool {
	for _, definition := range presetDefinitions {
		if definition.id == id {
			return true
		}
	}
	return false
}

func backupMetadata(preferences domain.Preferences, presets []domain.ApplicationPreset, applicationSources []domain.Source, captured map[string][]domain.BackupKeychainItem, createdAt time.Time) domain.BackupMetadata {
	metadata := domain.BackupMetadata{
		Version:      1,
		CreatedAt:    createdAt,
		Sources:      []domain.Source{},
		Exclusions:   append([]domain.Exclusion(nil), preferences.Exclusions...),
		Applications: []domain.BackupApplication{},
	}
	for _, source := range preferences.Sources {
		if source.Enabled && !source.Excluded {
			metadata.Sources = append(metadata.Sources, source)
		}
	}
	definitions := make(map[string]presetDefinition, len(presetDefinitions))
	for _, definition := range presetDefinitions {
		definitions[definition.id] = definition
	}
	for _, preset := range presets {
		if !preset.Enabled {
			continue
		}
		paths := make([]string, 0, len(preset.Paths))
		for _, path := range preset.Paths {
			for _, source := range applicationSources {
				if source.Path == path {
					paths = append(paths, path)
					break
				}
			}
		}
		if len(paths) == 0 {
			continue
		}
		definition := definitions[preset.ID]
		keychainItems := append([]domain.BackupKeychainItem(nil), definition.keychainItems...)
		for index := range keychainItems {
			for _, item := range captured[preset.ID] {
				if item.Service == keychainItems[index].Service && item.Account == keychainItems[index].Account {
					keychainItems[index].Value = item.Value
					break
				}
			}
		}
		metadata.Applications = append(metadata.Applications, domain.BackupApplication{
			ID:            preset.ID,
			Name:          preset.Name,
			Paths:         paths,
			KeychainItems: keychainItems,
		})
	}
	return metadata
}
