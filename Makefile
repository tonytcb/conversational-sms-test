.DEFAULT_GOAL := help
SHELL := /bin/bash

# Twilio sim defaults (override: make send-sms FROM=+15551234 BODY="hi")
FROM ?= +15551234567
TO   ?= +15550000000
BODY ?= Hello from a customer

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: env
env: ## Create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env")

.PHONY: up
up: env ## Build and start the full stack
	docker compose up --build -d
	@echo "API:      http://localhost:$${API_PORT:-3000}"
	@echo "Frontend: http://localhost:$${FRONTEND_PORT:-8080}"
	@echo "Mountebank admin: http://localhost:2525"

.PHONY: down
down: ## Stop the stack (keep volumes)
	docker compose down

.PHONY: clean
clean: ## Stop the stack and remove volumes
	docker compose down -v

.PHONY: logs
logs: ## Tail logs for all services
	docker compose logs -f

.PHONY: logs-worker
logs-worker: ## Tail the worker logs (watch processing transitions)
	docker compose logs -f backend-worker

.PHONY: migrate
migrate: ## Run database migrations
	docker compose run --rm migrate

.PHONY: ps
ps: ## Show running services
	docker compose ps

.PHONY: scale-workers
scale-workers: ## Scale workers: make scale-workers N=3
	docker compose up -d --scale backend-worker=$(or $(N),3)

.PHONY: send-sms
send-sms: ## Simulate an inbound SMS: make send-sms FROM=+1555... BODY="hi"
	@./scripts/send-sms.sh "$(FROM)" "$(TO)" "$(BODY)"

.PHONY: sent
sent: ## Show outbound messages Mountebank received from the worker
	@curl -s http://localhost:2525/imposters/4545 | \
		node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const reqs=(j.requests||[]).map(r=>r.body);console.log(JSON.stringify(reqs,null,2))})"

.PHONY: install
install: ## Install backend + e2e deps (and the Playwright browser)
	cd backend && npm install --include=dev
	cd e2e && npm install --include=dev && npx playwright install chromium

.PHONY: test
test: ## Run backend unit + integration tests (needs Docker for integration)
	@cd backend && { [ -d node_modules ] || npm install --include=dev; }; npm test

.PHONY: e2e
e2e: ## Run Playwright e2e tests (stack must be up; or use `make e2e-ci`)
	@cd e2e && { [ -d node_modules ] || npm install --include=dev; }; npx playwright install chromium >/dev/null 2>&1; npm test

.PHONY: e2e-ci
e2e-ci: env ## Start the stack, run e2e, then stop (one-shot)
	docker compose up --build -d
	@api=$$(grep -E '^API_HOST_PORT=' .env | cut -d= -f2); api=$${api:-3000}; \
	  fe=$$(grep -E '^FRONTEND_PORT=' .env | cut -d= -f2); fe=$${fe:-8080}; \
	  echo "waiting for API on :$$api ..."; \
	  for i in $$(seq 1 60); do curl -fsS http://localhost:$$api/health >/dev/null 2>&1 && break || sleep 2; done; \
	  ( cd e2e && npm install --include=dev && npx playwright install chromium && \
	    BASE_URL=http://localhost:$$fe API_URL=http://localhost:$$api npx playwright test ); \
	  status=$$?; \
	  docker compose down; \
	  exit $$status
