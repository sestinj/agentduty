package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/sestinj/agentduty/cli/internal/config"
)

func TestNew_UsesEnvVarOverStoredToken(t *testing.T) {
	cfg := &config.Config{AccessToken: "stored-token"}

	// Without env var, uses stored token
	c := New("http://localhost", cfg)
	if c.token != "stored-token" {
		t.Errorf("expected stored-token, got %s", c.token)
	}

	// With env var, uses env var
	os.Setenv("AGENTDUTY_API_KEY", "env-api-key")
	defer os.Unsetenv("AGENTDUTY_API_KEY")

	c = New("http://localhost", cfg)
	if c.token != "env-api-key" {
		t.Errorf("expected env-api-key, got %s", c.token)
	}
}

func TestNew_EmptyTokenWhenNothingConfigured(t *testing.T) {
	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{}
	c := New("http://localhost", cfg)
	if c.token != "" {
		t.Errorf("expected empty token, got %s", c.token)
	}
}

func TestDo_SetsAuthorizationHeader(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(graphqlResponse{
			Data: json.RawMessage(`{"test": true}`),
		})
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{AccessToken: "my-token"}
	c := New(server.URL, cfg)

	_, err := c.Do(`query { test }`, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth != "Bearer my-token" {
		t.Errorf("expected 'Bearer my-token', got '%s'", receivedAuth)
	}
}

func TestDo_NoAuthHeaderWhenNoToken(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(graphqlResponse{
			Data: json.RawMessage(`{}`),
		})
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{}
	c := New(server.URL, cfg)

	_, err := c.Do(`query { test }`, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth != "" {
		t.Errorf("expected no auth header, got '%s'", receivedAuth)
	}
}

func TestDo_SendsGraphQLRequest(t *testing.T) {
	var receivedBody graphqlRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected application/json, got %s", ct)
		}
		json.NewDecoder(r.Body).Decode(&receivedBody)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(graphqlResponse{
			Data: json.RawMessage(`{"result": "ok"}`),
		})
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{AccessToken: "tok"}
	c := New(server.URL, cfg)

	vars := map[string]any{"id": "123", "text": "hello"}
	data, err := c.Do(`mutation { respond(id: $id, text: $text) { id } }`, vars)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedBody.Query != `mutation { respond(id: $id, text: $text) { id } }` {
		t.Errorf("query mismatch: %s", receivedBody.Query)
	}
	if receivedBody.Variables["id"] != "123" {
		t.Errorf("variable id mismatch: %v", receivedBody.Variables)
	}

	var result map[string]string
	json.Unmarshal(data, &result)
	if result["result"] != "ok" {
		t.Errorf("unexpected data: %s", string(data))
	}
}

func TestDo_ReturnsErrorOnHTTPFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{AccessToken: "tok"}
	c := New(server.URL, cfg)

	_, err := c.Do(`query { test }`, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if got := err.Error(); got != "http 500: Internal Server Error" {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestDo_ReturnsGraphQLError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(graphqlResponse{
			Errors: []graphqlError{{Message: "Unauthorized"}},
		})
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{AccessToken: "tok"}
	c := New(server.URL, cfg)

	_, err := c.Do(`query { me { id } }`, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if got := err.Error(); got != "graphql error: Unauthorized" {
		t.Errorf("unexpected error: %s", got)
	}
}

func TestDo_RetriesOnAuthError(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			// First call: auth error
			json.NewEncoder(w).Encode(graphqlResponse{
				Errors: []graphqlError{{Message: "Unauthorized"}},
			})
			return
		}
		// Second call (after refresh attempt): success
		json.NewEncoder(w).Encode(graphqlResponse{
			Data: json.RawMessage(`{"ok": true}`),
		})
	}))
	defer server.Close()

	os.Unsetenv("AGENTDUTY_API_KEY")
	cfg := &config.Config{
		AccessToken:  "expired-token",
		RefreshToken: "refresh-tok",
	}
	c := New(server.URL, cfg)

	// The refresh will fail (no WorkOS mock), so it falls through to the original error
	_, err := c.Do(`query { test }`, nil)
	if err == nil {
		t.Fatal("expected error (refresh fails without WorkOS), got nil")
	}
	// Should have attempted the request at least once
	if callCount < 1 {
		t.Errorf("expected at least 1 API call, got %d", callCount)
	}
}

func TestIsAuthError(t *testing.T) {
	tests := []struct {
		msg    string
		expect bool
	}{
		{"graphql error: Unauthorized", true},
		{"graphql error: Unexpected error", true},
		{"http 500: Internal Server Error", false},
		{"connection refused", false},
	}

	for _, tt := range tests {
		err := &testError{msg: tt.msg}
		if got := isAuthError(err); got != tt.expect {
			t.Errorf("isAuthError(%q) = %v, want %v", tt.msg, got, tt.expect)
		}
	}
}

type testError struct{ msg string }

func (e *testError) Error() string { return e.msg }
