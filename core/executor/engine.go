package executor

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/chaitin-virtual-engineer/core/ssh"
	"github.com/chaitin/chaitin-virtual-engineer/models"
	gossh "golang.org/x/crypto/ssh"
)

var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]|\x1b[()][AB012]|\r`)

// passwordPrompt matches any password prompt line
var passwordPrompt = regexp.MustCompile(`(?i)(password\s*:|密码\s*:|请输入.*密码|enter.*password|passwd\s*:)`)

// sudoPrompt matches specifically sudo-related prompts
var sudoPrompt = regexp.MustCompile(`(?i)(sudo|root|privilege|超级用户|提权)`)

// Engine executes commands on remote hosts
type Engine struct{}

func NewEngine() *Engine { return &Engine{} }

// StreamExecute runs a command with PTY, auto-fills passwords by prompt content, calls onLine per line.
func (e *Engine) StreamExecute(host *models.Host, command string, onLine func(line string, isStderr bool)) (*models.ExecuteResult, error) {
	result := &models.ExecuteResult{
		HostID:    host.ID,
		Command:   command,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	start := time.Now()

	config, err := ssh.MakeSSHConfig(host)
	if err != nil {
		result.Error = err.Error()
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}
	config.Timeout = 30 * time.Second

	addr := fmt.Sprintf("%s:%d", host.IP, host.Port)
	client, err := gossh.Dial("tcp", addr, config)
	if err != nil {
		result.Error = fmt.Sprintf("SSH connection failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		result.Error = fmt.Sprintf("SSH session failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}
	defer session.Close()

	modes := gossh.TerminalModes{
		gossh.ECHO:          0,
		gossh.TTY_OP_ISPEED: 38400,
		gossh.TTY_OP_OSPEED: 38400,
	}
	if err := session.RequestPty("xterm-256color", 50, 220, modes); err != nil {
		result.Error = fmt.Sprintf("PTY request failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}

	stdinPipe, err := session.StdinPipe()
	if err != nil {
		result.Error = fmt.Sprintf("stdin pipe failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		result.Error = fmt.Sprintf("stdout pipe failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}

	if err := session.Start(command); err != nil {
		result.Error = fmt.Sprintf("SSH start failed: %v", err)
		result.Duration = time.Since(start).Milliseconds()
		return result, nil
	}

	buf := make([]byte, 4096)
	var lineBuf bytes.Buffer
	// Track fills per type to avoid infinite loops on wrong password
	pkgPassFills := 0
	sudoPassFills := 0

	for {
		n, readErr := stdoutPipe.Read(buf)
		if n > 0 {
			chunk := ansiEscape.ReplaceAllString(string(buf[:n]), "")
			lineBuf.WriteString(chunk)

			// Check if accumulated buffer ends with a password prompt (no newline yet)
			accumulated := lineBuf.String()
			if passwordPrompt.MatchString(accumulated) {
				var pass string
				if sudoPrompt.MatchString(accumulated) {
					// Prompt explicitly mentions sudo/root → sudo password
					if host.SudoPass != "" && sudoPassFills < 3 {
						pass = host.SudoPass
						sudoPassFills++
					}
				} else {
					// Generic password prompt → installer package password
					if host.PkgPass != "" && pkgPassFills < 3 {
						pass = host.PkgPass
						pkgPassFills++
					} else if host.SudoPass != "" && sudoPassFills < 3 {
						// Fallback: try sudo pass if no pkg pass configured
						pass = host.SudoPass
						sudoPassFills++
					}
				}

				if pass != "" {
					stdinPipe.Write([]byte(pass + "\n"))
					// Don't emit the prompt line (contains "password:")
					lineBuf.Reset()
					if readErr != nil {
						break
					}
					continue
				}
			}

			// Flush complete lines
			for {
				s := lineBuf.String()
				idx := strings.IndexByte(s, '\n')
				if idx < 0 {
					break
				}
				line := strings.TrimRight(s[:idx], " \r")
				lineBuf.Reset()
				lineBuf.WriteString(s[idx+1:])
				if line != "" {
					onLine(line, false)
				}
			}
		}
		if readErr != nil {
			break
		}
	}

	// Flush remaining
	if remaining := strings.TrimRight(lineBuf.String(), " \r\n"); remaining != "" {
		// Don't leak unanswered password prompts into output
		if !passwordPrompt.MatchString(remaining) {
			onLine(remaining, false)
		}
	}

	if err := session.Wait(); err != nil {
		if exitErr, ok := err.(*gossh.ExitError); ok {
			result.ExitCode = exitErr.ExitStatus()
		}
	}
	result.Duration = time.Since(start).Milliseconds()
	return result, nil
}
