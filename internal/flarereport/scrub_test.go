package flarereport

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	sentry "github.com/getsentry/sentry-go"
)

func headersOf(kv map[string]string) *sentry.Event {
	return &sentry.Event{Request: &sentry.Request{
		URL:     "https://vault.example/api/service-identities/me/secrets?code=abc",
		Method:  "POST",
		Headers: kv,
	}}
}

func TestScrubDropsAuthHeadersInAnyCasing(t *testing.T) {
	// The canonical spelling net/http produces, the lower-case spelling this
	// tree writes by hand, and a shouted spelling: all three must go.
	for _, name := range []string{"X-Service-Key", "x-service-key", "X-SERVICE-KEY", "Authorization", "authorization", "Cookie", "X-Api-Key", "x-api-key", "apikey", "Mcp-Session-Id"} {
		ev := scrubRequestEvent(headersOf(map[string]string{name: "sk_deadbeef"}))
		if v, ok := ev.Request.Headers[name]; ok {
			t.Errorf("header %q survived the scrub with value %q", name, v)
		}
	}
}

func TestScrubDropsEvenTriageHeaderValues(t *testing.T) {
	in := map[string]string{
		"Host":         "vault.example",
		"User-Agent":   "trustissues-boot/1.0",
		"Content-Type": "application/json",
		"content-type": "application/json",
	}
	ev := scrubRequestEvent(headersOf(in))
	for name := range in {
		if _, ok := ev.Request.Headers[name]; ok {
			t.Errorf("client-controlled header %q survived the privacy boundary", name)
		}
	}
}

func TestScrubClearsQueryCookiesAndBody(t *testing.T) {
	ev := &sentry.Event{Request: &sentry.Request{
		URL:         "https://vault.example/api/vault/entries?token=reset-me",
		Method:      "POST",
		Data:        `{"value":"sk-ant-api03-REAL-SECRET-VALUE"}`,
		QueryString: "token=reset-me",
		Cookies:     "ti_session=abc123",
		Headers:     map[string]string{},
	}}
	got := scrubRequestEvent(ev).Request
	if got.QueryString != "" {
		t.Errorf("QueryString survived: %q", got.QueryString)
	}
	if got.Cookies != "" {
		t.Errorf("Cookies survived: %q", got.Cookies)
	}
	// Scope.SetRequest buffers the request body and ApplyToEvent copies it into
	// Data, so this field is a real egress path, not a theoretical one.
	if got.Data != "" {
		t.Errorf("request body survived: %q", got.Data)
	}
	if got.URL != "/api/vault/:id" {
		t.Errorf("URL was not projected to a product route template: %q", got.URL)
	}
	if got.Method != "POST" {
		t.Errorf("method was lost, so the report cannot be triaged: %q", got.Method)
	}
}

func TestScrubToleratesNilEventAndNilRequest(t *testing.T) {
	if scrubRequestEvent(nil) != nil {
		t.Error("a nil event should come back nil, not be dereferenced")
	}
	ev := &sentry.Event{}
	if scrubRequestEvent(ev).Request != nil {
		t.Error("a nil request should be left alone")
	}
}

// headerCallSite matches the header names this codebase actually reads and
// writes. Anchoring on the http.Header call is what makes the enumeration
// mechanical: it cannot drift the way a hand-maintained list of "the auth
// headers we have" drifts, which is the drift that left X-Service-Key exposed.
var headerCallSite = regexp.MustCompile(`\.Header\.(?:Get|Set|Add|Del|Values)\(\s*"([A-Za-z0-9-]+)"`)

// authWords are the substrings that make a header name credential-bearing.
var authWords = []string{"key", "token", "auth", "secret", "session", "cookie", "credential", "password", "signature", "csrf", "xsrf"}

func looksCredentialBearing(header string) bool {
	lower := strings.ToLower(header)
	for _, w := range authWords {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

// collectHeaderNames walks the module source and returns every header name used
// at an http.Header call site.
func collectHeaderNames(t *testing.T) map[string]string {
	t.Helper()
	root, err := filepath.Abs("../..") // the module root; this package is internal/flarereport
	if err != nil {
		t.Fatalf("resolving module root: %v", err)
	}
	found := map[string]string{} // header name -> the file it was seen in
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "frontend", "vendor":
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		src, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		rel, _ := filepath.Rel(root, path)
		for _, m := range headerCallSite.FindAllSubmatch(src, -1) {
			name := string(m[1])
			if _, seen := found[name]; !seen {
				found[name] = rel
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
	return found
}

// TestEveryAuthHeaderInTreeIsScrubbed is the durable half of the X-Service-Key
// fix. It enumerates the header names this codebase actually uses, keeps the
// credential-bearing ones, and asserts the scrub drops each. Introduce a new
// auth header anywhere in the tree and this test covers it the moment it is
// written, which is the property the old hand-maintained deny-list did not have.
func TestEveryAuthHeaderInTreeIsScrubbed(t *testing.T) {
	names := collectHeaderNames(t)

	// A guard that finds nothing passes trivially and reads as evidence. These
	// three are known to exist at http.Header call sites in this tree; if the
	// enumeration stops finding them, it broke and the rest of this test is
	// worthless.
	for _, sentinel := range []string{"X-Service-Key", "Authorization", "X-API-Key"} {
		if _, ok := names[sentinel]; !ok {
			t.Fatalf("the enumeration failed to find %q, so it is no longer enumerating anything; fix headerCallSite", sentinel)
		}
	}

	checked := 0
	for name, file := range names {
		if !looksCredentialBearing(name) {
			continue
		}
		checked++
		// Every casing, because event.Request.Headers is a plain map that a
		// capture path may fill without going through http.Header.
		for _, variant := range []string{name, strings.ToLower(name), strings.ToUpper(name)} {
			ev := scrubRequestEvent(headersOf(map[string]string{variant: "a-real-looking-credential-value"}))
			if _, ok := ev.Request.Headers[variant]; ok {
				t.Errorf("%s: auth header %q (as %q) is NOT scrubbed; a panic on a route reading it ships the credential to the shared Flare store. Do not add it to reportableHeaders", file, name, variant)
			}
		}
	}
	if checked < 5 {
		t.Fatalf("only %d credential-bearing headers were checked; the filter is too narrow to be a guard", checked)
	}
	t.Logf("checked %d credential-bearing header names out of %d header call sites", checked, len(names))
}

func TestClientHooksAllowOnlyPrivateDiagnostics(t *testing.T) {
	const canary = "PRIVATE_SYNTHETIC_CSV_VALUE_8931"
	options := ClientOptions("https://public@flare.example/1", "trustissues", "abc1234")
	for _, hook := range []struct {
		name string
		fn   func(*sentry.Event, *sentry.EventHint) *sentry.Event
	}{{"error", options.BeforeSend}, {"transaction", options.BeforeSendTransaction}} {
		t.Run(hook.name, func(t *testing.T) {
			in := &sentry.Event{
				Message: canary, Release: canary, ServerName: canary, Logger: canary,
				Transaction: canary, Environment: "production", Fingerprint: []string{canary},
				User:        sentry.User{ID: canary, Email: canary},
				Contexts:    map[string]sentry.Context{"vault": {"value": canary}},
				Tags:        map[string]string{"vault": canary},
				Breadcrumbs: []*sentry.Breadcrumb{{Message: canary, Data: map[string]interface{}{"value": canary}}},
				Request: &sentry.Request{
					URL:    "https://" + canary + ".example/api/vault/" + canary + "?password=" + canary,
					Method: "POST", Data: canary, Cookies: canary, QueryString: canary,
					Headers: map[string]string{"User-Agent": canary, "X-Service-Key": canary},
					Env:     map[string]string{"REMOTE_ADDR": canary},
				},
				Exception: []sentry.Exception{{Type: canary, Value: canary, Module: canary,
					Mechanism: &sentry.Mechanism{Type: canary, Description: canary},
					Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{
						Module:   "github.com/bright-interaction/trustissues/internal/handlers",
						Function: "(*VaultImportHandler).ImportPreview", Filename: "vault_import.go", Lineno: 450,
						AbsPath: canary, Symbol: canary, ContextLine: canary,
						PreContext: []string{canary}, PostContext: []string{canary},
						Vars: map[string]interface{}{"password": canary}, Package: canary,
					}, {Module: canary, Filename: canary, Function: canary, Lineno: 1}}},
				}},
				Attachments: []*sentry.Attachment{{Filename: canary, Payload: []byte(canary)}},
			}
			if hook.name == "transaction" {
				in.Type = "transaction"
			}
			out := hook.fn(in, nil)
			raw, err := json.Marshal(out)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), canary) || len(out.Attachments) != 0 {
				t.Fatal("private synthetic input survived an actual client hook")
			}
			if out.Message != serverErrorCode || out.Release != "abc1234" || out.ServerName != "trustissues" || out.Environment != "production" {
				t.Fatalf("safe identity/category lost: %+v", out)
			}
			if out.Request.URL != "/api/vault/:id" || len(out.Exception[0].Stacktrace.Frames) == 0 {
				t.Fatal("useful route and first-party instruction location were lost")
			}
			for _, frame := range out.Exception[0].Stacktrace.Frames {
				if frame.Filename == "vault_import.go" && frame.Lineno == 450 {
					t.Fatal("a prefilled exception frame was trusted instead of the compiler capture chain")
				}
			}
		})
	}
}

func TestSDKScopeAndHintsCannotReattachPrivateDataAfterHook(t *testing.T) {
	const canary = "PRIVATE_SYNTHETIC_SCOPE_VALUE_4572"
	transport := &stalledTransport{}
	options := ClientOptions("https://public@flare.example/1", "trustissues", "abc1234")
	options.Transport = transport
	options.DisableLogs, options.DisableMetrics = true, true
	client, err := sentry.NewClient(options)
	if err != nil {
		t.Fatal(err)
	}
	scope := sentry.NewScope()
	scope.SetUser(sentry.User{Email: canary})
	scope.SetContext("vault", sentry.Context{"value": canary})
	scope.SetTag("vault", canary)
	scope.AddBreadcrumb(&sentry.Breadcrumb{Message: canary}, 10)
	scope.AddAttachment(&sentry.Attachment{Filename: canary, Payload: []byte(canary)})
	client.CaptureEvent(&sentry.Event{Message: canary, Exception: []sentry.Exception{{Value: canary}}}, &sentry.EventHint{
		Data: canary, OriginalException: errors.New(canary), RecoveredException: canary,
	}, scope)
	events := transport.captured()
	if len(events) != 1 {
		t.Fatalf("expected one real outbound event, got %d", len(events))
	}
	raw, err := json.Marshal(events[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), canary) || len(events[0].Attachments) != 0 {
		t.Fatal("SDK reattached private scope/hint/attachment data after BeforeSend")
	}
}

func TestPrivateHeartbeatRemainsLivenessOnly(t *testing.T) {
	out := privateClientEvent(&sentry.Event{Level: sentry.LevelInfo, Message: "service-up:trustissues"}, "abc1234")
	if out.Level != sentry.LevelInfo || out.Message != "service-up:trustissues" || strings.Join(out.Fingerprint, ":") != "service-up:trustissues" {
		t.Fatal("heartbeat no longer has its established liveness semantics")
	}
}
