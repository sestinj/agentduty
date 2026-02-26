package tui

import (
	"strings"
	"testing"
	"time"
)

func TestMinSplitWidth(t *testing.T) {
	if minSplitWidth != 90 {
		t.Errorf("expected minSplitWidth=90, got %d", minSplitWidth)
	}
}

func TestVisibleItems_HidesHiddenAndSortsSkipped(t *testing.T) {
	m := Model{
		items: []feedNotification{
			{ID: "a", ShortCode: "AAA"},
			{ID: "b", ShortCode: "BBB"},
			{ID: "c", ShortCode: "CCC"},
			{ID: "d", ShortCode: "DDD"},
		},
		hidden:  map[string]bool{"b": true},
		skipped: map[string]bool{"a": true},
	}

	visible := m.visibleItems()
	if len(visible) != 3 {
		t.Fatalf("expected 3 visible items, got %d", len(visible))
	}

	// Non-skipped items first, then skipped
	if visible[0].ID != "c" {
		t.Errorf("expected first visible item to be 'c', got '%s'", visible[0].ID)
	}
	if visible[1].ID != "d" {
		t.Errorf("expected second visible item to be 'd', got '%s'", visible[1].ID)
	}
	// Skipped item last
	if visible[2].ID != "a" {
		t.Errorf("expected last visible item (skipped) to be 'a', got '%s'", visible[2].ID)
	}
}

func TestVisibleItems_AllHidden(t *testing.T) {
	m := Model{
		items: []feedNotification{
			{ID: "a"},
			{ID: "b"},
		},
		hidden:  map[string]bool{"a": true, "b": true},
		skipped: map[string]bool{},
	}

	visible := m.visibleItems()
	if len(visible) != 0 {
		t.Errorf("expected 0 visible items, got %d", len(visible))
	}
}

func TestFocusedItem_ValidCursor(t *testing.T) {
	m := Model{
		items: []feedNotification{
			{ID: "a", ShortCode: "AAA"},
			{ID: "b", ShortCode: "BBB"},
		},
		cursor:  1,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	item := m.focusedItem()
	if item == nil {
		t.Fatal("expected focused item, got nil")
	}
	if item.ID != "b" {
		t.Errorf("expected focused item 'b', got '%s'", item.ID)
	}
}

func TestFocusedItem_OutOfRange(t *testing.T) {
	m := Model{
		items:   []feedNotification{{ID: "a"}},
		cursor:  5,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	if m.focusedItem() != nil {
		t.Error("expected nil for out-of-range cursor")
	}
}

func TestFocusedItem_EmptyList(t *testing.T) {
	m := Model{
		items:   nil,
		cursor:  0,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	if m.focusedItem() != nil {
		t.Error("expected nil for empty list")
	}
}

func TestView_UseSplitLayout(t *testing.T) {
	m := Model{
		items: []feedNotification{
			{ID: "a", ShortCode: "AAA", Message: "Hello", Priority: 3, CreatedAt: time.Now().Format(time.RFC3339)},
		},
		cursor:  0,
		width:   120,
		height:  30,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	view := m.View()
	// Split pane should show the detail panel (priority rendered)
	if !strings.Contains(view, "AgentDuty Feed") {
		t.Error("view should contain title")
	}
	if !strings.Contains(view, "Priority 3") {
		t.Error("split pane should render detail panel with priority")
	}
}

func TestView_SingleColumnLayout(t *testing.T) {
	m := Model{
		items: []feedNotification{
			{ID: "a", ShortCode: "AAA", Message: "Hello", Priority: 3, CreatedAt: time.Now().Format(time.RFC3339)},
		},
		cursor:  0,
		width:   60, // below minSplitWidth of 90
		height:  30,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	view := m.View()
	if !strings.Contains(view, "AgentDuty Feed") {
		t.Error("view should contain title")
	}
	// Single column shows card with P3 badge
	if !strings.Contains(view, "P3") {
		t.Error("single column should render card with P3 badge")
	}
}

func TestView_EmptyFeed(t *testing.T) {
	m := Model{
		items:   nil,
		cursor:  0,
		width:   120,
		height:  30,
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	view := m.View()
	if !strings.Contains(view, "No pending notifications") {
		t.Error("should show 'no pending notifications' message")
	}
}

func TestView_Loading(t *testing.T) {
	m := Model{
		width:   0, // not yet received window size
		hidden:  map[string]bool{},
		skipped: map[string]bool{},
	}

	view := m.View()
	if view != "Loading..." {
		t.Errorf("expected 'Loading...', got %q", view)
	}
}

func TestFeedNotification_Age(t *testing.T) {
	tests := []struct {
		name      string
		createdAt string
		expected  string
	}{
		{
			name:      "just now",
			createdAt: time.Now().Format(time.RFC3339),
			expected:  "now",
		},
		{
			name:      "minutes ago",
			createdAt: time.Now().Add(-5 * time.Minute).Format(time.RFC3339),
			expected:  "5m ago",
		},
		{
			name:      "hours ago",
			createdAt: time.Now().Add(-3 * time.Hour).Format(time.RFC3339),
			expected:  "3h ago",
		},
		{
			name:      "days ago",
			createdAt: time.Now().Add(-48 * time.Hour).Format(time.RFC3339),
			expected:  "2d ago",
		},
		{
			name:      "invalid time",
			createdAt: "not-a-date",
			expected:  "?",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := feedNotification{CreatedAt: tt.createdAt}
			if got := n.Age(); got != tt.expected {
				t.Errorf("Age() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestWrapText(t *testing.T) {
	tests := []struct {
		input    string
		width    int
		expected string
	}{
		{"hello world", 20, "hello world"},
		{"hello world foo bar", 10, "hello\nworld foo\nbar"},
		{"", 10, ""},
		{"hello", 0, "hello"},
		{"a b c d e", 5, "a b c\nd e"},
	}

	for _, tt := range tests {
		got := wrapText(tt.input, tt.width)
		if got != tt.expected {
			t.Errorf("wrapText(%q, %d) = %q, want %q", tt.input, tt.width, got, tt.expected)
		}
	}
}

func TestTruncateText(t *testing.T) {
	tests := []struct {
		input    string
		max      int
		expected string
	}{
		{"hello", 10, "hello"},
		{"hello world", 5, "hell…"},
		{"hi", 1, "…"},
		{"abc\ndef", 10, "abc def"},
		{"  multiple   spaces  ", 20, "multiple spaces"},
	}

	for _, tt := range tests {
		got := truncateText(tt.input, tt.max)
		if got != tt.expected {
			t.Errorf("truncateText(%q, %d) = %q, want %q", tt.input, tt.max, got, tt.expected)
		}
	}
}

