#!/bin/sh
set -e

REPO="sestinj/agentduty"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux)  OS="linux" ;;
  darwin) OS="darwin" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest release tag
if command -v curl >/dev/null 2>&1; then
  LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')
elif command -v wget >/dev/null 2>&1; then
  LATEST=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')
else
  echo "Error: curl or wget is required"
  exit 1
fi

if [ -z "$LATEST" ]; then
  echo "Error: could not determine latest release"
  exit 1
fi

BINARY="agentduty-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/$LATEST/$BINARY"

echo "Installing AgentDuty $LATEST ($OS/$ARCH)..."

# Download
TMPFILE=$(mktemp)
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMPFILE"
else
  wget -qO "$TMPFILE" "$URL"
fi

# Install
mkdir -p "$INSTALL_DIR"
mv "$TMPFILE" "$INSTALL_DIR/agentduty"
chmod +x "$INSTALL_DIR/agentduty"

echo "Installed to $INSTALL_DIR/agentduty"

# Check PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "Add this to your shell profile:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

# Set up Claude Code hooks
echo ""
echo "Setting up Claude Code hooks..."
"$INSTALL_DIR/agentduty" install 2>/dev/null || echo "Run 'agentduty install' after logging in to set up hooks."

echo ""
echo "Next steps:"
echo "  1. agentduty login"
echo "  2. agentduty install  (if hooks weren't set up above)"
echo "  3. Start using it: agentduty notify -m 'Hello!'"
