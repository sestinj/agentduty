package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var respondCmd = &cobra.Command{
	Use:   "respond <id>",
	Short: "Respond to a notification",
	Args:  cobra.ExactArgs(1),
	RunE:  runRespond,
}

func init() {
	respondCmd.Flags().StringP("message", "m", "", "Response text (required)")
	respondCmd.MarkFlagRequired("message")
	respondCmd.Flags().String("option", "", "Selected option")

	rootCmd.AddCommand(respondCmd)
}

func runRespond(cmd *cobra.Command, args []string) error {
	id := args[0]
	message, _ := cmd.Flags().GetString("message")
	option, _ := cmd.Flags().GetString("option")

	const query = `mutation RespondToNotification($id: String!, $text: String, $selectedOption: String) {
		respondToNotification(id: $id, text: $text, selectedOption: $selectedOption) {
			id
			shortCode
			status
			priority
			message
			responses {
				text
				selectedOption
				channel
			}
		}
	}`

	variables := map[string]any{
		"id":   id,
		"text": message,
	}
	if option != "" {
		variables["selectedOption"] = option
	}

	data, err := gqlClient.Do(query, variables)
	if err != nil {
		return fmt.Errorf("respond: %w", err)
	}

	var result struct {
		RespondToNotification output.Notification `json:"respondToNotification"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	n := result.RespondToNotification
	if jsonFlag {
		output.PrintJSON(n)
	} else {
		output.PrintNotification(n)
	}
	return nil
}
