package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
)

var connectCmd = &cobra.Command{
	Use:   "connect <service>",
	Short: "Connect an external service to your account",
	Args:  cobra.ExactArgs(1),
	RunE:  runConnect,
}

func init() {
	rootCmd.AddCommand(connectCmd)
}

func runConnect(cmd *cobra.Command, args []string) error {
	service := args[0]

	switch service {
	case "slack":
		return connectSlack()
	default:
		return fmt.Errorf("unknown service: %s (supported: slack)", service)
	}
}

func connectSlack() error {
	// Check if already connected
	checkQuery := `query { slackConnected }`
	data, err := gqlClient.Do(checkQuery, nil)
	if err != nil {
		return fmt.Errorf("check connection: %w", err)
	}

	var checkResult struct {
		SlackConnected bool `json:"slackConnected"`
	}
	if err := json.Unmarshal(data, &checkResult); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if checkResult.SlackConnected {
		fmt.Println("Your Slack account is already connected.")
		return nil
	}

	// Generate link code
	genQuery := `mutation { generateSlackLinkCode }`
	data, err = gqlClient.Do(genQuery, nil)
	if err != nil {
		return fmt.Errorf("generate link code: %w", err)
	}

	var genResult struct {
		GenerateSlackLinkCode string `json:"generateSlackLinkCode"`
	}
	if err := json.Unmarshal(data, &genResult); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	code := genResult.GenerateSlackLinkCode

	// Get user ID for the install URL
	meQuery := `query { me { id } }`
	meData, _ := gqlClient.Do(meQuery, nil)
	userId := ""
	if meData != nil {
		var meResult struct {
			Me struct {
				ID string `json:"id"`
			} `json:"me"`
		}
		if json.Unmarshal(meData, &meResult) == nil {
			userId = meResult.Me.ID
		}
	}

	baseURL := "https://www.agentduty.dev"
	installURL := fmt.Sprintf("%s/auth/slack/install?user_id=%s", baseURL, userId)

	fmt.Println("Step 1: Install the AgentDuty Slack app in your workspace")
	fmt.Println("  (skip if already installed)")
	fmt.Println()
	fmt.Printf("  %s\n", installURL)
	fmt.Println()

	// Try to open browser
	openBrowser(installURL)

	fmt.Println("Step 2: DM this code to the AgentDuty bot in Slack:")
	fmt.Println()
	fmt.Printf("  %s\n", code)
	fmt.Println()
	fmt.Println("The code expires in 15 minutes.")
	fmt.Println("Waiting for you to link your account...")

	// Poll until connected
	deadline := time.After(15 * time.Minute)
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			fmt.Fprintln(os.Stderr, "Link code expired. Run 'agentduty connect slack' again.")
			os.Exit(1)
		case <-ticker.C:
			data, err := gqlClient.Do(checkQuery, nil)
			if err != nil {
				continue
			}
			var result struct {
				SlackConnected bool `json:"slackConnected"`
			}
			if err := json.Unmarshal(data, &result); err != nil {
				continue
			}
			if result.SlackConnected {
				fmt.Println("Connected! You'll now receive notifications via Slack DM.")
				return nil
			}
		}
	}
}

