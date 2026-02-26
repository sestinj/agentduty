package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var archiveCmd = &cobra.Command{
	Use:   "archive <id>",
	Short: "Archive a notification",
	Args:  cobra.ExactArgs(1),
	RunE:  runArchive,
}

func init() {
	rootCmd.AddCommand(archiveCmd)
}

func runArchive(cmd *cobra.Command, args []string) error {
	id := args[0]

	const query = `mutation ArchiveNotification($id: String!) {
		archiveNotification(id: $id) {
			id
			shortCode
			status
			priority
			message
		}
	}`

	data, err := gqlClient.Do(query, map[string]any{"id": id})
	if err != nil {
		return fmt.Errorf("archive: %w", err)
	}

	var result struct {
		ArchiveNotification *output.Notification `json:"archiveNotification"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if result.ArchiveNotification == nil {
		return fmt.Errorf("notification not found: %s", id)
	}

	n := *result.ArchiveNotification
	if jsonFlag {
		output.PrintJSON(n)
	} else {
		fmt.Printf("Archived: %s (P%d) %s\n", n.ShortCode, n.Priority, truncateMsg(n.Message, 50))
	}
	return nil
}

func truncateMsg(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}
