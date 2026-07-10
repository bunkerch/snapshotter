.PHONY: engine test

engine:
	cd engine && mkdir -p build && go build -buildmode=c-shared -o build/libsnapshotter.dylib ./bridge

test:
	cd engine && go test -race ./...
	zsh -ic 'pnpm test'
	zsh -ic 'pnpm build'
	swift build --package-path macos
