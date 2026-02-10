package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/sestinj/agentduty/cli/internal/config"
)

const workosClientID = "client_01KFE40Z1FZ1NJQKHTNNPPWZ3C"

type Client struct {
	URL        string
	HTTPClient *http.Client
	token      string
	cfg        *config.Config
}

type graphqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables,omitempty"`
}

type graphqlResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphqlError  `json:"errors,omitempty"`
}

type graphqlError struct {
	Message string `json:"message"`
}

func New(apiURL string, cfg *config.Config) *Client {
	token := cfg.AccessToken
	// Env var takes priority over stored token.
	if key := os.Getenv("AGENTDUTY_API_KEY"); key != "" {
		token = key
	}
	return &Client{
		URL:        apiURL,
		HTTPClient: &http.Client{},
		token:      token,
		cfg:        cfg,
	}
}

func (c *Client) Do(query string, variables map[string]any) (json.RawMessage, error) {
	data, err := c.doRequest(query, variables)
	if err != nil && c.cfg.RefreshToken != "" && isAuthError(err) {
		// Try refreshing the token.
		if refreshErr := c.refreshToken(); refreshErr == nil {
			return c.doRequest(query, variables)
		}
	}
	return data, err
}

func (c *Client) doRequest(query string, variables map[string]any) (json.RawMessage, error) {
	body, err := json.Marshal(graphqlRequest{Query: query, Variables: variables})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.URL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, string(respBody))
	}

	var gqlResp graphqlResponse
	if err := json.Unmarshal(respBody, &gqlResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if len(gqlResp.Errors) > 0 {
		return nil, fmt.Errorf("graphql error: %s", gqlResp.Errors[0].Message)
	}

	return gqlResp.Data, nil
}

func isAuthError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "Unauthorized") || strings.Contains(msg, "Unexpected error")
}

func (c *Client) refreshToken() error {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", c.cfg.RefreshToken)
	form.Set("client_id", workosClientID)

	resp, err := http.Post(
		"https://api.workos.com/user_management/authenticate",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("refresh failed: %s", string(body))
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return err
	}

	// Update in-memory token.
	c.token = result.AccessToken

	// Persist new tokens.
	c.cfg.AccessToken = result.AccessToken
	if result.RefreshToken != "" {
		c.cfg.RefreshToken = result.RefreshToken
	}
	return config.Save(c.cfg)
}
