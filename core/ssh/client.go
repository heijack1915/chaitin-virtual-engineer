package ssh

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/chaitin/chaitin-virtual-engineer/models"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// HostManager manages SSH connections to target hosts
type HostManager struct {
	mu    sync.RWMutex
	hosts map[string]*models.Host
	path  string
}

// NewHostManager creates a new HostManager
func NewHostManager(path string) *HostManager {
	return &HostManager{
		hosts: make(map[string]*models.Host),
		path:  path,
	}
}

// ListHosts returns all hosts
func (hm *HostManager) ListHosts() []*models.Host {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	result := make([]*models.Host, 0, len(hm.hosts))
	for _, h := range hm.hosts {
		result = append(result, h)
	}
	return result
}

// GetHost returns a host by ID
func (hm *HostManager) GetHost(id string) *models.Host {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	return hm.hosts[id]
}

// AddHost adds a new host
func (hm *HostManager) AddHost(host *models.Host) error {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	if host.ID == "" {
		host.ID = uuid.New().String()
	}
	host.CreatedAt = time.Now()
	host.UpdatedAt = time.Now()
	hm.hosts[host.ID] = host
	return nil
}

// UpdateHost updates an existing host
func (hm *HostManager) UpdateHost(host *models.Host) error {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	if _, ok := hm.hosts[host.ID]; !ok {
		return fmt.Errorf("host not found: %s", host.ID)
	}
	host.UpdatedAt = time.Now()
	hm.hosts[host.ID] = host
	return nil
}

// RemoveHost removes a host
func (hm *HostManager) RemoveHost(id string) error {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	if _, ok := hm.hosts[id]; !ok {
		return fmt.Errorf("host not found: %s", id)
	}
	delete(hm.hosts, id)
	return nil
}

// Save saves hosts to file
func (hm *HostManager) Save() error {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	data, err := json.MarshalIndent(hm.hosts, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(hm.path, data, 0600)
}

// Load loads hosts from file
func (hm *HostManager) Load() error {
	hm.mu.Lock()
	defer hm.mu.Unlock()

	data, err := os.ReadFile(hm.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return json.Unmarshal(data, &hm.hosts)
}

// MakeSSHConfig builds an ssh.ClientConfig for a host (password or private key)
func MakeSSHConfig(host *models.Host) (*ssh.ClientConfig, error) {
	var authMethods []ssh.AuthMethod

	if host.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(host.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	if host.Password != "" {
		authMethods = append(authMethods, ssh.Password(host.Password))
	}

	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no authentication method provided (password or private key required)")
	}

	return &ssh.ClientConfig{
		User:            host.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}, nil
}

// Dial wraps golang.org/x/crypto/ssh Dial so callers can use it via this package
func Dial(network, addr string, config *ssh.ClientConfig) (*ssh.Client, error) {
	return ssh.Dial(network, addr, config)
}

// TestConnection tests SSH connection to a host
func TestConnection(host *models.Host) error {
	config, err := MakeSSHConfig(host)
	if err != nil {
		return err
	}

	addr := fmt.Sprintf("%s:%d", host.IP, host.Port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return err
	}
	client.Close()
	return nil
}
