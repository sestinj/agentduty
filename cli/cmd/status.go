package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "List active notifications",
	RunE:  runStatus,
}

func init() {
	rootCmd.AddCommand(statusCmd)
}

func runStatus(cmd *cobra.Command, args []string) error {
	const query = `query ListNotifications($status: String) {
		notifications(status: $status) {
			id
			shortCode
			status
			priority
			message
			createdAt
		}
	}`

	data, err := gqlClient.Do(query, map[string]any{})
	if err != nil {
		return fmt.Errorf("query notifications: %w", err)
	}

	var result struct {
		Notifications []output.Notification `json:"notifications"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if jsonFlag {
		output.PrintJSON(result.Notifications)
	} else {
		output.PrintNotifications(result.Notifications)
	}
	return nil
}
