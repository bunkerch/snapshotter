package main

import (
	"reflect"
	"testing"
)

func TestApplicationPresetDefinitionsIncludeSupportedAppData(t *testing.T) {
	expected := map[string][]string{
		"signal":           {"Library/Application Support/Signal"},
		"whatsapp":         {"Library/Containers/net.whatsapp.WhatsApp", "Library/Group Containers/group.net.whatsapp.WhatsApp.shared", "Library/Group Containers/group.net.whatsapp.WhatsApp.private", "Library/Group Containers/group.net.whatsapp.family"},
		"imhex":            {"Library/Application Support/imhex"},
		"mongodb-compass":  {"Library/Application Support/MongoDB Compass"},
		"beekeeper-studio": {"Library/Application Support/beekeeper-studio"},
		"sol":              {".config/sol", "Library/Preferences/com.ospfranco.sol.plist"},
		"rectangle":        {"Library/Preferences/com.knollsoft.Rectangle.plist"},
		"snapshotter":      {"Library/Application Support/Snapshotter"},
		"btop":             {".config/btop"},
		"wakatime":         {".wakatime.cfg", ".wakatime"},
	}

	definitions := make(map[string][]string, len(presetDefinitions))
	for _, definition := range presetDefinitions {
		definitions[definition.id] = definition.paths
	}
	for id, paths := range expected {
		if !reflect.DeepEqual(definitions[id], paths) {
			t.Errorf("preset %q paths = %#v, want %#v", id, definitions[id], paths)
		}
	}
}
