package main

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestStateCollectionsEncodeAsArrays(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	result := runtime.handle(context.Background(), []byte(`{"type":"state.get"}`))
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"sources":null`)) || bytes.Contains(encoded, []byte(`"snapshots":null`)) {
		t.Fatalf("state contains null collection: %s", encoded)
	}
}

func TestStateStartsUnconfiguredAndPersistsSources(t *testing.T) {
	runtime := newRuntime(filepath.Join(t.TempDir(), "preferences.json"))
	initial := runtime.handle(context.Background(), []byte(`{"type":"state.get"}`))
	if !initial.OK {
		t.Fatal(initial.Error)
	}
	state := initial.Data.(applicationState)
	if state.Status != "unconfigured" || len(state.Preferences.Sources) != 0 {
		t.Fatalf("unexpected initial state: %#v", state)
	}
	payload, err := json.Marshal(request{Type: "source.add", Payload: json.RawMessage(`{"paths":["/Users/example/Documents"]}`)})
	if err != nil {
		t.Fatal(err)
	}
	updated := runtime.handle(context.Background(), payload)
	if !updated.OK {
		t.Fatal(updated.Error)
	}
	state = updated.Data.(applicationState)
	if len(state.Preferences.Sources) != 1 || state.Preferences.Sources[0].Path != "/Users/example/Documents" {
		t.Fatalf("unexpected sources: %#v", state.Preferences.Sources)
	}
}
