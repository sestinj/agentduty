package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var historyCmd = &cobra.Command{
	Use:   "history",
	Short: "Show conversation history for the current session",
	RunE:  runHistory,
}

func init() {
	historyCmd.Flags().StringP("session", "s", "", "Session key (default: auto-generated from workspace)")
	historyCmd.Flags().StringP("workspace", "w", "", "Workspace path (default $PWD)")

	rootCmd.AddCommand(historyCmd)
}

const sessionHistoryQuery = `query SessionHistory($sessionKey: String!) {
	sessionHistory(sessionKey: $sessionKey) {
		sessionId
		workspace
		notifications {
			id
			shortCode
			message
			options
			status
			createdAt
			responses {
				text
				selectedOption
				channel
				createdAt
			}
		}
	}
}`

func runHistory(cmd *cobra.Command, args []string) error {
	session, _ := cmd.Flags().GetString("session")
	workspace, _ := cmd.Flags().GetString("workspace")

	if workspace == "" {
		workspace, _ = os.Getwd()
	}

	if session == "" {
		session = generateSession(workspace)
	}

	data, err := gqlClient.Do(sessionHistoryQuery, map[string]any{
		"sessionKey": session,
	})
	if err != nil {
		return fmt.Errorf("query session history: %w", err)
	}

	var result struct {
		SessionHistory *output.SessionHistory `json:"sessionHistory"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if result.SessionHistory == nil {
		fmt.Println("No session found. Send a notification first with: agentduty notify -m \"your message\"")
		return nil
	}

	if jsonFlag {
		output.PrintJSON(result.SessionHistory)
	} else {
		output.PrintSessionHistory(*result.SessionHistory)
	}

	return nil
}
