.PHONY: help install generate generate-sdk generate-cached consumer-test \
        provider-up provider-down verify verify-docker verify-broker verify-broken \
        publish-pacts demo clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install deps in all three packages
	cd provider && npm install
	cd consumer && npm install
	cd ai-generator && npm install

generate: ## Headline: Claude Opus + PactFlow MCP (auto remote/local) -> consumer test
	cd ai-generator && npx tsx generate.ts

generate-sdk: ## Fallback: plain Anthropic SDK, no MCP
	cd ai-generator && npx tsx generate.ts --sdk

generate-cached: ## Panic button: pre-generated known-good test, fully offline
	cd ai-generator && npx tsx generate.ts --cached

consumer-test: ## Run consumer test vs Pact MOCK -> emits the pact file (no live API)
	cd consumer && npm test

provider-up: ## Start the real provider in Docker (the deployable service)
	docker compose up -d --build provider

provider-down: ## Stop the Docker provider
	docker compose down

verify: ## Verify the contract against the correct provider (expect PASS)
	cd provider && npx tsx verify/verify-provider.ts

verify-docker: ## Verify against the running Docker provider on :3001 (needs provider-up)
	cd provider && PROVIDER_BASE_URL=http://localhost:3001 npx tsx verify/verify-provider.ts

verify-broker: ## Verify against the Docker provider and publish results to the broker
	cd provider && PROVIDER_BASE_URL=http://localhost:3001 npx tsx verify/verify-provider.ts

verify-broken: ## Verify against the BROKEN provider (expect FAIL — the demo payoff)
	cd provider && PROVIDER_VARIANT=broken npx tsx verify/verify-provider.ts

publish-pacts: ## Publish pact files to the local Pact Broker (needs broker running)
	cd consumer && PACT_BROKER_BASE_URL=http://localhost:9292 PACT_BROKER_USERNAME=pact PACT_BROKER_PASSWORD=pact npm run publish-pacts

demo: ## Full corrected pipeline: generate -> contract -> verify -> catch the break
	@echo "\n=== 1) Claude Opus + PactFlow MCP generate a consumer contract from the OpenAPI spec ==="
	@$(MAKE) generate
	@echo "\n=== 2) Run the consumer test vs the Pact MOCK -> emits the pact file (no live API) ==="
	@$(MAKE) consumer-test
	@ls -la consumer/pacts/
	@echo "\n=== 3) Verify the contract against the correct provider (expect GREEN) ==="
	@$(MAKE) verify
	@echo "\n=== 4) THE POINT: verify the SAME contract against a provider that renamed a field (expect RED) ==="
	-@$(MAKE) verify-broken
	@echo "\n✅ Done. The contract caught the breaking change before any UI test ran."

broker-setup: ## SmartBear MCP: create 'production' environment in the broker
	cd ai-generator && npx tsx broker-orchestrate.ts setup

broker-publish: ## SmartBear MCP: publish consumer contracts to the broker
	cd ai-generator && npx tsx broker-orchestrate.ts publish

broker-record-deployment: ## SmartBear MCP: record PetsProvider@1.0.0 deployed to production
	cd ai-generator && npx tsx broker-orchestrate.ts record-deployment PetsProvider 1.0.0

broker-can-i-deploy: ## SmartBear MCP: can-i-deploy check for PetsWebConsumer → production
	cd ai-generator && npx tsx broker-orchestrate.ts can-i-deploy PetsWebConsumer

clean: ## Remove generated artifacts + stop Docker
	-rm -f consumer/src/pets.consumer.pact.test.ts
	-rm -rf consumer/pacts
	-docker compose down -v
