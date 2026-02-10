package cmd

import (
	"fmt"
	"os"

	"github.com/sestinj/agentduty/cli/internal/client"
	"github.com/sestinj/agentduty/cli/internal/config"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	cfg       *config.Config
	gqlClient *client.Client
	jsonFlag  bool

	// Set via ldflags at build time.
	version = "dev"
)

var rootCmd = &cobra.Command{
	Use:     "agentduty",
	Short:   "AgentDuty CLI - notifications for AI agents",
	Version: version,
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		var err error
		cfg, err = config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		apiURL := viper.GetString("api_url")
		if u, _ := cmd.Flags().GetString("api-url"); u != "" {
			apiURL = u
		}
		cfg.APIUrl = apiURL

		gqlClient = client.New(cfg.APIUrl, cfg.AccessToken)
		return nil
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().String("api-url", "https://agentduty.dev/api/graphql", "API endpoint URL")
	rootCmd.PersistentFlags().BoolVar(&jsonFlag, "json", false, "Output as JSON")
}
