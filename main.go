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
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/chaitin-virtual-engineer/core/executor"
	"github.com/chaitin/chaitin-virtual-engineer/core/knowledge"
	"github.com/chaitin/chaitin-virtual-engineer/core/safeline"
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


var safelineConfigPath string

func loadSafelineConfigPkg() map[string]string {
	data, err := os.ReadFile(safelineConfigPath)
	if err != nil {
		return map[string]string{}
	}
	var cfg map[string]string
	json.Unmarshal(data, &cfg)
	return cfg
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


		// ── SafeLine WAF Management ─────────────────────────────────────────────
		safelineConfigPath = filepath.Join(*dataDir, "safeline_config.json")
		saveSafelineConfig := func(cfg map[string]string) {
			data, _ := json.MarshalIndent(cfg, "", "  ")
			os.WriteFile(safelineConfigPath, data, 0644)
		}
		getSafeLineClient := func(c echo.Context) *safeline.Client {
			cfg := loadSafelineConfigPkg()
			url := cfg["url"]
			token := cfg["token"]
			if url == "" || token == "" {
				return nil
			}
			return safeline.NewClient(url, token)
		}

		api.GET("/safeline/config", func(c echo.Context) error {
			return c.JSON(200, loadSafelineConfigPkg())
		})
		api.POST("/safeline/config", func(c echo.Context) error {
			var cfg map[string]string
			if err := c.Bind(&cfg); err != nil {
				return c.JSON(400, map[string]string{"error": err.Error()})
			}
			client := safeline.NewClient(cfg["url"], cfg["token"])
			resp, err := client.TestConnection()
			if err != nil {
				return c.JSON(400, map[string]string{"error": "连接失败: " + err.Error()})
			}
			if resp.Err != nil {
				return c.JSON(400, map[string]string{"error": fmt.Sprintf("认证失败: %v", resp.Err)})
			}
			saveSafelineConfig(cfg)
			return c.JSON(200, map[string]string{"status": "ok"})
		})
		api.POST("/safeline/test", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil {
				return c.JSON(400, map[string]string{"error": "请先配置雷池 API 连接"})
			}
			resp, err := client.TestConnection()
			if err != nil {
				return c.JSON(400, map[string]string{"error": err.Error()})
			}
			return c.JSON(200, resp)
		})
		api.GET("/safeline/system", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			info, _ := client.GetSystemInfo()
			return c.JSON(200, info)
		})
		api.GET("/safeline/overview", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			duration := c.QueryParam("duration")
			if duration == "" { duration = "h" }
			params := map[string]string{}
			for _, k := range []string{"total", "host", "src_ip", "attack_type", "risk_level", "request_number", "location"} {
				if v := c.QueryParam(k); v != "" { params[k] = v }
			}
			resp, err := client.GetOverview(duration, params)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/nodes", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetNodeInfo()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/websites", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			mode := c.QueryParam("mode")
			if mode == "" { mode = "SoftwareReverseProxy" }
			resp, err := client.GetWebsites(mode)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.POST("/safeline/websites", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			var body map[string]interface{}
			if err := c.Bind(&body); err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			resp, err := client.CreateWebsite(getString(body, "mode"), body)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.PUT("/safeline/websites", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			var body map[string]interface{}
			if err := c.Bind(&body); err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			mode := getString(body, "mode")
			site := body
			delete(site, "mode")
			resp, err := client.UpdateWebsite(mode, site)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.DELETE("/safeline/websites/:id", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			id, _ := strconv.Atoi(c.Param("id"))
			mode := c.QueryParam("mode")
			if mode == "" { mode = "SoftwareReverseProxy" }
			resp, err := client.DeleteWebsite(mode, id)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.PUT("/safeline/websites/:id/toggle", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			id, _ := strconv.Atoi(c.Param("id"))
			var body struct{ Enabled bool `json:"enabled"` }
			if err := c.Bind(&body); err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			resp, err := client.ToggleWebsite(id, body.Enabled)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/policies", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetPolicyGroups()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/certs", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetCerts()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/ip-groups", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetIPGroups()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.POST("/safeline/ip-groups", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			var body map[string]interface{}
			if err := c.Bind(&body); err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			resp, err := client.CreateIPGroup(body)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.DELETE("/safeline/ip-groups/:id", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			id, _ := strconv.Atoi(c.Param("id"))
			resp, err := client.DeleteIPGroup(id)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/logs", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			scope := c.QueryParam("scope")
			if scope == "" { scope = "log:detect_log" }
			count, _ := strconv.Atoi(c.QueryParam("count"))
			if count <= 0 { count = 20 }
			offset, _ := strconv.Atoi(c.QueryParam("offset"))
			filter := c.QueryParam("q")
			resp, err := client.GetAttackLogs(scope, filter, count, offset)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/es-indices", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			alias := c.QueryParam("alias")
			if alias == "" { alias = "detect_log" }
			resp, err := client.GetESIndices(alias)
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/license", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetLicense()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/detector", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetDetectorState()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/acl", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetACLRuleTemplates()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
		})
		api.GET("/safeline/traffic-learning", func(c echo.Context) error {
			client := getSafeLineClient(c)
			if client == nil { return c.JSON(400, map[string]string{"error": "未配置"}) }
			resp, err := client.GetTrafficLearningOverview()
			if err != nil { return c.JSON(400, map[string]string{"error": err.Error()}) }
			return c.JSON(200, resp)
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
		ExpandKB     bool                      `json:"expandKB,omitempty"`
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

		// Knowledge base context — hierarchical loading
		// Small KBs (<50KB): load full content
		// Large KBs (>=50KB): load index only
		// AI can use [LOAD: kb-id/file.md] to load specific files
		kbs := kbLoader.ListKnowledgeBases()
		kbContext := ""
		loadedFullKBs := map[string]bool{}
		for _, kb := range kbs {
			size := kbLoader.GetWikiSize(kb.ID)
			expandAll := req.ExpandKB
			if size < 50*1024 || expandAll {
				if wiki, err := kbLoader.GetWikiContent(kb.ID); err == nil {
					kbContext += "\n\n# " + wiki.Title + "\n" + wiki.Content
					loadedFullKBs[kb.ID] = true
				}
			} else {
				if idx, err := kbLoader.GetWikiIndex(kb.ID); err == nil {
					kbContext += "\n\n# " + idx.Title + "\n" + idx.Content
				}
			}
		}
		// Build list of large KBs for [LOAD:] instruction
		kbIDList := ""
		for _, kb := range kbs {
			if !loadedFullKBs[kb.ID] {
				kbIDList += fmt.Sprintf("\n  - %s: %s", kb.ID, kb.Name)
			}
		}
		if kbIDList != "" {
			kbContext += "\n\n【按需加载】以下知识库内容较大，仅加载了目录索引。如果你需要详细信息，使用 [LOAD: 知识库ID/文件名] 加载指定文件。可用的知识库：" + kbIDList
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

你有能力直接在目标主机上执行命令。

【命令执行机制 - 严格遵守】
当你需要在远程主机上执行命令时，你的回复中必须包含且仅包含一行 [EXEC: 命令内容]，不要附带任何其他文字。
系统会自动执行该命令并把真实输出返回给你，你再根据真实输出来判断下一步。
当任务全部完成或只需要回复用户时，用自然语言回复，不要输出 [EXEC:...]。

重要规则（违反这些规则会导致严重后果）：
1. 你绝对不能编造、猜测、假设命令的执行结果。你只能基于系统返回给你的真实输出进行回复。
2. 在收到命令执行结果之前，你不知道命令的输出是什么。不要说"回显如下"然后编造内容。
3. 每次只输出一条 [EXEC:...] 命令，等待结果后再决定下一步。
4. [EXEC:...] 命令必须单独占一行，格式为 [EXEC: 具体命令]，不要用 markdown 代码块包裹。
5. 如果用户质疑你的输出，说明你可能编造了结果，立即重新执行命令获取真实输出。

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

			systemPrompt += `

【SafeLine WAF API 操作 - 通过 API 管理雷池配置】
你可以直接通过 SafeLine OpenAPI 查询和管理雷池 WAF 的配置。
使用格式: [SAFEAPI: 操作名|参数1=值1|参数2=值2]

可用操作:
- get_system: 获取系统信息（版本、许可证等）
- get_license: 获取许可证详情
- get_nodes: 获取节点状态信息
- get_overview|时长=h: 获取防护总览统计（时长可选 h/d/w/M）
- get_websites: 获取所有站点列表（含域名、后端、健康检查状态）
- get_site|id=3: 获取指定站点详细配置
- create_site|域名=xxx|后端=ip:port|策略=3|健康检查=yes: 创建站点（策略默认3）
- delete_site|id=3: 删除指定站点
- toggle_site|id=3|启用=true: 启用或禁用站点
- get_policies: 获取所有防护策略组列表
- get_certs: 获取证书列表
- get_ip_groups: 获取所有 IP 组（黑名单/白名单）
- create_ip_group|名称=xxx|类型=黑名单|IP=1.2.3.4,5.6.7.8: 创建 IP 组（类型: 黑名单/白名单）
- delete_ip_group|id=3: 删除指定 IP 组
- get_logs|数量=20|过滤=xxx: 查询攻击日志（支持过滤关键词）
- get_acl: 获取自定义规则模板
- get_detector: 获取检测引擎状态

重要规则:
1. 查询操作(get_*)可以直接执行，创建/删除/修改操作前必须先告知用户即将执行的操作并征得确认
2. 每次只输出一个 [SAFEAPI:...] 调用，等待返回结果后再决定下一步
3. 创建站点时，后端地址格式为 ip:port（默认端口80）
4. 健康检查默认探测后端服务，创建站点时可指定 健康检查=yes 开启
5. 用户说大白话（如"帮我加个站点"），你需要自行提取参数并调用对应 API
6. 不要编造 API 返回结果，必须基于系统返回的真实数据回复
`


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
				respJSON, _ := json.Marshal(aiResp)
				log.Printf("[AI] empty content, raw response: %s", string(respJSON))
				errMsg := "AI 返回为空，请检查配置"
				s := string(respJSON)
				if len(s) > 500 { s = s[:500] + "..." }
				errMsg += "\nAPI 返回: " + s
				sseSend(map[string]interface{}{"type": "error", "content": errMsg})
				return nil
			}

				// Check if AI wants to call SafeLine API
				safeAPIAction := ""
				if idx := strings.Index(aiText, "[SAFEAPI:"); idx >= 0 {
					end := strings.Index(aiText[idx:], "]")
					if end > 0 {
						safeAPIAction = strings.TrimSpace(aiText[idx+9 : idx+end])
					}
				}
				if safeAPIAction != "" {
					sseSend(map[string]interface{}{"type": "turn", "role": "assistant", "content": aiText})
					apiResult := executeSafeAPI(safeAPIAction)
					sseSend(map[string]interface{}{"type": "turn", "role": "tool_result", "content": "SafeLine API 调用结果:\n" + apiResult})
					messages = append(messages,
						map[string]string{"role": "assistant", "content": aiText},
						map[string]string{"role": "user", "content": "[这是系统返回的真实 API 调用结果]\n" + apiResult + "\n请根据以上真实结果继续操作。"},
					)
					continue
				}


			// Check if AI wants to load a knowledge base file
			loadTarget := ""
			if idx := strings.Index(aiText, "[LOAD:"); idx >= 0 {
				end := strings.Index(aiText[idx:], "]")
				if end > 0 {
					loadTarget = strings.TrimSpace(aiText[idx+6 : idx+end])
				}
			}
			if loadTarget != "" {
				sseSend(map[string]interface{}{"type": "turn", "role": "assistant", "content": aiText})
				// Parse "kb-id/filename.md"
				parts := strings.SplitN(loadTarget, "/", 2)
				var loadResult string
				if len(parts) == 2 {
					fileContent, err := kbLoader.GetWikiFile(parts[0], parts[1])
					if err != nil {
						loadResult = fmt.Sprintf("加载失败: %s", err.Error())
					} else {
						loadResult = fmt.Sprintf("文件 %s/%s 已加载（%d 字符）:\n\n%s", parts[0], parts[1], len(fileContent), fileContent)
						loadedFullKBs[parts[0]] = true
					}
				} else {
					// Load entire KB
					kbID := loadTarget
					if wiki, err := kbLoader.GetWikiContent(kbID); err == nil {
						loadResult = fmt.Sprintf("知识库 %s 已完整加载（%d 字符）:\n\n%s", kbID, len(wiki.Content), wiki.Content)
						loadedFullKBs[kbID] = true
					} else {
						loadResult = fmt.Sprintf("加载失败: %s", err.Error())
					}
				}
				sseSend(map[string]interface{}{"type": "turn", "role": "tool_result", "content": loadResult})
				messages = append(messages,
					map[string]string{"role": "assistant", "content": aiText},
					map[string]string{"role": "user", "content": loadResult + "\n请根据以上内容继续回答。"},
				)
				continue
			}

			// Check if AI wants to execute a command
			// Support formats: [EXEC: cmd], ```bash\ncmd\n```, `cmd`
			execCmd := ""
			if idx := strings.Index(aiText, "[EXEC:"); idx >= 0 {
				end := strings.Index(aiText[idx:], "]")
				if end > 0 {
					execCmd = strings.TrimSpace(aiText[idx+6 : idx+end])
				}
			}
			if execCmd == "" {
				// Try markdown code block: ```bash ... ``` or ``` ... ```
				for _, re := range []*regexp.Regexp{
					regexp.MustCompile("(?s)```(?:bash|sh)?\\s*\\n([^\n].*?)\\n```"),
				} {
					if m := re.FindStringSubmatch(aiText); len(m) > 1 {
						candidate := strings.TrimSpace(m[1])
						if candidate != "" && !strings.Contains(candidate, "请") {
							execCmd = candidate
							break
						}
					}
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

			// Feed result back to AI — emphasize this is real output
			messages = append(messages,
				map[string]string{"role": "assistant", "content": aiText},
				map[string]string{"role": "user", "content": "[这是系统返回的真实命令执行结果，你必须基于此结果回复]\n命令: " + execCmd + "\n输出:\n" + cmdOutput + "\n请根据以上真实结果继续操作。"},
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

	// Try original URL first, if fails and URL doesn't end with /v1, retry with /v1 appended
	urls := []string{apiURL + "/chat/completions"}
	if !strings.HasSuffix(apiURL, "/v1") {
		urls = append(urls, apiURL+"/v1/chat/completions")
	}

	var lastErr error
	for _, fullURL := range urls {
		httpReq, err := http.NewRequest("POST", fullURL, bytes.NewBuffer(body))
		if err != nil {
			return fmt.Errorf("failed to build request: %w", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
		httpResp, err := (&http.Client{Timeout: 120 * time.Second}).Do(httpReq)
		if err != nil {
			lastErr = fmt.Errorf("请求失败: %w", err)
			continue
		}
		respBody, _ := io.ReadAll(httpResp.Body)
		httpResp.Body.Close()
		log.Printf("[AI] url=%s status=%d body=%s", fullURL, httpResp.StatusCode, string(respBody))

		if httpResp.StatusCode == 200 {
			json.Unmarshal(respBody, resp)
			return nil
		}

		// Non-200: extract error message
		var errResp map[string]interface{}
		json.Unmarshal(respBody, &errResp)
		msg := string(respBody)
		if errMsg, ok := errResp["error"].(map[string]interface{}); ok {
			if m, ok := errMsg["message"].(string); ok {
				msg = m
			}
		}
		lastErr = fmt.Errorf("API 返回 HTTP %d: %s", httpResp.StatusCode, msg)
		// If got a proper API error (not redirect), don't retry
		if httpResp.StatusCode >= 400 && httpResp.StatusCode < 500 && httpResp.StatusCode != 404 {
			return lastErr
		}
	}
	return lastErr
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// executeSafeAPI parses and executes a SafeLine API action from AI
// Format: "action|param1=val1|param2=val2"
func executeSafeAPI(action string) string {
	cfg := loadSafelineConfigPkg()
	url := cfg["url"]
	token := cfg["token"]
	if url == "" || token == "" {
		return "[错误] 未配置雷池 API 连接。请先在「雷池管理」页面配置 API 地址和 Token。"
	}
	client := safeline.NewClient(url, token)

	parts := strings.Split(action, "|")
	op := strings.TrimSpace(parts[0])
	params := map[string]string{}
	for _, p := range parts[1:] {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) == 2 {
			params[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}

	switch op {
	case "get_system":
		info, err := client.GetSystemInfo()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(info, "", "  ")
		return string(out)

	case "get_license":
		resp, err := client.GetLicense()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp, "", "  ")
		return string(out)

	case "get_nodes":
		resp, err := client.GetNodeInfo()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp, "", "  ")
		return string(out)

	case "get_overview":
		duration := params["时长"]
		if duration == "" {
			duration = "h"
		}
		resp, err := client.GetOverview(duration, map[string]string{})
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp, "", "  ")
		return string(out)

	case "get_websites":
		resp, err := client.GetWebsites("SoftwareReverseProxy")
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		type siteSummary struct {
			ID          int                     `json:"id"`
			Name        string                  `json:"name"`
			ServerNames []string                `json:"server_names"`
			IsEnabled   bool                    `json:"is_enabled"`
			PolicyGroup interface{}             `json:"policy_group"`
			Servers     []map[string]interface{} `json:"servers"`
			HealthCheck interface{}             `json:"health_check_status"`
		}
		items, _ := resp.Data.([]interface{})
		var summaries []siteSummary
		for _, item := range items {
			m, _ := item.(map[string]interface{})
			s := siteSummary{ID: int(m["id"].(float64))}
			if v, ok := m["name"].(string); ok {
				s.Name = v
			}
			if v, ok := m["server_names"].([]interface{}); ok {
				for _, sn := range v {
					if snStr, ok := sn.(string); ok {
						s.ServerNames = append(s.ServerNames, snStr)
					}
				}
			}
			s.IsEnabled = m["is_enabled"].(bool)
			s.PolicyGroup = m["policy_group"]
			if bc, ok := m["backend_config"].(map[string]interface{}); ok {
				if hcs, ok := bc["health_check_status"].(string); ok {
					s.HealthCheck = hcs
				}
				if srvs, ok := bc["servers"].([]interface{}); ok {
					for _, srv := range srvs {
						if sm, ok := srv.(map[string]interface{}); ok {
							s.Servers = append(s.Servers, map[string]interface{}{"host": sm["host"], "port": sm["port"]})
						}
					}
				}
			}
			summaries = append(summaries, s)
		}
		out, _ := json.MarshalIndent(summaries, "", "  ")
		return fmt.Sprintf("共 %d 个站点:\n%s", len(summaries), string(out))

	case "get_site":
		id, _ := strconv.Atoi(params["id"])
		if id == 0 {
			return "[错误] 缺少参数 id"
		}
		resp, err := client.GetWebsite("SoftwareReverseProxy", id)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	case "create_site":
		domain := params["域名"]
		upstream := params["后端"]
		if domain == "" || upstream == "" {
			return "[错误] 创建站点需要至少提供域名和后端地址"
		}
		policyGroup := 3
		if pg := params["策略"]; pg != "" {
			policyGroup, _ = strconv.Atoi(pg)
		}
		upstreamHost := upstream
		upstreamPort := 80
		if idx := strings.LastIndex(upstream, ":"); idx > 0 {
			upstreamHost = upstream[:idx]
			upstreamPort, _ = strconv.Atoi(upstream[idx+1:])
		}
		hcEnabled := strings.ToLower(params["健康检查"]) == "yes" || strings.ToLower(params["健康检查"]) == "true"
		hcProtocol := params["hc协议"]
		if hcProtocol == "" {
			hcProtocol = "http"
		}
		hcHost := params["hc地址"]
		if hcHost == "" {
			hcHost = upstreamHost
		}
		hcPort := params["hc端口"]
		if hcPort == "" {
			hcPort = strconv.Itoa(upstreamPort)
		}
		hcPortInt, _ := strconv.Atoi(hcPort)

		site := map[string]interface{}{
			"mode": "SoftwareReverseProxy", "name": domain,
			"server_names": []string{domain}, "ip": []string{"0.0.0.0", "::"}, "interface": "virtual",
			"ports":              []map[string]interface{}{{"port": 80, "ssl": false, "http2": false, "sni": false, "is_double_cert": false}},
			"backend_config": map[string]interface{}{
				"type": "proxy", "load_balance_policy": "Round Robin", "x_forwarded_for_action": "append",
				"servers": []map[string]interface{}{{"host": upstreamHost, "port": upstreamPort, "protocol": "http", "weight": 1, "is_enabled": true}},
				"health_check_config": map[string]interface{}{
					"is_enabled": hcEnabled, "check_type": hcProtocol, "host": hcHost, "port": hcPortInt,
					"path": "/", "method": "GET", "interval": 10000, "timeout": 5000, "fall": 3, "rise": 2,
					"check_http_expect_alive": []string{"http_2xx", "http_3xx"},
				},
			},
			"session_method":      map[string]interface{}{"type": "off"},
			"advanced_cache":      false, "ignore_cert": false, "ntlm_enabled": false,
			"url_paths":           []map[string]interface{}{{"op": "pre", "url_path": "/"}},
			"detector_ip_source":  []string{"Socket"}, "detector_ip_source_from": "local",
			"access_log":          map[string]interface{}{"is_enabled": true, "log_option": "Non-Persistence", "req_body": true, "rsp_body": false, "log_request_header": false, "log_response_header": false},
			"proxy_bind_config":   map[string]interface{}{"enable": false, "hash_select_ip_method": "remote_addr_and_port", "proxy_ip_list": nil},
			"selected_tengine":    map[string]interface{}{"tengine_list": nil, "type": "all"},
			"asset_group":         1, "ssl_cert": nil, "ssl_ciphers": "", "ssl_gm_cert": nil, "ssl_protocols": []interface{}{}, "remark": "",
			"policy_group":        policyGroup,
		}
		resp, err := client.CreateWebsite("SoftwareReverseProxy", site)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		if resp.Err != nil {
			return fmt.Sprintf("[错误] %v", resp.Err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return "站点创建成功！\n" + string(out)

	case "delete_site":
		id, _ := strconv.Atoi(params["id"])
		if id == 0 {
			return "[错误] 缺少参数 id"
		}
		resp, err := client.DeleteWebsite("SoftwareReverseProxy", id)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		if resp.Err != nil {
			return fmt.Sprintf("[错误] %v", resp.Err)
		}
		return "站点已成功删除"

	case "toggle_site":
		id, _ := strconv.Atoi(params["id"])
		if id == 0 {
			return "[错误] 缺少参数 id"
		}
		enabled := true
		if v := params["启用"]; v != "" {
			enabled = v == "true" || v == "yes"
		}
		resp, err := client.ToggleWebsite(id, enabled)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		if resp.Err != nil {
			return fmt.Sprintf("[错误] %v", resp.Err)
		}
		return fmt.Sprintf("站点已%s", map[bool]string{true: "启用", false: "禁用"}[enabled])

	case "get_policies":
		resp, err := client.GetPolicyGroups()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		type policySummary struct {
			ID   int
			Name string
		}
		var summaries []policySummary
		if items, ok := resp.Data.([]interface{}); ok {
			for _, item := range items {
				m, _ := item.(map[string]interface{})
				summaries = append(summaries, policySummary{ID: int(m["id"].(float64)), Name: getString(m, "name")})
			}
		}
		out, _ := json.MarshalIndent(summaries, "", "  ")
		return fmt.Sprintf("共 %d 个策略组:\n%s", len(summaries), string(out))

	case "get_certs":
		resp, err := client.GetCerts()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	case "get_ip_groups":
		resp, err := client.GetIPGroups()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	case "create_ip_group":
		name := params["名称"]
		if name == "" {
			return "[错误] 缺少参数 名称"
		}
		ipType := 1
		if v := params["类型"]; v == "白名单" || v == "whitelist" || v == "0" {
			ipType = 0
		}
		var ipList []string
		if ips := params["IP"]; ips != "" {
			ipList = strings.Split(ips, ",")
		}
		group := map[string]interface{}{"name": name, "type": ipType, "ip_list": ipList}
		resp, err := client.CreateIPGroup(group)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		if resp.Err != nil {
			return fmt.Sprintf("[错误] %v", resp.Err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return "IP 组创建成功！\n" + string(out)

	case "delete_ip_group":
		id, _ := strconv.Atoi(params["id"])
		if id == 0 {
			return "[错误] 缺少参数 id"
		}
		resp, err := client.DeleteIPGroup(id)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		if resp.Err != nil {
			return fmt.Sprintf("[错误] %v", resp.Err)
		}
		return "IP 组已成功删除"

	case "get_logs":
		count := 20
		if v := params["数量"]; v != "" {
			count, _ = strconv.Atoi(v)
		}
		offset := 0
		if v := params["偏移"]; v != "" {
			offset, _ = strconv.Atoi(v)
		}
		filter := params["过滤"]
		resp, err := client.GetAttackLogs("log:detect_log", filter, count, offset)
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	case "get_acl":
		resp, err := client.GetACLRuleTemplates()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	case "get_detector":
		resp, err := client.GetDetectorState()
		if err != nil {
			return fmt.Sprintf("[错误] %s", err)
		}
		out, _ := json.MarshalIndent(resp.Data, "", "  ")
		return string(out)

	default:
		return fmt.Sprintf("[错误] 未知的 SafeLine API 操作: %s\n可用操作: get_system, get_license, get_nodes, get_overview, get_websites, get_site, create_site, delete_site, toggle_site, get_policies, get_certs, get_ip_groups, create_ip_group, delete_ip_group, get_logs, get_acl, get_detector", op)
	}
}
