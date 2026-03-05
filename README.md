<p align="center">
  <a href="https://continue.dev">
    <img src=".github/assets/continue-banner.png" width="800" alt="Continue" />
  </a>
</p>

<h1 align="center">AgentDuty</h1>

<p align="center">On-call for your AI agents — get notified when they need you, respond from Slack.</p>

<p align="center"><em>An autonomous codebase built by the <a href="https://continue.dev/blueprint">Continue Software Factory</a></em></p>

---

## Why?

AI coding agents run autonomously but sometimes need human input — approval, clarification, or a judgment call. AgentDuty bridges that gap: agents notify you through Slack when they need attention, and you respond right there. Think of it as PagerDuty, but for your AI agents instead of your servers.

## Table of Contents

- [Architecture](#architecture)
- [CLI](#cli)
- [Web App](#web-app)
- [Installation](#installation)
- [Development](#development)
- [Deploying](#deploying)
- [Contributing](#contributing)
- [License](#license)

## Architecture

AgentDuty has two main components:

- **CLI** (`cli/`) — A Go CLI that agents use to send notifications and poll for responses. Integrates with Claude Code via hooks.
- **Web App** (`web/`) — A Next.js app with a Slack integration backend. Handles message routing, session management, and the dashboard at [agentduty.dev](https://www.agentduty.dev).

## CLI

The CLI is how agents communicate through AgentDuty. Key commands:

- `agentduty notify -m "message"` — Send a notification to the user
- `agentduty poll <short-code> --wait` — Wait for a response in a session
- `agentduty react <short-code> -e <emoji>` — React to a message
- `agentduty login` — Authenticate with your account
- `agentduty install` — Set up Claude Code hooks

Build from source:

```bash
cd cli && go build -o /tmp/agentduty .
```

## Web App

The web app is built with Next.js 14, Drizzle ORM, and Neon (serverless Postgres). It provides:

- Slack Events API integration for message routing
- GraphQL API for the CLI
- Dashboard for managing sessions and settings

## Installation

Install the CLI with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/sestinj/agentduty/main/install.sh | sh
```

Then:

```bash
agentduty login
agentduty install
```

## Development

### Prerequisites

- Node.js 20+
- Go 1.24+
- A Neon database (or local Postgres)

### Web App

```bash
cd web
cp .env.example .env.local  # Configure your environment
npm install
npm run dev
```

### CLI

```bash
cd cli
go build -o /tmp/agentduty .
go test ./...
```

### Tests

```bash
# Web tests (Vitest)
cd web && npm test

# CLI tests (Go)
cd cli && go test ./...
```

## Deploying

- **Web app**: Deploys to Vercel. Always deploy from the `web/` directory:
  ```bash
  cd web && npx vercel --prod
  ```
- **CLI**: Releases are built automatically via GoReleaser when a version tag is pushed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

Copyright (c) 2025 Continue Dev, Inc.
