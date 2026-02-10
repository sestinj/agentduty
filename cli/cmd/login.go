package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/sestinj/agentduty/cli/internal/config"
	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with AgentDuty",
	RunE:  runLogin,
}

func init() {
	rootCmd.AddCommand(loginCmd)
}

type deviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error,omitempty"`
}

func runLogin(cmd *cobra.Command, args []string) error {
	// Step 1: Request device codes.
	deviceResp, err := requestDeviceCodes()
	if err != nil {
		return fmt.Errorf("device code request: %w", err)
	}

	// Step 2: Display code and open browser.
	fmt.Printf("Enter code %s at %s\n", deviceResp.UserCode, deviceResp.VerificationURI)
	fmt.Println("Opening browser...")

	openBrowser(deviceResp.VerificationURI)

	// Step 3: Poll for token.
	fmt.Println("Waiting for authentication...")

	token, err := pollForToken(deviceResp.DeviceCode, time.Duration(deviceResp.ExpiresIn)*time.Second)
	if err != nil {
		return fmt.Errorf("authentication: %w", err)
	}

	// Step 4: Store tokens.
	cfg.AccessToken = token.AccessToken
	cfg.RefreshToken = token.RefreshToken
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	fmt.Println("Logged in successfully.")
	return nil
}

func requestDeviceCodes() (*deviceCodeResponse, error) {
	body, _ := json.Marshal(map[string]string{
		"client_id": "agentduty-cli",
	})

	resp, err := http.Post(
		"https://auth.agentduty.dev/user_management/authorize/device",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, string(respBody))
	}

	var result deviceCodeResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}

	if result.VerificationURI == "" {
		result.VerificationURI = "https://auth.agentduty.dev/verify"
	}
	if result.ExpiresIn == 0 {
		result.ExpiresIn = 300
	}
	if result.Interval == 0 {
		result.Interval = 5
	}

	return &result, nil
}

func pollForToken(deviceCode string, expires time.Duration) (*tokenResponse, error) {
	deadline := time.After(expires)
	interval := 5 * time.Second

	for {
		select {
		case <-deadline:
			return nil, fmt.Errorf("authentication timed out")
		case <-time.After(interval):
		}

		body, _ := json.Marshal(map[string]string{
			"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
			"device_code": deviceCode,
			"client_id":   "agentduty-cli",
		})

		resp, err := http.Post(
			"https://auth.agentduty.dev/user_management/authenticate/device",
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			return nil, err
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var token tokenResponse
		if err := json.Unmarshal(respBody, &token); err != nil {
			return nil, err
		}

		switch token.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "":
			if token.AccessToken != "" {
				return &token, nil
			}
			continue
		default:
			return nil, fmt.Errorf("%s", token.Error)
		}
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	}
	if cmd != nil {
		cmd.Start()
	}
}
