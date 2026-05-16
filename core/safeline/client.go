package safeline

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// urlEncode encodes a string for safe use in URL query parameters
func urlEncode(s string) string {
	return url.QueryEscape(s)
}

// Client wraps SafeLine OpenAPI calls
type Client struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
}

// NewClient creates a new SafeLine API client (skips TLS verification for self-signed certs)
func NewClient(baseURL, apiToken string) *Client {
	return &Client{
		BaseURL:  baseURL,
		APIToken: apiToken,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

// SLResponse is the standard SafeLine API response format
type SLResponse struct {
	Err  interface{} `json:"err"`
	Msg  interface{} `json:"msg"`
	Data interface{} `json:"data"`
}

func (c *Client) doRequest(method, path string, body interface{}) (*SLResponse, error) {
	var reqBody io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reqBody = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("API-Token", c.APIToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respData, _ := io.ReadAll(resp.Body)
	var slResp SLResponse
	if err := json.Unmarshal(respData, &slResp); err != nil {
		return nil, fmt.Errorf("parse response: %w (body: %s)", err, string(respData))
	}
	return &slResp, nil
}

// TestConnection tests the API connection by fetching profile
func (c *Client) TestConnection() (*SLResponse, error) {
	return c.doRequest("GET", "/api/ProfileAPI", nil)
}

// GetProfile returns current user info
func (c *Client) GetProfile() (*SLResponse, error) {
	return c.doRequest("GET", "/api/ProfileAPI", nil)
}

// GetNodeList returns node IDs
func (c *Client) GetNodeList() (*SLResponse, error) {
	return c.doRequest("GET", "/api/NodeListAPI", nil)
}

// GetNodeInfo returns detailed node status (CPU, memory, containers, services, etc.)
func (c *Client) GetNodeInfo() (*SLResponse, error) {
	return c.doRequest("GET", "/api/NodeInfoAPI", nil)
}

// GetLicense returns license info
func (c *Client) GetLicense() (*SLResponse, error) {
	return c.doRequest("GET", "/api/LicenseAPI", nil)
}

// GetOverview returns stats overview
// duration: h (24h), today, yesterday, d (30d), 7doh (7d by hour)
func (c *Client) GetOverview(duration string, params map[string]string) (*SLResponse, error) {
	path := fmt.Sprintf("/api/OverviewAPI?duration=%s", urlEncode(duration))
	for k, v := range params {
		path += "&" + urlEncode(k) + "=" + urlEncode(v)
	}
	return c.doRequest("GET", path, nil)
}

// GetWebsites returns website list for the given operation mode
func (c *Client) GetWebsites(mode string) (*SLResponse, error) {
	return c.doRequest("GET", "/api/"+mode+"WebsiteAPI", nil)
}

// GetWebsite returns a single website by ID
func (c *Client) GetWebsite(mode string, id int) (*SLResponse, error) {
	return c.doRequest("GET", "/api/"+mode+"WebsiteAPI?id="+fmt.Sprintf("%d", id), nil)
}

// CreateWebsite creates a new website
func (c *Client) CreateWebsite(mode string, site map[string]interface{}) (*SLResponse, error) {
	return c.doRequest("POST", "/api/"+mode+"WebsiteAPI", site)
}

// UpdateWebsite updates an existing website (requires full object)
func (c *Client) UpdateWebsite(mode string, site map[string]interface{}) (*SLResponse, error) {
	return c.doRequest("PUT", "/api/"+mode+"WebsiteAPI", site)
}

// DeleteWebsite deletes a website
func (c *Client) DeleteWebsite(mode string, id int) (*SLResponse, error) {
	return c.doRequest("DELETE", "/api/"+mode+"WebsiteAPI", map[string]interface{}{
		"id":                    id,
		"delete_all_resources": true,
	})
}

// ToggleWebsite enables or disables a website
func (c *Client) ToggleWebsite(id int, enabled bool) (*SLResponse, error) {
	action := "enable"
	if !enabled {
		action = "disable"
	}
	return c.doRequest("PUT", "/api/EnableDisableWebsiteAPI", map[string]interface{}{
		"id":         id,
		"is_enabled": enabled,
		"action":     action,
	})
}

// GetIPGroups returns IP group list
func (c *Client) GetIPGroups() (*SLResponse, error) {
	return c.doRequest("GET", "/api/IPGroupAPI", nil)
}

// CreateIPGroup creates a new IP group
func (c *Client) CreateIPGroup(group map[string]interface{}) (*SLResponse, error) {
	return c.doRequest("POST", "/api/IPGroupAPI", group)
}

// DeleteIPGroup deletes an IP group
func (c *Client) DeleteIPGroup(id int) (*SLResponse, error) {
	return c.doRequest("DELETE", "/api/IPGroupAPI", map[string]interface{}{
		"id":                    id,
		"delete_all_resources": true,
	})
}

// GetPolicyGroups returns policy group list
func (c *Client) GetPolicyGroups() (*SLResponse, error) {
	return c.doRequest("GET", "/api/PolicyGroupAPI", nil)
}

// GetCerts returns certificate list
func (c *Client) GetCerts() (*SLResponse, error) {
	return c.doRequest("GET", "/api/CertAPI", nil)
}

// GetAttackLogs queries attack detection logs
func (c *Client) GetAttackLogs(scope, filter string, count, offset int) (*SLResponse, error) {
	path := fmt.Sprintf("/api/FilterV2API?scope=%s&count=%d&offset=%d", urlEncode(scope), count, offset)
	if filter != "" {
		path += "&q=" + urlEncode(filter)
	}
	return c.doRequest("GET", path, nil)
}

// GetESIndices returns ES index info
func (c *Client) GetESIndices(alias string) (*SLResponse, error) {
	return c.doRequest("GET", "/api/ESIndices?alias="+urlEncode(alias), nil)
}

// GetACLRuleTemplates returns ACL rule templates
func (c *Client) GetACLRuleTemplates() (*SLResponse, error) {
	return c.doRequest("GET", "/api/ACLRuleTemplateAPI", nil)
}

// GetACLWhiteList returns ACL whitelist
func (c *Client) GetACLWhiteList() (*SLResponse, error) {
	return c.doRequest("GET", "/api/ACLWhiteListAPI", nil)
}

// CreateACLRuleTemplate creates an ACL rule template
func (c *Client) CreateACLRuleTemplate(tpl map[string]interface{}) (*SLResponse, error) {
	return c.doRequest("POST", "/api/ACLRuleTemplateAPI", tpl)
}

// GetLogFlagConfig returns log flag config
func (c *Client) GetLogFlagConfig() (*SLResponse, error) {
	return c.doRequest("GET", "/api/LogFlagConfig", nil)
}

// GetDetectorState returns detector config state
func (c *Client) GetDetectorState() (*SLResponse, error) {
	return c.doRequest("GET", "/api/DetectorConfigStateAPI", nil)
}

// GetTrafficLearningOverview returns traffic learning overview
func (c *Client) GetTrafficLearningOverview() (*SLResponse, error) {
	return c.doRequest("GET", "/api/traffic_learning/v1/Overview", nil)
}

// GetVenderInfo returns product/vendor info
func (c *Client) GetVenderInfo() (*SLResponse, error) {
	return c.doRequest("GET", "/api/VenderInfoAPI", nil)
}

// GetSystemInfo returns hostname, version, etc.
func (c *Client) GetSystemInfo() (map[string]interface{}, error) {
	hostname, _ := c.GetProfile()
	vendor, _ := c.GetVenderInfo()
	license, _ := c.GetLicense()
	nodes, _ := c.GetNodeList()
	info := map[string]interface{}{
		"hostname":       extractData(hostname),
		"vendor":         extractData(vendor),
		"license":        extractData(license),
		"nodes":          extractData(nodes),
	}
	return info, nil
}
