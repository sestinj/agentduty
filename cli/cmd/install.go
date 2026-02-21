package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var installCmd = &cobra.Command{
	Use:   "install",
	Short: "Install Claude Code hooks for AgentDuty",
	Long: `Sets up Claude Code hooks so that:
- On session start, the agent learns how to use AgentDuty
- On stop, the agent is reminded to poll for pending notifications

Hooks are installed in ~/.claude/settings.json (global).`,
	RunE: runInstall,
}

func init() {
	installCmd.Flags().Bool("global", true, "Install hooks globally (default: true)")
	rootCmd.AddCommand(installCmd)
}

func runInstall(cmd *cobra.Command, args []string) error {
	// Find the agentduty binary path.
	binaryPath, err := findBinaryPath()
	if err != nil {
		return fmt.Errorf("could not find agentduty binary: %w", err)
	}

	settingsPath, err := claudeSettingsPath()
	if err != nil {
		return err
	}

	// Read existing settings or start fresh.
	settings, err := readSettings(settingsPath)
	if err != nil {
		return err
	}

	// Ensure hooks map exists.
	hooks, ok := settings["hooks"].(map[string]any)
	if !ok {
		hooks = map[string]any{}
		settings["hooks"] = hooks
	}

	stopCmd := binaryPath + " hook stop"
	sessionStartCmd := binaryPath + " hook session-start"

	// Add Stop hook if not already present.
	addHookIfMissing(hooks, "Stop", stopCmd)

	// Add SessionStart hook if not already present.
	addHookIfMissing(hooks, "SessionStart", sessionStartCmd)

	// Write settings back.
	if err := writeSettings(settingsPath, settings); err != nil {
		return err
	}

	fmt.Printf("Installed AgentDuty hooks in %s\n", settingsPath)
	fmt.Println()
	fmt.Println("Hooks installed:")
	fmt.Printf("  Stop:         %s\n", stopCmd)
	fmt.Printf("  SessionStart: %s\n", sessionStartCmd)
	return nil
}

func findBinaryPath() (string, error) {
	// First try: the current executable path.
	exe, err := os.Executable()
	if err == nil {
		resolved, err := filepath.EvalSymlinks(exe)
		if err == nil {
			return resolved, nil
		}
		return exe, nil
	}

	// Fallback: search PATH.
	path, err := exec.LookPath("agentduty")
	if err == nil {
		return path, nil
	}

	return "", fmt.Errorf("could not determine agentduty binary location")
}

func claudeSettingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not find home directory: %w", err)
	}

	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("could not create ~/.claude: %w", err)
	}

	return filepath.Join(dir, "settings.json"), nil
}

func readSettings(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("read settings: %w", err)
	}

	// Handle empty file.
	content := strings.TrimSpace(string(data))
	if content == "" {
		return map[string]any{}, nil
	}

	var settings map[string]any
	if err := json.Unmarshal([]byte(content), &settings); err != nil {
		return nil, fmt.Errorf("parse settings (%s): %w", path, err)
	}
	return settings, nil
}

func writeSettings(path string, settings map[string]any) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize settings: %w", err)
	}

	if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		return fmt.Errorf("write settings: %w", err)
	}
	return nil
}

func addHookIfMissing(hooks map[string]any, event string, command string) {
	existing, ok := hooks[event].([]any)
	if !ok {
		existing = []any{}
	}

	// Check if a hook entry with this command already exists.
	for _, entry := range existing {
		entryMap, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		innerHooks, ok := entryMap["hooks"].([]any)
		if !ok {
			continue
		}
		for _, h := range innerHooks {
			hookMap, ok := h.(map[string]any)
			if !ok {
				continue
			}
			cmd, _ := hookMap["command"].(string)
			if cmd == command {
				return // Already installed.
			}
			// Check for existing agentduty hook with a different path.
			if strings.Contains(cmd, "agentduty hook") {
				hookMap["command"] = command
				return
			}
		}
	}

	// Add new hook entry in the nested format.
	existing = append(existing, map[string]any{
		"hooks": []any{
			map[string]any{
				"type":    "command",
				"command": command,
			},
		},
	})
	hooks[event] = existing
}

