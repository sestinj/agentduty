package cmd

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var notifyCmd = &cobra.Command{
	Use:   "notify",
	Short: "Send a notification",
	RunE:  runNotify,
}

func init() {
	notifyCmd.Flags().StringP("message", "m", "", "Notification message")
	notifyCmd.Flags().IntP("priority", "p", 3, "Priority level (1-5)")
	notifyCmd.Flags().StringArrayP("options", "o", nil, "Response options")
	notifyCmd.Flags().StringSliceP("context", "c", nil, "Context key:value pairs")
	notifyCmd.Flags().StringSliceP("tags", "t", nil, "Tags (comma-separated)")
	notifyCmd.Flags().StringP("session", "s", "", "Session ID (auto-generated if empty)")
	notifyCmd.Flags().StringP("workspace", "w", "", "Workspace path (default $PWD)")
	notifyCmd.Flags().Bool("wait", false, "Wait for response")
	notifyCmd.Flags().Duration("timeout", 30*time.Minute, "Timeout when waiting")
	notifyCmd.Flags().Bool("stdin", false, "Read message from stdin")

	rootCmd.AddCommand(notifyCmd)
}

func runNotify(cmd *cobra.Command, args []string) error {
	message, _ := cmd.Flags().GetString("message")
	priority, _ := cmd.Flags().GetInt("priority")
	options, _ := cmd.Flags().GetStringArray("options")
	contextPairs, _ := cmd.Flags().GetStringSlice("context")
	tags, _ := cmd.Flags().GetStringSlice("tags")
	session, _ := cmd.Flags().GetString("session")
	workspace, _ := cmd.Flags().GetString("workspace")
	wait, _ := cmd.Flags().GetBool("wait")
	timeout, _ := cmd.Flags().GetDuration("timeout")
	readStdin, _ := cmd.Flags().GetBool("stdin")

	if readStdin {
		scanner := bufio.NewScanner(os.Stdin)
		var lines []string
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		message = strings.Join(lines, "\n")
	}

	if message == "" {
		return fmt.Errorf("message is required (use -m or --stdin)")
	}

	if workspace == "" {
		workspace = resolveWorkspace()
	}

	if session == "" {
		session = generateSession(workspace)
	}

	// Build context map from key:value pairs.
	contextMap := map[string]string{}
	for _, pair := range contextPairs {
		parts := strings.SplitN(pair, ":", 2)
		if len(parts) == 2 {
			contextMap[parts[0]] = parts[1]
		}
	}

	var contextJSON *string
	if len(contextMap) > 0 {
		b, _ := json.Marshal(contextMap)
		s := string(b)
		contextJSON = &s
	}

	variables := map[string]any{
		"message":    message,
		"priority":   priority,
		"sessionKey": session,
		"workspace":  workspace,
	}
	if len(options) > 0 {
		variables["options"] = options
	}
	if contextJSON != nil {
		variables["context"] = *contextJSON
	}
	if len(tags) > 0 {
		variables["tags"] = tags
	}

	const query = `mutation CreateNotification(
		$message: String!,
		$priority: Int,
		$options: [String!],
		$context: String,
		$tags: [String!],
		$sessionKey: String,
		$workspace: String
	) {
		createNotification(
			message: $message,
			priority: $priority,
			options: $options,
			context: $context,
			tags: $tags,
			sessionKey: $sessionKey,
			workspace: $workspace
		) {
			id
			shortCode
			status
			priority
		}
	}`

	data, err := gqlClient.Do(query, variables)
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}

	var result struct {
		CreateNotification output.Notification `json:"createNotification"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	n := result.CreateNotification

	if jsonFlag && !wait {
		output.PrintJSON(n)
		return nil
	}

	if !wait {
		output.PrintNotificationCreated(n)
		return nil
	}

	// --wait: poll until response or timeout.
	return pollForResponse(n.ID, timeout, jsonFlag)
}

func generateSession(workspace string) string {
	// Check for an instance-specific session (set by session-start hook).
	if s := readInstanceSession(workspace); s != "" {
		return s
	}
	// Fallback: deterministic session from workspace + date.
	date := time.Now().Format("2006-01-02")
	h := sha256.Sum256([]byte(workspace + date))
	return fmt.Sprintf("%x", h[:4])
}

// instanceSessionPath returns the path for the per-instance session file.
// Uses the workspace .claude directory so it's visible both inside and
// outside the Claude Code sandbox.
func instanceSessionPath(workspace string) string {
	dir := filepath.Join(workspace, ".claude")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "agentduty-instance.session")
}

// writeInstanceSession creates a unique session ID and writes it to the instance file.
func writeInstanceSession(workspace string) string {
	b := make([]byte, 4)
	rand.Read(b)
	date := time.Now().Format("2006-01-02")
	h := sha256.Sum256([]byte(workspace + date + hex.EncodeToString(b)))
	sessionKey := fmt.Sprintf("%x", h[:4])
	_ = os.WriteFile(instanceSessionPath(workspace), []byte(sessionKey), 0644)
	return sessionKey
}

// readInstanceSession reads the instance session ID from the temp file.
func readInstanceSession(workspace string) string {
	data, err := os.ReadFile(instanceSessionPath(workspace))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// resolveWorkspace returns the git repo root if inside a repo, otherwise CWD.
func resolveWorkspace() string {
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	cwd, _ := os.Getwd()
	return cwd
}
