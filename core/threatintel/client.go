package threatintel

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

type ThreatItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Source      string `json:"source"`
	Severity    string `json:"severity"`
	PublishedAt string `json:"published_at"`
	URL         string `json:"url"`
	Summary     string `json:"summary"`
}

type AnalysisResult struct {
	ThreatID        string   `json:"threat_id"`
	Affected        bool     `json:"affected"`
	Reason          string   `json:"reason"`
	VulnPrinciple   string   `json:"vuln_principle,omitempty"`
	VulnDetail      string   `json:"vuln_detail,omitempty"`
	Solution        string   `json:"solution,omitempty"`
	AnalyzedAt      string   `json:"analyzed_at"`
	AffectedHosts   []string `json:"affected_hosts,omitempty"`
}

type FixAnalysis struct {
	Safe        bool     `json:"safe"`
	Reason      string   `json:"reason"`
	Commands    []string `json:"commands"`
	TargetHosts []string `json:"target_hosts"`
	Warning     string   `json:"warning,omitempty"`
}

type Cache struct {
	Threats    []ThreatItem              `json:"threats"`
	Results    map[string]AnalysisResult `json:"results"`
	Dismissed  []string                  `json:"dismissed,omitempty"`
	LastFetch  string                    `json:"last_fetch"`
}

type EnvComponent struct {
	Name   string
	Search string
}

func FetchThreats(components []EnvComponent) ([]ThreatItem, error) {
	if len(components) == 0 {
		return nil, fmt.Errorf("未发现环境组件，请先添加主机或配置长亭产品")
	}
	client := &http.Client{Timeout: 30 * time.Second}
	now := time.Now()
	startDate := now.AddDate(0, 0, -90).Format("2006-01-02T15:04:05.000")
	endDate := now.Add(24 * time.Hour).Format("2006-01-02T15:04:05.000")
	seen := make(map[string]bool)
	var allItems []ThreatItem
	for i, comp := range components {
		var items []ThreatItem
		var err error
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				wait := 30 * time.Second
				log.Printf("[TI] NVD 429限流，等待 %v 后重试 '%s' (第%d次)", wait, comp.Search, attempt+1)
				time.Sleep(wait)
			}
			log.Printf("[TI] querying NVD [%d/%d] keyword='%s' source='%s'", i+1, len(components), comp.Search, comp.Name)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			items, err = queryNVD(ctx, client, comp.Search, comp.Name, startDate, endDate)
			cancel()
			if err != nil {
				if strings.Contains(err.Error(), "429") {
					continue
				}
				log.Printf("[TI] NVD query failed for %s (%s): %v", comp.Name, comp.Search, err)
				break
			}
			log.Printf("[TI] NVD query '%s' returned %d items", comp.Search, len(items))
			break
		}
		for _, item := range items {
			if !seen[item.ID] {
				seen[item.ID] = true
				allItems = append(allItems, item)
			}
		}
		time.Sleep(6 * time.Second)
	}
	sort.Slice(allItems, func(i, j int) bool {
		return allItems[i].PublishedAt > allItems[j].PublishedAt
	})
	if len(allItems) > 1000 {
		allItems = allItems[:1000]
	}
	return allItems, nil
}

func queryNVD(ctx context.Context, client *http.Client, keyword, source, startDate, endDate string) ([]ThreatItem, error) {
	apiURL := fmt.Sprintf("https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=%s&pubStartDate=%s&pubEndDate=%s&resultsPerPage=200",
		url.QueryEscape(keyword), url.QueryEscape(startDate), url.QueryEscape(endDate))
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ChaitinVirtualEngineer/2.1 (+https://chaitin.com)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("NVD HTTP 429")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("NVD HTTP %d", resp.StatusCode)
	}
	if resp.Header.Get("X-RateLimit-Remaining") == "0" {
		log.Printf("[TI] NVD rate limit hit for %s", keyword)
		time.Sleep(30 * time.Second)
		return nil, fmt.Errorf("NVD rate limited")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, err
	}
	var nvdResp nvdResponse
	if err := json.Unmarshal(body, &nvdResp); err != nil {
		return parseNVDResponse(body, source), nil
	}
	items := parseNVDResponse(body, source)
	if nvdResp.TotalResults > 200 {
		log.Printf("[TI] NVD query '%s' has %d results (got %d), fetching page 2", keyword, nvdResp.TotalResults, len(items))
		time.Sleep(700 * time.Millisecond)
		page2URL := fmt.Sprintf("https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=%s&pubStartDate=%s&pubEndDate=%s&resultsPerPage=200&startIndex=200",
			url.QueryEscape(keyword), url.QueryEscape(startDate), url.QueryEscape(endDate))
		req2, err := http.NewRequest("GET", page2URL, nil)
		if err == nil {
			req2.Header.Set("User-Agent", "ChaitinVirtualEngineer/2.1 (+https://chaitin.com)")
			resp2, err := client.Do(req2)
			if err == nil {
				defer resp2.Body.Close()
				if resp2.StatusCode == 200 {
					body2, err := io.ReadAll(io.LimitReader(resp2.Body, 5*1024*1024))
					if err == nil {
						items = append(items, parseNVDResponse(body2, source)...)
					}
				} else {
					log.Printf("[TI] NVD page 2 HTTP %d for '%s'", resp2.StatusCode, keyword)
				}
			}
		}
	}
	return items, nil
}

func LookupCVE(client *http.Client, cveID string) ([]ThreatItem, error) {
	apiURL := fmt.Sprintf("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=%s", url.QueryEscape(cveID))
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ChaitinVirtualEngineer/2.1 (+https://chaitin.com)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("NVD HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return nil, err
	}
	return parseNVDResponse(body, "CVE直接查询"), nil
}

type nvdResponse struct {
	TotalResults   int `json:"totalResults"`
	Vulnerabilities []struct {
		CVE struct {
			ID           string `json:"id"`
			Published    string `json:"published"`
			Descriptions []struct {
				Lang  string `json:"lang"`
				Value string `json:"value"`
			} `json:"descriptions"`
			Metrics struct {
				CvssMetricV31 []struct {
					CvssData struct {
						BaseScore    float64 `json:"baseScore"`
						BaseSeverity string  `json:"baseSeverity"`
					} `json:"cvssData"`
				} `json:"cvssMetricV31"`
			} `json:"metrics"`
		} `json:"cve"`
	} `json:"vulnerabilities"`
}

func parseNVDResponse(data []byte, source string) []ThreatItem {
	var resp nvdResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil
	}
	var items []ThreatItem
	for _, v := range resp.Vulnerabilities {
		cveID := v.CVE.ID
		desc := ""
		for _, d := range v.CVE.Descriptions {
			if d.Lang == "en" {
				desc = d.Value
				break
			}
		}
		if desc == "" && len(v.CVE.Descriptions) > 0 {
			desc = v.CVE.Descriptions[0].Value
		}
		summary := desc
		if len(summary) > 500 {
			summary = summary[:500] + "..."
		}
		severity := "low"
		if len(v.CVE.Metrics.CvssMetricV31) > 0 {
			severity = strings.ToLower(v.CVE.Metrics.CvssMetricV31[0].CvssData.BaseSeverity)
		}
		shortTitle := extractShortTitle(desc)
		title := cveID
		if shortTitle != "" {
			title += " - " + shortTitle
		}
		h := sha256.Sum256([]byte(cveID))
		items = append(items, ThreatItem{
			ID: fmt.Sprintf("%x", h)[:16], Title: title, Source: source, Severity: severity,
			PublishedAt: v.CVE.Published, URL: "https://nvd.nist.gov/vuln/detail/" + cveID, Summary: summary,
		})
	}
	return items
}

func extractShortTitle(desc string) string {
	desc = strings.TrimSpace(desc)
	if idx := strings.Index(desc, "."); idx > 10 && idx < 120 {
		return desc[:idx]
	}
	if len(desc) > 100 {
		return desc[:100] + "..."
	}
	return desc
}

func BuildAnalysisPrompt(threat ThreatItem, envInfo string) string {
	return fmt.Sprintf(`你是一名资深安全研究员，擅长漏洞原理分析和安全评估。请对以下CVE进行深度技术分析，判断是否影响用户当前环境。

## CVE漏洞信息
- 编号: %s
- 来源标签: %s
- 严重程度: %s
- 发布时间: %s
- 漏洞描述: %s

## 用户当前环境
%s

## 分析要求（必须全部覆盖）
1. **影响判定**（affected）: 该CVE是否会影响用户环境。注意：不只是应用层软件，也包括底层组件！如果CVE影响Linux内核，那么所有运行Linux的主机（包括SafeLine WAF所在的宿主机、牧云Agent所在的主机、所有受管主机）都应视为受影响。如果CVE影响nginx/OpenSSL/OpenSSH/Docker等通用组件，只要环境中任意主机安装了这些组件就视为受影响。
2. **影响分析原因**（reason）: 详细说明为什么影响/不影响，引用具体的环境信息
3. **漏洞原理**（vuln_principle）: 用中文解释该漏洞的技术原理——什么类型的漏洞（缓冲区溢出/注入/反序列化/权限提升等）、触发条件是什么、攻击者能利用它做什么、可能的攻击路径。让非安全专业的人员也能理解。
4. **漏洞技术细节**（vuln_detail）: 受影响的具体组件名称和版本范围、漏洞触发的前提条件、CVSS评分中各维度的含义（攻击复杂度、所需权限等）。如果CVE信息不足，基于已知信息合理推断。
5. **修复方案**（solution，仅affected=true时）: 提供尽可能具体的修复建议——升级到哪个版本、修改什么配置、临时缓解措施。如果需要升级SafeLine等长亭产品，说明需要升级到的具体版本要求。
6. **受影响主机**（affected_hosts）: 受影响主机的名称列表

## 输出格式（严格JSON）
{"affected": true/false, "reason": "详细影响分析", "vuln_principle": "漏洞原理通俗解释", "vuln_detail": "受影响组件/版本/条件等技术细节", "solution": "具体修复建议", "affected_hosts": ["主机名"]}

要求：
- vuln_principle 至少150字，用中文解释清楚漏洞是什么、怎么产生的、会造成什么后果
- vuln_detail 至少100字，包含受影响组件、版本范围、触发条件
- solution（affected=true时必须填写）：
  * 如果有官方补丁：说明需要升级到的版本号、获取方式
  * 如果暂无官方补丁：必须提供临时缓解措施！例如：禁用相关功能模块、修改配置降低风险、使用WAF规则拦截、限制访问权限、临时回退到安全版本等
  * 绝对不允许返回"无修复方案"或"暂无解决方案"！即使没有补丁也要给出可行的缓解建议
- affected=false 时，reason 要详细解释为什么不受影响
请直接输出 JSON，不要附加其他文字。`, threat.Title, threat.Source, threat.Severity, threat.PublishedAt, threat.Summary, envInfo)
}

func BuildFixPrompt(threat ThreatItem, result AnalysisResult, envInfo string) string {
	return fmt.Sprintf(`你是一名资深安全运维工程师。针对以下CVE漏洞，请生成修复命令并评估安全性。

## CVE漏洞信息
- 标题: %s
- 严重程度: %s
- 详情: %s

## AI 分析结果
- 是否影响环境: %v
- 影响原因: %s
- 漏洞原理: %s
- 修复方案: %s
- 受影响主机: %s

## 用户当前环境
%s

## 修复策略（必须严格遵守）

1. **优先临时缓解方案**：必须先给出临时缓解措施（如黑名单内核模块、降级软件包、修改配置文件、添加防火墙规则等），避免直接升级内核或重启系统
2. **禁止直接重启**：不要在 commands 中包含 reboot 命令。如果修复需要重启，在 warning 中说明，让用户决定是否重启
3. **根据操作系统生成命令**：必须根据环境信息中每台主机的 OS 类型生成对应的命令（Ubuntu/Debian 用 apt，CentOS/RHEL 用 yum/dnf，Alpine 用 apk），禁止混用不同包管理器
4. **一条命令对应一个操作**：每条 command 只包含一个完整操作，不要用 || 或 && 拼接不同包管理器的命令

## 安全评估要求

判断修复命令是否会影响环境中**已部署的任何产品或服务**。必须基于环境信息中的实际技术栈做精准判断。

### 判定方法

1. **内核模块卸载**（如 rmmod + 黑名单）：通常安全
   - algif_aead/algif_skcipher 等内核加密模块：nginx/openssl/docker 使用用户态加密库，不依赖 → safe=true
   - netfilter/iptables/nftables 模块：Docker/防火墙依赖 → safe=false
   - eBPF/audit 模块：安全监控类产品依赖 → safe=false

2. **软件包升级**（apt/yum）：
   - 小版本升级：通常安全 → safe=true
   - 大版本升级或内核升级：可能破坏兼容性 → safe=false
   - 升级 glibc/systemd 等基础包：影响范围大 → safe=false

3. **配置修改**：通常不影响运行 → safe=true

4. **漏洞不影响当前环境**：safe=true，commands 和 target_hosts 为空数组

### 关键要求
- 必须给出**具体的技术理由**，禁止写"可能影响"、"建议联系厂商"这类模糊结论
- safe=false 时，warning 必须明确说明**哪个具体服务**会受影响、**为什么**受影响
- 临时缓解方案绝大多数情况下 safe=true

## 输出格式（JSON）
{"safe": true/false, "reason": "具体技术评估理由", "commands": ["命令1", "命令2"], "target_hosts": ["主机名1"], "warning": "具体的警告信息（仅safe=false时填写，必须说明哪个服务受影响以及原因）"}

请直接输出 JSON，不要附加其他文字。`,
		threat.Title, threat.Severity, threat.Summary,
		result.Affected, result.Reason, result.VulnPrinciple, result.Solution,
		strings.Join(result.AffectedHosts, ", "),
		envInfo)
}

// EnvRuntimeInfo holds dynamically collected runtime info for fix assessment
type EnvRuntimeInfo struct {
	Products       []ProductInfo     `json:"products"`
	HostServices   map[string]string `json:"host_services"`   // host -> service list
	HostOS         map[string]string `json:"host_os"`         // host -> OS info
	DockerImages   []string          `json:"docker_images,omitempty"`
	LoadedModules  []string          `json:"loaded_modules,omitempty"`
}

type ProductInfo struct {
	Name    string `json:"name"`
	Type    string `json:"type"` // waf, hids, scanner, etc.
	Address string `json:"address,omitempty"`
	Status  string `json:"status"`
}

func CollectEnvInfo(products []ProductInfo, hosts []map[string]string, hostServices map[string]string) string {
	var sb strings.Builder

	if len(products) > 0 {
		sb.WriteString("### 已配置的安全产品\n")
		for _, p := range products {
			line := fmt.Sprintf("- %s (类型: %s, 状态: %s", p.Name, p.Type, p.Status)
			if p.Address != "" {
				line += ", 地址: " + p.Address
			}
			line += ")\n"
			sb.WriteString(line)
		}
	}

	if len(hostServices) > 0 {
		sb.WriteString("\n### 主机上检测到的服务及版本\n")
		for svc, ver := range hostServices {
			sb.WriteString(fmt.Sprintf("- %s: %s\n", svc, ver))
		}
	}

	if len(hosts) > 0 {
		sb.WriteString("\n### 受管主机\n")
		for _, h := range hosts {
			name := h["name"]
			os := h["os"]
			ip := h["host"]
			if name == "" {
				name = ip
			}
			sb.WriteString(fmt.Sprintf("- %s (IP: %s, OS: %s)\n", name, ip, os))
		}
	}

	return sb.String()
}

var hostOSCache = struct {
	sync.RWMutex
	data map[string]string
	time time.Time
}{}

func GetHostOS(id, cmd, stdout string) {
	hostOSCache.Lock()
	defer hostOSCache.Unlock()
	if hostOSCache.data == nil {
		hostOSCache.data = make(map[string]string)
	}
	if cmd != "" {
		hostOSCache.data[id] = parseOSOutput(stdout)
	} else {
		delete(hostOSCache.data, id)
	}
	hostOSCache.time = time.Now()
}

func GetHostOSMap() map[string]string {
	hostOSCache.RLock()
	defer hostOSCache.RUnlock()
	m := make(map[string]string, len(hostOSCache.data))
	for k, v := range hostOSCache.data {
		m[k] = v
	}
	return m
}

func HostOSCacheExpired() bool {
	hostOSCache.RLock()
	defer hostOSCache.RUnlock()
	return hostOSCache.data == nil || time.Since(hostOSCache.time) > 24*time.Hour
}

func parseOSOutput(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
		}
	}
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			return strings.TrimSpace(line)
		}
	}
	return output
}

func IsURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && u.Host != ""
}
