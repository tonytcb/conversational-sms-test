# frontend — SMS Admin UI

React + TypeScript + Vite admin interface. Read-only (no auth, per the brief):
list conversations and inspect each one's inbound/outbound messages with live
status. Clarity over polish.

## Tools

- **React 18 + Vite** — fast dev server and build.
- **TanStack Query** — server state + polling. The list refetches every 3s and the
  open conversation every 2s, so `received → processing → sent → delivered`
  transitions appear live without manual refresh or websockets.
- **nginx** — serves the static build in the container (SPA fallback).

## How it works

- `src/api.ts` — typed fetch wrapper around the backend (`/api/v1/...`). Base URL
  comes from `VITE_API_BASE_URL`, inlined at build time.
- `src/components/ConversationList.tsx` — left pane, polls the conversations list.
- `src/components/ConversationDetail.tsx` — right pane, polls one conversation;
  renders inbound/outbound bubbles + a colored `StatusBadge`.

`data-testid` attributes are present throughout for the Playwright e2e suite.

## Run

```bash
# Local dev (expects the API on :3000, or set VITE_API_BASE_URL)
npm install
npm run dev            # http://localhost:5173

# Production build
npm run build          # -> dist/
```

In Docker the API base is injected via the compose build arg
`VITE_API_BASE_URL` (defaults to `http://localhost:3000`).
