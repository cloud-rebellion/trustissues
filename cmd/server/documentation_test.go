package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/bright-interaction/trustissues/internal/config"
	timw "github.com/bright-interaction/trustissues/internal/middleware"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

// Exercise the actual server router, authentication and enrollment middleware.
// The fixture contains no vault tables: reading documentation must not require
// loading, unlocking, or changing a credential.
func TestDocumentationRouterAuthRolesAndEnrollment(t *testing.T) {
	testDocumentationRouterAuthRolesAndEnrollment(t, "/api/documentation/docs/USER-GUIDE.md", "# TrustIssues user guide")
}

func testDocumentationRouterAuthRolesAndEnrollment(t *testing.T, guidePath, expectedPrefix string) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`
		CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
		  sessions_valid_after INTEGER NOT NULL DEFAULT 0, totp_enabled INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, revoked_at TEXT,
		  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT);
		CREATE TABLE api_keys (key_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT,
		  revoked_at TEXT, last_used_at TEXT);
		INSERT INTO settings (key, value) VALUES ('require_totp', 'true');
	`)
	if err != nil {
		t.Fatal(err)
	}
	const secret = "documentation-route-synthetic-jwt-secret"
	router := newRouter(routerDeps{
		cfg:        &config.Config{BaseURL: "https://vault.example.test", JWTSecret: secret},
		dbConn:     db,
		apiLimiter: timw.NewRateLimiter(1000, time.Minute),
	})
	request := func(path string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	for _, path := range []string{guidePath, "/api/documentation/docs/screenshots/user-guide/04-vault-overview.png"} {
		if got := request(path, nil); got.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s status=%d, want 401", path, got.Code)
		}
	}
	for _, role := range []string{"admin", "user", "vault_only"} {
		t.Run(role, func(t *testing.T) {
			id := "synthetic-" + role
			if _, err := db.Exec("INSERT INTO users (id, role) VALUES (?, ?)", id, role); err != nil {
				t.Fatal(err)
			}
			sessionID := "session-" + role
			if _, err := db.Exec("INSERT INTO sessions (id, user_id) VALUES (?, ?)", sessionID, id); err != nil {
				t.Fatal(err)
			}
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"sub": id, "jti": sessionID, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
			}).SignedString([]byte(secret))
			if err != nil {
				t.Fatal(err)
			}
			apiKey := "ti_synthetic_docs_" + role
			hash := sha256.Sum256([]byte(apiKey))
			if _, err := db.Exec("INSERT INTO api_keys (key_hash, user_id) VALUES (?, ?)", hex.EncodeToString(hash[:]), id); err != nil {
				t.Fatal(err)
			}
			for kind, headers := range map[string]map[string]string{
				"session": {"Cookie": timw.SessionCookieName + "=" + token},
				"api-key": {"X-API-Key": apiKey},
			} {
				t.Run(kind, func(t *testing.T) {
					rec := request(guidePath, headers)
					if rec.Code != http.StatusOK {
						t.Fatalf("unenrolled account documentation status=%d body=%s", rec.Code, rec.Body.String())
					}
					var response struct {
						Content string `json:"content"`
					}
					if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || !strings.HasPrefix(response.Content, expectedPrefix) {
						t.Fatalf("documentation response was not canonical guide JSON: err=%v", err)
					}
					if rec.Header().Get("Cache-Control") != "no-store" {
						t.Fatal("authenticated documentation was cacheable")
					}
					image := request("/api/documentation/docs/screenshots/user-guide/04-vault-overview.png", headers)
					if image.Code != http.StatusOK || image.Header().Get("Content-Type") != "image/png" {
						t.Fatalf("authenticated screenshot status=%d type=%q", image.Code, image.Header().Get("Content-Type"))
					}
					vault := request("/api/vault/", headers)
					if vault.Code != http.StatusForbidden || !strings.Contains(vault.Body.String(), timw.TOTPEnrollmentRequiredCode) {
						t.Fatalf("documentation exception affected vault gate: status=%d body=%s", vault.Code, vault.Body.String())
					}
				})
			}
			if _, err := db.Exec("UPDATE users SET disabled = 1 WHERE id = ?", id); err != nil {
				t.Fatal(err)
			}
			if rec := request(guidePath, map[string]string{"Cookie": timw.SessionCookieName + "=" + token}); rec.Code != http.StatusUnauthorized {
				t.Fatalf("disabled account documentation status=%d, want 401", rec.Code)
			}
		})
	}
}
