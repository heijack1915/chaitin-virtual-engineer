package cloudwalker

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client wraps CloudWalker JSONRPC 2.0 API calls
type Client struct {
	BaseURL    string
	APIToken   string
	HTTPClient *http.Client
}

// NewClient creates a new CloudWalker API client
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

// CWResponse is the standard JSONRPC 2.0 response
type CWResponse struct {
	JsonRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *CWError        `json:"error"`
}

// CWError represents a JSONRPC error
type CWError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data"`
}

func (c *Client) doRequest(method string, params map[string]interface{}) (*CWResponse, error) {
	reqBody := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
		"id":      "0",
	}
	data, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST", c.BaseURL+"/rpc", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")
	if c.APIToken != "" {
		req.AddCookie(&http.Cookie{Name: "API-Token", Value: c.APIToken})
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respData, _ := io.ReadAll(resp.Body)
	var cwResp CWResponse
	if err := json.Unmarshal(respData, &cwResp); err != nil {
		return nil, fmt.Errorf("parse response: %w (body: %s)", err, string(respData))
	}
	return &cwResp, nil
}

func (c *Client) rawRequest(method string, params map[string]interface{}) (json.RawMessage, error) {
	resp, err := c.doRequest(method, params)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("%s", resp.Error.Message)
	}
	return resp.Result, nil
}

// TestConnection tests the API connection by calling GetPublicKey
func (c *Client) TestConnection() (map[string]interface{}, error) {
	result, err := c.rawRequest("CloudwalkerSettingService.GetPublicKey", map[string]interface{}{})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// ListRealTimeEvents fetches the latest threat events
func (c *Client) ListRealTimeEvents(count int) (map[string]interface{}, error) {
	result, err := c.rawRequest("ThreatOverviewService.ListRealTimeEvents", map[string]interface{}{
		"count": count,
	})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// ListEventTypeDistInfo gets event type distribution stats
func (c *Client) ListEventTypeDistInfo(period int) (map[string]interface{}, error) {
	result, err := c.rawRequest("ThreatOverviewService.ListEventTypeDistInfo", map[string]interface{}{
		"period": period,
	})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// GetProcessedEventInfo gets processed event statistics
func (c *Client) GetProcessedEventInfo() (map[string]interface{}, error) {
	result, err := c.rawRequest("ThreatOverviewService.GetProcessedEventInfo", nil)
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// GetOverview returns a combined overview: real-time events + event type distribution + processed stats
func (c *Client) GetOverview() (map[string]interface{}, error) {
	events, err := c.ListRealTimeEvents(10)
	if err != nil {
		return nil, fmt.Errorf("获取实时事件失败: %w", err)
	}
	dist, err := c.ListEventTypeDistInfo(7)
	if err != nil {
		return nil, fmt.Errorf("获取事件分布失败: %w", err)
	}
	processed, err := c.GetProcessedEventInfo()
	if err != nil {
		return nil, fmt.Errorf("获取处理统计失败: %w", err)
	}
	return map[string]interface{}{
		"real_time_events": events,
		"event_dist":       dist,
		"processed_info":   processed,
	}, nil
}

// GetEventList fetches event list for a given service type
func (c *Client) GetEventList(service string, count, offset int) (map[string]interface{}, error) {
	serviceMap := map[string]string{
		"webshell":          "WebshellEventService.GetEventList",
		"revshell":          "RevshellEventService.GetEventList",
		"malware":           "MalwareEventService.GetEventList",
		"brute_force":       "BruteForceService.GetEventList",
		"honeypot":          "HoneypotService.GetEventList",
		"elevation_process": "ElevationProcessEventService.GetEventList",
		"abnormal_login":    "AbnormalLoginEventService.GetEventList",
	}
	method, ok := serviceMap[service]
	if !ok {
		return nil, fmt.Errorf("未知事件类型: %s", service)
	}
	result, err := c.rawRequest(method, map[string]interface{}{
		"count":  count,
		"offset": offset,
	})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// GetEvent fetches a single event by type and ID
func (c *Client) GetEvent(service string, id string) (map[string]interface{}, error) {
	serviceMap := map[string]string{
		"webshell":          "WebshellEventService.GetEvent",
		"revshell":          "RevshellEventService.GetEvent",
		"malware":           "MalwareEventService.GetEvent",
		"brute_force":       "BruteForceService.GetEvent",
		"honeypot":          "HoneypotService.GetEvent",
		"elevation_process": "ElevationProcessEventService.GetEvent",
		"abnormal_login":    "AbnormalLoginEventService.GetEvent",
	}
	method, ok := serviceMap[service]
	if !ok {
		return nil, fmt.Errorf("未知事件类型: %s", service)
	}
	result, err := c.rawRequest(method, map[string]interface{}{
		"id": id,
	})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// ListAlertConfigs gets alert configuration list
func (c *Client) ListAlertConfigs(count, offset int) (map[string]interface{}, error) {
	result, err := c.rawRequest("AlertConfigService.List", map[string]interface{}{
		"count":  count,
		"offset": offset,
	})
	if err != nil {
		return nil, err
	}
	var data map[string]interface{}
	json.Unmarshal(result, &data)
	return data, nil
}

// Login authenticates with username and password
func (c *Client) Login(username, password string) (string, error) {
	// Step 1: Get public key
	result, err := c.rawRequest("CloudwalkerSettingService.GetPublicKey", nil)
	if err != nil {
		return "", fmt.Errorf("获取公钥失败: %w", err)
	}
	var pubKeyResp struct {
		PublicKey string `json:"public_key"`
	}
	json.Unmarshal(result, &pubKeyResp)

	// Step 2: Login (in a real implementation you'd encrypt the password with the public key)
	// For now we just call the login endpoint - the actual crypto would need the RSA public key
	result, err = c.rawRequest("AccountNoAuthService.Login", map[string]interface{}{
		"username": username,
		"password": password,
	})
	if err != nil {
		return "", err
	}
	return string(result), nil
}
