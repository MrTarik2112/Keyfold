# Manual check — recovery key and clipboard clearing

Purpose: verify finding **F5** (the recovery key must go through the same
clipboard guard as a vault secret) on a real Windows desktop build. Every step
below states the expected result and how to observe it.

Related: [SECURITY.md](SECURITY.md) § IPC boundary contract, [PENTEST.md](PENTEST.md) § 5.1.

## 0. Prerequisites

1. Rebuild — the released `keyfold.exe` predates the `copy_recovery_key`
   command. Run `npm run build:desktop` (or `npm run build` then
   `cargo build --release` in `src-tauri`).
2. Turn **off** Windows clipboard history for the duration of the test:
   Settings → System → Clipboard → Clipboard history **off**. (History keeps
   its own copies and would make results look wrong; it is also a real
   limitation, see § 4.)
3. Clear the clipboard: `Set-Clipboard -Value $null` in PowerShell.
4. How to read the clipboard between steps:
   ```powershell
   Get-Clipboard
   ```
   An empty string means cleared. Pasting into Notepad works too.

## 1. Settings used by this checklist

Open Settings with <kbd>Ctrl</kbd>+<kbd>,</kbd>:

| Setting | Value to use |
| --- | --- |
| Auto-lock | 1 minute |
| Critical auto-lock | 30 seconds |
| Clipboard clear | 10 seconds |
| Lock on minimize | on |

Shortcuts used below: <kbd>Ctrl</kbd>+<kbd>L</kbd> locks the vault,
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> locks only the Critical tier.

## 2. Checks

### T1 — auto-clear timer fires

1. Settings → **Regenerate** recovery key, enter both passwords, Generate.
2. Click **Copy**. Note the toast: it must read
   `Recovery key copied. Clipboard clears in 10s.`
3. Immediately run `Get-Clipboard` → shows the key.
4. Wait 12 seconds, run it again.

**Expected:** empty. **Fails if:** the key is still there (the timer thread is
not running) or the toast has no "clears in" figure (the command was not used).

---

### T2 — locking clears it immediately

1. Regenerate a key and **Copy** it (do not wait for the timer).
2. Within a few seconds press <kbd>Ctrl</kbd>+<kbd>L</kbd>.
3. Run `Get-Clipboard`.

**Expected:** empty, and the app shows the Unlock screen.
**Fails if:** the key survives the lock (F5 regression).

---

### T3 — an unrelated clipboard value is not destroyed

1. Regenerate a key and **Copy** it.
2. In Notepad select the word `hello`, press <kbd>Ctrl</kbd>+<kbd>C</kbd>.
3. Wait past 10 seconds, then `Get-Clipboard`.

**Expected:** `hello`. **Fails if:** the clipboard is empty — the guard must
compare a SHA-256 fingerprint and only clear its own value.

---

### T4 — minimize locks and clears

1. Regenerate a key and **Copy** it.
2. Minimize the window (with *Lock on minimize* on).
3. Restore the window, run `Get-Clipboard`.

**Expected:** empty, and the vault is locked. **Fails if:** still unlocked or
the key is still present.

---

### T5 — idle auto-lock clears it

1. Regenerate a key and **Copy** it.
2. Do not touch the app for ~75 seconds (auto-lock is 1 minute).
3. Run `Get-Clipboard`.

**Expected:** empty, app on the Unlock screen.

---

### T6 — sleep/wake clears it

1. Regenerate a key and **Copy** it.
2. Sleep the machine for more than 5 seconds (Start → Sleep), then wake it.
3. Run `Get-Clipboard`.

**Expected:** empty, app locked (the ticker treats a >5 s wall-clock jump as a
sleep).

---

### T7 — quitting clears it

1. Regenerate a key and **Copy** it.
2. Quit Keyfold entirely (close the window).
3. Run `Get-Clipboard`.

**Expected:** empty.

---

### T8 — a Critical lock does not clear a Standard-guarded value

1. Regenerate a key and **Copy** it (recovery copies are guarded as Standard).
2. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> (lock Critical only).
3. Run `Get-Clipboard`.

**Expected:** the key is **still present** — this is intentional; only a full
lock clears it, and the 10-second timer will still remove it. Then press
<kbd>Ctrl</kbd>+<kbd>L</kbd> and confirm it is empty.

---

### T9 — a Critical secret is cleared by a Critical lock

1. In the Critical tier, copy any key with the row **Copy** button.
2. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

**Expected:** empty. This is the pre-existing behaviour and must not regress
when recovery copies were rerouted.

---

### T10 — the configured delay is honoured

1. Set Clipboard clear to **60 seconds**, copy a recovery key, check at 10 s
   (present) and at 65 s (empty).
2. Set it back to **10 seconds**.

**Expected:** the toast figure matches the setting both times.

---

### T11 — saving the recovery key still works (F6 regression guard)

1. Settings → Regenerate → Generate.
2. Click **Save to file**, pick a new `.txt` path.

**Expected:** the file is written, starts with `Keyfold recovery key`, and
contains the key. **Fails if:** `The operation could not be completed.` — that
means only the key (not a pre-formatted document) must be sent.

3. Repeat with the **same** path.

**Expected:** `A file already exists at that location.` and the file is
unchanged.

---

### T12 — stale binary guard

If copying fails with an error that names `copy_recovery_key` (for example
`Command copy_recovery_key not found`), the running binary is older than the
frontend build. Rebuild (step 0).

## 3. Pass criteria

All of T1–T11 must match. Any clipboard that keeps the recovery key after
lock, minimize, sleep or exit is an F5 regression and should be treated as a
security bug.

## 4. Known limitations (not bugs)

- **Windows clipboard history and cloud sync** may retain a copy of the key even
  after Keyfold clears the live clipboard. Keep history off on machines that
  hold production keys.
- **One guard slot.** The backend remembers the last value it wrote. Copy a
  secret, then copy a recovery key, and only the recovery key is tracked; the
  earlier value will not be cleared by Keyfold (the timer for it was already
  running and compares fingerprints before clearing).
- **Timer threads die with the process.** The exit path covers this by clearing
  on the way out, but a hard kill (Task Manager) skips both.
- **The Clear happens only if the clipboard still holds Keyfold's value.** If
  another app replaced it, Keyfold leaves the new content alone by design.
