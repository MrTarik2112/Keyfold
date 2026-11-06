# Keyfold — Build Plan

> **Audience:** an AI coding agent that will build this application end to end.
> **Read this whole file before writing any code.** Follow it literally. Where the plan says MUST / MUST NOT, treat it as a hard requirement. Where it says SHOULD, use judgment.
> **Language rule:** the application name, every UI string, every error message, every comment, every identifier, and all documentation are **English only**. No localization layer, no Turkish strings anywhere in the product.

---

## 1. Product summary

**Keyfold** is a local-first, offline, encrypted vault dedicated to **API keys**.

**The problem:** websites such as OpenAI, Anthropic, Stripe, and GitHub show an API key exactly once. If you did not save it somewhere safe, it is gone. People end up pasting keys into notes apps, `.env` files, and chat messages.

**The solution:** a desktop app that behaves like a password manager, but is built around API keys and the way people actually organize them (many keys per provider).

**Core ideas:**

1. Unlock the vault with a **master password**.
2. Keys live in one of **two tiers**:
   - **Standard** — unlocked by the master password.
   - **Critical** — requires a **second, separate master password** entered after the first one. Protected by stronger, layered encryption.
3. Inside either tier you can add:
   - a **Folder** (a provider or project, e.g. "ChatGPT") that holds many keys, or
   - a plain standalone **Key**.
4. Modern, minimal, black-and-gray interface with one clear "+" action.
5. Nothing ever leaves the machine. No accounts, no cloud, no telemetry.

---

## 2. Goals and non-goals

### Goals
- Store API keys safely at rest with well-reviewed cryptography.
- Make the two-tier model feel natural and fast.
- Be pleasant to use: fast, keyboard-friendly, beautiful.
- Be a small, dependable single installer.

### Non-goals (do NOT build these)
- No cloud sync, no accounts, no server component.
- No browser extension or autofill.
- No sharing or teams.
- No custom cryptographic primitives. Use audited libraries only.
- No telemetry, analytics, crash reporting that phones home, or auto-update pings in v1.

---

## 3. Name and branding

- **Name:** `Keyfold` (a "fold" is both a folder of keys and something that tucks things away safely).
- **Tagline:** *"Every key, folded away safely."*
- **Tier names shown in UI:** `Standard` and `Critical`.
- **Folder terminology in UI:** "Folder" for a group of keys, "Key" for a single secret.
- **Logo:** simple monochrome mark, a key whose bow is shaped like a folded corner. Deliver as SVG, plus `.ico` and `.png` app icons (16–1024 px). Keep it flat, one accent color on a dark rounded-square background.

---

## 4. Technology stack

Use exactly this unless a hard blocker appears (if so, document the deviation in `DECISIONS.md`).

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri 2** | Small binary, low RAM, Rust backend, native feel |
| Backend / crypto | **Rust** (stable) | Memory safety, `zeroize`, strong crypto crates |
| Frontend | **React 18 + TypeScript (strict)** | Fast to build polished UI |
| Build tool | **Vite** | Fast dev loop |
| Styling | **Tailwind CSS** + CSS variables for design tokens | Consistent theming |
| Components | **Radix UI primitives** (dialogs, dropdowns, tooltips) | Accessible, unstyled |
| Animation | **Framer Motion** | Smooth, spring-based transitions |
| Icons | **Lucide React** | Clean, consistent line icons |
| State | **Zustand** | Tiny, simple |
| Fonts | **Inter** (UI) and **JetBrains Mono** (keys), bundled locally | No network font loading |

**Target platform:** Windows 11 first (primary), but keep code cross-platform-clean so macOS and Linux build without changes.

**Rust crates:**
- `argon2` — password hashing / key derivation (Argon2id)
- `chacha20poly1305` — XChaCha20-Poly1305 AEAD
- `aes-gcm` — AES-256-GCM AEAD
- `hkdf` + `sha2` — key separation
- `rand` / `getrandom` (OS CSPRNG) — all randomness
- `zeroize` — wipe secrets from memory
- `secrecy` — wrap secrets so they cannot be accidentally logged
- `serde`, `serde_json`, `bincode` or `rmp-serde` — serialization
- `thiserror`, `anyhow` — errors
- `tauri-plugin-clipboard-manager` — clipboard
- `tempfile` — atomic writes
- `subtle` — constant-time comparisons

---

## 5. Security architecture

This is the most important section. Implement it exactly. All cryptography lives in the **Rust backend only**. The frontend never sees master passwords after submitting them and never holds derived keys.

### 5.1 Threat model

**Protect against:**
- Someone copying the vault file (stolen laptop, backup leak, malware that reads files).
- Offline brute-force of the master passwords.
- Casual shoulder-surfing and clipboard snooping.
- Leaving the app unlocked and walking away.

**Out of scope (document honestly in the README):**
- Malware running as the user *while the vault is unlocked* (it can read process memory or the screen).
- Keyloggers.
- A weak master password. Argon2id slows guessing but cannot save "password123".

### 5.2 Primitives

| Purpose | Primitive |
|---|---|
| Password → key | **Argon2id** |
| Layer A cipher | **XChaCha20-Poly1305** (192-bit random nonce) |
| Layer B cipher | **AES-256-GCM** (96-bit random nonce, never reused per key) |
| Key separation | **HKDF-SHA256** with distinct `info` labels |
| Randomness | OS CSPRNG only |

**Argon2id parameters:** default `memory = 256 MiB`, `iterations = 3`, `parallelism = 4`, output 32 bytes. On first run, run a quick benchmark and raise `iterations` until one derivation takes roughly **0.7–1.5 seconds** on the machine. Store the chosen parameters in the vault header so they can be reproduced. Enforce a floor of 64 MiB / 3 iterations so a tampered header cannot weaken it.

### 5.3 Key hierarchy

```
Master Password (P1) ──Argon2id(salt1)──► K1 (32 bytes)
Critical Password (P2) ──Argon2id(salt2)──► K2 (32 bytes)

Vault Key (VK)          random 32 bytes, generated once at vault creation
Critical Key (CK)       random 32 bytes, generated once at vault creation

VK is stored encrypted ("wrapped") by K1.                 -> wrapped_VK
CK is stored encrypted ("wrapped") by a key derived from BOTH K1 and K2:
        W = HKDF(ikm = K1 || K2, info = "keyfold/v1/critical-wrap")
                                                           -> wrapped_CK
```

Consequences:
- Master password alone unlocks the **Standard** tier only.
- Reaching the **Critical** tier needs **both** passwords, in order.
- Changing a password re-wraps a small key; it does not re-encrypt every entry.

### 5.4 Standard tier encryption (2 layers)

For each Standard secret value:

1. Generate a fresh random **item key** `IK` (32 bytes).
2. Layer 1: encrypt the secret with `IK` using **XChaCha20-Poly1305**.
3. Layer 2: encrypt `IK` with `VK`-derived key using **AES-256-GCM** (store the wrapped item key beside the ciphertext).

Use HKDF to derive separate subkeys from `VK` for each purpose (`"keyfold/v1/standard/item-wrap"`, `"keyfold/v1/standard/metadata"`).

### 5.5 Critical tier encryption (3 layers)

For each Critical secret value:

1. Generate a fresh random item key `IK`.
2. **Layer 1:** encrypt the secret with `IK` using **XChaCha20-Poly1305**.
3. **Layer 2:** encrypt that ciphertext again with a subkey from `CK` using **AES-256-GCM** (`info = "keyfold/v1/critical/layer2"`).
4. **Layer 3:** encrypt the result again with a different subkey from `CK` using **XChaCha20-Poly1305** (`info = "keyfold/v1/critical/layer3"`).
5. Wrap `IK` with a third `CK` subkey (`info = "keyfold/v1/critical/item-wrap"`).

All layers MUST use independent keys and fresh nonces. Authenticate everything with AEAD and bind **associated data (AAD)** = `vault_id || entry_id || tier || format_version` so ciphertext cannot be swapped between entries.

> **Honesty note for the README:** stacking ciphers adds defense-in-depth and protects against a flaw in any single implementation, but the real security of Critical comes from the **second independent password** and Argon2id. Do not market this as "unbreakable" or "military grade". Say what it does.

### 5.6 What gets encrypted

- Secret values (the API keys): always.
- Notes: always, in the same tier as the entry.
- **Folder names and key labels are also encrypted** (Critical tier labels are only visible after the Critical tier is unlocked). Only the vault header (KDF params, salts, versions, wrapped keys) is plaintext.

### 5.7 Vault file

- Single file: `keyfold.vault` in the OS app-data directory (via Tauri path API).
- Layout: magic bytes `KFLD`, format version (u16), header (KDF params, salt1, salt2, wrapped_VK, wrapped_CK, vault_id), then an encrypted payload.
- **Atomic writes:** write to a temp file in the same directory, `fsync`, then rename over the original. Keep one rolling backup `keyfold.vault.bak`.
- On load, validate magic, version, and parameter floors. Refuse to open anything malformed with a clear error.

### 5.8 Session and memory handling

- Derived keys and decrypted values live only in Rust, inside `secrecy`/`zeroize` types.
- **Auto-lock:** default 5 minutes of inactivity (configurable 1 / 5 / 15 / 30 min / never-not-recommended). Also lock on: window minimize (optional setting), system sleep/lock, and a manual **Lock** button (`Ctrl+L`).
- **Critical tier auto-lock is shorter:** default **60 seconds** after the last Critical interaction, independent of the Standard session. When Critical locks, wipe `K2`, `CK`, and any decrypted Critical values.
- Decrypted values are sent to the UI only when the user presses **Reveal** or **Copy**, and are cleared from UI state after 10 seconds or when the view closes.
- **Clipboard:** after Copy, clear the clipboard after 20 seconds (only if it still contains the copied value).
- Disable devtools and the right-click menu in release builds. Set a strict Content Security Policy. No remote content, no external network permissions in `tauri.conf`.
- Never log secrets. Add a lint/grep check in CI to catch `println!`/`console.log` near secret types.
- Rate limiting: after 5 wrong master/critical attempts, enforce an increasing delay (2s, 4s, 8s ... up to 60s) in the UI session. (Real protection is Argon2id cost; this is just friction.)

### 5.9 Recovery

- At vault creation, generate a **Recovery Key** (random 256-bit, shown as 8 groups of 4 words or 52 base32 chars) that can unwrap `VK` and `CK`.
- Force the user through a screen: show it once, require them to confirm they saved it (type the last 4 characters to proceed).
- Offer `Settings → Security → Regenerate recovery key` (requires both passwords).
- State clearly in the UI: **"If you lose your master passwords and your recovery key, your data cannot be recovered. Nobody can help, including us."**

### 5.10 Export / import

- `Export encrypted backup`: writes a copy of the vault file (still encrypted) to a location the user picks.
- `Import backup`: loads a `.vault` file after validating it, asks before replacing the current vault.
- **No plaintext export in v1.** (Optionally add a Critical-gated, heavily warned plaintext export later; do not build it now.)

### 5.11 Password strength

- At creation, enforce minimum **12 characters** for the master password and for the Critical password.
- Show a strength meter (use `zxcvbn-ts`, bundled offline). Block scores below 3 with a clear explanation.
- **The two passwords MUST NOT be identical.** Reject with a clear message.
- Show a one-time suggestion to use a long passphrase (4+ random words).

### 5.12 Testing requirements for security code

- Unit tests: encrypt/decrypt round trip for both tiers; wrong password fails; tampered ciphertext fails; swapped entry ciphertext (AAD mismatch) fails; nonce uniqueness; parameter-floor enforcement; atomic write recovery.
- Use known-answer tests for each primitive where the crates provide vectors.
- A test that proves Critical data cannot be decrypted with `P1` only.
- A test that proves zeroization types are used for key material (code review checklist item).

---

## 6. Data model

All of this is serialized into the encrypted payload (never plaintext on disk).

```ts
type Tier = "standard" | "critical";

interface Vault {
  id: string;                 // uuid
  createdAt: string;          // ISO
  settings: Settings;
  standard: TierData;
  critical: TierData;         // encrypted under CK; unreadable until unlocked
}

interface TierData {
  folders: Folder[];
  keys: ApiKey[];             // standalone keys (not in a folder)
}

interface Folder {
  id: string;
  name: string;               // e.g. "ChatGPT"
  icon: string;               // built-in icon id or emoji
  color: string;              // token name from the accent palette
  note?: string;
  keys: ApiKey[];
  createdAt: string;
  updatedAt: string;
}

interface ApiKey {
  id: string;
  label: string;              // e.g. "Production - main app"
  value: string;              // the secret itself
  note?: string;
  provider?: string;          // free text, e.g. "OpenAI"
  tags?: string[];
  expiresAt?: string;         // optional reminder date
  createdAt: string;
  updatedAt: string;
  lastCopiedAt?: string;
}

interface Settings {
  autoLockMinutes: number;        // default 5
  criticalAutoLockSeconds: number;// default 60
  clipboardClearSeconds: number;  // default 20
  lockOnMinimize: boolean;        // default true
  reduceMotion: boolean;          // default follows OS
  compactMode: boolean;           // default false
}
```

**Rules**
- A folder holds any number of keys (users will put 5–6 or more).
- A key can live inside a folder or at the tier root.
- Moving keys between folders and between tiers MUST re-encrypt them under the target tier's scheme. Moving Standard → Critical requires the Critical tier to be unlocked.
- Deleting asks for confirmation. Deleting a folder with keys requires typing the folder name.

---

## 7. Features (v1 scope)

### 7.1 Onboarding (first run)
1. **Welcome** screen: logo, tagline, "Create your vault".
2. **Master password** screen: password + confirm, live strength meter, rules.
3. **Critical password** screen: explains "This second password protects your most sensitive keys." Same inputs, must differ from the master password.
4. **Recovery key** screen: show once, copy/save-to-file button, confirmation step.
5. A short **security promise** screen (what is and is not protected). Then enter the app.

### 7.2 Unlock
- Centered card on a dark background, password field with show/hide toggle, "Unlock" button, `Enter` submits.
- Shake animation + inline error on a wrong password.
- Subtle indicator of failed-attempt delay.

### 7.3 Main workspace
- **Sidebar (left):** two top-level sections: **Standard** (shield icon) and **Critical** (lock icon, accent-red tint). Under each, the list of folders. Bottom: Settings, Lock.
- **Critical section:** shows a locked state until the second password is entered, via an inline gate. Once unlocked it shows a visible countdown pill (e.g. `Locks in 0:48`).
- **Content area:** header with the folder/tier name, search, and a **sort/filter** control. Then the keys as rows (list) or cards (toggle).
- **Global search** (`Ctrl+K` command palette): searches Standard always, and Critical only when unlocked.

### 7.4 The "+" button (primary action)
A floating round "+" button, bottom-right of the content area, also reachable with `Ctrl+N`. Clicking it opens a small animated menu with exactly two choices:

1. **New Folder** — name, icon, color, optional note.
2. **New Key** — label, value, optional provider/notes/tags/expiry. If a folder is currently open, the key is added into that folder by default (with a dropdown to change it, or "No folder").

The new item goes into whichever tier is currently selected. Make the target tier obvious in the dialog title ("New Key in Critical").

### 7.5 Key row/card behavior
- Value is **masked by default** (`sk-••••••••••••3f9a`, show first 3 and last 4 characters only if the key is long enough; otherwise fully masked).
- Buttons: **Reveal** (eye), **Copy**, **Edit**, **Move**, **Delete**.
- Reveal auto-hides after 10 seconds.
- Show created date, last copied, and an **expiry badge** when set (amber when within 14 days, red when expired).
- Copy gives a toast: "Copied. Clipboard clears in 20s."

### 7.6 Folder behavior
- Folder tile/entry shows the icon, name, and key count.
- Provider icon presets (OpenAI, Anthropic, Google, GitHub, Stripe, AWS, Cloudflare, Generic) as simple monochrome glyphs. Do not use trademarked logos; use neutral letter-marks or generic icons.
- Drag and drop to reorder folders and to move keys between folders (with keyboard-accessible "Move to..." alternative).
- Folder detail view: list of keys, "Add key" inline row, rename, change icon/color, delete.

### 7.7 Settings
- **Security:** auto-lock timers, clipboard clear time, lock on minimize, change master password, change Critical password, regenerate recovery key, Argon2id cost info (read-only) with a "re-tune" button.
- **Appearance:** compact mode, reduce motion, accent color choice (from a curated set).
- **Data:** export encrypted backup, import backup, open vault file location, delete vault (typed confirmation, requires both passwords).
- **About:** version, license, a plain-language security summary.

### 7.8 Nice-to-haves (only after everything above works and is tested)
- Key expiry reminders on the unlock screen ("2 keys expire this week").
- "Recently copied" list.
- Optional Windows Hello / biometrics for the **Standard** tier only (never Critical).
- Import from `.env` file into a folder (parse into labeled keys).

---

## 8. Design system

Goal: a calm, premium, developer-tool feel. Think dark-mode-first apps such as Linear, Raycast, and 1Password's desktop app: lots of breathing room, subtle borders instead of heavy shadows, restrained color, crisp type. Contrast and clarity matter more than decoration, since a vault UI that confuses users causes security mistakes.

### 8.1 Color tokens (CSS variables)

```css
:root {
  /* Neutrals — black to gray */
  --bg-0: #070708;       /* app background */
  --bg-1: #0d0d0f;       /* sidebar */
  --bg-2: #131316;       /* cards, panels */
  --bg-3: #1a1a1f;       /* hover / raised */
  --bg-4: #23232a;       /* inputs, pressed */
  --border-subtle: #1f1f25;
  --border: #2b2b33;
  --border-strong: #3a3a44;

  --text-0: #f4f4f6;     /* primary */
  --text-1: #b6b6c0;     /* secondary */
  --text-2: #7c7c88;     /* muted */
  --text-3: #55555f;     /* disabled */

  /* Single accent for Standard */
  --accent: #8b8cff;     /* soft indigo-violet */
  --accent-hover: #a2a3ff;
  --accent-bg: rgba(139, 140, 255, 0.12);

  /* Critical tier identity */
  --critical: #ff5d6c;   /* warm red */
  --critical-bg: rgba(255, 93, 108, 0.12);

  /* Status */
  --success: #3ddc97;
  --warning: #ffb84d;
  --danger: #ff5d6c;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
}
```

Rules:
- The UI is **black/gray dominant**. Accent color is used sparingly: primary buttons, focus rings, active sidebar item, the "+" button.
- Critical tier gets its own red tint so the user always knows when they are in the high-security area.
- All body text MUST meet WCAG AA contrast (4.5:1) against its background. Verify the muted text tokens.
- Offer 4–5 accent alternatives in Settings (indigo, emerald, amber, rose, cyan), swapping `--accent` only.

### 8.2 Typography
- UI: **Inter**, weights 400/500/600. Base size 14 px, line-height 1.5. Headings 18/24/32 px, tight tracking.
- Secrets and key values: **JetBrains Mono**, 13 px, with `font-variant-ligatures: none` so characters are unambiguous.
- Use tabular numbers for counters and countdowns.

### 8.3 Layout
- Window default 1080×720, minimum 860×560. Custom dark title bar (Tauri decorations off) with drag region, plus native-feeling window controls.
- Sidebar 260 px (collapsible to 64 px icons-only). Content max width 960 px, centered, 32 px padding.
- 8-px spacing scale (4, 8, 12, 16, 24, 32, 48).
- Cards: `--bg-2` background, 1 px `--border-subtle` border, `--radius-lg`. Hover raises to `--bg-3` with a slightly stronger border (no big drop shadows).
- A faint noise or very soft radial gradient glow behind the unlock card is allowed; keep it subtle.

### 8.4 Components checklist
Buttons (primary, secondary, ghost, danger), icon buttons, text input, password input with show/hide and strength meter, select, switch, segmented control, modal dialog, popover menu (for "+"), tooltip, toast, badge/pill, key row, folder tile, empty state, skeleton loader, command palette, context menu, countdown pill.

### 8.5 Motion
- Use springs (stiffness ~300, damping ~30) for dialogs, menus, and sidebar transitions. Durations 150–250 ms.
- "+" button rotates 45° into an "×" when its menu is open; menu items stagger in.
- Critical unlock: the lock icon animates open, the red accent fades in.
- Wrong password: horizontal shake (3 oscillations, 250 ms).
- Respect `prefers-reduced-motion` and the in-app Reduce motion setting by replacing movement with simple fades.
- Never animate in a way that delays access to a secret.

### 8.6 Empty states
Friendly, short, English copy with one clear call to action. Example: "No folders yet. Press + to create one, like 'OpenAI' or 'Stripe'."

### 8.7 Accessibility
- Full keyboard navigation, visible focus rings (2 px accent, offset), correct ARIA roles via Radix.
- Do not rely on color alone for status; pair with icons/text.
- Minimum hit target 32×32 px.

### 8.8 Copy tone
Short, calm, direct. No jokes in security-critical messages. Examples:
- "Vault locked."
- "Critical tier unlocked. Locks automatically in 60 seconds."
- "That password is incorrect."

---

## 9. Project structure

```
keyfold/
├─ plan.md
├─ README.md
├─ DECISIONS.md                # any deviations from this plan, with reasons
├─ SECURITY.md                 # threat model + honest limitations
├─ package.json
├─ vite.config.ts
├─ tailwind.config.ts
├─ src/                        # frontend
│  ├─ main.tsx
│  ├─ app/                     # routes/screens: Onboarding, Unlock, Workspace, Settings
│  ├─ components/              # ui primitives + feature components
│  ├─ features/
│  │  ├─ vault/                # folders, keys, dialogs
│  │  ├─ critical-gate/
│  │  ├─ search/
│  │  └─ settings/
│  ├─ lib/                     # tauri command wrappers (typed), utils
│  ├─ store/                   # zustand stores
│  └─ styles/                  # tokens.css, globals.css
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json          # strict CSP, no network permissions
   └─ src/
      ├─ main.rs
      ├─ commands.rs           # the only surface exposed to the frontend
      ├─ crypto/
      │  ├─ kdf.rs             # Argon2id + benchmark
      │  ├─ aead.rs            # XChaCha20-Poly1305, AES-256-GCM wrappers
      │  ├─ hierarchy.rs       # VK/CK wrapping, HKDF labels
      │  └─ layers.rs          # standard (2) and critical (3) layering
      ├─ vault/
      │  ├─ model.rs
      │  ├─ storage.rs         # atomic file IO, backup, header validation
      │  └─ session.rs         # unlocked state, auto-lock timers
      └─ tests/
```

**Tauri command surface (keep it minimal, all typed):**
`vault_exists`, `create_vault`, `unlock`, `lock`, `unlock_critical`, `lock_critical`, `list_tree(tier)` (labels only, no secrets), `get_secret(entry_id)` (returns the value for Reveal/Copy), `create_folder`, `create_key`, `update_*`, `move_*`, `delete_*`, `search`, `get_settings`, `set_settings`, `change_master`, `change_critical`, `regenerate_recovery`, `export_backup`, `import_backup`, `session_status`.

`list_tree` MUST NOT return secret values. Only `get_secret` does, one entry at a time.

---

## 10. Build phases

Complete each phase, with tests passing, before starting the next.

**Phase 0 — Scaffolding**
Tauri 2 + Vite + React + TS strict + Tailwind. Lint (ESLint, Clippy `-D warnings`), formatting (Prettier, rustfmt), CI script that runs both test suites. Strict CSP in `tauri.conf.json`.

**Phase 1 — Crypto core (Rust, no UI)**
Argon2id with benchmark, AEAD wrappers, HKDF hierarchy, layered encrypt/decrypt for both tiers, vault file read/write with atomic saves. Full unit-test suite from section 5.12. **Do not proceed until all crypto tests pass.**

**Phase 2 — Session and commands**
Unlock/lock, Critical unlock/lock with its own timer, auto-lock, clipboard clearing, recovery key flow, rate-limit friction. Expose the Tauri commands.

**Phase 3 — Design system**
Tokens, base components, custom title bar, a `/design` dev page showing every component in every state.

**Phase 4 — Screens**
Onboarding, Unlock, Workspace shell (sidebar, header, content), Critical gate, "+" menu, New Folder / New Key dialogs, key rows with reveal/copy, folder view, search / command palette, empty states.

**Phase 5 — Settings and data**
All settings, change-password flows, export/import backup, delete vault.

**Phase 6 — Polish**
Animations, reduced motion, keyboard shortcuts, accessibility pass, toast/error states, icon and branding assets, performance pass (cold start target under 1 second to the unlock screen, excluding Argon2id).

**Phase 7 — Packaging**
Windows installer (NSIS/MSI via Tauri bundler), app icons, version stamping. Write README and SECURITY.md.

---

## 11. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette / search |
| `Ctrl+N` | Open the "+" menu |
| `Ctrl+L` | Lock vault now |
| `Ctrl+Shift+L` | Lock Critical tier only |
| `Ctrl+,` | Settings |
| `Esc` | Close dialog / hide revealed value |
| `Ctrl+C` on a focused key row | Copy its value |

---

## 12. Acceptance checklist (definition of done)

**Security**
- [ ] All crypto in Rust; frontend never receives keys, only requested secrets.
- [ ] Standard values use the 2-layer scheme; Critical values use the 3-layer scheme with independent keys and AAD binding.
- [ ] Critical tier is unreadable with the master password alone (test proves it).
- [ ] Argon2id params benchmarked, stored in header, floors enforced.
- [ ] Vault file validated on load; writes are atomic with a backup.
- [ ] Secrets zeroized; none logged; clipboard clears; both auto-lock timers work.
- [ ] Recovery key flow works end to end.
- [ ] No network permissions or requests anywhere in the app.

**Product**
- [ ] First-run onboarding creates a working vault with two distinct passwords.
- [ ] "+" creates folders and standalone keys in the current tier.
- [ ] A folder can hold 6+ keys with a smooth, organized view.
- [ ] Move keys between folders and tiers with correct re-encryption.
- [ ] Search works; Critical results only appear when unlocked.
- [ ] Export and import of encrypted backups works.

**Design**
- [ ] Black/gray theme matches the token system, with a single restrained accent and a distinct red Critical identity.
- [ ] Animations are smooth and respect reduced-motion.
- [ ] Every screen is keyboard accessible and passes AA contrast.
- [ ] **All UI text is English.** Run a final search for non-English strings.

**Quality**
- [ ] `cargo clippy -D warnings`, `cargo test`, ESLint, and TypeScript strict all clean.
- [ ] Windows installer builds and installs on a clean machine.

---

## 13. Rules for the agent

1. Do not invent your own cryptography or change the scheme in section 5 without documenting it in `DECISIONS.md` and keeping equal or stronger security.
2. Do not add network calls, analytics, or remote assets.
3. Do not store any secret, master password, or derived key in `localStorage`, files (other than the encrypted vault), logs, or the frontend state beyond what Reveal needs for 10 seconds.
4. Ask the user before adding anything listed under non-goals.
5. Prefer small, tested commits per phase. After each phase, summarize what works and what is next.
6. When something in this plan is ambiguous, choose the simplest option that keeps the security properties intact, and note the choice in `DECISIONS.md`.
