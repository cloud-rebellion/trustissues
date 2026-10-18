// Package guides packages the reviewed product guides with the server.
// The HTTP handler must be mounted behind the application's authentication
// middleware. It serves a fixed documentation inventory, never a host directory.
package guides

import (
	"embed"
	"encoding/json"
	"net/http"
	"strings"
)

// Keep the canonical Markdown files as the single source for repository and
// in-application documentation. Embedding them also means the runtime image does
// not need a separate documentation directory or an extra Docker COPY step.
//
//go:embed docs/*.md docs/screenshots/user-guide/*.png docs/screenshots/user-guide/README.md docs/screenshots/user-guide/manifest.json README.md SECURITY.md THREAT-MODEL.md CONTRACT.md FRONTEND-CONTRACT.md CONTRIBUTING.md DEFERRED.md
var files embed.FS

// allowedFiles is deliberately narrower than the embedded filesystem. Adding an
// unrelated Markdown file or screenshot to the repository must not publish it
// through this API without an explicit inventory change.
var allowedFiles = map[string]string{
	"docs/README.md":                                           "markdown",
	"docs/USER-GUIDE.md":                                       "markdown",
	"docs/ADMIN-GUIDE.md":                                      "markdown",
	"docs/SECURITY-AND-AUTOMATION-GUIDE.md":                    "markdown",
	"docs/PGP-IMPORT-EXPORT.md":                                "markdown",
	"docs/PORTABILITY.md":                                      "markdown",
	"docs/PRIVATE-INGRESS.md":                                  "markdown",
	"docs/BACKUP.md":                                           "markdown",
	"docs/ADMIN-LOCKOUT-RECOVERY.md":                           "markdown",
	"README.md":                                                "markdown",
	"SECURITY.md":                                              "markdown",
	"THREAT-MODEL.md":                                          "markdown",
	"CONTRACT.md":                                              "markdown",
	"FRONTEND-CONTRACT.md":                                     "markdown",
	"CONTRIBUTING.md":                                          "markdown",
	"DEFERRED.md":                                              "markdown",
	"docs/screenshots/user-guide/README.md":                    "markdown",
	"docs/screenshots/user-guide/manifest.json":                "application/json",
	"docs/screenshots/user-guide/01-first-run.png":             "image/png",
	"docs/screenshots/user-guide/02-locked-vault.png":          "image/png",
	"docs/screenshots/user-guide/03-create-vault.png":          "image/png",
	"docs/screenshots/user-guide/04-vault-overview.png":        "image/png",
	"docs/screenshots/user-guide/05-add-credential.png":        "image/png",
	"docs/screenshots/user-guide/06-manage-vault.png":          "image/png",
	"docs/screenshots/user-guide/07-rotation-delivery.png":     "image/png",
	"docs/screenshots/user-guide/08-service-identity.png":      "image/png",
	"docs/screenshots/user-guide/09-proton-import-preview.png": "image/png",
	"docs/screenshots/user-guide/10-pgp-export.png":            "image/png",
	"docs/screenshots/user-guide/11-users.png":                 "image/png",
	"docs/screenshots/user-guide/12-activity.png":              "image/png",
	"docs/screenshots/user-guide/13-account-settings.png":      "image/png",
	"docs/screenshots/user-guide/14-vault-policy.png":          "image/png",
	"docs/screenshots/user-guide/15-ai-and-mcp.png":            "image/png",
	"docs/screenshots/user-guide/16-api-keys.png":              "image/png",
}

// Handler serves canonical paths after /api/documentation has been stripped:
// /docs/USER-GUIDE.md returns {"content":"..."}; the listed PNGs and screenshot
// manifest are returned with their native media type. Authentication belongs to
// the enclosing router so normal account/session revocation remains effective.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Do not clean paths: traversal, repeated slashes, backslashes and
		// unlisted files fail the exact lookup instead of becoming an alias.
		name := strings.TrimPrefix(r.URL.Path, "/")
		mediaType, ok := allowedFiles[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		content, err := files.ReadFile(name)
		if err != nil {
			http.Error(w, "documentation unavailable", http.StatusInternalServerError)
			return
		}
		if mediaType == "markdown" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(struct {
				Content string `json:"content"`
			}{Content: string(content)})
			return
		}
		w.Header().Set("Content-Type", mediaType)
		_, _ = w.Write(content)
	})
}
