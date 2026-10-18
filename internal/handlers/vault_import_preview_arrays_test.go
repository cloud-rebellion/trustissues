package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func previewCSV(t *testing.T, handler *VaultImportHandler, userID, data, format string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "fixture.csv")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(data)); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("format", format); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := vaultAuthzRequest(http.MethodPost, "/api/vault/import/preview", userID, "user", "", body.String())
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ImportPreview(response, request)
	return response
}

func TestCSVPreviewAlwaysReturnsArraysWithoutMutatingVault(t *testing.T) {
	vh, queries := newCollectionAuthzEnv(t)
	user := mustUser(t, queries, "csv-arrays@example.test", "user", "")
	handler := NewVaultImportHandler(vh.db, vh)
	for _, tc := range []struct {
		name, csv        string
		entries, skipped int
	}{
		{"no conflicts", "url,username,password,extra,name\nhttps://example.test,u,fixture-password,,Example\n", 1, 0},
		{"empty file", "url,username,password,extra,name\n", 0, 0},
		{"all rows skipped", "folder,type,name,notes,login_uri,login_username,login_password\n,note,Note,fixture-note,,,\n", 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := previewCSV(t, handler, user, tc.csv, "auto")
			if response.Code != http.StatusOK {
				t.Fatalf("preview status=%d body=%s", response.Code, response.Body.String())
			}
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(response.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"entries", "conflicts", "skipped"} {
				if !bytes.HasPrefix(raw[field], []byte("[")) {
					t.Fatalf("%s must be an array, got %s", field, raw[field])
				}
			}
			var data VaultImportPreview
			if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
				t.Fatal(err)
			}
			if len(data.Entries) != tc.entries || len(data.Skipped) != tc.skipped || data.SourceRows != tc.entries+tc.skipped {
				t.Fatal("incorrect CSV preview counts")
			}
		})
	}
	var count int
	if err := vh.db.QueryRow("SELECT count(*) FROM vault_entries").Scan(&count); err != nil || count != 0 {
		t.Fatalf("preview changed the vault: count=%d err=%v", count, err)
	}
}

func TestCSVPreviewFailsClosedWhenConflictCheckFails(t *testing.T) {
	vh, queries := newCollectionAuthzEnv(t)
	user := mustUser(t, queries, "csv-conflict-failure@example.test", "user", "")
	handler := NewVaultImportHandler(vh.db, vh)
	if err := vh.db.Close(); err != nil {
		t.Fatal(err)
	}
	response := previewCSV(t, handler, user, "url,username,password,extra,name\nhttps://example.test,u,fixture-secret,,Example", "auto")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("conflict query failure returned %d", response.Code)
	}
	if strings.Contains(response.Body.String(), "fixture-secret") {
		t.Fatal("error response exposed a value")
	}
}

func TestCSVPreviewDoesNotMisreadProtonAsLastPass(t *testing.T) {
	vh, queries := newCollectionAuthzEnv(t)
	user := mustUser(t, queries, "csv-proton@example.test", "user", "")
	handler := NewVaultImportHandler(vh.db, vh)
	for _, choice := range []string{"auto", "lastpass", "protonpass"} {
		response := previewCSV(t, handler, user, "type,name,url,email,username,password,note,totp,vault\nlogin,Example,https://example.test,,u,fixture-secret,private-note,fixture-totp,Personal", choice)
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "updated import dialog") {
			t.Fatalf("Proton must use the native migration, not lossy LastPass: %d", response.Code)
		}
		if strings.Contains(response.Body.String(), "fixture-secret") {
			t.Fatal("error response exposed a value")
		}
	}
}
