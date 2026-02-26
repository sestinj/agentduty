package tui

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/sestinj/agentduty/cli/internal/client"
)

const activeFeedQuery = `query ActiveFeed {
	activeFeed {
		id
		shortCode
		message
		priority
		options
		status
		createdAt
		snoozedUntil
		responses {
			text
			selectedOption
			channel
			createdAt
		}
	}
}`

const respondMutation = `mutation RespondToNotification($id: String!, $text: String, $selectedOption: String) {
	respondToNotification(id: $id, text: $text, selectedOption: $selectedOption) {
		id
		status
	}
}`

const archiveMutation = `mutation ArchiveNotification($id: String!) {
	archiveNotification(id: $id) {
		id
		status
	}
}`

const archiveAllMutation = `mutation ArchiveAllNotifications {
	archiveAllNotifications
}`

const snoozeMutation = `mutation SnoozeNotification($id: String!, $minutes: Int!) {
	snoozeNotification(id: $id, minutes: $minutes) {
		id
		snoozedUntil
	}
}`

type feedNotification struct {
	ID           string   `json:"id"`
	ShortCode    string   `json:"shortCode"`
	Message      string   `json:"message"`
	Priority     int      `json:"priority"`
	Options      []string `json:"options"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"createdAt"`
	SnoozedUntil *string  `json:"snoozedUntil"`
}

func (n feedNotification) Age() string {
	t, err := time.Parse(time.RFC3339, n.CreatedAt)
	if err != nil {
		return "?"
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

func fetchActiveFeed(c *client.Client) ([]feedNotification, error) {
	data, err := c.Do(activeFeedQuery, nil)
	if err != nil {
		return nil, err
	}

	var result struct {
		ActiveFeed []feedNotification `json:"activeFeed"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result.ActiveFeed, nil
}

func submitResponse(c *client.Client, id string, text *string, selectedOption *string) error {
	vars := map[string]any{"id": id}
	if text != nil {
		vars["text"] = *text
	}
	if selectedOption != nil {
		vars["selectedOption"] = *selectedOption
	}
	_, err := c.Do(respondMutation, vars)
	return err
}

func snoozeNotification(c *client.Client, id string, minutes int) error {
	vars := map[string]any{"id": id, "minutes": minutes}
	_, err := c.Do(snoozeMutation, vars)
	return err
}

func archiveNotificationReq(c *client.Client, id string) error {
	vars := map[string]any{"id": id}
	_, err := c.Do(archiveMutation, vars)
	return err
}

func archiveAllNotificationsReq(c *client.Client) (int, error) {
	data, err := c.Do(archiveAllMutation, nil)
	if err != nil {
		return 0, err
	}
	var result struct {
		ArchiveAllNotifications int `json:"archiveAllNotifications"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return 0, err
	}
	return result.ArchiveAllNotifications, nil
}
