package cmd

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/sestinj/agentduty/cli/internal/tui"
	"github.com/spf13/cobra"
)

var feedCmd = &cobra.Command{
	Use:   "feed",
	Short: "Live feed of pending notifications",
	RunE:  runFeed,
}

func init() {
	rootCmd.AddCommand(feedCmd)
}

func runFeed(cmd *cobra.Command, args []string) error {
	m := tui.NewModel(gqlClient)
	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		return fmt.Errorf("feed: %w", err)
	}
	return nil
}
