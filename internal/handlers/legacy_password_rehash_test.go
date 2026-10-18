package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/bright-interaction/trustissues/internal/config"
	"github.com/bright-interaction/trustissues/internal/db"
	"github.com/bright-interaction/trustissues/internal/passwordhash"
	"golang.org/x/crypto/bcrypt"
)

const legacyRehashPassword = "Synthetic-Legacy-Password-1!"
const replacementRehashPassword = "Synthetic-New-Password-2!"
const legacyRehashEmail = "legacy-rehash@example.com"

func newLegacyRehashEnv(t *testing.T) (*AuthHandler, *VaultHandler, *db.Queries, string, string) {
	t.Helper()
	vh, queries := newCollectionAuthzEnv(t)
	legacy, err := bcrypt.GenerateFromPassword([]byte(legacyRehashPassword), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := queries.CreateInvitedUser(context.Background(), db.CreateInvitedUserParams{
		Email: legacyRehashEmail, PasswordHash: string(legacy), Name: toNullString("Legacy fixture"),
		Role: "user", PasswordSet: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	ah := NewAuthHandler(queries, &config.Config{
		JWTSecret: strings.Repeat("j", 32), VaultKey: strings.Repeat("k", 32),
	})
	return ah, vh, queries, user, string(legacy)
}

func assertStoredRehashPassword(t *testing.T, queries *db.Queries, user, password string) {
	t.Helper()
	stored, err := queries.GetPasswordHashByUserID(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	valid, err := passwordhash.Verify(password, stored)
	if err != nil || !valid || passwordhash.NeedsRehash(stored) {
		t.Fatal("stored password did not retain the intended Argon2id value")
	}
}

// Force the stale read -> explicit password change -> opportunistic rehash
// ordering directly. A query that writes by user ID alone fails this regression.
func TestLegacyPasswordRehashCASPreservesChosenPasswordAndRevocationState(t *testing.T) {
	for _, changed := range []bool{false, true} {
		name := "matching-legacy-value-upgrades"
		if changed {
			name = "new-password-wins-over-stale-rehash"
		}
		t.Run(name, func(t *testing.T) {
			_, vh, queries, user, observed := newLegacyRehashEnv(t)
			ctx := context.Background()
			if err := queries.InvalidateUserSessions(ctx, db.InvalidateUserSessionsParams{ID: user, SessionsValidAfter: 1700000000}); err != nil {
				t.Fatal(err)
			}
			if err := queries.CreateSession(ctx, db.CreateSessionParams{ID: "revoked-before-rehash", UserID: user}); err != nil {
				t.Fatal(err)
			}
			if err := queries.RevokeUserSessions(ctx, user); err != nil {
				t.Fatal(err)
			}
			upgrade, err := passwordhash.Hash(legacyRehashPassword)
			if err != nil {
				t.Fatal(err)
			}
			wantPassword := legacyRehashPassword
			wantMarker, wantAffected := 0, int64(1)
			if changed {
				newHash, err := passwordhash.Hash(replacementRehashPassword)
				if err != nil {
					t.Fatal(err)
				}
				if err := queries.SetPasswordHash(ctx, db.SetPasswordHashParams{ID: user, PasswordHash: newHash}); err != nil {
					t.Fatal(err)
				}
				wantPassword, wantMarker, wantAffected = replacementRehashPassword, 1, 0
			}
			result, err := queries.RehashPasswordIfUnchanged(ctx, db.RehashPasswordIfUnchangedParams{
				UserID: user, ExpectedPasswordHash: observed, NewPasswordHash: upgrade,
			})
			if err != nil {
				t.Fatal(err)
			}
			affected, err := result.RowsAffected()
			if err != nil || affected != wantAffected {
				t.Fatalf("CAS affected %d rows, want %d (err=%v)", affected, wantAffected, err)
			}
			assertStoredRehashPassword(t, queries, user, wantPassword)
			var marker, revoked int
			var cutoff int64
			if err := vh.db.QueryRow("SELECT password_set,sessions_valid_after FROM users WHERE id=?", user).Scan(&marker, &cutoff); err != nil {
				t.Fatal(err)
			}
			if err := vh.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE user_id=? AND revoked_at IS NOT NULL", user).Scan(&revoked); err != nil {
				t.Fatal(err)
			}
			if marker != wantMarker || cutoff != 1700000000 || revoked != 1 {
				t.Fatalf("rehash changed password/session markers: password_set=%d cutoff=%d revoked=%d", marker, cutoff, revoked)
			}
		})
	}
}

func TestLegacyPasswordRehashLoginRechecksConcurrentChanges(t *testing.T) {
	for _, scenario := range []string{"ordinary-upgrade", "another-login-upgraded", "human-changed-password"} {
		t.Run(scenario, func(t *testing.T) {
			ah, vh, queries, user, observed := newLegacyRehashEnv(t)
			ctx := context.Background()
			if err := queries.CreateSession(ctx, db.CreateSessionParams{ID: "existing-session", UserID: user}); err != nil {
				t.Fatal(err)
			}
			calls := 0
			ah.legacyPasswordHasher = func(password string) (string, error) {
				calls++
				upgrade, err := passwordhash.Hash(password)
				if err != nil {
					return "", err
				}
				switch scenario {
				case "another-login-upgraded":
					competing, err := passwordhash.Hash(password)
					if err != nil {
						return "", err
					}
					result, err := queries.RehashPasswordIfUnchanged(ctx, db.RehashPasswordIfUnchangedParams{
						UserID: user, ExpectedPasswordHash: observed, NewPasswordHash: competing,
					})
					if err != nil {
						return "", err
					}
					if affected, err := result.RowsAffected(); err != nil || affected != 1 {
						t.Fatal("competing upgrade fixture did not write the observed legacy value")
					}
				case "human-changed-password":
					replacement, err := passwordhash.Hash(replacementRehashPassword)
					if err != nil {
						return "", err
					}
					if err := queries.SetPasswordHash(ctx, db.SetPasswordHashParams{ID: user, PasswordHash: replacement}); err != nil {
						return "", err
					}
					if err := queries.InvalidateUserSessions(ctx, db.InvalidateUserSessionsParams{ID: user, SessionsValidAfter: 1700000000}); err != nil {
						return "", err
					}
					if err := queries.RevokeUserSessions(ctx, user); err != nil {
						return "", err
					}
				}
				return upgrade, nil
			}
			rec := diagnosticLogin(t, ah, legacyRehashEmail, legacyRehashPassword, "")
			if calls != 1 {
				t.Fatalf("legacy rehash hook calls=%d, want 1", calls)
			}
			var liveSessions int
			if err := vh.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE user_id=? AND revoked_at IS NULL", user).Scan(&liveSessions); err != nil {
				t.Fatal(err)
			}
			if scenario == "human-changed-password" {
				var response APIError
				if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if rec.Code != http.StatusUnauthorized || response.Error != "invalid credentials" || len(rec.Result().Cookies()) != 0 || liveSessions != 0 {
					t.Fatal("stale legacy login authenticated after a concurrent password reset")
				}
				assertStoredRehashPassword(t, queries, user, replacementRehashPassword)
				assertDiagnosticFailureCount(t, queries, legacyRehashEmail, 1)
				var detail string
				if err := vh.db.QueryRow("SELECT detail FROM activity_log WHERE action='auth.login_failed'").Scan(&detail); err != nil || !strings.HasSuffix(detail, " stage=password") {
					t.Fatal("stale password refusal did not receive the safe password-stage audit label")
				}
				var marker int
				var cutoff int64
				if err := vh.db.QueryRow("SELECT password_set,sessions_valid_after FROM users WHERE id=?", user).Scan(&marker, &cutoff); err != nil || marker != 1 || cutoff != 1700000000 {
					t.Fatal("stale rehash changed the newer password marker or session revocation cutoff")
				}
			} else {
				if rec.Code != http.StatusOK || len(rec.Result().Cookies()) != 1 || liveSessions != 2 {
					t.Fatalf("valid same-password upgrade was refused: status=%d live-sessions=%d", rec.Code, liveSessions)
				}
				assertStoredRehashPassword(t, queries, user, legacyRehashPassword)
				assertDiagnosticFailureCount(t, queries, legacyRehashEmail, 0)
			}
		})
	}
}
