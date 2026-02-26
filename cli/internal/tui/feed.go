package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/sestinj/agentduty/cli/internal/client"
)

type state int

const (
	stateBrowsing state = iota
	stateTextInput
	stateSnoozePicker
)

// Layout constants
const (
	minSplitWidth  = 90
	listPanelWidth = 36
	panelGap       = 1
)

// Messages

type feedRefreshedMsg struct {
	items []feedNotification
	err   error
}

type respondedMsg struct {
	id  string
	err error
}
type snoozedMsg struct {
	id  string
	err error
}
type archivedMsg struct {
	id  string
	err error
}
type archivedAllMsg struct {
	count int
	err   error
}

// Styles

var (
	accentBlue = lipgloss.Color("#3b82f6")
	dimColor   = lipgloss.Color("#6b7280")
	errorColor = lipgloss.Color("#ef4444")

	focusedBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(accentBlue).
			Padding(0, 1)

	normalBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#374151")).
			Padding(0, 1)

	skippedBorder = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("#374151")).
			Padding(0, 1).
			Foreground(dimColor)

	priorityStyles = map[int]lipgloss.Style{
		5: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#ef4444")), // red
		4: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#f97316")), // orange
		3: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#eab308")), // yellow
		2: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#3b82f6")), // blue
		1: lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#9ca3af")), // gray
	}

	metaStyle   = lipgloss.NewStyle().Foreground(dimColor)
	footerStyle = lipgloss.NewStyle().Foreground(dimColor)
	errorStyle  = lipgloss.NewStyle().Foreground(errorColor)

	detailPanelStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(accentBlue).
				Padding(1, 2)

	detailHeaderStyle = lipgloss.NewStyle().Bold(true).Foreground(accentBlue)
)

type Model struct {
	client   *client.Client
	items    []feedNotification
	cursor   int
	state    state
	textarea textarea.Model
	skipped  map[string]bool
	hidden   map[string]bool
	width    int
	height   int
	err      error
	status   string
}

func NewModel(c *client.Client) Model {
	ta := textarea.New()
	ta.Placeholder = "Type your response... (shift+enter for newline)"
	ta.CharLimit = 500
	ta.ShowLineNumbers = false
	ta.SetHeight(3)
	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.BlurredStyle.CursorLine = lipgloss.NewStyle()
	// Unbind enter from inserting newline — we handle enter as submit,
	// alt+enter as newline in handleKey.
	ta.KeyMap.InsertNewline = key.NewBinding(key.WithDisabled())

	return Model{
		client:   c,
		textarea: ta,
		skipped:  make(map[string]bool),
		hidden:   make(map[string]bool),
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(
		fetchFeed(m.client),
		tea.WindowSize(),
	)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case feedRefreshedMsg:
		if msg.err != nil {
			m.err = msg.err
		} else {
			m.items = msg.items
			m.err = nil
			// Reconcile hidden: remove IDs no longer in server response
			serverIDs := make(map[string]bool, len(msg.items))
			for _, n := range msg.items {
				serverIDs[n.ID] = true
			}
			for id := range m.hidden {
				if !serverIDs[id] {
					delete(m.hidden, id)
				}
			}
			if m.cursor >= len(m.visibleItems()) {
				m.cursor = max(0, len(m.visibleItems())-1)
			}
		}
		return m, scheduleRefresh()

	case respondedMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Error: %v", msg.err)
			// Unhide so the item reappears
			if msg.id != "" {
				delete(m.hidden, msg.id)
			}
		}
		return m, nil

	case snoozedMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Error: %v", msg.err)
			if msg.id != "" {
				delete(m.hidden, msg.id)
			}
		}
		return m, nil

	case archivedMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Error: %v", msg.err)
			if msg.id != "" {
				delete(m.hidden, msg.id)
			}
		}
		return m, nil

	case archivedAllMsg:
		if msg.err != nil {
			m.status = fmt.Sprintf("Error: %v", msg.err)
			// Clear hidden since we're rolling back
			m.hidden = make(map[string]bool)
		}
		return m, nil

	case tickMsg:
		return m, fetchFeed(m.client)

	case tea.KeyMsg:
		return m.handleKey(msg)
	}

	if m.state == stateTextInput {
		var cmd tea.Cmd
		m.textarea, cmd = m.textarea.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m Model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.state {
	case stateTextInput:
		switch msg.String() {
		case "esc":
			m.state = stateBrowsing
			m.textarea.Blur()
			m.textarea.Reset()
			m.status = ""
			return m, nil
		case "enter":
			text := strings.TrimSpace(m.textarea.Value())
			if text == "" {
				return m, nil
			}
			m.textarea.Reset()
			m.textarea.Blur()
			m.state = stateBrowsing
			n := m.focusedItem()
			if n == nil {
				return m, nil
			}
			m.hidden[n.ID] = true
			if m.cursor >= len(m.visibleItems()) {
				m.cursor = max(0, len(m.visibleItems())-1)
			}
			return m, submitResponseCmd(m.client, n.ID, &text, nil)
		case "alt+enter":
			// Insert a newline
			m.textarea.InsertString("\n")
			return m, nil
		default:
			var cmd tea.Cmd
			m.textarea, cmd = m.textarea.Update(msg)
			return m, cmd
		}

	case stateSnoozePicker:
		durations := []int{5, 15, 60, 240}
		switch msg.String() {
		case "1", "2", "3", "4":
			idx := int(msg.String()[0]-'0') - 1
			n := m.focusedItem()
			if n == nil {
				m.state = stateBrowsing
				return m, nil
			}
			m.state = stateBrowsing
			m.hidden[n.ID] = true
			if m.cursor >= len(m.visibleItems()) {
				m.cursor = max(0, len(m.visibleItems())-1)
			}
			return m, snoozeCmd(m.client, n.ID, durations[idx])
		case "esc":
			m.state = stateBrowsing
			m.status = ""
			return m, nil
		}
		return m, nil

	default: // stateBrowsing
		visible := m.visibleItems()
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil
		case "down", "j":
			if m.cursor < len(visible)-1 {
				m.cursor++
			}
			return m, nil
		case "enter":
			m.state = stateTextInput
			// Set textarea width based on layout mode
			if m.width >= minSplitWidth {
				rightInner := m.width - listPanelWidth - panelGap - 6 // border + padding
				m.textarea.SetWidth(max(rightInner, 20))
			} else {
				m.textarea.SetWidth(min(m.width-4, 80) - 4)
			}
			m.textarea.Focus()
			m.status = "Enter to send · Alt+Enter for newline · Esc to cancel"
			return m, m.textarea.Focus()
		case "s":
			n := m.focusedItem()
			if n != nil {
				m.skipped[n.ID] = true
				m.status = fmt.Sprintf("Skipped %s", n.ShortCode)
				// Skipped items move to the end of the list, so the cursor
				// now points at the next active item. Clamp if we were at the
				// end of the active (non-skipped) portion.
				active := 0
				for _, it := range m.items {
					if !m.hidden[it.ID] && !m.skipped[it.ID] {
						active++
					}
				}
				if m.cursor >= active && active > 0 {
					m.cursor = active - 1
				}
			}
			return m, nil
		case "z":
			n := m.focusedItem()
			if n != nil {
				m.state = stateSnoozePicker
				m.status = "Snooze: [1] 5m  [2] 15m  [3] 1h  [4] 4h  Esc cancel"
			}
			return m, nil
		case "a":
			n := m.focusedItem()
			if n != nil {
				m.hidden[n.ID] = true
				if m.cursor >= len(m.visibleItems()) {
					m.cursor = max(0, len(m.visibleItems())-1)
				}
				return m, archiveCmd(m.client, n.ID)
			}
			return m, nil
		case "A":
			if len(visible) > 0 {
				m.items = nil
				m.hidden = make(map[string]bool)
				m.cursor = 0
				return m, archiveAllCmd(m.client)
			}
			return m, nil
		default:
			// Number keys 1-9 for option selection
			if len(msg.String()) == 1 && msg.String()[0] >= '1' && msg.String()[0] <= '9' {
				idx := int(msg.String()[0]-'0') - 1
				n := m.focusedItem()
				if n != nil && idx < len(n.Options) {
					opt := n.Options[idx]
					m.hidden[n.ID] = true
					if m.cursor >= len(m.visibleItems()) {
						m.cursor = max(0, len(m.visibleItems())-1)
					}
					return m, submitResponseCmd(m.client, n.ID, nil, &opt)
				}
			}
			return m, nil
		}
	}
}

func (m Model) visibleItems() []feedNotification {
	var active, skipped []feedNotification
	for _, n := range m.items {
		if m.hidden[n.ID] {
			continue
		}
		if m.skipped[n.ID] {
			skipped = append(skipped, n)
		} else {
			active = append(active, n)
		}
	}
	return append(active, skipped...)
}

func (m Model) focusedItem() *feedNotification {
	visible := m.visibleItems()
	if m.cursor < 0 || m.cursor >= len(visible) {
		return nil
	}
	n := visible[m.cursor]
	return &n
}

func (m Model) View() string {
	if m.width == 0 {
		return "Loading..."
	}

	// Header
	title := lipgloss.NewStyle().Bold(true).Render("AgentDuty Feed")
	count := fmt.Sprintf(" (%d pending)", len(m.visibleItems()))
	header := title + metaStyle.Render(count)

	visible := m.visibleItems()
	footer := footerStyle.Render("↑↓ navigate · 1-9 option · enter reply · a archive · A archive all · s skip · z snooze · q quit")

	useSplit := m.width >= minSplitWidth
	if !useSplit {
		return m.viewSingleColumn(header, visible, footer)
	}
	return m.viewSplitPane(header, visible, footer)
}

func (m Model) viewSingleColumn(header string, visible []feedNotification, footer string) string {
	var b strings.Builder
	b.WriteString(header + "\n\n")

	if len(visible) == 0 && m.err == nil {
		b.WriteString(metaStyle.Render("  No pending notifications. Refreshing every 3s...\n"))
	}

	if m.err != nil {
		b.WriteString(errorStyle.Render(fmt.Sprintf("  Error: %v\n", m.err)))
	}

	// Calculate available height for cards
	headerLines := 2
	footerLines := 3
	availableHeight := m.height - headerLines - footerLines

	// Render cards
	cardWidth := min(m.width-4, 80)
	linesUsed := 0

	for i, n := range visible {
		card := m.renderCard(n, i == m.cursor, cardWidth)
		cardLines := strings.Count(card, "\n") + 1
		if linesUsed+cardLines > availableHeight && i > m.cursor {
			remaining := len(visible) - i
			b.WriteString(metaStyle.Render(fmt.Sprintf("  ... and %d more\n", remaining)))
			break
		}
		b.WriteString(card + "\n")
		linesUsed += cardLines + 1
	}

	// Status line
	if m.status != "" {
		b.WriteString("\n" + m.status + "\n")
	} else {
		b.WriteString("\n")
	}

	// Text input (shown in text input mode)
	if m.state == stateTextInput {
		b.WriteString(m.textarea.View() + "\n")
	}

	b.WriteString(footer)
	return b.String()
}

func (m Model) viewSplitPane(header string, visible []feedNotification, footer string) string {
	var b strings.Builder
	b.WriteString(header + "\n\n")

	if m.err != nil {
		b.WriteString(errorStyle.Render(fmt.Sprintf("  Error: %v\n", m.err)))
	}

	// Available height for the panels (subtract header + footer)
	headerLines := 2
	footerLines := 2
	panelHeight := m.height - headerLines - footerLines
	if panelHeight < 5 {
		panelHeight = 5
	}

	rightWidth := m.width - listPanelWidth - panelGap

	if len(visible) == 0 && m.err == nil {
		left := metaStyle.Render("  No pending notifications.\n  Refreshing every 3s...")
		b.WriteString(left + "\n")
		b.WriteString(footer)
		return b.String()
	}

	// Build left panel: compact card list with scrolling
	cardInnerWidth := listPanelWidth - 4 // border + padding
	linesPerCard := 3                    // top border + content + bottom border
	cardsPerPage := panelHeight / linesPerCard
	if cardsPerPage < 1 {
		cardsPerPage = 1
	}

	// Calculate scroll window that keeps cursor visible
	startIdx := 0
	endIdx := len(visible)
	if len(visible) > cardsPerPage {
		startIdx = m.cursor - cardsPerPage/2
		if startIdx < 0 {
			startIdx = 0
		}
		endIdx = startIdx + cardsPerPage
		if endIdx > len(visible) {
			endIdx = len(visible)
			startIdx = max(0, endIdx-cardsPerPage)
		}
	}

	var leftLines []string
	if startIdx > 0 {
		leftLines = append(leftLines, metaStyle.Render(fmt.Sprintf("  +%d above", startIdx)))
	}
	for i := startIdx; i < endIdx; i++ {
		card := m.renderCompactCard(visible[i], i == m.cursor, cardInnerWidth)
		leftLines = append(leftLines, card)
	}
	if endIdx < len(visible) {
		leftLines = append(leftLines, metaStyle.Render(fmt.Sprintf("  +%d more", len(visible)-endIdx)))
	}
	leftContent := strings.Join(leftLines, "\n")

	// Build right panel: detail view
	rightContent := m.renderDetailPanel(panelHeight, rightWidth)

	// Set fixed height on left panel so both panels align
	leftFinal := lipgloss.NewStyle().Width(listPanelWidth).Height(panelHeight).Render(leftContent)
	rightFinal := rightContent

	panels := lipgloss.JoinHorizontal(lipgloss.Top, leftFinal, strings.Repeat(" ", panelGap), rightFinal)
	b.WriteString(panels + "\n")

	b.WriteString(footer)
	return b.String()
}

func (m Model) renderCompactCard(n feedNotification, focused bool, width int) string {
	pStyle, ok := priorityStyles[n.Priority]
	if !ok {
		pStyle = priorityStyles[3]
	}
	badge := pStyle.Render(fmt.Sprintf("P%d", n.Priority))

	// Truncate message to fit on one line: badge(2) + 2 spaces + shortcode(~4) + 1 space
	scCode := metaStyle.Render(n.ShortCode)
	// Reserve space for badge + gaps + shortcode
	msgMaxWidth := width - 4 - len(n.ShortCode) - 1
	if msgMaxWidth < 5 {
		msgMaxWidth = 5
	}
	msgLine := truncateText(n.Message, msgMaxWidth)

	content := badge + "  " + msgLine + " " + scCode

	isSkipped := m.skipped[n.ID]
	var style lipgloss.Style
	switch {
	case isSkipped:
		style = skippedBorder.Width(width + 2) // +2 for padding inside border
	case focused:
		style = focusedBorder.Width(width + 2)
	default:
		style = normalBorder.Width(width + 2)
	}

	return style.Render(content)
}

func (m Model) renderDetailPanel(panelHeight, totalWidth int) string {
	n := m.focusedItem()
	if n == nil {
		empty := metaStyle.Render("No notification selected")
		return detailPanelStyle.Width(totalWidth - 2).Height(panelHeight - 2).Render(empty)
	}

	// Inner width accounts for border (2) + padding (2*2)
	innerWidth := totalWidth - 6
	if innerWidth < 10 {
		innerWidth = 10
	}

	var sections []string

	// Priority + status
	pStyle, ok := priorityStyles[n.Priority]
	if !ok {
		pStyle = priorityStyles[3]
	}
	badge := pStyle.Render(fmt.Sprintf("Priority %d", n.Priority))
	statusText := metaStyle.Render(fmt.Sprintf("  Status: %s", n.Status))
	sections = append(sections, badge+statusText)

	// Full message text
	sections = append(sections, "")
	wrapped := wrapText(n.Message, innerWidth)
	sections = append(sections, wrapped)

	// Metadata
	sections = append(sections, "")
	metaLine := n.Age() + " · " + n.ShortCode
	if n.SnoozedUntil != nil {
		if t, err := time.Parse(time.RFC3339, *n.SnoozedUntil); err == nil {
			metaLine += fmt.Sprintf(" · snoozed until %s", t.Format("15:04"))
		}
	}
	sections = append(sections, metaStyle.Render(metaLine))

	// Options
	if len(n.Options) > 0 {
		sections = append(sections, "")
		sections = append(sections, detailHeaderStyle.Render("Options"))
		for i, o := range n.Options {
			sections = append(sections, fmt.Sprintf("  [%d] %s", i+1, o))
		}
	}

	// Status line / snooze picker / text input in the detail panel
	if m.state == stateSnoozePicker {
		sections = append(sections, "")
		sections = append(sections, detailHeaderStyle.Render("Snooze"))
		sections = append(sections, "  [1] 5m  [2] 15m  [3] 1h  [4] 4h  Esc cancel")
	}

	if m.state == stateTextInput {
		sections = append(sections, "")
		sections = append(sections, detailHeaderStyle.Render("Reply"))
		sections = append(sections, m.textarea.View())
	}

	if m.status != "" && m.state == stateBrowsing {
		sections = append(sections, "")
		sections = append(sections, metaStyle.Render(m.status))
	}

	content := strings.Join(sections, "\n")

	// Truncate if too tall
	contentLines := strings.Split(content, "\n")
	maxLines := panelHeight - 2 // border top + bottom
	if maxLines < 1 {
		maxLines = 1
	}
	if len(contentLines) > maxLines {
		if m.state == stateTextInput || m.state == stateSnoozePicker {
			// Keep the bottom visible (input area)
			start := len(contentLines) - maxLines
			contentLines = append([]string{"..."}, contentLines[start+1:]...)
		} else {
			contentLines = append(contentLines[:maxLines-1], metaStyle.Render("..."))
		}
		content = strings.Join(contentLines, "\n")
	}

	return detailPanelStyle.Width(totalWidth - 2).Height(panelHeight - 2).Render(content)
}

func (m Model) renderCard(n feedNotification, focused bool, width int) string {
	var lines []string

	// Priority badge + message
	pStyle, ok := priorityStyles[n.Priority]
	if !ok {
		pStyle = priorityStyles[3]
	}
	badge := pStyle.Render(fmt.Sprintf("P%d", n.Priority))

	// Wrap message text
	msgWidth := width - 8 // account for border + padding + badge
	msg := wrapText(n.Message, msgWidth)
	msgLines := strings.Split(msg, "\n")
	lines = append(lines, badge+"  "+msgLines[0])
	for _, l := range msgLines[1:] {
		lines = append(lines, "    "+l)
	}

	// Metadata line
	meta := metaStyle.Render(fmt.Sprintf("    %s · %s", n.Age(), n.ShortCode))
	lines = append(lines, "")
	lines = append(lines, meta)

	// Options
	if len(n.Options) > 0 {
		var opts []string
		for i, o := range n.Options {
			opts = append(opts, fmt.Sprintf("[%d] %s", i+1, o))
		}
		lines = append(lines, "")
		lines = append(lines, "    "+strings.Join(opts, "  "))
	}

	content := strings.Join(lines, "\n")

	isSkipped := m.skipped[n.ID]
	var style lipgloss.Style
	switch {
	case isSkipped:
		style = skippedBorder.Width(width)
	case focused:
		style = focusedBorder.Width(width)
	default:
		style = normalBorder.Width(width)
	}

	return style.Render(content)
}

// Commands

type tickMsg struct{}

func scheduleRefresh() tea.Cmd {
	return tea.Tick(3*time.Second, func(time.Time) tea.Msg {
		return tickMsg{}
	})
}

func fetchFeed(c *client.Client) tea.Cmd {
	return func() tea.Msg {
		items, err := fetchActiveFeed(c)
		return feedRefreshedMsg{items: items, err: err}
	}
}

func submitResponseCmd(c *client.Client, id string, text *string, selectedOption *string) tea.Cmd {
	return func() tea.Msg {
		err := submitResponse(c, id, text, selectedOption)
		return respondedMsg{id: id, err: err}
	}
}

func snoozeCmd(c *client.Client, id string, minutes int) tea.Cmd {
	return func() tea.Msg {
		err := snoozeNotification(c, id, minutes)
		return snoozedMsg{id: id, err: err}
	}
}

func archiveCmd(c *client.Client, id string) tea.Cmd {
	return func() tea.Msg {
		err := archiveNotificationReq(c, id)
		return archivedMsg{id: id, err: err}
	}
}

func archiveAllCmd(c *client.Client) tea.Cmd {
	return func() tea.Msg {
		count, err := archiveAllNotificationsReq(c)
		return archivedAllMsg{count: count, err: err}
	}
}

// Helpers

func wrapText(s string, width int) string {
	if width <= 0 {
		return s
	}
	words := strings.Fields(s)
	if len(words) == 0 {
		return s
	}

	var lines []string
	line := words[0]
	for _, w := range words[1:] {
		if len(line)+1+len(w) > width {
			lines = append(lines, line)
			line = w
		} else {
			line += " " + w
		}
	}
	lines = append(lines, line)
	return strings.Join(lines, "\n")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func truncateText(s string, maxWidth int) string {
	// Collapse to first line, strip newlines
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= maxWidth {
		return s
	}
	if maxWidth <= 1 {
		return "…"
	}
	return s[:maxWidth-1] + "…"
}
