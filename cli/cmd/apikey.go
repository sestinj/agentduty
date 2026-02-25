package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/sestinj/agentduty/cli/internal/config"
	"github.com/sestinj/agentduty/cli/internal/output"
	"github.com/spf13/cobra"
)

var apikeyCmd = &cobra.Command{
	Use:     "apikey",
	Aliases: []string{"key", "keys"},
	Short:   "Manage API keys",
}

var apikeyCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new API key",
	RunE:  runApikeyCreate,
}

var apikeyListCmd = &cobra.Command{
	Use:   "list",
	Short: "List API keys",
	RunE:  runApikeyList,
}

var apikeyRevokeCmd = &cobra.Command{
	Use:   "revoke <id>",
	Short: "Revoke an API key",
	Args:  cobra.ExactArgs(1),
	RunE:  runApikeyRevoke,
}

func init() {
	apikeyCreateCmd.Flags().StringP("name", "n", "", "Name for the API key")
	apikeyCreateCmd.Flags().Bool("save", false, "Save the key to config (replaces current auth)")

	apikeyCmd.AddCommand(apikeyCreateCmd)
	apikeyCmd.AddCommand(apikeyListCmd)
	apikeyCmd.AddCommand(apikeyRevokeCmd)
	rootCmd.AddCommand(apikeyCmd)
}

func runApikeyCreate(cmd *cobra.Command, args []string) error {
	name, _ := cmd.Flags().GetString("name")
	save, _ := cmd.Flags().GetBool("save")

	if name == "" {
		name = "cli"
	}

	const query = `mutation CreateApiKey($name: String!) {
		createApiKey(name: $name) {
			key
			id
			prefix
		}
	}`

	data, err := gqlClient.Do(query, map[string]any{"name": name})
	if err != nil {
		return fmt.Errorf("create API key: %w", err)
	}

	var result struct {
		CreateApiKey struct {
			Key    string `json:"key"`
			ID     string `json:"id"`
			Prefix string `json:"prefix"`
		} `json:"createApiKey"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	k := result.CreateApiKey

	if jsonFlag {
		output.PrintJSON(k)
		return nil
	}

	fmt.Println("API key created. Save it now — you won't see it again.")
	fmt.Println()
	fmt.Println(k.Key)
	fmt.Println()
	fmt.Printf("Use: export AGENTDUTY_API_KEY='%s'\n", k.Key)

	if save {
		cfg.AccessToken = k.Key
		cfg.RefreshToken = "" // API keys don't use refresh tokens
		if err := config.Save(cfg); err != nil {
			return fmt.Errorf("save config: %w", err)
		}
		fmt.Println()
		fmt.Println("Saved to config. Future commands will use this key.")
	}

	return nil
}

func runApikeyList(cmd *cobra.Command, args []string) error {
	const query = `query {
		apiKeys {
			id
			name
			keyPrefix
			lastUsedAt
			createdAt
		}
	}`

	data, err := gqlClient.Do(query, nil)
	if err != nil {
		return fmt.Errorf("list API keys: %w", err)
	}

	var result struct {
		ApiKeys []struct {
			ID         string  `json:"id"`
			Name       string  `json:"name"`
			KeyPrefix  string  `json:"keyPrefix"`
			LastUsedAt *string `json:"lastUsedAt"`
			CreatedAt  string  `json:"createdAt"`
		} `json:"apiKeys"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if jsonFlag {
		output.PrintJSON(result.ApiKeys)
		return nil
	}

	if len(result.ApiKeys) == 0 {
		fmt.Println("No API keys.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME\tPREFIX\tLAST USED\tCREATED")
	for _, k := range result.ApiKeys {
		lastUsed := "never"
		if k.LastUsedAt != nil {
			lastUsed = *k.LastUsedAt
		}
		fmt.Fprintf(w, "%s\t%s\t%s…\t%s\t%s\n", k.ID, k.Name, k.KeyPrefix, lastUsed, k.CreatedAt)
	}
	w.Flush()
	return nil
}

func runApikeyRevoke(cmd *cobra.Command, args []string) error {
	id := args[0]

	const query = `mutation RevokeApiKey($id: String!) {
		revokeApiKey(id: $id)
	}`

	data, err := gqlClient.Do(query, map[string]any{"id": id})
	if err != nil {
		return fmt.Errorf("revoke API key: %w", err)
	}

	var result struct {
		RevokeApiKey bool `json:"revokeApiKey"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	if result.RevokeApiKey {
		fmt.Println("API key revoked.")
	} else {
		fmt.Println("API key not found.")
	}
	return nil
}
