# Security

Keyfold stores API keys in one encrypted file on your machine. This document
describes what that file protects, how, and what it cannot protect against.

## Reporting a problem

Please report security issues privately through the repository's security
advisory feature rather than a public issue. Include the version, a short
description, and reproduction steps. Do not attach a real vault or real keys.

## Threat model

**In scope**

- Someone copies the vault file (stolen laptop, leaked backup, malware that
  reads files) and tries to open it offline.
- Offline brute force against either password.
- Casual shoulder-surfing, clipboard snooping, and leaving the app unlocked.
- Silent corruption or truncation of the vault file.
- An attacker swapping ciphertext from one entry or tier into another.
- Casual screen capture of the app window (blocked by default on Windows and
  macOS through the OS content-protection API).

**Out of scope**

- Malware running as you **while the vault is unlocked**. It can read process
  memory or capture the screen through a path the OS does not protect.
- Keyloggers and kernel-level screen recorders.
- A weak password. Argon2id raises the cost of guessing; it cannot rescue
  `password123`.
- An attacker who can modify the Keyfold binary itself.
- Physical attacks that read RAM after the app has been closed and the keys
  dropped.

## Primitives

| Purpose | Primitive |
| --- | --- |
| Password to key | Argon2id, 32-byte output |
| Layer A | XChaCha20-Poly1305, 192-bit random nonce |
| Layer B | AES-256-GCM, 96-bit random nonce |
| Key separation | HKDF-SHA256 with distinct `info` labels |
| Randomness | OS CSPRNG (`getrandom`) only |
| Comparison | `subtle` constant-time equality |
| Memory cleanup | `zeroize` and `secrecy` |

Argon2id starts at 256 MiB, 3 iterations and parallelism 4. At creation (and on
demand from Settings) the app benchmarks the machine and raises the iteration
count until one derivation takes roughly 0.7–1.5 seconds. The chosen parameters
are stored in the vault header. On load, anything below 64 MiB or 3 iterations
is rejected, so a tampered header cannot weaken the KDF.

## Key hierarchy

```
master password  --Argon2id(salt1)-->  K1
critical password --Argon2id(salt2)-->  K2

VK = 32 random bytes, generated once   wrapped by K1                    -> wrapped_VK
CK = 32 random bytes, generated once   wrapped by HKDF(K1 || K2)       -> wrapped_CK
recovery key (256-bit)                 wraps VK and CK directly        -> recovery_VK / recovery_CK
```

Consequences:

- The master password alone opens only the Standard tier. Wrapped CK cannot be
  opened without both passwords; this is asserted by tests.
- Changing either password re-wraps VK and CK. It does not re-encrypt entries.
- The recovery key can unwrap both keys. It cannot be used to change passwords
  until the vault has been unlocked normally.

## Entry encryption

**Standard (two layers).** A fresh 32-byte item key `IK` is generated per secret.
The value is encrypted with `IK` using XChaCha20-Poly1305, then `IK` is wrapped
with an AES-256-GCM key derived from VK (`keyfold/v1/standard/item-wrap`).
Folder and key metadata use a separate VK subkey
(`keyfold/v1/standard/metadata`).

**Critical (three layers).** A fresh `IK` encrypts the value with
XChaCha20-Poly1305; that ciphertext is encrypted again with AES-256-GCM under a
CK subkey (`keyfold/v1/critical/layer2`); the result is encrypted once more with
XChaCha20-Poly1305 under a different CK subkey (`keyfold/v1/critical/layer3`).
`IK` itself is wrapped by a third CK subkey (`keyfold/v1/critical/item-wrap`).
The entire Critical tier payload is also sealed under its own metadata key, so
its folder names and labels stay unreadable while the tier is locked.

Every AEAD call uses a fresh nonce and binds
`vault_id || entry_id || tier || format_version` as associated data. Ciphertext
copied to another entry, tier, or vault fails authentication and is rejected.

> Honest note: stacking ciphers adds defense in depth against a flaw in a single
> implementation. The real strength of the Critical tier is the **second
> independent password** and Argon2id. "Three layers" is not a claim of
> unbreakability.

## What is encrypted

Secret values, notes, key labels, folder names, folder notes, providers and tags
are all inside the encrypted payload. Only the header — magic, format version,
KDF parameters, salts, wrapped keys, vault id — is plaintext.

## Vault file

```
KFLD | u16 format version | u32 header length | header JSON
     | standard blob (24-byte nonce | u32 length | ciphertext)
     | critical blob
```

- The header is validated on every load: magic, version, sizes, KDF floors.
- Saves write to a temporary file in the same directory, flush and sync it, then
  rename over the vault. The previous file is kept as `keyfold.vault.bak`.
- Malformed, truncated, padded, or newer-version files are refused with a clear
  error instead of being partially read.

## Session handling

- Derived keys and decrypted payloads exist only in Rust memory, wrapped in
  `Zeroizing`/`SecretString`. Locking drops and wipes them.
- Standard auto-lock defaults to 5 minutes of inactivity (1 / 5 / 15 / 30 /
  never). Critical auto-lock defaults to 60 seconds and is independent; when it
  fires, K2, CK and all decrypted Critical data are dropped.
- The vault locks on system sleep (a wall-clock gap in the one-second ticker)
  and, optionally, when the window is minimized.
- Wrong attempts are delayed after the fifth failure: 2 s, 4 s, 8 s, 16 s, 32 s,
  then 60 s. This is UI friction; Argon2id is the real cost.
- Decrypted values reach the webview only for Reveal or Copy. Revealed values
  hide after 10 seconds, when the view closes, when the window loses focus or
  becomes hidden, and whenever either tier locks.
- The clipboard is cleared after 20 seconds, but only if it still contains the
  copied value. It is also cleared immediately when the vault locks, when the
  Critical tier locks after a Critical copy, when the window is minimized, when
  the vault is deleted, and when the app exits. A SHA-256 fingerprint of the
  copied value is kept for that comparison; the secret itself is not retained.
- The packaged app prevents the browser context menu, and content protection asks
  the OS to exclude the window from screen capture where the platform supports
  it. This is defense in depth, not a guarantee against privileged malware or an
  external camera.

## No network

Keyfold has no HTTP client, no analytics, no crash reporting, no update check,
and no remote fonts or assets. The Tauri capability file grants only clipboard,
dialog and opener access. The Content Security Policy is restricted to local
assets and the Tauri IPC origin.

## Defence in depth (2026-11-06)

Controls added on top of the design above. None of them change the vault format,
so existing vaults keep opening.

- **Absolute session ceilings.** Activity (`touch`) is an IPC call that a
  compromised webview could loop, so idle timers alone cannot bound how long key
  material stays in memory. A Standard session expires after **12 hours** and a
  Critical session after **15 minutes**, regardless of activity. With auto-lock
  set to *Never*, the 12-hour ceiling is still the hard limit.
- **`#![forbid(unsafe_code)]`.** The core crate contains no `unsafe` block at
  all, and the compiler enforces that it never gains one.
- **Plaintext metadata is wiped on drop.** Labels, notes, providers, tags and
  expiry hints are zeroized when the unlocked tier is dropped, not only when the
  derived keys are.
- **Payload buffers are wiped.** The JSON buffers built during a save are
  `Zeroizing`, so decrypted metadata does not linger in freed heap memory.
- **Backups cannot be redirected.** A pre-created `keyfold.vault.bak` that is a
  directory or a link is refused, and the backup is written through a synced
  temporary file plus rename, so a local attacker cannot make Keyfold overwrite
  an unrelated file.
- **File permissions are restricted to the current user.** After every write,
  the vault, its `.bak` snapshot and a saved recovery-key file are limited to
  the account that runs Keyfold: `0600` on Unix, and on Windows
  `icacls /inheritance:r /grant:r <user>:(F)` invoked by absolute path so a
  poisoned `PATH` cannot substitute another program. This is best effort: a
  filesystem without ACL support reports no change and the write still stands,
  because refusing to save would be worse than loose permissions.
- **Permissions are tightened when the vault is opened**, not only when it is
  next saved, and the app data directory itself is limited to the current
  account, so another local user cannot even list it.
- **The webview cannot read the clipboard.** Capabilities grant clipboard
  *writing* only; reading is not in the ACL, and unused dialog permissions are
  gone. Drag-and-drop into the window is disabled as well, so a dropped file
  cannot navigate the webview.
- **The shipped binary is hardened**: `panic = "abort"`, LTO, a single codegen
  unit, stripped symbols and overflow checks, so a fault aborts instead of
  unwinding through the app and integer overflow never passes silently.
- **Constant-time fingerprint comparison** is used for every clipboard guard
  check, matching the comparison already used for key material.
- **Bounded input.** Search text is capped at 256 characters, a tier at 5,000
  keys and 500 folders, and entry metadata at the limits above.

## IPC boundary contract

Keyfold's webview is treated as untrusted. It renders data and asks the Rust
core to do everything else; the core re-checks every request as if it came from
an attacker. This section records which side owns which guarantee, so a future
change does not quietly move a check into the wrong layer.

### The backend is authoritative

| Guarantee | Enforced by | The frontend must not |
| --- | --- | --- |
| Password correctness, tier separation, KDF floors | `unlock*`, `verify_*_limited`, header validation | Assume a password is right because its own form passed |
| Rate limiting and backoff | `Session::begin_attempt` + `record_failure` (one guess at a time, failures counted before the next guess) | Retry in a loop or pipeline guesses |
| Identifier shape | `require_id` (UUID charset only) and `validate_header` for `vault_id` | Build ids client-side or pass ids from form input |
| Metadata size | `MAX_NOTE_LEN`, `MAX_PROVIDER_LEN`, `MAX_DATE_LEN`, `MAX_TAGS`, `MAX_TAG_LEN`, `MAX_SECRET_LEN` | Rely on its own length attributes as a limit |
| Settings policy | `Settings::validate` (fixed auto-lock and clipboard menu) | Offer values outside the fixed sets |
| Vault file size and shape | `VAULT_MAX_BYTES`, `MAX_HEADER_BYTES`, regular-file check | Ask the backend to read arbitrary paths anyway |
| File writes | `save_recovery_key` accepts only a valid recovery key, never overwrites, refuses directories; `export_backup` refuses the vault path | Send a composed document, or a path the user did not pick |
| Clipboard ownership | Only the backend writes secrets (`copy_secret`, `copy_recovery_key`) so it can fingerprint, time and clear them | Write a secret to the clipboard with the plugin directly |
| Session lifetime | Idle timers, sleep detection, minimize lock, per-command `expire()` | Keep working after a lock event without a fresh unlock |

Consequences the UI relies on:

- **Nothing secret is persisted outside Rust memory.** `localStorage` holds only
  `keyfold.viewMode` and `keyfold.sidebar`. Revealed values live in one React
  state slot, are dropped after 10 s, on Escape, on window blur, and whenever
  `secretsEpoch` is bumped by a lock event.
- **The renderer never derives keys.** It receives plaintext only from
  `get_secret` (one entry, on demand) and never sees the vault file.
- **Errors are opaque on purpose.** `AppError` serialises to a user-facing
  message with no internal detail; the UI shows it verbatim.
- **The dev preview is not a boundary.** `preview-backend.ts` is imported only
  when there is no Tauri runtime *and* `import.meta.env.DEV`; Vite strips it from
  releases. It performs no cryptography and must never be treated as a backend.

### Copying and saving the recovery key

The recovery key is as powerful as both passwords, so it follows the same rules
as a secret value:

- Copy goes through `copy_recovery_key`, which validates the key format, writes
  it once, records its SHA-256 fingerprint, schedules the configured auto-clear
  and lets the existing lock/minimize/exit paths wipe it.
- Save sends only the key. The backend composes the document text, so the webview
  cannot use the command as a general-purpose file writer.

## Verification

```bash
npm run test:rust
npm run clippy
npm run typecheck
npm run lint
```

The suite includes known-answer tests for AES-256-GCM and HKDF (RFC 5869),
nonce-uniqueness checks, tampering and swap tests, parameter-floor tests, atomic
write recovery, and an end-to-end test that creates a vault through the real IPC
surface, moves a key from Standard to Critical, restarts from disk, changes a
password and unlocks with the recovery key.
