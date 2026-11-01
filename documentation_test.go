package guides

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerReturnsCanonicalMarkdownAsJSON(t *testing.T) {
	for _, path := range []string{"docs/USER-GUIDE.md", "docs/ADMIN-GUIDE.md", "docs/SECURITY-AND-AUTOMATION-GUIDE.md", "SECURITY.md"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/"+path, nil))
			if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
				t.Fatalf("status=%d content-type=%q", rec.Code, rec.Header().Get("Content-Type"))
			}
			var response struct {
				Content string `json:"content"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			canonical, err := files.ReadFile(path)
			if err != nil || response.Content != string(canonical) || !strings.HasPrefix(response.Content, "# ") {
				t.Fatalf("response did not preserve canonical Markdown: read error=%v", err)
			}
			if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("documentation must retain no-store and nosniff headers")
			}
		})
	}
}

func TestHandlerScreenshotInventoryMatchesCaptureManifest(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs/screenshots/user-guide/manifest.json", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("manifest status=%d type=%q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var manifest struct {
		Images []struct {
			File   string `json:"file"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
			SHA256 string `json:"sha256"`
		} `json:"images"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Images) != 16 {
		t.Fatalf("capture manifest has %d images, want 16", len(manifest.Images))
	}
	for _, image := range manifest.Images {
		t.Run(image.File, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs/screenshots/user-guide/"+image.File, nil))
			if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
				t.Fatalf("screenshot status=%d type=%q", rec.Code, rec.Header().Get("Content-Type"))
			}
			config, err := png.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
			if err != nil || config.Width != image.Width || config.Height != image.Height {
				t.Fatalf("image dimensions=%dx%d err=%v; capture=%dx%d", config.Width, config.Height, err, image.Width, image.Height)
			}
			hash := sha256.Sum256(rec.Body.Bytes())
			if got := hex.EncodeToString(hash[:]); got != image.SHA256 {
				t.Fatalf("screenshot digest=%s, want captured %s", got, image.SHA256)
			}
		})
	}
}

func TestHandlerRefusesUnlistedAndNoncanonicalPaths(t *testing.T) {
	for _, path := range []string{
		"/", "/docs/UNKNOWN.md", "/go.mod", "/.env", "/documentation.go",
		"/docs/audit-history/AUDIT-ROUND-19.md", "/docs/screenshots/user-guide/not-reviewed.png",
		"/docs/../SECURITY.md", "/docs/%2e%2e/SECURITY.md", "/docs/%252e%252e/SECURITY.md",
		"//docs/USER-GUIDE.md", "/docs//USER-GUIDE.md", "/docs/./USER-GUIDE.md",
		"/docs%5cUSER-GUIDE.md", "/docs/USER-GUIDE.md/", "/docs/USER-GUIDE.md%00",
	} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d, want 404; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandlerAcceptsOnlyGET(t *testing.T) {
	for _, method := range []string{http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions} {
		t.Run(method, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Handler().ServeHTTP(rec, httptest.NewRequest(method, "/docs/USER-GUIDE.md", nil))
			if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != http.MethodGet {
				t.Fatalf("status=%d Allow=%q, want 405/GET", rec.Code, rec.Header().Get("Allow"))
			}
		})
	}
}

func TestEveryAllowedFileIsEmbeddedAndHasKnownMediaType(t *testing.T) {
	for name, mediaType := range allowedFiles {
		if mediaType != "markdown" && mediaType != "image/png" && mediaType != "application/json" {
			t.Errorf("unknown media type for %s: %q", name, mediaType)
		}
		if content, err := readDocumentationFile(name); err != nil || len(content) == 0 {
			t.Errorf("allowlisted file %s is missing or empty: %v", name, err)
		}
	}
}
