# Defter — task runner. Run `make` (or `make help`) to list targets.
# Everything wraps pnpm; the packages live in packages/*, the demo in apps/demo.

.DEFAULT_GOAL := help
SHELL := bash
PKGS := --filter "./packages/*"
PACK_DIR := dist-tarballs

.PHONY: help install build rebuild typecheck test lint format demo demo-build storybook deploy pack publish-dry publish clean

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[1m%-13s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

build: ## Build all publishable packages (tsc + copy CSS)
	pnpm -r $(PKGS) build

rebuild: clean build ## Clean then build packages from scratch (use when a build looks stale)

typecheck: ## Type-check the whole workspace
	pnpm typecheck

test: ## Run the test suite (vitest)
	pnpm test

lint: ## Lint with Biome
	pnpm lint

format: ## Format with Biome (writes)
	pnpm format

demo: ## Run the demo site (Vite dev server)
	pnpm demo

demo-build: ## Build the demo site (clears the Vite cache first so it can't ship a stale bundle)
	rm -rf apps/demo/node_modules/.vite node_modules/.vite apps/demo/dist
	pnpm demo:build

storybook: ## Run Storybook
	pnpm storybook

deploy: ## Clean-build + deploy demo & Storybook to defter.cagdas.io, then verify it landed
	bash scripts/deploy.sh
	@echo "Deployed & verified. If it FAILED verification, the live site kept the old bundle."

bench: build ## Run the performance harness (parse/serialize/edit/recompute across sizes)
	node scripts/bench.mjs

pack: build ## Pack every package to ./dist-tarballs/*.tgz (install elsewhere without npm)
	@rm -rf $(PACK_DIR) && mkdir -p $(PACK_DIR)
	@for d in packages/*/; do (cd "$$d" && pnpm pack --pack-destination "$(CURDIR)/$(PACK_DIR)"); done
	@echo "→ tarballs in $(PACK_DIR)/. Elsewhere: pnpm add $(CURDIR)/$(PACK_DIR)/<name>.tgz"

publish-dry: build ## Dry-run: what `make publish` would push to npm
	pnpm -r $(PKGS) publish --access public --dry-run --no-git-checks

publish: build ## Publish all packages to npm (needs `npm login` + the @defter org)
	pnpm -r $(PKGS) publish --access public --no-git-checks

clean: ## Remove build outputs and caches (dist, tsbuildinfo, Vite caches)
	@for d in packages/*/; do rm -rf "$$d/dist" "$$d"/*.tsbuildinfo; done
	rm -rf $(PACK_DIR) apps/demo/dist storybook-static
	rm -rf node_modules/.vite apps/demo/node_modules/.vite
