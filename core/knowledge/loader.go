package knowledge

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chaitin/chaitin-virtual-engineer/models"
)

// Loader handles knowledge base loading and searching
type Loader struct {
	mu        sync.RWMutex
	baseDir   string
	loadedKBs map[string]*models.KnowledgeBase
}

// NewLoader creates a new knowledge loader
func NewLoader(baseDir string) *Loader {
	os.MkdirAll(baseDir, 0755)
	return &Loader{
		baseDir:   baseDir,
		loadedKBs: make(map[string]*models.KnowledgeBase),
	}
}

// Scan loads all knowledge bases already on disk (call once at startup)
func (l *Loader) Scan() {
	l.mu.Lock()
	defer l.mu.Unlock()

	entries, err := os.ReadDir(l.baseDir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		kbID := entry.Name()
		kbDir := filepath.Join(l.baseDir, kbID)
		l.loadedKBs[kbID] = l.loadManifest(kbDir, kbID)
	}
}

// Import imports a knowledge base from a zip file
func (l *Loader) Import(reader io.Reader, filename string) (*models.KnowledgeBase, error) {
	tempDir, err := os.MkdirTemp("", "knowledge-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	zipPath := filepath.Join(tempDir, filename)
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		return nil, fmt.Errorf("failed to write temp zip: %w", err)
	}

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	kbID := strings.TrimSuffix(filename, filepath.Ext(filename))
	kbDir := filepath.Join(l.baseDir, kbID)
	os.MkdirAll(kbDir, 0755)

	for _, f := range r.File {
		// Sanitize path to prevent zip-slip
		fpath := filepath.Join(kbDir, filepath.Clean("/"+f.Name))
		if !strings.HasPrefix(fpath, filepath.Clean(kbDir)+string(os.PathSeparator)) {
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, 0755)
			continue
		}
		os.MkdirAll(filepath.Dir(fpath), 0755)
		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err != nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			continue
		}
		io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
	}

	l.mu.Lock()
	kb := l.loadManifest(kbDir, kbID)
	l.loadedKBs[kbID] = kb
	l.mu.Unlock()

	return kb, nil
}

// Remove deletes a knowledge base from disk and memory
func (l *Loader) Remove(kbID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	kb, ok := l.loadedKBs[kbID]
	if !ok {
		return fmt.Errorf("knowledge base not found: %s", kbID)
	}
	if err := os.RemoveAll(kb.Path); err != nil {
		return fmt.Errorf("failed to delete knowledge base files: %w", err)
	}
	delete(l.loadedKBs, kbID)
	return nil
}

// loadManifest loads the manifest.json file (caller holds lock or is single-threaded)
func (l *Loader) loadManifest(kbDir, kbID string) *models.KnowledgeBase {
	manifestPath := filepath.Join(kbDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return &models.KnowledgeBase{
			ID:   kbID,
			Name: kbID,
			Path: kbDir,
		}
	}

	var manifest struct {
		Name        string   `json:"name"`
		Version     string   `json:"version"`
		Description string   `json:"description"`
		Operations  []string `json:"supported_operations"`
	}
	json.Unmarshal(data, &manifest)

	name := manifest.Name
	if name == "" {
		name = kbID
	}

	return &models.KnowledgeBase{
		ID:          kbID,
		Name:        name,
		Version:     manifest.Version,
		Description: manifest.Description,
		Path:        kbDir,
		Operations:  manifest.Operations,
	}
}

// ListKnowledgeBases returns all loaded knowledge bases
func (l *Loader) ListKnowledgeBases() []*models.KnowledgeBase {
	l.mu.RLock()
	defer l.mu.RUnlock()

	result := make([]*models.KnowledgeBase, 0, len(l.loadedKBs))
	for _, kb := range l.loadedKBs {
		result = append(result, kb)
	}
	return result
}

// GetWikiContent returns the combined wiki content for a knowledge base
// Loads ALL .md files from wiki/ directory, not just index.md
func (l *Loader) GetWikiContent(kbID string) (*models.WikiContent, error) {
	l.mu.RLock()
	kb, ok := l.loadedKBs[kbID]
	l.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("knowledge base not found: %s", kbID)
	}

	var allContent strings.Builder
	wikiDir := filepath.Join(kb.Path, "wiki")

	entries, err := os.ReadDir(wikiDir)
	if err == nil {
		for _, f := range entries {
			if strings.HasSuffix(f.Name(), ".md") {
				data, err := os.ReadFile(filepath.Join(wikiDir, f.Name()))
				if err == nil {
					allContent.WriteString(string(data))
					allContent.WriteString("\n\n")
				}
			}
		}
	}

	// Fallback: read sources/ directory listing
	if allContent.Len() == 0 {
		sourcesPath := filepath.Join(kb.Path, "sources")
		sEntries, _ := os.ReadDir(sourcesPath)
		var mdFiles []string
		for _, f := range sEntries {
			if strings.HasSuffix(f.Name(), ".md") {
				mdFiles = append(mdFiles, f.Name())
			}
		}
		return &models.WikiContent{
			KBID:    kbID,
			Path:    "sources/",
			Title:   kb.Name,
			Content: fmt.Sprintf("Available documents: %v", mdFiles),
		}, nil
	}

	return &models.WikiContent{
		KBID:    kbID,
		Path:    "wiki/",
		Title:   kb.Name,
		Content: allContent.String(),
	}, nil
}

// Search performs a simple text search in the knowledge base
func (l *Loader) Search(kbID, query string) ([]*models.SearchResult, error) {
	l.mu.RLock()
	kb, ok := l.loadedKBs[kbID]
	l.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("knowledge base not found: %s", kbID)
	}

	var results []*models.SearchResult
	queryLower := strings.ToLower(query)

	for _, dir := range []struct {
		path  string
		score float64
	}{
		{filepath.Join(kb.Path, "wiki"), 1.0},
		{filepath.Join(kb.Path, "sources"), 0.8},
	} {
		filepath.Walk(dir.path, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !strings.HasSuffix(path, ".md") {
				return nil
			}
			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			contentStr := string(content)
			if strings.Contains(strings.ToLower(contentStr), queryLower) {
				relPath, _ := filepath.Rel(kb.Path, path)
				results = append(results, &models.SearchResult{
					KBID:    kbID,
					Path:    relPath,
					Title:   info.Name(),
					Excerpt: extractExcerpt(contentStr, query, 100),
					Score:   dir.score,
				})
			}
			return nil
		})
	}

	return results, nil
}

// extractExcerpt extracts a text excerpt around the query
func extractExcerpt(content, query string, maxLen int) string {
	contentLower := strings.ToLower(content)
	queryLower := strings.ToLower(query)

	idx := strings.Index(contentLower, queryLower)
	if idx == -1 {
		if len(content) > maxLen {
			return content[:maxLen] + "..."
		}
		return content
	}

	start := idx - 50
	if start < 0 {
		start = 0
	}
	end := idx + len(query) + 50
	if end > len(content) {
		end = len(content)
	}

	excerpt := content[start:end]
	if start > 0 {
		excerpt = "..." + excerpt
	}
	if end < len(content) {
		excerpt = excerpt + "..."
	}
	return excerpt
}
