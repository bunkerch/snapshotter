package main

import (
	"os"
	"path/filepath"

	"github.com/restic/restic/app/domain"
)

type presetDefinition struct {
	id    string
	name  string
	paths []string
}

var presetDefinitions = []presetDefinition{
	{id: "firefox", name: "Firefox", paths: []string{"Library/Application Support/Firefox/Profiles", "Library/Application Support/Firefox/installs.ini", "Library/Application Support/Firefox/profiles.ini"}},
	{id: "thunderbird", name: "Thunderbird", paths: []string{"Library/Thunderbird/Profiles", "Library/Thunderbird/installs.ini", "Library/Thunderbird/profiles.ini"}},
	{id: "ghostty", name: "Ghostty", paths: []string{"Library/Application Support/com.mitchellh.ghostty/config", ".config/ghostty"}},
	{id: "opencode", name: "OpenCode", paths: []string{".config/opencode", ".local/share/opencode", ".local/state/opencode"}},
	{id: "vscode", name: "Visual Studio Code", paths: []string{"Library/Application Support/Code/User", ".vscode/extensions"}},
	{id: "minecraft", name: "Minecraft saves", paths: []string{"Library/Application Support/minecraft/saves"}},
	{id: "chrome", name: "Google Chrome", paths: []string{"Library/Application Support/Google/Chrome"}},
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
