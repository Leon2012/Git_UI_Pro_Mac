SHELL := /bin/bash

.DEFAULT_GOAL := help

NPM ?= npm
NODE ?= node
PLAYWRIGHT ?= npx playwright

.PHONY: help install install-deps dev dev-web build typecheck test test-ui test-macos \
  test-macos-interface verify-macos verify-macos-artifacts smoke-macos-interface \
  dist-mac macos-arm64 package-macos-arm64

help:
	@printf '%s\n' \
		'Usage: make <target>' \
		'' \
		'General:' \
		'  install                 Build, sign and install the macOS arm64 app' \
		'  install-deps            Install locked npm dependencies' \
		'  dev                    Start Vite and Electron development mode' \
		'  dev-web                Start the renderer-only Vite server' \
		'  build                  Build Electron and renderer assets' \
		'  typecheck              Run strict TypeScript checks' \
		'  test                   Run the complete Node test suite' \
		'  test-ui                Run the complete Playwright UI suite' \
		'' \
		'macOS arm64:' \
		'  verify-macos           Verify the current host and Electron runtime' \
		'  dist-mac               Build arm64 DMG and ZIP into release/' \
		'  macos-arm64           Build, verify and smoke-test an isolated arm64 package' \
		'  package-macos-arm64   Alias for macos-arm64' \
		'  verify-macos-artifacts Verify an existing output (ARTIFACT_DIR=...)' \
		'  smoke-macos-interface Run native Electron smoke (APP_PATH=... optional)'

install-deps:
	$(NPM) ci

install:
	@set -euo pipefail; \
	$(NPM) run verify:macos; \
	if [ ! -x node_modules/.bin/electron-builder ]; then \
		printf '%s\n' '[macos-install] dependencies are missing; running npm ci'; \
		$(NPM) ci; \
	fi; \
	identity="$${MAC_SIGN_IDENTITY:-$$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)}"; \
	if [ -z "$$identity" ]; then \
		printf '%s\n' '[macos-install] no valid codesigning identity found; set MAC_SIGN_IDENTITY'; \
		exit 2; \
	fi; \
	output_dir="$${MACOS_OUTPUT_DIR:-$$(mktemp -d "$${TMPDIR:-/tmp}/git-ui-pro-macos-install.XXXXXX")}"; \
	staging_dir="$$(mktemp -d "$${TMPDIR:-/tmp}/git-ui-pro-macos-install-stage.XXXXXX")"; \
	trap 'rm -rf "$$staging_dir"' EXIT; \
	app_path="$$output_dir/mac-arm64/Git UI Pro.app"; \
	target_path="/Applications/Git UI Pro.app"; \
	printf '%s\n' "[macos-install] identity=$$identity" "[macos-install] output=$$output_dir"; \
	$(NPM) run dist:mac -- --dir --config.directories.output="$$output_dir" --config.mac.identity="$$identity" --config.mac.timestamp=none --publish never; \
	test -d "$$app_path"; \
	codesign --verify --deep --strict --verbose=2 "$$app_path"; \
	ditto "$$app_path" "$$staging_dir/Git UI Pro.app"; \
	if [ -e "$$target_path" ]; then rm -rf "$$target_path"; fi; \
	ditto "$$staging_dir/Git UI Pro.app" "$$target_path"; \
	codesign --verify --deep --strict "$$target_path"; \
	printf '%s\n' "[macos-install] installed=$$target_path" "[macos-install] package=$$output_dir"

dev:
	$(NPM) run dev

dev-web:
	$(NPM) run dev:web

build:
	$(NPM) run build

typecheck:
	$(NPM) run typecheck

test:
	$(NPM) test

test-ui:
	$(PLAYWRIGHT) test

test-macos:
	$(NPM) run test:macos

test-macos-interface:
	$(NPM) run test:macos-interface

verify-macos:
	$(NPM) run verify:macos

verify-macos-artifacts:
	@test -n "$(ARTIFACT_DIR)" || { \
		echo 'ARTIFACT_DIR is required, for example: make verify-macos-artifacts ARTIFACT_DIR=/tmp/output'; \
		exit 2; \
	}
	$(NODE) scripts/verify-macos-arm64-artifacts.mjs "$(ARTIFACT_DIR)"

smoke-macos-interface:
	@if [ -n "$(APP_PATH)" ]; then \
		$(NODE) scripts/smoke-macos-interface.mjs "$(APP_PATH)"; \
	else \
		$(NODE) scripts/smoke-macos-interface.mjs; \
	fi

dist-mac:
	$(NPM) run dist:mac -- --publish never

macos-arm64:
	@set -euo pipefail; \
	output_dir="$${MACOS_OUTPUT_DIR:-$$(mktemp -d "$${TMPDIR:-/tmp}/git-ui-pro-macos-arm64.XXXXXX")}"; \
	printf '%s\n' "[macos-build] output=$$output_dir"; \
	$(NPM) run verify:macos; \
	$(NPM) run dist:mac -- --config.directories.output="$$output_dir" --publish never; \
	$(NODE) scripts/verify-macos-arm64-artifacts.mjs "$$output_dir"; \
	$(NODE) scripts/smoke-macos-interface.mjs "$$output_dir/mac-arm64/Git UI Pro.app"; \
	printf '%s\n' "[macos-build] completed output=$$output_dir"

package-macos-arm64: macos-arm64
