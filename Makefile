.PHONY: app dmg engine test verify

app:
	sh scripts/package-macos.sh

dmg:
	sh scripts/package-release.sh

engine:
	cd engine && mkdir -p build && go build -buildmode=c-shared -o build/libsnapshotter.dylib ./bridge

test:
	cd engine && go test -race ./...
	zsh -ic 'pnpm test'
	zsh -ic 'pnpm build'
	swift build --package-path macos

verify:
	zsh -ic 'pnpm lint'
	zsh -ic 'pnpm test'
	zsh -ic 'pnpm build'
	cd engine && go test -race ./...
	swift build --package-path macos -Xswiftc -warnings-as-errors
	sh scripts/package-release.sh
