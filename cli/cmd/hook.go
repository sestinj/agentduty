package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var hookCmd = &cobra.Command{
	Use:   "hook",
	Short: "Claude Code hook handlers",
}

var hookStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop hook — blocks if there are pending AgentDuty notifications",
	RunE:  runHookStop,
}

var hookSessionStartCmd = &cobra.Command{
	Use:   "session-start",
	Short: "Session start hook — outputs AgentDuty usage instructions",
	RunE:  runHookSessionStart,
}

func init() {
	hookCmd.AddCommand(hookStopCmd)
	hookCmd.AddCommand(hookSessionStartCmd)
	rootCmd.AddCommand(hookCmd)
}

type hookResponse struct {
	Decision string `json:"decision"`
	Reason   string `json:"reason,omitempty"`
}

func runHookStop(cmd *cobra.Command, args []string) error {
	// If a poll process is already running, the agent is listening. Let it stop.
	if IsPollRunning() {
		return nil
	}

	// Compute session key from workspace (same logic as notify/history).
	workspace := resolveWorkspace()
	sessionKey := generateSession(workspace)

	// Query session history to find unresponded notifications.
	data, err := gqlClient.Do(sessionHistoryQuery, map[string]any{
		"sessionKey": sessionKey,
	})
	if err != nil {
		// On error, approve — don't block the agent due to API issues.
		return nil
	}

	var result struct {
		SessionHistory *output.SessionHistory `json:"sessionHistory"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil
	}

	if result.SessionHistory == nil {
		return nil
	}

	// Check for notifications in "delivered" or "pending" status (awaiting response).
	// Only consider notifications from the last hour to avoid blocking on stale ones.
	cutoff := time.Now().Add(-1 * time.Hour)
	var pending []output.Notification
	for _, n := range result.SessionHistory.Notifications {
		if n.Status != "delivered" && n.Status != "pending" {
			continue
		}
		if n.CreatedAt.Before(cutoff) {
			continue
		}
		pending = append(pending, n)
	}

	if len(pending) == 0 {
		return nil
	}

	// Use the most recent pending notification's ID for the poll command.
	latest := pending[len(pending)-1]

	reason := fmt.Sprintf(
		"You have %d pending AgentDuty notification(s) awaiting response. "+
			"Start a background poll before stopping so you don't lose contact:\n"+
			"  agentduty poll %s --wait --timeout 30m\n"+
			"Run this in the background, then you can continue working.",
		len(pending), latest.ID,
	)

	resp := hookResponse{
		Decision: "block",
		Reason:   reason,
	}

	enc := json.NewEncoder(os.Stdout)
	return enc.Encode(resp)
}

func runHookSessionStart(cmd *cobra.Command, args []string) error {
	// Reuse existing session key if one exists; only create a new one
	// for genuinely new sessions. This prevents context compaction or
	// session restarts from fragmenting the Slack thread.
	workspace := resolveWorkspace()
	if existing := readInstanceSession(workspace); existing == "" {
		writeInstanceSession(workspace)
	}

	fmt.Print(`AgentDuty is installed. Use it to communicate with the user via Slack:

- Send a message: agentduty notify -m "your message"
- Send with options: agentduty notify -m "question?" -o "Yes" -o "No"
- Wait for response: agentduty notify -m "question?" --wait
- Poll for response: agentduty poll <ID> --wait --timeout 30m
- Acknowledge a message: agentduty react <shortCode>
- View history: agentduty history

IMPORTANT: When having a conversation through AgentDuty, always maintain a background poll so you can receive replies. After sending a notification, immediately start a background poll. Never let a poll lapse without starting a new one — losing contact means the user has to rescue you manually.

IMPORTANT: Keep messages concise. Slack truncates messages behind a "See more" toggle at ~700 characters. Stay under this limit when possible — be direct, skip filler, use short bullet points. If you truly need more space, it's okay to go over, but prefer brevity.
`)
	return nil
}
