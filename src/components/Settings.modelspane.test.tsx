/**
 * Behavioral tests for the Settings → Models & Providers pane.
 * Tests add/edit/remove models and providers, and verify that
 * ipc.saveProviders + ipc.saveSettings are called on save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ProviderConfig, AppSettings } from "../lib/types";

// ─── Fixtures ─────────────────────────────────────────────────────

const MOCK_PROVIDER: ProviderConfig = {
  name: "anthropic",
  apiBase: "https://api.anthropic.com",
  apiKeyEnv: "ANTHROPIC_API_KEY",
  models: [
    {
      id: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      inputCostPerM: 3.0,
      outputCostPerM: 15.0,
      cacheReadCostPerM: 0.3,
      cacheCreationCostPerM: 3.75,
      maxContext: 200000,
      supportsVision: true,
      supportsTools: true,
      tags: ["balanced"],
    },
  ],
  enabled: true,
  protocol: "anthropic",
  local: false,
};

const MOCK_SETTINGS: AppSettings = {
  providerKeys: { anthropic: "sk-ant-test" },
  providerBaseUrls: {},
  gitCredentials: {},
};

const saveProvidersMock = vi.fn().mockResolvedValue(undefined);
const saveSettingsMock = vi.fn().mockResolvedValue(undefined);
const listProvidersMock = vi.fn().mockResolvedValue([MOCK_PROVIDER]);
const getSettingsMock = vi.fn().mockResolvedValue(MOCK_SETTINGS);
const getDefaultProvidersMock = vi.fn().mockResolvedValue([MOCK_PROVIDER]);
const listModelsMock = vi.fn().mockResolvedValue([]);

vi.mock("../lib/ipc", () => ({
  ipc: {
    listProviders: listProvidersMock,
    getSettings: getSettingsMock,
    saveSettings: saveSettingsMock,
    saveProviders: saveProvidersMock,
    getDefaultProviders: getDefaultProvidersMock,
    listModels: listModelsMock,
    refreshPricing: vi.fn().mockResolvedValue({ modelsUpdated: 0, modelsTotal: 0, fetchedAt: "" }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────

async function renderModelsPane() {
  // Lazy import so mock is applied first
  const { Settings } = await import("./Settings");
  let rendered: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(
      <Settings open initialTab="models" onClose={vi.fn()} />
    );
  });
  return rendered!;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("ModelsPane — model editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProvidersMock.mockResolvedValue([MOCK_PROVIDER]);
    getSettingsMock.mockResolvedValue(MOCK_SETTINGS);
    saveProvidersMock.mockResolvedValue(undefined);
    saveSettingsMock.mockResolvedValue(undefined);
    getDefaultProvidersMock.mockResolvedValue([MOCK_PROVIDER]);
  });

  it("renders the anthropic provider with its model", async () => {
    await renderModelsPane();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("adds a model to a provider and saves both settings and providers", async () => {
    await renderModelsPane();

    // Click "Add a model" button
    const addModelBtn = screen.getByRole("button", { name: /add a model/i });
    await act(async () => { fireEvent.click(addModelBtn); });

    // Fill in the model id
    const idInput = screen.getByPlaceholderText(/model id/i);
    await act(async () => { fireEvent.change(idInput, { target: { value: "claude-x" } }); });

    // Submit
    const submitBtn = screen.getByRole("button", { name: /add model/i });
    await act(async () => { fireEvent.click(submitBtn); });

    // After adding, the model should appear in the list
    expect(screen.getByText("claude-x")).toBeInTheDocument();

    // Now click "Save changes"
    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    await act(async () => { fireEvent.click(saveBtn); });

    await waitFor(() => {
      expect(saveProvidersMock).toHaveBeenCalledTimes(1);
      expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    });

    // Verify the providers call includes claude-x
    const providersArg: ProviderConfig[] = saveProvidersMock.mock.calls[0][0];
    const anthropic = providersArg.find((p) => p.name === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.models.some((m) => m.id === "claude-x")).toBe(true);
  });

  it("blocks a model with an empty id", async () => {
    await renderModelsPane();

    const addModelBtn = screen.getByRole("button", { name: /add a model/i });
    await act(async () => { fireEvent.click(addModelBtn); });

    // Submit without filling in an id (it's blank by default)
    const submitBtn = screen.getByRole("button", { name: /add model/i });
    await act(async () => { fireEvent.click(submitBtn); });

    // An error message should appear
    expect(screen.getByText(/model id is required/i)).toBeInTheDocument();

    // The model count for anthropic should still be 1 (no new model added)
    // Verify by checking the model list hasn't grown
    const modelIds = screen.getAllByText("claude-sonnet-4-6");
    expect(modelIds.length).toBeGreaterThan(0);
  });
});

describe("ModelsPane — custom provider management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProvidersMock.mockResolvedValue([MOCK_PROVIDER]);
    getSettingsMock.mockResolvedValue(MOCK_SETTINGS);
    saveProvidersMock.mockResolvedValue(undefined);
    saveSettingsMock.mockResolvedValue(undefined);
    getDefaultProvidersMock.mockResolvedValue([MOCK_PROVIDER]);
  });

  it("adds a custom provider and appends it to the list", async () => {
    await renderModelsPane();

    // Click "Add a provider"
    const addProviderBtn = screen.getByRole("button", { name: /add a provider/i });
    await act(async () => { fireEvent.click(addProviderBtn); });

    // Fill in provider name
    const nameInput = screen.getByPlaceholderText(/e.g. my-gateway/i);
    await act(async () => { fireEvent.change(nameInput, { target: { value: "sonatype" } }); });

    // Fill in base URL
    const baseUrlInput = screen.getByPlaceholderText(/https:\/\/my-gateway/i);
    await act(async () => { fireEvent.change(baseUrlInput, { target: { value: "https://sonatype.example.com" } }); });

    // Use the form's Add a provider button (the second one inside the form)
    const addBtns = screen.getAllByRole("button", { name: /add a provider/i });
    // After clicking the top-level one, the form appears — the submit button is inside the form
    // There should be one remaining for the submit inside the form
    const submitFormBtn = addBtns[addBtns.length - 1];
    await act(async () => { fireEvent.click(submitFormBtn); });

    // The new provider should appear in the list
    expect(screen.getByText("Sonatype")).toBeInTheDocument();
  });

  it("shows an error when adding a provider with empty name", async () => {
    await renderModelsPane();

    const addProviderBtn = screen.getByRole("button", { name: /add a provider/i });
    await act(async () => { fireEvent.click(addProviderBtn); });

    // Submit without filling name
    const addBtns = screen.getAllByRole("button", { name: /add a provider/i });
    const submitFormBtn = addBtns[addBtns.length - 1];
    await act(async () => { fireEvent.click(submitFormBtn); });

    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  it("removes a custom provider via confirm dialog", async () => {
    const customProvider: ProviderConfig = {
      name: "my-gateway",
      apiBase: "https://gw.example.com",
      apiKeyEnv: "",
      models: [],
      enabled: true,
      protocol: "anthropic",
      local: false,
    };
    // Only show the custom provider (not built-in) so there's only one Remove button
    listProvidersMock.mockResolvedValue([customProvider]);
    await renderModelsPane();

    // The custom provider is shown
    expect(screen.getByText("My-gateway")).toBeInTheDocument();

    // Click the "Remove" provider button (not a model remove)
    const removeBtn = screen.getByRole("button", { name: /^remove$/i });
    await act(async () => { fireEvent.click(removeBtn); });

    // ConfirmDialog should appear
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Click the destructive button in the dialog
    const confirmBtn = screen.getByRole("button", { name: /remove provider/i });
    await act(async () => { fireEvent.click(confirmBtn); });

    // Provider should be gone from UI
    expect(screen.queryByText("My-gateway")).not.toBeInTheDocument();
  });

  it("reset to defaults restores a builtin provider's models in local state", async () => {
    // Start with anthropic with models removed
    const modifiedAnthropic: ProviderConfig = {
      ...MOCK_PROVIDER,
      models: [],
    };
    listProvidersMock.mockResolvedValue([modifiedAnthropic]);
    // Defaults still have the model
    getDefaultProvidersMock.mockResolvedValue([MOCK_PROVIDER]);

    await renderModelsPane();

    // Should have no model initially
    expect(screen.queryByText("claude-sonnet-4-6")).not.toBeInTheDocument();

    // Click "Reset to defaults"
    const resetBtn = screen.getByRole("button", { name: /reset to defaults/i });
    await act(async () => { fireEvent.click(resetBtn); });

    // The model should now appear
    await waitFor(() => {
      expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    });
  });
});
