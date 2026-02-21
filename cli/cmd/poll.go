package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var pollCmd = &cobra.Command{
	Use:   "poll <id>",
	Short: "Poll a notification for responses",
	Args:  cobra.ExactArgs(1),
	RunE:  runPoll,
}

func init() {
	pollCmd.Flags().Bool("wait", false, "Wait for response")
	pollCmd.Flags().Duration("timeout", 30*time.Minute, "Timeout when waiting")

	rootCmd.AddCommand(pollCmd)
}

const getNotificationQuery = `query GetNotification($id: String!) {
	notification(id: $id) {
		id
		shortCode
		status
		priority
		message
		options
		createdAt
		responses {
			text
			selectedOption
			channel
			createdAt
		}
	}
}`

func runPoll(cmd *cobra.Command, args []string) error {
	id := args[0]
	wait, _ := cmd.Flags().GetBool("wait")
	timeout, _ := cmd.Flags().GetDuration("timeout")

	if !wait {
		return queryAndPrint(id)
	}

	return pollForResponse(id, timeout, jsonFlag)
}

func queryAndPrint(id string) error {
	n, err := fetchNotification(id)
	if err != nil {
		return err
	}

	if jsonFlag {
		output.PrintJSON(n)
	} else {
		output.PrintNotification(n)
	}
	return nil
}

func fetchNotification(id string) (output.Notification, error) {
	data, err := gqlClient.Do(getNotificationQuery, map[string]any{"id": id})
	if err != nil {
		return output.Notification{}, fmt.Errorf("query notification: %w", err)
	}

	var result struct {
		Notification output.Notification `json:"notification"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return output.Notification{}, fmt.Errorf("parse response: %w", err)
	}
	return result.Notification, nil
}

func pollForResponse(id string, timeout time.Duration, asJSON bool) error {
	backoff := []time.Duration{
		500 * time.Millisecond,
		1 * time.Second,
		2 * time.Second,
		3 * time.Second,
		5 * time.Second,
	}

	deadline := time.After(timeout)
	attempt := 0

	for {
		n, err := fetchNotification(id)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(2)
		}

		if n.FirstResponse() != nil {
			if asJSON {
				output.PrintJSON(n)
			} else {
				output.PrintNotification(n)
			}
			os.Exit(0)
		}

		delay := backoff[len(backoff)-1]
		if attempt < len(backoff) {
			delay = backoff[attempt]
		}
		attempt++

		select {
		case <-deadline:
			fmt.Fprintln(os.Stderr, "Timeout waiting for response.")
			os.Exit(1)
		case <-time.After(delay):
			// continue polling
		}
	}
}
