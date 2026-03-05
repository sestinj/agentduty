# Contributing to AgentDuty

Thanks for your interest in contributing to AgentDuty! This document covers the development setup, project structure, and contribution process.

## Development Setup

### Prerequisites

- Node.js 20+
- Go 1.24+
- A PostgreSQL database (Neon recommended, or local Postgres)

### Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/agentduty.git
   cd agentduty
   ```

2. Set up the web app:
   ```bash
   cd web
   cp .env.example .env.local  # Fill in your environment variables
   npm install
   npm run dev
   ```

3. Build the CLI:
   ```bash
   cd cli
   go build -o /tmp/agentduty .
   ```

## Project Structure

```
agentduty/
  cli/           # Go CLI — agent-facing notification and polling tool
    cmd/         # Cobra command definitions
    internal/    # Internal packages
    main.go      # Entry point
  web/           # Next.js web app — Slack integration and dashboard
    src/         # App source (routes, components, API)
    drizzle/     # Database migrations
  install.sh     # One-line installer for the CLI
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `refactor:` — Code refactoring (no behavior change)
- `test:` — Adding or updating tests
- `chore:` — Maintenance, dependencies, CI

Examples:
```
feat: add timeout option to poll command
fix: handle expired Slack tokens gracefully
docs: add architecture diagram to README
```

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes and ensure tests pass:
   ```bash
   # Web
   cd web && npm test

   # CLI
   cd cli && go test ./...
   ```

3. Push your branch and open a pull request against `main`.

4. Fill out the PR template — describe what changed and why.

5. Address any review feedback. Once approved, a maintainer will merge your PR.

## Code Style

- **Go**: Follow standard `gofmt` conventions. Run `go vet ./...` before submitting.
- **TypeScript**: ESLint is configured in the web app. Run `npm run lint` to check.

## Reporting Issues

Use [GitHub Issues](https://github.com/sestinj/agentduty/issues) to report bugs or request features. Please use the provided issue templates.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
