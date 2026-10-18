# PGP import and export

## Move from Proton Pass

1. In Proton Pass, open Settings → Export and choose the encrypted ZIP format.
   Choose an export passphrase and disable file attachments.
2. In TrustIssues, unlock the vault and choose **Import vault**. Select the ZIP,
   or the `Proton Pass/data.pgp` file extracted from it. You can also select a
   decrypted Proton Pass JSON export or a Proton Pass CSV. CSV is detected
   automatically; **Proton Pass CSV** is also available in the format selector.
3. For an encrypted file, enter the passphrase chosen during Proton's export.
   This is separate from the TrustIssues account password. Choose **Preview Import**.
4. Review the counts, migration details and any name conflicts. Enter your
   TrustIssues account password and confirm the import.

Decryption happens in a temporary browser worker. PGP private keys and PGP
passphrases are not uploaded. Decrypted data is sent to the existing TrustIssues
preview and import endpoints over the authenticated connection. No plaintext
download or temporary server-side PGP key is created by this feature.

Each nonempty Proton vault becomes a new standard shared vault managed by you.
Memberships are not copied. Login usernames, passwords and first URLs map to
credential fields; secure notes become credential values. TOTP URIs and original
item data, including additional URLs and custom fields, are stored as secret
custom fields. This preserves data without automatically configuring a TOTP
generator, autofill rules, provider rotation or AI access.

Duplicate item names are qualified with a vault name or number. Trashed items
and empty vaults are excluded with counts in the preview. Folder hierarchy is
flattened within each vault. Other item types are preserved as generic
credentials with their source data. Passkeys retained this way cannot be used
to authenticate: register them separately. Archives containing attachments or
multiple payloads are refused rather than partially imported. Oversized items
that do not fit the native import limits block the import; nothing is truncated.

These mappings follow Proton's documented ZIP/PGP workflow and public export
types. Keep your original export until you have verified the imported data.

CSV preserves vault grouping, exact password cells, multiline notes and TOTP
data. Original CSV cells are retained as secret source data. Proton's CSV export
omits some item details and custom fields, so encrypted JSON/ZIP is preferred
for a complete migration. Malformed rows block the entire preview. A CSV import
is limited to 5,000 rows and the same native size and item limits as JSON.

- [Proton Pass export guide](https://proton.me/support/pass-export)
- [Proton export types](https://github.com/ProtonMail/WebClients/blob/main/packages/pass/lib/export/types.ts)
- [Proton CSV exporter](https://github.com/ProtonMail/WebClients/blob/main/packages/pass/lib/export/csv.ts)
- [Proton archive layout](https://github.com/ProtonMail/WebClients/blob/main/packages/pass/lib/export/archive.ts)

## Export an encrypted TrustIssues backup

Choose **Export vault → PGP-encrypted TrustIssues JSON (.asc)**. Supply either a
separate passphrase of at least 12 characters, entered twice, or the recipient's
armored public key. Verify the recipient fingerprint using your PGP tool. Re-enter
your TrustIssues account password to authorize the export.

Only encrypted bytes are downloaded. Encryption failure never falls back to a
plaintext download. Preserve the matching private key or export passphrase;
TrustIssues cannot recover them. Plaintext JSON remains an explicit format option.

The payload is the versioned TrustIssues native JSON format, preserving its
collections and fields. It is readable with TrustIssues or standard OpenPGP tools
such as GPG. **It is not Proton Pass's native JSON schema**, so do not select
Proton Pass's own export format when importing this backup into that application.

Export authorization and public/private ingress scope are unchanged: PGP
encryption does not grant access to entries outside the current export scope.

## Other PGP files and limits

Imports accept armored `.asc` and binary `.pgp`/`.gpg` messages wrapping supported
CSV, TrustIssues JSON or Proton Pass JSON. Select passphrase decryption or provide
an armored private key file (`.asc`), including its passphrase when protected.
The decrypted payload goes through the usual preview, conflict and confirmation
steps. OpenPGP message integrity is required. Sender signatures are not verified.

Encrypted input and ZIP payloads are limited to 16 MiB; decrypted/native data is
limited to 10 MiB; armored keys are limited to 256 KiB. ZIPs are processed in
memory with actual decompressed-output limits, a bounded file count, and a single
approved payload path. PGP processing has a 60-second deadline and is terminated
when the dialog closes. After a confirmed HTTP import has started, closing the
dialog cannot guarantee rollback of a transaction the server already committed.

Keys, passphrases and decrypted file references are discarded when the flow
closes. Browser garbage collection is not secure erasure. The browser, served
JavaScript and vault server remain trusted; local PGP processing does not turn
TrustIssues into a zero-knowledge vault.

The implementation pins [OpenPGP.js](https://github.com/openpgpjs/openpgpjs)
6.3.1 (LGPL-3.0-or-later) and [fflate](https://github.com/101arrowz/fflate)
0.8.3 (MIT); source and license texts are available with those packages. No
custom cryptographic algorithms or global GPG keyring are used by the app.
