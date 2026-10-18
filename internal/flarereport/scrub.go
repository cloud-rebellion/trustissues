package flarereport

import (
	"net/url"
	"path"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	sentry "github.com/getsentry/sentry-go"
)

const serverErrorCode = "TRUSTISSUES_SERVER_ERROR"

var buildLabelPattern = regexp.MustCompile(`^[A-Za-z0-9._@+-]{1,100}$`)
var eventIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var sourceModulePattern = regexp.MustCompile(`^github\.com/bright-interaction/trustissues/(?:internal|cmd)(?:/[a-z][a-z0-9]*)+$`)
var sourceFilenamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*\.go$`)
var sourceFunctionPattern = regexp.MustCompile(`^(?:\(\*?[A-Za-z_][A-Za-z0-9_]*\)\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$`)

func buildLabel(value string) string {
	if buildLabelPattern.MatchString(value) {
		return value
	}
	return ""
}

// reportRoute returns product-owned templates only. Never forward a raw host,
// path segment, provider URL, query, collection name or credential identifier.
func reportRoute(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "/:unknown"
	}
	switch u.Path {
	case "/health", "/api/vault", "/api/vault/import/preview", "/api/vault/import/confirm",
		"/api/vault/import/native/preview", "/api/vault/import/native/confirm",
		"/api/service-identities/me/secrets", "/api/service-identities", "/api/collections",
		"/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/users", "/api/activity":
		return u.Path
	}
	for _, prefix := range []string{"/api/vault/", "/api/collections/", "/api/service-identities/", "/api/users/"} {
		if strings.HasPrefix(u.Path, prefix) {
			return prefix + ":id"
		}
	}
	if strings.HasPrefix(u.Path, "/proxy/") {
		return "/proxy/:target"
	}
	return "/:unknown"
}

// privateFrames derives compiler-owned locations from the active capture call
// chain, never prefilled exception strings. A stored handled-error creation
// stack may differ and is deliberately omitted to establish source provenance.
func privateFrames() *sentry.Stacktrace {
	var pcs [128]uintptr
	count := runtime.Callers(2, pcs[:])
	callers := runtime.CallersFrames(pcs[:count])
	frames := make([]sentry.Frame, 0, 32)
	for {
		caller, more := callers.Next()
		frame := sentry.NewFrame(caller)
		filename := path.Base(frame.Filename)
		if frame.Filename == "" {
			filename = path.Base(frame.AbsPath)
		}
		if !sourceModulePattern.MatchString(frame.Module) || !sourceFilenamePattern.MatchString(filename) || frame.Lineno <= 0 {
			if !more {
				break
			}
			continue
		}
		function := ""
		if len(frame.Function) <= 160 && sourceFunctionPattern.MatchString(frame.Function) {
			function = frame.Function
		}
		frames = append(frames, sentry.Frame{
			Module: frame.Module, Function: function, Filename: filename,
			Lineno: frame.Lineno, Colno: frame.Colno, InApp: true,
		})
		if !more || len(frames) == 32 {
			break
		}
	}
	// Sentry uses oldest -> newest; runtime.Callers returns the reverse.
	for left, right := 0, len(frames)-1; left < right; left, right = left+1, right-1 {
		frames[left], frames[right] = frames[right], frames[left]
	}
	return &sentry.Stacktrace{Frames: frames}
}

// scrubRequestEvent is the outbound allowlist for this vault product. Error
// messages (including panic values) may contain imported CSV rows or secrets;
// regex redaction cannot establish their safety. A fresh event also excludes
// SDK fields added later, attachments, breadcrumbs, user, contexts, extra,
// arbitrary tags, headers and request bodies by default.
func scrubRequestEvent(event *sentry.Event) *sentry.Event {
	if event == nil {
		return nil
	}
	if event.Request != nil {
		// Clear the original request buffers too, before constructing the fresh
		// projection. A retained input reference must not keep a second copy of
		// these fields; the estate scrub guard also checks this invariant.
		event.Request.QueryString = ""
		event.Request.Cookies = ""
		event.Request.Data = ""
		event.Request.Headers = nil
		event.Request.Env = nil
	}
	out := &sentry.Event{
		Platform: "go", Level: sentry.LevelError, Timestamp: event.Timestamp,
		Release: buildLabel(event.Release), ServerName: "trustissues",
		Message: serverErrorCode,
		Tags:    map[string]string{"source": "trustissues-backend", "error_code": serverErrorCode},
	}
	if eventIDPattern.MatchString(string(event.EventID)) {
		out.EventID = event.EventID
	}
	switch event.Environment {
	case "production", "staging", "development", "test":
		out.Environment = event.Environment
	}
	if event.Request != nil {
		method := ""
		switch event.Request.Method {
		case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
			method = event.Request.Method
		}
		out.Request = &sentry.Request{URL: reportRoute(event.Request.URL), Method: method}
	}
	// Keep the established, fixed liveness signal distinct from errors. Neither
	// the heartbeat message nor its fingerprint accepts an arbitrary service.
	if event.Level == sentry.LevelInfo && event.Message == "service-up:trustissues" && len(event.Exception) == 0 {
		out.Level = sentry.LevelInfo
		out.Message = "service-up:trustissues"
		out.Fingerprint = []string{"service-up", "trustissues"}
		out.Tags = map[string]string{"source": "trustissues-backend"}
		return out
	}
	if len(event.Exception) > 0 {
		out.Exception = []sentry.Exception{{
			Type: "ServerError", Value: serverErrorCode, Module: "trustissues",
			Stacktrace: privateFrames(),
		}}
	}
	out.Fingerprint = []string{serverErrorCode}
	if out.Request != nil {
		out.Fingerprint = append(out.Fingerprint, out.Request.URL)
	}
	for _, exception := range out.Exception {
		if exception.Stacktrace == nil {
			continue
		}
		for _, frame := range exception.Stacktrace.Frames {
			if len(out.Fingerprint) == 32 {
				break
			}
			out.Fingerprint = append(out.Fingerprint, frame.Module+":"+frame.Function+":"+frame.Filename+":"+strconv.Itoa(frame.Lineno))
		}
	}
	// Transactions are not enabled today. If enabled, retain aggregate timing
	// and a product route template, without spans, descriptions or custom data.
	if event.Type == "transaction" {
		out.Type = "transaction"
		out.StartTime = event.StartTime
		out.Transaction = "/:unknown"
		if out.Request != nil {
			out.Transaction = out.Request.URL
		}
	}
	return out
}
