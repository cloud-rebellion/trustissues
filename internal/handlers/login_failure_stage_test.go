package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bright-interaction/trustissues/internal/db"
)

func diagnosticLogin(t *testing.T, ah *AuthHandler, email, password, code string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"email": email, "password": password, "totp_code": code})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.RemoteAddr = "198.51.100.79:41000"
	req.Header.Set("User-Agent", "signin-diagnostics-test")
	rec := httptest.NewRecorder()
	ah.Login(rec, req)
	return rec
}

func assertDiagnosticFailureCount(t *testing.T, queries *db.Queries, email string, want int64) {
	t.Helper()
	for _, scope := range []string{db.LoginAttemptScopePasswordLogin, db.LoginAttemptScopeSessionReauth} {
		got, err := queries.CountRecentFailedLoginAttemptsByEmailAndScope(context.Background(),
			db.CountRecentFailedLoginAttemptsByEmailAndScopeParams{Email: email, Scope: scope})
		if err != nil {
			t.Fatal(err)
		}
		expected := int64(0)
		if scope == db.LoginAttemptScopePasswordLogin {
			expected = want
		}
		if got != expected {
			t.Fatalf("failed attempts at scope %s = %d, want %d", scope, got, expected)
		}
	}
}

func TestLoginFailureAuditStagesAreSafeAndPreserveAuthentication(t *testing.T) {
	const email = "totp-user@example.com"
	const wrongPassword = "Wrong-Password-Private-Marker"
	const wrongCode = "wrong-mfa-private-marker"
	for _, tc := range []struct {
		stage, password, code, message string
		disabled                       bool
		status                         int
	}{
		{stage: "password", password: wrongPassword, code: wrongCode, message: "invalid credentials", status: http.StatusUnauthorized},
		{stage: "mfa", password: totpTestPassword, code: wrongCode, message: "invalid 2FA code", status: http.StatusUnauthorized},
		{stage: "disabled", password: totpTestPassword, code: wrongCode, message: "account is disabled", disabled: true, status: http.StatusForbidden},
	} {
		t.Run(tc.stage, func(t *testing.T) {
			ah, vh, queries, user := newTOTPEnv(t)
			mustEnable2FA(t, ah, queries, user)
			if tc.disabled {
				if _, err := queries.SetUserDisabled(context.Background(), db.SetUserDisabledParams{ID: user, Disabled: 1}); err != nil {
					t.Fatal(err)
				}
			}
			rec := diagnosticLogin(t, ah, email, tc.password, tc.code)
			if rec.Code != tc.status {
				t.Fatalf("status=%d, want %d", rec.Code, tc.status)
			}
			var response APIError
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil || response.Error != tc.message {
				t.Fatalf("public failure semantics changed: decode error=%v", err)
			}
			if strings.Contains(rec.Body.String(), "stage=") || len(rec.Result().Cookies()) != 0 {
				t.Fatal("failure leaked audit classification or created an authentication cookie")
			}
			var sessions int
			if err := vh.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE user_id=?", user).Scan(&sessions); err != nil || sessions != 0 {
				t.Fatalf("failed login created a server session: count=%d err=%v", sessions, err)
			}
			var action, detail, ip, agent string
			var auditCount int
			if err := vh.db.QueryRow("SELECT COUNT(*) FROM activity_log WHERE action='auth.login_failed'").Scan(&auditCount); err != nil || auditCount != 1 {
				t.Fatalf("failure audit count=%d err=%v", auditCount, err)
			}
			if err := vh.db.QueryRow("SELECT action,detail,ip_address,user_agent FROM activity_log WHERE action='auth.login_failed'").Scan(&action, &detail, &ip, &agent); err != nil {
				t.Fatal(err)
			}
			wantDetail := fmt.Sprintf("Failed login for %s from 198.51.100.79 stage=%s", email, tc.stage)
			if action != "auth.login_failed" || detail != wantDetail || ip != "198.51.100.79" || agent != "signin-diagnostics-test" {
				t.Fatal("audit did not retain the existing action/source and exact safe stage detail")
			}
			for _, secret := range []string{totpTestPassword, wrongPassword, wrongCode} {
				if strings.Contains(detail, secret) {
					t.Fatal("audit contains submitted credential material")
				}
			}
			assertDiagnosticFailureCount(t, queries, email, 1)
			count, err := queries.CountRecentFailedLoginAttemptsByIP(context.Background(), "198.51.100.79")
			if err != nil || count != 1 {
				t.Fatalf("per-IP failed attempt count=%d err=%v", count, err)
			}
		})
	}
}

func TestLoginFailureAuditDoesNotExposeUnknownAccountsOrChangeLockout(t *testing.T) {
	ah, vh, queries, _ := newTOTPEnv(t)
	const known = "totp-user@example.com"
	const unknown = "missing-user@example.com"
	knownResponse := diagnosticLogin(t, ah, known, "incorrect-password", "")
	unknownResponse := diagnosticLogin(t, ah, unknown, "incorrect-password", "")
	if knownResponse.Code != http.StatusUnauthorized || unknownResponse.Code != knownResponse.Code || unknownResponse.Body.String() != knownResponse.Body.String() {
		t.Fatal("known and unknown accounts have distinguishable public password failures")
	}
	assertDiagnosticFailureCount(t, queries, known, 1)
	assertDiagnosticFailureCount(t, queries, unknown, 1)
	var auditCount int
	if err := vh.db.QueryRow("SELECT COUNT(*) FROM activity_log WHERE action='auth.login_failed'").Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("unknown account produced an attributed audit event: count=%d err=%v", auditCount, err)
	}
	// Reach the existing threshold without the graduated sleeps. The two real
	// requests above prove accrual; seeding the remaining four checks the gate.
	seedFailure(t, queries, known, db.LoginAttemptScopePasswordLogin, 4)
	locked := diagnosticLogin(t, ah, known, totpTestPassword, "")
	if locked.Code != http.StatusTooManyRequests {
		t.Fatalf("existing five-attempt lockout status=%d, want 429", locked.Code)
	}
	assertDiagnosticFailureCount(t, queries, known, 5)
	if len(locked.Result().Cookies()) != 0 {
		t.Fatal("lockout created an authentication cookie")
	}
	var after int
	if err := vh.db.QueryRow("SELECT COUNT(*) FROM activity_log WHERE action='auth.login_failed'").Scan(&after); err != nil || after != auditCount {
		t.Fatal("lockout changed the failure event/counter behavior")
	}
}
