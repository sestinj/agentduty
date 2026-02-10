package config

import (
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

type Config struct {
	APIUrl       string `mapstructure:"api_url" yaml:"api_url"`
	AccessToken  string `mapstructure:"access_token" yaml:"access_token"`
	RefreshToken string `mapstructure:"refresh_token" yaml:"refresh_token"`
}

func ConfigDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".agentduty")
}

func ConfigPath() string {
	return filepath.Join(ConfigDir(), "config.yaml")
}

func Load() (*Config, error) {
	dir := ConfigDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(dir)

	viper.SetDefault("api_url", "https://agentduty.dev/api/graphql")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, err
		}
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func Save(cfg *Config) error {
	dir := ConfigDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	viper.Set("api_url", cfg.APIUrl)
	viper.Set("access_token", cfg.AccessToken)
	viper.Set("refresh_token", cfg.RefreshToken)

	return viper.WriteConfigAs(ConfigPath())
}
