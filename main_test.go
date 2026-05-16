package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/chaitin-virtual-engineer/models"
)

func TestAPIConfigFromRequestPrefersCurrentInput(t *testing.T) {
	saved := map[string]string{"url": "https://old.example", "token": "old-token"}
	body := strings.NewReader(`{"url":"https://new.example","token":"new-token"}`)

	cfg, err := apiConfigFromRequest(body, saved)
	if err != nil {
		t.Fatalf("apiConfigFromRequest returned error: %v", err)
	}
	if cfg["url"] != "https://new.example" || cfg["token"] != "new-token" {
		t.Fatalf("expected current request config, got %#v", cfg)
	}
}

func TestAPIConfigFromRequestFallsBackToSavedConfig(t *testing.T) {
	saved := map[string]string{"url": "https://saved.example", "token": "saved-token"}

	cfg, err := apiConfigFromRequest(strings.NewReader(`{}`), saved)
	if err != nil {
		t.Fatalf("apiConfigFromRequest returned error: %v", err)
	}
	if cfg["url"] != saved["url"] || cfg["token"] != saved["token"] {
		t.Fatalf("expected saved config fallback, got %#v", cfg)
	}
}

func TestApplyHostUpdateCanExplicitlyClearSecrets(t *testing.T) {
	host := &models.Host{Password: "ssh-pass", PrivateKey: "key", PkgPass: "pkg", SudoPass: "sudo"}
	raw := map[string]interface{}{
		"clear_password":    true,
		"clear_private_key": true,
		"clear_pkg_pass":    true,
		"clear_sudo_pass":   true,
	}

	applyHostUpdate(host, raw)

	if host.Password != "" || host.PrivateKey != "" || host.PkgPass != "" || host.SudoPass != "" {
		t.Fatalf("expected secrets cleared, got password=%q private_key=%q pkg=%q sudo=%q", host.Password, host.PrivateKey, host.PkgPass, host.SudoPass)
	}
}

func TestOpsUIHasCloudWalkerSpecificLifecycleCommands(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("ui", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	js := string(data)
	checks := []string{
		"function buildCloudWalkerInstallCommands",
		"/data/cloudwalker",
		"-C ' + shQuote(installDir)",
		"function runCloudWalkerUpgrade",
		"function runCloudWalkerUninstall",
		"healthcheck.timer",
		"./minion compose down",
		"https://$(hostname -I | awk",
	}
	for _, want := range checks {
		if !strings.Contains(js, want) {
			t.Fatalf("ui/app.js missing CloudWalker-specific behavior marker: %s", want)
		}
	}
	if strings.Contains(js, "_opsProduct.id === 'safeline' ? '/data/safeline' : '/opt/' + _opsProduct.id") {
		t.Fatalf("CloudWalker still defaults to /opt/cloudwalker instead of /data/cloudwalker")
	}
}

func TestOpsUIUsesInstallDirForSafeLineManagementCertificate(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("ui", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	js := string(data)
	if !strings.Contains(js, "extractMgmtCredentials(hostId, modeOpts.installDir") {
		t.Fatalf("management credential extraction must receive actual installDir")
	}
	if strings.Contains(js, "cat /data/safeline/resources/management/certs/minion.crt") {
		t.Fatalf("management certificate path is still hard-coded to /data/safeline")
	}
}

func TestJSONPayloadsAreValid(t *testing.T) {
	for _, payload := range []string{`{"url":"https://new.example","token":"new-token"}`, `{}`} {
		var m map[string]string
		if err := json.Unmarshal([]byte(payload), &m); err != nil {
			t.Fatalf("bad test payload: %v", err)
		}
	}
}
