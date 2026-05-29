# Provider & Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add custom AI providers and add/edit/remove model ids on any provider, persisted to `~/.octopush/providers.json`, all from Settings → Models & Providers.

**Architecture:** The catalog already lives in `~/.octopush/providers.json` and `ProviderRouter::load()` re-reads it per request. This adds a backend `save_providers` command (+ `get_default_providers` for reset) over the existing `ProviderConfig`/`ModelInfo` types, and extends the Settings `ModelsPane` UI to edit the catalog. Secrets/base-URL overrides stay in `settings.json` (unchanged split).

**Tech Stack:** Rust (Tauri 2, serde, `provider_router`), React 19 + TS, Zustand, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-provider-model-management-design.md`

**Design-system:** Match existing `ModelsPane`/`ProviderRow` patterns exactly — tokens only, upright serif (NO italics), brass surgical (CTAs/active/eyebrows only), `font-mono` for ids/costs/urls, `ConfirmDialog` + rouge for destructive, calm motion. See the spec's "Design-system alignment" section.

---

## File Structure

**Backend:**
- Modify `src-tauri/src/provider_router.rs` — extract `write_providers()` + `default_providers_list()` helpers; add validation fn.
- Modify `src-tauri/src/commands.rs` — `save_providers`, `get_default_providers` commands.
- Modify `src-tauri/src/lib.rs` — register the two commands.
- Modify `src-tauri/src/tests.rs` — round-trip + validation + defaults tests.

**Frontend:**
- Modify `src/lib/ipc.ts` — `saveProviders`, `getDefaultProviders`.
- Modify `src/lib/types.ts` — ensure `ProviderConfig`/`ModelInfo` TS types expose the editable fields (they likely exist; verify).
- Modify `src/components/Settings.tsx` — extend `ModelsPane` + `ProviderRow`; add `ModelEditor` + `AddProviderForm` (same file or a new `src/components/settings/` module if Settings.tsx is large).
- Test `src/components/Settings.modelspane.test.tsx` (new).

---

## Task A1: Backend — save/defaults helpers + commands + validation

**Files:**
- Modify: `src-tauri/src/provider_router.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tests.rs`

- [ ] **Step 1: Extract reusable write + defaults-list helpers in `provider_router.rs`**

Add (near `config_path`):
```rust
/// Default providers as a list (for "reset to defaults" in the UI).
pub fn default_providers_list() -> Vec<ProviderConfig> {
    builtin_providers().into_values().collect()
}

/// Write the provider catalog to `~/.octopush/providers.json` (pretty JSON).
pub fn write_providers(list: &[ProviderConfig]) -> AppResult<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(list)?)?;
    Ok(())
}

/// Validate a provider list before persisting. Returns Err(message) on the
/// first problem found.
pub fn validate_providers(list: &[ProviderConfig]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for p in list {
        let name = p.name.trim();
        if name.is_empty() {
            return Err("Provider name cannot be empty".into());
        }
        if !seen.insert(name.to_lowercase()) {
            return Err(format!("Duplicate provider name: {name}"));
        }
        if p.protocol != "anthropic" && p.protocol != "openai-compatible" {
            return Err(format!("Provider {name}: protocol must be 'anthropic' or 'openai-compatible'"));
        }
        if !p.local && p.api_base.trim().is_empty() {
            return Err(format!("Provider {name}: base URL is required"));
        }
        let mut model_ids = std::collections::HashSet::new();
        for m in &p.models {
            if m.id.trim().is_empty() {
                return Err(format!("Provider {name}: a model id is empty"));
            }
            if !model_ids.insert(m.id.trim().to_lowercase()) {
                return Err(format!("Provider {name}: duplicate model id {}", m.id));
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Add Rust tests in `src-tauri/src/tests.rs`** (new module or in `workspace_tests`-style module)

```rust
#[cfg(test)]
mod provider_catalog_tests {
    use crate::provider_router::{
        default_providers_list, validate_providers, write_providers, ProviderRouter, ProviderConfig, ModelInfo,
    };
    use tempfile::TempDir;

    fn prov(name: &str, protocol: &str, local: bool, models: Vec<ModelInfo>) -> ProviderConfig {
        ProviderConfig {
            name: name.into(),
            api_base: if local { String::new() } else { "https://x".into() },
            api_key_env: String::new(),
            models,
            rate_limits: Default::default(),
            enabled: true,
            protocol: protocol.into(),
            local,
        }
    }
    fn model(id: &str) -> ModelInfo {
        ModelInfo {
            id: id.into(), display_name: id.into(),
            input_cost_per_m: 1.0, output_cost_per_m: 2.0,
            cache_read_cost_per_m: 0.0, cache_creation_cost_per_m: 0.0,
            max_context: 200_000, supports_vision: false, supports_tools: true, tags: vec![],
        }
    }

    #[test]
    fn validate_rejects_dupes_and_empties() {
        assert!(validate_providers(&[prov("", "anthropic", false, vec![])]).is_err());
        assert!(validate_providers(&[prov("a", "anthropic", false, vec![]), prov("A", "anthropic", false, vec![])]).is_err());
        assert!(validate_providers(&[prov("a", "weird", false, vec![])]).is_err());
        assert!(validate_providers(&[prov("a", "anthropic", false, vec![model("m"), model("m")])]).is_err());
        assert!(validate_providers(&[prov("a", "anthropic", false, vec![model("ok")])]).is_ok());
    }

    #[test]
    fn write_then_load_roundtrips() {
        let tmp = TempDir::new().unwrap();
        std::env::set_var("HOME", tmp.path());
        let list = vec![prov("sonatype", "anthropic", false, vec![model("claude-x")])];
        write_providers(&list).unwrap();
        let router = ProviderRouter::load().unwrap();
        let names: Vec<String> = router.list_providers().iter().map(|p| p.name.clone()).collect();
        assert!(names.contains(&"sonatype".to_string()));
        // The built-ins are also re-seeded by load(); our custom one persists.
        assert!(router.find_model("claude-x").is_some());
    }

    #[test]
    fn defaults_list_has_builtins() {
        let d = default_providers_list();
        let names: Vec<&str> = d.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"anthropic"));
        assert!(names.contains(&"openai"));
    }
}
```
Note: ensure `ProviderConfig`/`ModelInfo` fields are `pub` and constructible from the test module (they are `pub` per `provider_router.rs`). If `RateLimits` needs `Default`, it derives it.

- [ ] **Step 3: Run tests — expect compile + pass**

Run: `cd src-tauri && cargo test provider_catalog_tests`
Expected: 3 tests pass. (If `write_then_load_roundtrips` is flaky due to the global `HOME` env across tests, mark the module `#[serial]` using the `serial_test` crate already used elsewhere — add `use serial_test::serial;` and `#[serial]` on the HOME-mutating test.)

- [ ] **Step 4: Add the commands in `src-tauri/src/commands.rs`**

```rust
/// Persist the full provider catalog to ~/.octopush/providers.json.
#[tauri::command]
pub async fn save_providers(providers: Vec<crate::provider_router::ProviderConfig>) -> AppResult<()> {
    crate::provider_router::validate_providers(&providers)
        .map_err(crate::error::AppError::Other)?;
    crate::provider_router::write_providers(&providers)?;
    Ok(())
}

/// Return the built-in provider defaults (for "reset to defaults" in the UI).
#[tauri::command]
pub fn get_default_providers() -> Vec<crate::provider_router::ProviderConfig> {
    crate::provider_router::default_providers_list()
}
```
(Confirm `AppError::Other(String)` exists — it's used elsewhere in the crate. If the error variant differs, map to whatever the crate's string-error constructor is.)

- [ ] **Step 5: Register both commands in `src-tauri/src/lib.rs`**

Add to the `tauri::generate_handler![...]` list:
```rust
commands::save_providers,
commands::get_default_providers,
```

- [ ] **Step 6: Build + test**

Run: `cd src-tauri && cargo build` then `cargo test provider_catalog_tests`
Expected: clean build, tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/provider_router.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/src/tests.rs
git commit -m "feat(providers): save_providers + get_default_providers commands + validation"
```

---

## Task A2: Frontend — types + ipc bindings

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Verify/define `ProviderConfig` + `ModelInfo` TS types in `src/lib/types.ts`**

These types are already used by `Settings.tsx` (`ProviderConfig` is imported). Confirm `ModelInfo` and `ProviderConfig` exist and include the editable fields; if `ModelInfo` is missing fields, align it to the Rust struct (camelCase):
```ts
export interface ModelInfo {
  id: string;
  displayName: string;
  inputCostPerM: number;
  outputCostPerM: number;
  cacheReadCostPerM?: number;
  cacheCreationCostPerM?: number;
  maxContext: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  tags?: string[];
}
export interface ProviderConfig {
  name: string;
  apiBase: string;
  apiKeyEnv: string;
  models: ModelInfo[];
  rateLimits?: { requestsPerMinute?: number | null; tokensPerMinute?: number | null };
  enabled: boolean;
  protocol: string; // "anthropic" | "openai-compatible"
  local: boolean;
}
```
(Only add fields that are missing — do not duplicate existing definitions. Match what `ipc.listProviders()` already returns.)

- [ ] **Step 2: Add ipc bindings in `src/lib/ipc.ts`**

```ts
  saveProviders: (providers: ProviderConfig[]) =>
    invoke<void>("save_providers", { providers }),
  getDefaultProviders: () =>
    invoke<ProviderConfig[]>("get_default_providers"),
```
(Import `ProviderConfig` from `./types` if not already imported.)

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` (expect clean)
```bash
git add src/lib/types.ts src/lib/ipc.ts
git commit -m "feat(providers): TS types + ipc.saveProviders/getDefaultProviders"
```

---

## Task A3: Frontend — editable models per provider

**Files:**
- Modify: `src/components/Settings.tsx` (extend `ProviderRow`; add `ModelEditor`)
- Test: `src/components/Settings.modelspane.test.tsx` (new)

- [ ] **Step 1: Write the failing test `src/components/Settings.modelspane.test.tsx`**

Mock `ipc` (listProviders/getSettings/saveSettings/saveProviders/getDefaultProviders/listModels), render the Models pane (export `ModelsPane` if not already, or render `<Settings open initialTab="providers" .../>` and target the providers pane). Assert:
```tsx
// (sketch — adapt selectors to the rendered DOM)
it("adds a model to a provider and saves both settings and providers", async () => {
  // render Models pane with one provider "anthropic" with 1 model
  // click "Add a model" under anthropic
  // fill id "claude-x", display "Claude X", costs, context
  // confirm -> local state shows 2 models
  // click "Save changes"
  // expect ipc.saveProviders called with anthropic.models including {id:"claude-x"}
  // expect ipc.saveSettings also called
});
it("blocks a model with an empty id", async () => { /* add-model with blank id shows error, no add */ });
```
Write concrete selectors based on the markup you implement in Step 3 (use `getByРRole`/`getByText`/`getByPlaceholderText`). Keep assertions behavioral.

- [ ] **Step 2: Run it — verify it fails** (`npx vitest run src/components/Settings.modelspane.test.tsx`). Expected: fail (no Add-model UI yet).

- [ ] **Step 3: Implement model editing in `ProviderRow` + a `ModelEditor` subcomponent**

In `Settings.tsx`, the `ModelsPane` must hold `providers` in editable state and pass an `onChangeProvider(updated: ProviderConfig)` to each `ProviderRow`. Extend `ProviderRow` to render its models and an "Add a model" CTA; add a `ModelEditor` for add/edit. Use the existing visual recipes (see design-system note). Key structure:
```tsx
function ModelEditor({ initial, onSubmit, onCancel }: {
  initial?: ModelInfo; onSubmit: (m: ModelInfo) => void; onCancel: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.displayName ?? "");
  const [inC, setInC] = useState(String(initial?.inputCostPerM ?? 0));
  const [outC, setOutC] = useState(String(initial?.outputCostPerM ?? 0));
  const [ctx, setCtx] = useState(String(initial?.maxContext ?? 200000));
  const [err, setErr] = useState<string | null>(null);
  function submit() {
    if (!id.trim()) { setErr("Model id is required"); return; }
    onSubmit({
      ...(initial ?? { cacheReadCostPerM: 0, cacheCreationCostPerM: 0, supportsVision: false, supportsTools: true, tags: [] }),
      id: id.trim(),
      displayName: name.trim() || id.trim(),
      inputCostPerM: Number(inC) || 0,
      outputCostPerM: Number(outC) || 0,
      maxContext: Number(ctx) || 200000,
    });
  }
  return (
    <div className="mt-2 rounded-md border border-octo-hairline bg-octo-onyx p-3 space-y-2">
      {/* eyebrow labels in font-mono text-[9px] uppercase tracking-[0.25em] text-octo-mute */}
      <input value={id} onChange={(e)=>setId(e.target.value)} placeholder="model id (e.g. anthropic.claude-...)"
        className="w-full rounded-md border border-octo-hairline bg-octo-onyx px-3 py-2 font-mono text-[12px] text-octo-ivory outline-none placeholder:text-octo-mute focus:border-octo-brass" />
      {/* display name (font-mono/sans), input cost, output cost, max context — same input recipe */}
      {err && <div className="font-mono text-[10px] text-octo-rouge">{err}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={submit}
          className="rounded-md px-3 py-1.5 font-serif text-[12px] text-octo-brass"
          style={{ background: "var(--brass-ghost)", border: "1px solid var(--brass-dim)" }}>
          {initial ? "Save model" : "Add model"}
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-md border border-octo-hairline px-3 py-1.5 text-[12px] text-octo-sage hover:text-octo-ivory">
          Cancel
        </button>
      </div>
    </div>
  );
}
```
In `ProviderRow`, render the model list (id in `font-mono text-[11px] text-octo-ivory`, display name + costs in mono/sage, an edit pencil and a remove "×" per row → remove uses `ConfirmDialog`), plus an "Add a model" CTA toggling a `ModelEditor`. Each change calls `onChangeProvider({ ...provider, models: nextModels })`. `ModelsPane` updates its `providers` state accordingly.

- [ ] **Step 4: Make `ModelsPane.handleSave` persist BOTH**

```ts
async function handleSave() {
  setSaving(true);
  await ipc.saveSettings({
    providerKeys: Object.fromEntries(Object.entries(keys).filter(([, v]) => v && v.length > 0)),
    providerBaseUrls: Object.fromEntries(Object.entries(baseUrls).filter(([, v]) => v && v.length > 0)),
    gitCredentials: {},
  });
  try {
    await ipc.saveProviders(providers);
  } catch (e) {
    pushToast({ level: "error", title: "Save failed", body: String(e) });
    setSaving(false);
    return;
  }
  // refresh models so the picker reflects edits
  await ipc.listModels?.();
  setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
}
```
(If there's no `pushToast` import in Settings.tsx, import it from `./Toasts` as other components do.)

- [ ] **Step 5: Run the test — verify pass** (`npx vitest run src/components/Settings.modelspane.test.tsx`). Iterate selectors/markup until green.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/components/Settings.tsx src/components/Settings.modelspane.test.tsx
git commit -m "feat(providers): edit/add/remove models per provider in Settings"
```

---

## Task A4: Frontend — add custom provider, remove, reset to defaults

**Files:**
- Modify: `src/components/Settings.tsx` (add `AddProviderForm`; wire remove + reset)
- Modify: `src/components/Settings.modelspane.test.tsx`

- [ ] **Step 1: Add failing tests** for: adding a custom provider appends it to local state with the chosen protocol/baseURL/local; "Reset to defaults" on a built-in restores its default models; removing a provider triggers `ConfirmDialog`. (Write concrete selectors against the Step-3 markup.)

- [ ] **Step 2: Run — verify they fail.**

- [ ] **Step 3: Implement `AddProviderForm` + wiring in `ModelsPane`**

```tsx
function AddProviderForm({ onAdd, onCancel }: { onAdd: (p: ProviderConfig) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<"anthropic" | "openai-compatible">("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [local, setLocal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function submit() {
    if (!name.trim()) { setErr("Name is required"); return; }
    if (!local && !baseUrl.trim()) { setErr("Base URL is required"); return; }
    onAdd({
      name: name.trim(), apiBase: baseUrl.trim(), apiKeyEnv: "",
      models: [], rateLimits: {}, enabled: true, protocol, local,
    });
  }
  // render: name input, protocol <select> (Anthropic-compatible / OpenAI-compatible),
  // base URL input, "runs locally (no key)" checkbox, Add a provider / Cancel buttons.
  // Use the same input + brass-ghost button recipes; eyebrow "PROTOCOL" label in mono.
}
```
In `ModelsPane`: an **"Add a provider"** CTA toggles `AddProviderForm`; on add, append to `providers`. Each `ProviderRow` for a CUSTOM provider shows a quiet **Remove** (`text-octo-mute hover:text-octo-rouge`) → `ConfirmDialog` → drop from `providers`. Each BUILT-IN provider shows **Reset to defaults** → fetch `ipc.getDefaultProviders()` (once, memoized) and replace that provider's `models`/`apiBase`/`protocol` from the matching default. (Determine "built-in" by name ∈ {anthropic, openai, deepseek, ollama} or by presence in the defaults list.)

- [ ] **Step 4: Run tests — verify pass.** Iterate until green.

- [ ] **Step 5: Typecheck + full frontend test run**

Run: `npm run typecheck` then `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx src/components/Settings.modelspane.test.tsx
git commit -m "feat(providers): add custom provider, remove, reset-to-defaults"
```

---

## Verification (after all tasks)

- [ ] `npm run typecheck` — clean
- [ ] `npx vitest run` — all pass
- [ ] `cd src-tauri && cargo test` — all pass (incl. provider_catalog_tests)
- [ ] Manual (in the built .app): add a custom provider "Sonatype" (Anthropic-compatible, base URL = gateway, its key), add a model with your gateway's real model id, select it, send a message — confirm it routes to the gateway. Confirm built-in Anthropic still works independently. Confirm "Reset to defaults" restores a built-in's models.
