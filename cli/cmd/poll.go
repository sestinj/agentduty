package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
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

const getSessionHistoryQuery = `query SessionHistory($sessionKey: String!) {
	sessionHistory(sessionKey: $sessionKey) {
		sessionId
		workspace
		notifications {
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

func fetchSessionHistory(sessionKey string) (*output.SessionHistory, error) {
	data, err := gqlClient.Do(getSessionHistoryQuery, map[string]any{"sessionKey": sessionKey})
	if err != nil {
		return nil, fmt.Errorf("query session: %w", err)
	}

	var result struct {
		SessionHistory *output.SessionHistory `json:"sessionHistory"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("parse session: %w", err)
	}
	return result.SessionHistory, nil
}

// latestResponseTime returns the most recent response timestamp in the session.
func latestResponseTime(history *output.SessionHistory) string {
	latest := ""
	for _, n := range history.Notifications {
		for _, r := range n.Responses {
			if r.CreatedAt > latest {
				latest = r.CreatedAt
			}
		}
	}
	return latest
}

// collectResponsesAfter returns responses with CreatedAt after the given watermark.
func collectResponsesAfter(history *output.SessionHistory, watermark string) []output.ResponseWithContext {
	var result []output.ResponseWithContext
	for _, n := range history.Notifications {
		for i, r := range n.Responses {
			if r.CreatedAt > watermark {
				result = append(result, output.ResponseWithContext{
					Response:      r,
					ShortCode:     n.ShortCode,
					ResponseIndex: i + 1, // 1-based
				})
			}
		}
	}
	return result
}

// watermarkPath returns the path to the watermark file for this session.
func watermarkPath() string {
	workspace := resolveWorkspace()
	dir := filepath.Join(workspace, ".claude")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "agentduty-poll-watermark")
}

func readWatermark() string {
	data, err := os.ReadFile(watermarkPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func writeWatermark(ts string) {
	_ = os.WriteFile(watermarkPath(), []byte(ts), 0644)
}

// pollPidPath returns the path to the PID file for the current session.
// Uses the workspace .claude directory so the file is visible both inside
// and outside the Claude Code sandbox.
func pollPidPath() string {
	workspace := resolveWorkspace()
	sessionKey := generateSession(workspace)
	dir := filepath.Join(workspace, ".claude")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, fmt.Sprintf("agentduty-poll-%s.pid", sessionKey))
}

// writePollPid writes the current PID to the poll PID file.
func writePollPid() {
	_ = os.WriteFile(pollPidPath(), []byte(strconv.Itoa(os.Getpid())), 0644)
}

// removePollPid removes the poll PID file.
func removePollPid() {
	_ = os.Remove(pollPidPath())
}

// IsPollRunning checks if a poll process is currently running for this session.
func IsPollRunning() bool {
	data, err := os.ReadFile(pollPidPath())
	if err != nil {
		return false
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return false
	}

	// Check if the process is still alive.
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// Signal 0 checks if process exists without sending a signal.
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func pollForResponse(id string, timeout time.Duration, asJSON bool) error {
	// Write PID file so the stop hook knows a poll is running.
	writePollPid()
	defer removePollPid()

	workspace := resolveWorkspace()
	sessionKey := generateSession(workspace)

	backoff := []time.Duration{
		500 * time.Millisecond,
		1 * time.Second,
		2 * time.Second,
		3 * time.Second,
		5 * time.Second,
	}

	deadline := time.After(timeout)
	attempt := 0

	// Use a persisted watermark so we never re-report old responses.
	watermark := readWatermark()
	if watermark == "" {
		// No watermark yet — set it to now so we only see future responses.
		history, err := fetchSessionHistory(sessionKey)
		if err == nil && history != nil {
			watermark = latestResponseTime(history)
			if watermark != "" {
				writeWatermark(watermark)
			}
		}
	}

	for {
		// Poll the full session to catch responses to any notification.
		history, err := fetchSessionHistory(sessionKey)
		if err != nil {
			// Fall back to single-notification poll if session query fails.
			n, nerr := fetchNotification(id)
			if nerr != nil {
				fmt.Fprintf(os.Stderr, "Error: %v\n", nerr)
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
		} else if history != nil {
			newResponses := collectResponsesAfter(history, watermark)
			if len(newResponses) > 0 {
				for _, r := range newResponses {
					if asJSON {
						output.PrintJSON(r)
					} else {
						output.PrintResponseWithContext(r)
					}
					// Advance watermark
					if r.Response.CreatedAt > watermark {
						watermark = r.Response.CreatedAt
					}
				}
				writeWatermark(watermark)
				os.Exit(0)
			}
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
