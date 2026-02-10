"use client";

import { useState } from "react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 rounded px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
      aria-label="Copy to clipboard"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function TerminalBlock({
  command,
  copyable = true,
}: {
  command: string;
  copyable?: boolean;
}) {
  return (
    <div className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 font-mono text-sm">
      <code className="overflow-x-auto">
        <span className="select-none text-muted">$ </span>
        {command}
      </code>
      {copyable && <CopyButton text={command} />}
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-muted">
        {step}
      </div>
      <div className="flex flex-col gap-2 pt-0.5">
        <h3 className="font-medium text-foreground">{title}</h3>
        <div className="text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 transition-colors hover:bg-surface-hover">
      <h3 className="mb-2 font-medium text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}

function SlackPreview() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-accent/20 text-center text-xs leading-5 font-bold text-accent">
          A
        </div>
        <span className="text-sm font-medium text-foreground">AgentDuty</span>
        <span className="text-xs text-muted">12:34 PM</span>
      </div>
      <div className="mb-3 border-l-2 border-accent/40 pl-3 text-sm text-muted">
        <p className="mb-1 text-foreground">
          Tests failing on <code className="rounded bg-background px-1 py-0.5 text-xs">user-auth</code> branch.
        </p>
        <p>Revert or fix?</p>
      </div>
      <div className="flex gap-2">
        <div className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
          Revert
        </div>
        <div className="rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">
          Fix
        </div>
        <div className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
          Skip
        </div>
      </div>
    </div>
  );
}

function SMSPreview() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-2 text-xs text-muted">SMS from AgentDuty</div>
      <div className="space-y-2">
        <div className="inline-block max-w-[85%] rounded-2xl rounded-bl-sm bg-border/60 px-3 py-2 text-sm text-foreground">
          <p className="mb-1">Tests failing on user-auth branch. Revert or fix?</p>
          <p className="text-muted">
            1) Revert{" "}
            2) Fix{" "}
            3) Skip
          </p>
        </div>
        <div className="flex justify-end">
          <div className="inline-block rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white">
            2
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const installCmd = "curl -fsSL https://agentduty.dev/install | sh";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">
            AgentDuty
          </span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/sestinj/agentduty"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href="/auth/login"
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              Log in
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-24 sm:pt-32">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Your coding agents need decisions.{" "}
            <span className="text-muted">You need your life back.</span>
          </h1>
          <p className="mb-10 text-lg leading-relaxed text-muted sm:text-xl">
            Coding agents run autonomously but hit walls that need human input.
            AgentDuty bridges the gap with Slack DMs and SMS so you can
            unblock agents from anywhere.
          </p>

          {/* Install command */}
          <div className="mx-auto mb-8 max-w-lg">
            <TerminalBlock command={installCmd} />
          </div>

          <div className="flex items-center justify-center gap-4">
            <a
              href="/auth/login"
              className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Get Started
            </a>
            <a
              href="https://github.com/sestinj/agentduty"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              View Source
            </a>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="border-t border-border" />
      </div>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Up and running in 60 seconds
        </h2>
        <div className="mx-auto max-w-xl space-y-8">
          <StepCard step={1} title="Install the CLI">
            <TerminalBlock command={installCmd} />
          </StepCard>

          <StepCard step={2} title="Log in to your account">
            <TerminalBlock command="agentduty login" />
          </StepCard>

          <StepCard step={3} title="Add a checkpoint in your agent workflow">
            <TerminalBlock
              command='agentduty notify -m "Tests failing. Revert or fix?" --options "Revert,Fix,Skip"'
            />
          </StepCard>

          <StepCard step={4} title="Get notified, respond, and your agent continues">
            <div className="grid gap-3 sm:grid-cols-2">
              <SlackPreview />
              <SMSPreview />
            </div>
          </StepCard>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="border-t border-border" />
      </div>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Built for how you actually work
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureCard
            title="Slack DMs with action buttons"
            description="Get a DM with context and tap a button to respond. No typing, no context switching. Your agent gets the answer instantly."
          />
          <FeatureCard
            title="SMS with numbered options"
            description="Away from your desk? Get a text message and reply with a number. Works from anywhere with cell signal."
          />
          <FeatureCard
            title="Escalation policies"
            description="Define how and when to escalate. Start with Slack, bump to SMS after 5 minutes, page your teammate after 15."
          />
          <FeatureCard
            title="Session threading"
            description="Every agent session gets its own thread. See full conversation history and decision trail in one place."
          />
          <FeatureCard
            title="Works with any agent"
            description="One CLI command is all it takes. Works with Claude Code, Cursor, Copilot, Aider, or any agent that can run shell commands."
          />
          <FeatureCard
            title="Self-hostable"
            description="Run AgentDuty on your own infrastructure. Your data, your rules. Open source under MIT license."
          />
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="border-t border-border" />
      </div>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          Stop babysitting your agents
        </h2>
        <p className="mb-8 text-muted">
          Install AgentDuty and get back to what matters.
        </p>
        <div className="mx-auto mb-6 max-w-lg">
          <TerminalBlock command={installCmd} />
        </div>
        <a
          href="/auth/login"
          className="inline-block rounded-md bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Get Started
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <span className="text-sm text-muted">AgentDuty</span>
          <a
            href="https://github.com/sestinj/agentduty"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
