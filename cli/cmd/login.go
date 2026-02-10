package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/sestinj/agentduty/cli/internal/config"
	"github.com/spf13/cobra"
)

const workosClientID = "client_01KFE40Z1FZ1NJQKHTNNPPWZ3C"

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with AgentDuty",
	RunE:  runLogin,
}

func init() {
	rootCmd.AddCommand(loginCmd)
}

type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	User         interface{} `json:"user,omitempty"`
	Error        string      `json:"error,omitempty"`
}

func runLogin(cmd *cobra.Command, args []string) error {
	// Step 1: Request device authorization from WorkOS.
	deviceResp, err := requestDeviceCodes()
	if err != nil {
		return fmt.Errorf("device code request: %w", err)
	}

	// Step 2: Display code and open browser.
	fmt.Printf("\nEnter code %s at %s\n\n", deviceResp.UserCode, deviceResp.VerificationURI)

	if deviceResp.VerificationURIComplete != "" {
		fmt.Println("Opening browser...")
		openBrowser(deviceResp.VerificationURIComplete)
	}

	// Step 3: Poll for token.
	fmt.Println("Waiting for authentication...")

	interval := deviceResp.Interval
	if interval == 0 {
		interval = 5
	}
	expiresIn := deviceResp.ExpiresIn
	if expiresIn == 0 {
		expiresIn = 300
	}

	token, err := pollForToken(deviceResp.DeviceCode, interval, time.Duration(expiresIn)*time.Second)
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
	form := url.Values{}
	form.Set("client_id", workosClientID)

	resp, err := http.Post(
		"https://api.workos.com/user_management/authorize/device",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()),
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

	return &result, nil
}

func pollForToken(deviceCode string, interval int, expires time.Duration) (*tokenResponse, error) {
	deadline := time.After(expires)

	for {
		select {
		case <-deadline:
			return nil, fmt.Errorf("authentication timed out")
		case <-time.After(time.Duration(interval) * time.Second):
		}

		form := url.Values{}
		form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
		form.Set("device_code", deviceCode)
		form.Set("client_id", workosClientID)

		resp, err := http.Post(
			"https://api.workos.com/user_management/authenticate",
			"application/x-www-form-urlencoded",
			strings.NewReader(form.Encode()),
		)
		if err != nil {
			return nil, err
		}

		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			var token tokenResponse
			if err := json.Unmarshal(respBody, &token); err != nil {
				return nil, err
			}
			if token.AccessToken != "" {
				return &token, nil
			}
		}

		// Parse error response.
		var errResp struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(respBody, &errResp); err != nil {
			return nil, fmt.Errorf("unexpected response: %s", string(respBody))
		}

		switch errResp.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval++
			continue
		case "access_denied", "expired_token":
			return nil, fmt.Errorf("authorization failed: %s", errResp.Error)
		default:
			if errResp.Error != "" {
				return nil, fmt.Errorf("authorization failed: %s", errResp.Error)
			}
			continue
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
