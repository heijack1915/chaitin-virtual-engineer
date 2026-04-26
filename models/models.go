package models

import "time"

// Host represents a target server
type Host struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	IP         string    `json:"ip"`
	Port       int       `json:"port"`
	Username   string    `json:"username"`
	Password   string    `json:"password"`
	PrivateKey string    `json:"private_key,omitempty"`
	PkgPass    string    `json:"pkg_pass,omitempty"`  // installer package password (prompted immediately on run)
	SudoPass   string    `json:"sudo_pass,omitempty"` // sudo password (prompted when escalating privileges)
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ExecuteRequest represents a command execution request
type ExecuteRequest struct {
	HostID   string `json:"host_id"`
	Command  string `json:"command"`
	Timeout  int    `json:"timeout"` // seconds, 0 = default
}

// ExecuteResult represents the result of a command execution
type ExecuteResult struct {
	HostID    string `json:"host_id"`
	Command   string `json:"command"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exit_code"`
	Duration  int64  `json:"duration_ms"` // milliseconds
	Timestamp string `json:"timestamp"`
	Error     string `json:"error,omitempty"`
}

// KnowledgeBase represents a loaded knowledge base
type KnowledgeBase struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description"`
	Path        string   `json:"path"`
	Operations  []string `json:"operations"` // install, uninstall, upgrade, troubleshoot
	LoadedAt    string   `json:"loaded_at"`
}

// WikiContent represents wiki page content
type WikiContent struct {
	KBID     string   `json:"kb_id"`
	Path     string   `json:"path"`
	Title    string   `json:"title"`
	Content  string   `json:"content"`
	Related  []string `json:"related"` // related page paths
}

// SearchResult represents a search result
type SearchResult struct {
	KBID     string  `json:"kb_id"`
	Path     string  `json:"path"`
	Title    string  `json:"title"`
	Excerpt  string  `json:"excerpt"`
	Score    float64 `json:"score"`
}
