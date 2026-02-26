package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"
)

func resetViper() {
	viper.Reset()
}

func TestConfigDir_ReturnsHomeSubdir(t *testing.T) {
	dir := ConfigDir()
	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, ".agentduty")
	if dir != expected {
		t.Errorf("expected %s, got %s", expected, dir)
	}
}

func TestConfigPath_ReturnsYamlPath(t *testing.T) {
	path := ConfigPath()
	if filepath.Base(path) != "config.yaml" {
		t.Errorf("expected config.yaml, got %s", filepath.Base(path))
	}
	if filepath.Dir(path) != ConfigDir() {
		t.Errorf("expected dir %s, got %s", ConfigDir(), filepath.Dir(path))
	}
}

func TestLoadAndSave_RoundTrip(t *testing.T) {
	resetViper()
	tmpDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", origHome)

	cfg := &Config{
		APIUrl:       "https://test.example.com/api/graphql",
		AccessToken:  "test-access-token",
		RefreshToken: "test-refresh-token",
	}

	err := Save(cfg)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify file was created
	configFile := filepath.Join(tmpDir, ".agentduty", "config.yaml")
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		t.Fatal("config file was not created")
	}

	content, err := os.ReadFile(configFile)
	if err != nil {
		t.Fatalf("failed to read config file: %v", err)
	}

	contentStr := string(content)
	if !strings.Contains(contentStr, "test-access-token") {
		t.Errorf("config file doesn't contain access token: %s", contentStr)
	}
	if !strings.Contains(contentStr, "test-refresh-token") {
		t.Errorf("config file doesn't contain refresh token: %s", contentStr)
	}
	if !strings.Contains(contentStr, "https://test.example.com/api/graphql") {
		t.Errorf("config file doesn't contain API URL: %s", contentStr)
	}
}

func TestLoad_DefaultAPIUrl(t *testing.T) {
	resetViper()
	tmpDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", origHome)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if cfg.APIUrl != "https://www.agentduty.dev/api/graphql" {
		t.Errorf("expected default API URL, got %s", cfg.APIUrl)
	}
}

func TestLoad_CreatesConfigDir(t *testing.T) {
	resetViper()
	tmpDir := t.TempDir()
	origHome := os.Getenv("HOME")
	os.Setenv("HOME", tmpDir)
	defer os.Setenv("HOME", origHome)

	_, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	configDir := filepath.Join(tmpDir, ".agentduty")
	info, err := os.Stat(configDir)
	if os.IsNotExist(err) {
		t.Fatal("config directory was not created")
	}
	if !info.IsDir() {
		t.Fatal("config path is not a directory")
	}
}
