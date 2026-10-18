# User-guide screenshots

These are screenshots of the real TrustIssues web app at source release
`823c618`, captured on **18 October 2026** using Chromium. The frontend was built
from that release's frozen Bun lockfile. The backend ran on loopback with a
fresh disposable SQLite database and newly generated temporary instance keys.
No production database, exported credentials or administrator login file was
used. The instance and its temporary data were removed after capture.

All people, emails, URLs and credentials are synthetic. `.test` addresses are
examples. Passwords remain masked; no API key, service key, MFA seed, QR code,
recovery code or PGP private key was minted or displayed for these pictures.

The account is an administrator, so screenshots include controls that ordinary
users and Vault only clients do not see. Private ingress and external providers
are not configured. Illustrating an option does not prove it is enabled or
tested against a live provider. Localhost endpoint examples must be replaced
with the operator-supplied HTTPS origin when connecting a real client.

## Image index

| Screenshot | What it explains |
|---|---|
| [01-first-run.png](01-first-run.png) | First administrator setup, only for an uninitialized instance |
| [02-locked-vault.png](02-locked-vault.png) | Account session versus locked vault |
| [03-create-vault.png](03-create-vault.png) | Name, description and access-policy choices |
| [04-vault-overview.png](04-vault-overview.png) | All/Personal/shared filters, health and masked entry rows |
| [05-add-credential.png](05-add-credential.png) | Selected destination and credential fields |
| [06-manage-vault.png](06-manage-vault.png) | Vault settings, pending/accepted membership and roles |
| [07-rotation-delivery.png](07-rotation-delivery.png) | Provider, schedule and delivery configuration |
| [08-service-identity.png](08-service-identity.png) | Machine access form before minting a key |
| [09-proton-import-preview.png](09-proton-import-preview.png) | Counts, migration warnings and confirmation gate |
| [10-pgp-export.png](10-pgp-export.png) | PGP protection versus account reauthentication |
| [11-users.png](11-users.png) | Administrator account and invitation management |
| [12-activity.png](12-activity.png) | Recorded actions and audit filters |
| [13-account-settings.png](13-account-settings.png) | Profile, password and MFA controls before enrollment |
| [14-vault-policy.png](14-vault-policy.png) | Team password, vault-lock, reminder and MFA policy |
| [15-ai-and-mcp.png](15-ai-and-mcp.png) | Provider selection and connection addresses |
| [16-api-keys.png](16-api-keys.png) | API-key naming and creation before any key is displayed |

## Updating screenshots

Use a disposable local instance of the release being documented. Build its
frontend with `bun install --frozen-lockfile` and `bun run build`. Build the
server using the repository's normal build instructions and default Go cache.
Use random temporary server keys, a new data directory and loopback binding.
Never point the screenshot session at an operator's real vault.

Create a fictional administrator and the sample Personal, Acme Client and
Engineering entries. Capture the indexed screens through the real UI; do not
mock successful backend responses or edit text into an image. For an import
preview, use a tiny generated Proton CSV containing a fictional login and note.
Do not confirm a real export or reveal sensitive enrollment material.

Use a 1440-pixel-wide desktop viewport. Allow enough height for dialogs and
wait for loading indicators and transient toasts to clear. Review the pictures
at readable size, check every Markdown image link, and update the release/date
here and in the guides together. Keep the screenshot meaning in the adjacent
guide text and alt text so readers do not have to infer the behavior from an
image alone. `manifest.json` records each image's dimensions and SHA-256 hash.

Some UI copy in AI & MCP describes Shield more broadly than the source supports.
The [security guide](../../SECURITY-AND-AUTOMATION-GUIDE.md) explains the actual
limits: MCP names and capability results are visible to the assistant; gateway
tokenization is not universal secret detection. The screenshots preserve the
real UI rather than silently correcting its wording inside an image.
