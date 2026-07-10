package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"context"
	"encoding/json"
	"sync"
	"unsafe"
)

var (
	bridgeMu      sync.Mutex
	bridgeRuntime *runtime
)

//export SnapshotterOpen
func SnapshotterOpen(preferencesPath *C.char) *C.char {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	bridgeRuntime = newRuntime(C.GoString(preferencesPath))
	return encodeResponse(response{OK: true})
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
