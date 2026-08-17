package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"unsafe"
)

var (
	bridgeMu        sync.Mutex
	bridgeRuntime   *runtime
	progressRuntime atomic.Pointer[runtime]
)

//export SnapshotterOpen
func SnapshotterOpen(preferencesPath *C.char) *C.char {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	bridgeRuntime = newRuntime(C.GoString(preferencesPath))
	progressRuntime.Store(bridgeRuntime)
	return encodeResponse(response{OK: true})
}

//export SnapshotterProgress
func SnapshotterProgress() *C.char {
	runtime := progressRuntime.Load()
	if runtime == nil {
		return C.CString(`{"phase":"idle"}`)
	}
	encoded, err := json.Marshal(runtime.backupProgress())
	if err != nil {
		return C.CString(`{"phase":"error"}`)
	}
	return C.CString(string(encoded))
}

//export SnapshotterCancel
func SnapshotterCancel() *C.char {
	runtime := progressRuntime.Load()
	if runtime == nil {
		return encodeResponse(response{OK: true, Data: false})
	}
	return encodeResponse(response{OK: true, Data: runtime.cancelOperation()})
}

//export SnapshotterHandle
func SnapshotterHandle(rawRequest *C.char) *C.char {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	if bridgeRuntime == nil {
		return encodeResponse(failed(context.Canceled))
	}
	return encodeResponse(bridgeRuntime.handle(context.Background(), []byte(C.GoString(rawRequest))))
}

//export SnapshotterClose
func SnapshotterClose() {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	if bridgeRuntime != nil {
		_ = bridgeRuntime.repository.Close()
		bridgeRuntime = nil
		progressRuntime.Store(nil)
	}
}

//export SnapshotterFree
func SnapshotterFree(pointer unsafe.Pointer) { C.free(pointer) }

func encodeResponse(value response) *C.char {
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded = []byte(`{"ok":false,"error":"encode response"}`)
	}
	return C.CString(string(encoded))
}

func main() {}
