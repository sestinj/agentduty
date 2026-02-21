package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var reactCmd = &cobra.Command{
	Use:   "react <shortCode>",
	Short: "Add an emoji reaction to a notification",
	Args:  cobra.ExactArgs(1),
	RunE:  runReact,
}

func init() {
	reactCmd.Flags().StringP("emoji", "e", "thumbsup", "Emoji name (without colons)")
	reactCmd.Flags().IntP("response", "r", 0, "Response index (1-based) to react to; default is latest")
	rootCmd.AddCommand(reactCmd)
}

func runReact(cmd *cobra.Command, args []string) error {
	id := args[0]
	emoji, _ := cmd.Flags().GetString("emoji")
	responseIndex, _ := cmd.Flags().GetInt("response")

	const query = `mutation AddReaction($id: String!, $emoji: String!, $responseIndex: Int) {
		addReaction(id: $id, emoji: $emoji, responseIndex: $responseIndex)
	}`

	variables := map[string]any{
		"id":    id,
		"emoji": emoji,
	}
	if responseIndex > 0 {
		variables["responseIndex"] = responseIndex
	}

	data, err := gqlClient.Do(query, variables)
	if err != nil {
		return fmt.Errorf("react: %w", err)
	}

	var result struct {
		AddReaction bool `json:"addReaction"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if jsonFlag {
		fmt.Println(`{"ok": true}`)
	} else {
		fmt.Printf("Reacted with :%s: on %s\n", emoji, id)
	}
	return nil
}
