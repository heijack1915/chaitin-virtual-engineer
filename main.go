package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/chaitin-virtual-engineer/core/executor"
	"github.com/chaitin/chaitin-virtual-engineer/core/knowledge"
	"github.com/chaitin/chaitin-virtual-engineer/core/ssh"
	"github.com/chaitin/chaitin-virtual-engineer/models"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/pkg/sftp"
)

//go:embed ui
var uiFS embed.FS

var (
	port    = flag.Int("port", 8080, "HTTP server port")
	dataDir = flag.String("data", "", "Data directory path")
)

// jobStore stores streaming job output
var (
	jobMu   sync.RWMutex
	jobLogs = map[string][]string{}
	jobDone = map[string]bool{}
)

func appendJobLog(jobID, line string) {
	jobMu.Lock()
	jobLogs[jobID] = append(jobLogs[jobID], line)
	jobMu.Unlock()
}

func cleanOldProcess(port int) {
	selfPid := os.Getpid()

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "netstat -ano | findstr :"+strconv.Itoa(port))
	default:
		cmd = exec.Command("sh", "-c", "lsof -i :"+strconv.Itoa(port)+" -t 2>/dev/null")
	}
	out, err := cmd.Output()
	if err != nil {
		return
	}
	for _, line := range strings.Fields(string(out)) {
		pid, err := strconv.Atoi(strings.TrimSpace(line))
		if err != nil || pid == selfPid || pid == 0 {
			continue
		}
		psCmd := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "comm=")
		psOut, _ := psCmd.Output()
		exe := strings.TrimSpace(string(psOut))
		if strings.Contains(exe, "chaitin-ve") || strings.Contains(exe, "ve-server") {
			log.Printf("Killing old process PID %d (%s) on port %d", pid, exe, port)
			p, _ := os.FindProcess(pid)
			if p != nil {
				p.Kill()
			}
		}
	}
}

func main() {
	flag.Parse()

	// Kill old instances of this process to avoid port conflicts
	cleanOldProcess(*port)

	if *dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal("Cannot find home directory:", err)
		}
		*dataDir = filepath.Join(home, ".chaitin-virtual-engineer")
	}

	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatal("Cannot create data directory:", err)
	}

	pkgDir := filepath.Join(*dataDir, "packages")
	os.MkdirAll(pkgDir, 0755)

	log.Printf("Chaitin-Virtual-Engineer starting...")
	log.Printf("Data directory: %s", *dataDir)
	log.Printf("Server port: %d", *port)

	hostManager := ssh.NewHostManager(filepath.Join(*dataDir, "hosts.json"))
	execEngine := executor.NewEngine()
	kbLoader := knowledge.NewLoader(filepath.Join(*dataDir, "knowledge"))

	if err := hostManager.Load(); err != nil {
		log.Printf("No saved hosts or error loading: %v", err)
	}
	kbLoader.Scan()

	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	uiSub, _ := fs.Sub(uiFS, "ui")
	e.GET("/", func(c echo.Context) error {
		data, err := fs.ReadFile(uiSub, "index.html")
		if err != nil {
			return c.String(404, "Not Found")
		}
		return c.HTML(200, string(data))
	})
	e.GET("/styles.css", func(c echo.Context) error {
		data, err := fs.ReadFile(uiSub, "styles.css")
		if err != nil {
			return c.String(404, "Not Found")
		}
		return c.Blob(200, "text/css", data)
	})
	e.GET("/app.js", func(c echo.Context) error {
		data, err := fs.ReadFile(uiSub, "app.js")
		if err != nil {
			return c.String(404, "Not Found")
		}
		return c.Blob(200, "application/javascript", data)
	})

	api := e.Group("/api")

	// ── Hosts ──────────────────────────────────────────────────────────────
	api.GET("/hosts", func(c echo.Context) error {
		return c.JSON(200, hostManager.ListHosts())
	})
	api.POST("/hosts", func(c echo.Context) error {
		var raw map[string]interface{}
		if err := c.Bind(&raw); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		hostPort := 22
		if v, ok := raw["port"]; ok {
			switch pv := v.(type) {
			case float64:
				hostPort = int(pv)
			case int:
				hostPort = pv
			}
		}
		host := models.Host{
			Name:       getString(raw, "name"),
			Username:   getString(raw, "username"),
			Password:   getString(raw, "password"),
			PrivateKey: getString(raw, "private_key"),
			PkgPass:    getString(raw, "pkg_pass"),
			SudoPass:   getString(raw, "sudo_pass"),
			Port:       hostPort,
		}
		host.IP = getString(raw, "ip")
		if host.IP == "" {
			host.IP = getString(raw, "host")
		}
		if err := hostManager.AddHost(&host); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		hostManager.Save()
		return c.JSON(200, host)
	})
	api.DELETE("/hosts/:id", func(c echo.Context) error {
		if err := hostManager.RemoveHost(c.Param("id")); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		hostManager.Save()
		return c.JSON(200, map[string]string{"status": "ok"})
	})
	api.PUT("/hosts/:id", func(c echo.Context) error {
		host := hostManager.GetHost(c.Param("id"))
		if host == nil {
			return c.JSON(404, map[string]string{"error": "Host not found"})
		}
		var raw map[string]interface{}
		if err := c.Bind(&raw); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		if v := getString(raw, "name"); v != "" { host.Name = v }
		if v := getString(raw, "ip"); v != "" { host.IP = v }
		if v := getString(raw, "username"); v != "" { host.Username = v }
		if v := getString(raw, "password"); v != "" { host.Password = v }
		if v := getString(raw, "private_key"); v != "" { host.PrivateKey = v }
		if v := getString(raw, "pkg_pass"); v != "" { host.PkgPass = v }
		if v := getString(raw, "sudo_pass"); v != "" { host.SudoPass = v }
		if p, ok := raw["port"]; ok {
			if pv, ok := p.(float64); ok && pv > 0 { host.Port = int(pv) }
		}
		hostManager.Save()
		return c.JSON(200, host)
	})
	api.POST("/hosts/:id/test", func(c echo.Context) error {
		host := hostManager.GetHost(c.Param("id"))
		if host == nil {
			return c.JSON(404, map[string]string{"error": "Host not found"})
		}
		if err := ssh.TestConnection(host); err != nil {
			host.Status = "offline"
			hostManager.Save()
			return c.JSON(200, map[string]string{"status": "error", "message": err.Error()})
		}
		host.Status = "online"
		hostManager.Save()
		return c.JSON(200, map[string]string{"status": "ok", "message": "Connection successful"})
	})

	// ── Execute (streaming via SSE) ────────────────────────────────────────
	// POST /api/execute → starts job, returns {job_id}
	api.POST("/execute", func(c echo.Context) error {
		var req models.ExecuteRequest
		if err := c.Bind(&req); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		host := hostManager.GetHost(req.HostID)
		if host == nil {
			return c.JSON(404, map[string]string{"error": "Host not found"})
		}

		jobID := fmt.Sprintf("%d", time.Now().UnixNano())
		jobMu.Lock()
		jobLogs[jobID] = []string{}
		jobDone[jobID] = false
		jobMu.Unlock()

		go func() {
			result, err := execEngine.StreamExecute(host, req.Command, func(line string, isStderr bool) {
				if isStderr {
					appendJobLog(jobID, "\x00stderr\x00"+line)
				} else {
					appendJobLog(jobID, line)
				}
			})
			if err != nil {
				appendJobLog(jobID, "[ERROR] "+err.Error())
			} else if result.Error != "" {
				appendJobLog(jobID, "[ERROR] "+result.Error)
			} else if result != nil && result.ExitCode != 0 {
				appendJobLog(jobID, fmt.Sprintf("[EXIT %d]", result.ExitCode))
			}
			jobMu.Lock()
			jobDone[jobID] = true
			jobMu.Unlock()
		}()

		return c.JSON(200, map[string]string{"job_id": jobID})
	})

	// GET /api/execute/stream?job_id=xxx → SSE stream
	api.GET("/execute/stream", func(c echo.Context) error {
		jobID := c.QueryParam("job_id")
		if jobID == "" {
			return c.JSON(400, map[string]string{"error": "job_id required"})
		}

		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().WriteHeader(200)

		sent := 0
		for {
			jobMu.RLock()
			logs := jobLogs[jobID]
			done := jobDone[jobID]
			jobMu.RUnlock()

			for sent < len(logs) {
				line := logs[sent]
				sent++
				data, _ := json.Marshal(map[string]string{"line": line})
				fmt.Fprintf(c.Response(), "data: %s\n\n", data)
				c.Response().Flush()
			}

			if done && sent >= len(logs) {
				fmt.Fprintf(c.Response(), "data: %s\n\n", `{"done":true}`)
				c.Response().Flush()
				// Cleanup after a delay
				go func() {
					time.Sleep(30 * time.Second)
					jobMu.Lock()
					delete(jobLogs, jobID)
					delete(jobDone, jobID)
					jobMu.Unlock()
				}()
				return nil
			}
			time.Sleep(100 * time.Millisecond)
		}
	})

	// ── Knowledge ──────────────────────────────────────────────────────────
	api.GET("/knowledge", func(c echo.Context) error {
		return c.JSON(200, kbLoader.ListKnowledgeBases())
	})
	api.POST("/knowledge/import", func(c echo.Context) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.JSON(400, map[string]string{"error": "No file uploaded"})
		}
		src, err := file.Open()
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		defer src.Close()
		kb, err := kbLoader.Import(src, file.Filename)
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		return c.JSON(200, kb)
	})
	api.DELETE("/knowledge/:id", func(c echo.Context) error {
		if err := kbLoader.Remove(c.Param("id")); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		return c.JSON(200, map[string]string{"status": "ok"})
	})
	api.GET("/knowledge/:id/wiki", func(c echo.Context) error {
		wiki, err := kbLoader.GetWikiContent(c.Param("id"))
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		return c.JSON(200, wiki)
	})
	api.GET("/knowledge/:id/search", func(c echo.Context) error {
		results, err := kbLoader.Search(c.Param("id"), c.QueryParam("q"))
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		return c.JSON(200, results)
	})

	// ── Packages ───────────────────────────────────────────────────────────
	api.GET("/packages", func(c echo.Context) error {
		entries, _ := os.ReadDir(pkgDir)
		var pkgs []map[string]interface{}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			info, _ := e.Info()
			pkgs = append(pkgs, map[string]interface{}{
				"name": e.Name(),
				"size": info.Size(),
			})
		}
		if pkgs == nil {
			pkgs = []map[string]interface{}{}
		}
		return c.JSON(200, pkgs)
	})
	api.POST("/packages/upload", func(c echo.Context) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.JSON(400, map[string]string{"error": "No file uploaded"})
		}
		src, err := file.Open()
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		defer src.Close()
		dst, err := os.Create(filepath.Join(pkgDir, filepath.Base(file.Filename)))
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		defer dst.Close()
		io.Copy(dst, src)
		return c.JSON(200, map[string]string{"status": "ok", "name": file.Filename})
	})
	api.DELETE("/packages/:name", func(c echo.Context) error {
		name := filepath.Base(c.Param("name"))
		if err := os.Remove(filepath.Join(pkgDir, name)); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		return c.JSON(200, map[string]string{"status": "ok"})
	})
	// GET /api/packages/:name/deploy?host_id=&remote_path= → SSE progress stream
	api.GET("/packages/:name/deploy", func(c echo.Context) error {
		pkgName := filepath.Base(c.Param("name"))
		hostID := c.QueryParam("host_id")
		remotePath := c.QueryParam("remote_path")

		host := hostManager.GetHost(hostID)
		if host == nil {
			return c.JSON(404, map[string]string{"error": "Host not found"})
		}
		if remotePath == "" {
			remotePath = "/tmp/" + pkgName
		}

		localPath := filepath.Join(pkgDir, pkgName)
		f, err := os.Open(localPath)
		if err != nil {
			return c.JSON(400, map[string]string{"error": "Package not found locally"})
		}
		defer f.Close()

		fi, err := f.Stat()
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		total := fi.Size()

		sshConfig, err := ssh.MakeSSHConfig(host)
		if err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}
		sshConfig.Timeout = 30 * time.Second

		addr := fmt.Sprintf("%s:%d", host.IP, host.Port)
		sshClient, err := ssh.Dial("tcp", addr, sshConfig)
		if err != nil {
			return c.JSON(400, map[string]string{"error": "SSH: " + err.Error()})
		}
		defer sshClient.Close()

		sftpClient, err := sftp.NewClient(sshClient)
		if err != nil {
			return c.JSON(400, map[string]string{"error": "SFTP: " + err.Error()})
		}
		defer sftpClient.Close()

		remote, err := sftpClient.Create(remotePath)
		if err != nil {
			return c.JSON(400, map[string]string{"error": "Remote create: " + err.Error()})
		}
		defer remote.Close()

		// SSE headers
		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().WriteHeader(200)

		sseEvent := func(v map[string]interface{}) {
			data, _ := json.Marshal(v)
			fmt.Fprintf(c.Response(), "data: %s\n\n", data)
			c.Response().Flush()
		}

		var transferred int64
		const chunkSize = 512 * 1024 // report every 512 KB
		buf := make([]byte, chunkSize)
		for {
			nr, rerr := f.Read(buf)
			if nr > 0 {
				nw, werr := remote.Write(buf[:nr])
				transferred += int64(nw)
				pct := 0
				if total > 0 {
					pct = int(transferred * 100 / total)
				}
				sseEvent(map[string]interface{}{
					"bytes": transferred,
					"total": total,
					"pct":   pct,
				})
				if werr != nil {
					sseEvent(map[string]interface{}{"error": "Transfer: " + werr.Error()})
					return nil
				}
			}
			if rerr == io.EOF {
				break
			}
			if rerr != nil {
				sseEvent(map[string]interface{}{"error": "Read: " + rerr.Error()})
				return nil
			}
		}

		sseEvent(map[string]interface{}{
			"done":        true,
			"remote_path": remotePath,
			"bytes":       transferred,
		})
		return nil
	})

	// ── AI Agent Chat (multi-turn with auto-execution) ─────────────────────
	// POST /api/chat → SSE stream: pushes each turn as it happens
	api.POST("/chat", func(c echo.Context) error {
		var req struct {
			Message       string                   `json:"message"`
			HostID        string                   `json:"hostId"`
			TerminalLines []string                 `json:"terminalLines"`
			History       []map[string]string      `json:"history"`
			DeployedPkgs  []map[string]interface{} `json:"deployedPkgs"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(400, map[string]string{"error": err.Error()})
		}

		apiUrl := c.Request().Header.Get("X-API-URL")
		apiKey := c.Request().Header.Get("X-API-Key")
		model := c.Request().Header.Get("X-Model")
		if apiUrl == "" || apiKey == "" {
			return c.JSON(400, map[string]string{"error": "请先在设置中配置 AI 接口"})
		}

		host := hostManager.GetHost(req.HostID)

		// Knowledge base context
		kbs := kbLoader.ListKnowledgeBases()
		kbContext := ""
		for _, kb := range kbs {
			if wiki, err := kbLoader.GetWikiContent(kb.ID); err == nil {
				kbContext += "\n\n# " + wiki.Title + "\n" + wiki.Content
			}
		}

		hostContext := ""
		if host != nil {
			hostContext = fmt.Sprintf("\n\n当前操作主机: %s (%s:%d), 用户: %s, 状态: %s",
				host.Name, host.IP, host.Port, host.Username, host.Status)
		}

		terminalContext := ""
		if len(req.TerminalLines) > 0 {
			lines := req.TerminalLines
			if len(lines) > 50 {
				lines = lines[len(lines)-50:]
			}
			terminalContext = "\n\n最近终端输出：\n```\n" + strings.Join(lines, "\n") + "\n```"
		}

		// Packages context — read directly from disk, don't rely on frontend state
		pkgContext := ""
		if entries, err := os.ReadDir(pkgDir); err == nil && len(entries) > 0 {
			pkgContext = "\n\n本地已上传安装包（存放于服务端）："
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				info, _ := entry.Info()
				size := ""
				if info != nil {
					if info.Size() > 1048576 {
						size = fmt.Sprintf("%.1f MB", float64(info.Size())/1048576)
					} else {
						size = fmt.Sprintf("%.1f KB", float64(info.Size())/1024)
					}
				}
				pkgContext += fmt.Sprintf("\n- %s（%s）", entry.Name(), size)
			}
		}
		if len(req.DeployedPkgs) > 0 {
			pkgContext += "\n\n本次会话已部署记录："
			for _, d := range req.DeployedPkgs {
				pkgName, _ := d["pkgName"].(string)
				hostName, _ := d["hostName"].(string)
				remotePath, _ := d["remotePath"].(string)
				t, _ := d["time"].(string)
				pkgContext += fmt.Sprintf("\n- %s → 主机 %s，远程路径 %s（%s）", pkgName, hostName, remotePath, t)
			}
		}

		systemPrompt := `你是长亭虚拟工程师，专门帮助用户在远程 Linux 主机上安装、配置和排查长亭科技产品（SafeLine WAF、牧云CloudWalker、洞鉴X-Ray、谛听D-Sensor）。

你有能力直接在目标主机上执行命令。当需要执行命令时，使用以下格式（每次只发一条）：
[EXEC: 命令内容]

系统会自动执行该命令并把输出返回给你，你再根据输出决定下一步。
当任务全部完成或不需要再执行命令时，直接用自然语言回复用户即可，不要再输出 [EXEC:...] 格式。

执行规则：
- 每次只输出一条 [EXEC:...] 命令，等待结果后再决定下一步
- 输出 [EXEC:...] 时不要附带其他解释，执行完再解释
- 如果命令执行失败，分析原因并尝试修复

知识库优先原则（最高优先级，必须严格遵守）：
- 下方「内置知识库」包含了经过真实环境验证的完整部署/卸载/升级/故障排查经验
- 执行任何操作时，必须优先使用内置知识库中的步骤和命令，严格按照知识库指令执行
- 回答用户关于产品的问题（如部署模式区别、参数含义、故障原因等）时，必须优先基于内置知识库中的信息作答
- 仅当内置知识库中确实没有覆盖用户请求的内容时，才允许你自行发挥
- 自行发挥时，必须先向用户明确说明：「⚠️ 以下内容不在内置知识库中，是我根据通用经验生成，请谨慎参考」
- 绝对不可执行与用户意图相反的操作（如用户要求卸载却执行安装）

内置知识库 - Docker 一键彻底卸载脚本（卸载 Docker 时按此顺序逐步执行）：
[步骤1] 停止Docker服务：systemctl stop docker 2>/dev/null || true; systemctl stop docker.socket 2>/dev/null || true; systemctl stop containerd 2>/dev/null || true
[步骤2] 禁用开机自启：systemctl disable docker.socket 2>/dev/null || true; systemctl disable docker 2>/dev/null || true; systemctl disable containerd 2>/dev/null || true
[步骤3] 删除systemd服务文件：rm -f /etc/systemd/system/docker.service /etc/systemd/system/docker.socket /etc/systemd/system/containerd.service /etc/systemd/system/containerd.socket; systemctl daemon-reload; systemctl reset-failed
[步骤4] 删除Docker程序文件：rm -f /usr/local/bin/dockerd /usr/local/bin/containerd /usr/local/bin/containerd-shim /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/runc /usr/local/bin/docker-init /usr/local/bin/docker-proxy /usr/bin/dockerd /usr/bin/docker /usr/local/bin/docker /usr/local/bin/docker-compose /usr/local/bin/docker-compose-plugin /usr/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose /usr/lib/docker/cli-plugins/docker-compose
[步骤5] 清理Docker数据（如用户要求删除数据）：rm -rf /var/lib/docker /var/lib/containerd；否则保留数据
[步骤6] 清理网络配置：ip link delete docker0 2>/dev/null || true; ip link delete br-* 2>/dev/null || true; iptables -t nat -F 2>/dev/null || true; iptables -t filter -F DOCKER 2>/dev/null || true; iptables -t nat -F DOCKER 2>/dev/null || true
[步骤7] 清理Docker用户组：groupdel docker 2>/dev/null || true
[步骤8] 删除配置文件：rm -rf /etc/docker /etc/containerd /etc/default/docker /etc/sysconfig/docker /etc/profile.d/docker.sh /etc/profile.d/docker-compose.sh
[步骤9] 清理残留软链接：find /usr -type l -name "*docker*" -delete 2>/dev/null || true; find /usr/local -type l -name "*docker*" -delete 2>/dev/null || true`

		if kbContext != "" {
			systemPrompt += "\n\n内置知识库：" + kbContext
		}
		if hostContext != "" {
			systemPrompt += hostContext
		}
		if pkgContext != "" {
			systemPrompt += pkgContext
		}
		if terminalContext != "" {
			systemPrompt += terminalContext
		}

		// Build message history
		messages := []map[string]string{{"role": "system", "content": systemPrompt}}
		for _, h := range req.History {
			messages = append(messages, h)
		}
		messages = append(messages, map[string]string{"role": "user", "content": req.Message})

		// SSE headers
		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().Header().Set("X-Content-Type-Options", "nosniff")
		c.Response().WriteHeader(200)

		sseSend := func(v map[string]interface{}) {
			data, _ := json.Marshal(v)
			fmt.Fprintf(c.Response(), "data: %s\n\n", data)
			c.Response().Flush()
		}

		// Agentic loop: no artificial round limit — AI decides when to stop
		for round := 0; ; round++ {
			aiReq := map[string]interface{}{
				"model":    model,
				"messages": messages,
			}
			var aiResp map[string]interface{}
			if err := callAI(apiUrl, apiKey, aiReq, &aiResp); err != nil {
				sseSend(map[string]interface{}{"type": "error", "content": err.Error()})
				return nil
			}
			if errMsg, ok := aiResp["error"].(map[string]interface{}); ok {
				if msg, ok := errMsg["message"].(string); ok {
					sseSend(map[string]interface{}{"type": "error", "content": msg})
					return nil
				}
			}

			aiText := ""
			if choices, ok := aiResp["choices"].([]interface{}); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]interface{}); ok {
					if msg, ok := choice["message"].(map[string]interface{}); ok {
						if content, ok := msg["content"].(string); ok {
							aiText = content
						}
					}
				}
			}
			if aiText == "" {
				sseSend(map[string]interface{}{"type": "error", "content": "AI 返回为空，请检查配置"})
				return nil
			}

			// Check if AI wants to execute a command
			execCmd := ""
			if idx := strings.Index(aiText, "[EXEC:"); idx >= 0 {
				end := strings.Index(aiText[idx:], "]")
				if end > 0 {
					execCmd = strings.TrimSpace(aiText[idx+6 : idx+end])
				}
			}

			if execCmd == "" {
				// No command to execute — AI is done, stream final response
				sseSend(map[string]interface{}{"type": "response", "role": "assistant", "content": aiText})
				return nil
			}

			// Stream the EXEC turn to client
			sseSend(map[string]interface{}{"type": "turn", "role": "assistant", "content": aiText})

			// Execute command on host
			cmdOutput := ""
			if host == nil {
				cmdOutput = "[错误] 未选择主机，无法执行命令"
			} else {
				var outputLines []string
				result, err := execEngine.StreamExecute(host, execCmd, func(line string, _ bool) {
					outputLines = append(outputLines, line)
				})
				if err != nil {
					cmdOutput = "[错误] " + err.Error()
				} else {
					if result.Error != "" {
						outputLines = append(outputLines, "[错误] "+result.Error)
					} else if result.ExitCode != 0 {
						outputLines = append(outputLines, fmt.Sprintf("[退出码 %d]", result.ExitCode))
					}
					cmdOutput = strings.Join(outputLines, "\n")
					if cmdOutput == "" {
						cmdOutput = "(命令执行完毕，无输出)"
					}
				}
			}

			// Stream tool result to client
			toolResult := fmt.Sprintf("命令: %s\n\n输出:\n%s", execCmd, cmdOutput)
			sseSend(map[string]interface{}{"type": "turn", "role": "tool_result", "content": toolResult})

			// Feed result back to AI
			messages = append(messages,
				map[string]string{"role": "assistant", "content": aiText},
				map[string]string{"role": "user", "content": "命令执行结果：\n```\n" + cmdOutput + "\n```\n请继续。"},
			)
		}

		return nil
	})

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("Server starting on %s", addr)
	if err := e.Start(addr); err != nil {
		log.Fatal(err)
	}
}

func callAI(apiURL, apiKey string, req map[string]interface{}, resp *map[string]interface{}) error {
	body, _ := json.Marshal(req)
	apiURL = strings.TrimRight(apiURL, "/")
	if strings.HasSuffix(apiURL, "/chat/completions") {
		apiURL = strings.TrimSuffix(apiURL, "/chat/completions")
	}
	httpReq, err := http.NewRequest("POST", apiURL+"/chat/completions", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpResp, err := (&http.Client{}).Do(httpReq)
	if err != nil {
		return err
	}
	defer httpResp.Body.Close()
	respBody, _ := io.ReadAll(httpResp.Body)
	log.Printf("[AI] status=%d body=%s", httpResp.StatusCode, string(respBody))
	json.Unmarshal(respBody, resp)
	return nil
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
