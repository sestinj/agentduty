package output

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"
)

type Notification struct {
	ID        string     `json:"id"`
	ShortCode string     `json:"shortCode"`
	Status    string     `json:"status"`
	Priority  int        `json:"priority"`
	Message   string     `json:"message"`
	Options   []string   `json:"options,omitempty"`
	Channels  []string   `json:"channels,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	Responses []Response `json:"responses,omitempty"`
	Response  *Response  `json:"response,omitempty"`
}

func (n *Notification) FirstResponse() *Response {
	if n.Response != nil {
		return n.Response
	}
	if len(n.Responses) > 0 {
		return &n.Responses[0]
	}
	return nil
}

type Response struct {
	Text           string `json:"text"`
	SelectedOption string `json:"selectedOption,omitempty"`
	Channel        string `json:"channel"`
	CreatedAt      string `json:"createdAt"`
}

func PrintJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

func PrintNotificationCreated(n Notification) {
	fmt.Printf("Notification sent: %s\n", n.ShortCode)
	fmt.Printf("Priority: %d | Status: %s\n", n.Priority, n.Status)
	fmt.Printf("Poll: agentduty poll %s\n", n.ShortCode)
}

func PrintNotification(n Notification) {
	fmt.Printf("ID:       %s\n", n.ShortCode)
	fmt.Printf("Status:   %s\n", n.Status)
	fmt.Printf("Priority: %d\n", n.Priority)
	fmt.Printf("Message:  %s\n", n.Message)
	if len(n.Options) > 0 {
		fmt.Printf("Options:  %s\n", strings.Join(n.Options, ", "))
	}
	if r := n.FirstResponse(); r != nil {
		fmt.Println()
		fmt.Printf("Response: %s\n", r.Text)
		if r.SelectedOption != "" {
			fmt.Printf("Selected: %s\n", r.SelectedOption)
		}
		fmt.Printf("Channel:  %s\n", r.Channel)
	}
}

func PrintNotifications(notifications []Notification) {
	if len(notifications) == 0 {
		fmt.Println("No active notifications.")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tPRIORITY\tMESSAGE\tSTATUS\tAGE")
	for _, n := range notifications {
		msg := n.Message
		if len(msg) > 50 {
			msg = msg[:47] + "..."
		}
		age := formatAge(time.Since(n.CreatedAt))
		fmt.Fprintf(w, "%s\t%d\t%s\t%s\t%s\n", n.ShortCode, n.Priority, msg, n.Status, age)
	}
	w.Flush()
}

func PrintResponse(r Response) {
	fmt.Printf("Response: %s\n", r.Text)
	if r.SelectedOption != "" {
		fmt.Printf("Selected: %s\n", r.SelectedOption)
	}
	fmt.Printf("Channel:  %s\n", r.Channel)
}

func formatAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}
