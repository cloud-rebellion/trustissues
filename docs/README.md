# TrustIssues documentation

Inside TrustIssues, open **Documentation** from the sidebar. Search guides by
topic, choose a guide and use **On this page** to jump to a section. Select a
screenshot to open it at full size, or use **Print guide** for a paper/PDF copy.
Documentation is available to every signed-in role, including client accounts
and accounts still enrolling in MFA; credential operations keep their existing
permission and enrollment checks.

Start with the **[illustrated user guide](USER-GUIDE.md)**. It explains the app
through real tasks and screenshots, including Personal versus shared vaults,
adding credentials, client sharing, Proton Pass import and PGP export.

## Guides by audience

| Guide | Audience and contents |
|---|---|
| [User guide](USER-GUIDE.md) | Everyone: sign-in, unlock, create a vault, add/use/edit credentials, imports, exports and troubleshooting |
| [Administration and team guide](ADMIN-GUIDE.md) | Account administrators and vault managers: permissions, client invitations, MFA, extension connection, rotation, logs and settings |
| [Security and automation guide](SECURITY-AND-AUTOMATION-GUIDE.md) | People connecting AI/IDEs or services, and operators: encryption boundaries, MCP/proxy, provider gateway, service identities and private access |

These guides describe release **`823c618`**, checked on **18 October 2026**.
The [16 screenshots](screenshots/user-guide/README.md) use synthetic data in an
isolated instance, not customer vault contents. Role-dependent controls and
operator configuration affect what your instance displays.

## Focused references and runbooks

| Reference | Use it for |
|---|---|
| [PGP import and export](PGP-IMPORT-EXPORT.md) | Supported encrypted files, Proton mapping, keys/passphrases, limits and fidelity |
| [Portability](PORTABILITY.md) | Native JSON contents, export scope, import conflicts and authority that does not transfer |
| [Private ingress](PRIVATE-INGRESS.md) | Configure and verify the separate private listener, overlay network and access policies |
| [Backup and restore](BACKUP.md) | WAL-safe database backups, separate key custody, restore checks and recovery |
| [Administrator lockout recovery](ADMIN-LOCKOUT-RECOVERY.md) | Operator recovery when normal administrator sign-in is unavailable |
| [Security policy](../SECURITY.md) | Encryption, key handling and security reporting |
| [Threat model](../THREAT-MODEL.md) | What the system defends, what it trusts and known limitations |
| [Architecture contract](../CONTRACT.md) | Backend architecture and development constraints |
| [Frontend contract](../FRONTEND-CONTRACT.md) | Frontend architecture and behavior contracts |
| [Contributor guide](../CONTRIBUTING.md) | Build and contribution workflow |
| [Deferred work](../DEFERRED.md) | Explicitly deferred functionality |

The guides explain product behavior. They do not certify that optional private
ingress, every provider adapter, SMTP or an extension package has been configured
and accepted on a particular installation.
