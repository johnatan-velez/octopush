import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

// ─── Mocks (must be set up BEFORE the component is imported) ──────────────────

const listProvidersMock = vi.fn().mockResolvedValue([]);

vi.mock("../lib/ipc", () => ({
  ipc: {
    listProviders: listProvidersMock,
  },
}));

// Dynamic import AFTER mocks are wired.
const { AgentBar } = await import("./AgentBar");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentBar — dynamic provider/model rendering", () => {
  it("renders model pills from two providers after the effect resolves", async () => {
    listProvidersMock.mockResolvedValueOnce([
      {
        name: "anthropic",
        enabled: true,
        models: [
          {
            id: "claude-opus-4-7",
            displayName: "Opus 4.7",
            inputCostPerM: 15,
            outputCostPerM: 75,
            maxContext: 200000,
            supportsVision: true,
            supportsTools: true,
          },
        ],
        apiBase: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        protocol: "anthropic",
        local: false,
      },
      {
        name: "openai",
        enabled: true,
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            inputCostPerM: 5,
            outputCostPerM: 15,
            maxContext: 128000,
            supportsVision: true,
            supportsTools: true,
          },
        ],
        apiBase: "https://api.openai.com",
        apiKeyEnv: "OPENAI_API_KEY",
        protocol: "openai",
        local: false,
      },
    ]);

    const onSelect = vi.fn();

    render(<AgentBar activeModel="claude-opus-4-7" onSelectModel={onSelect} />);

    // Resolve the useEffect (listProviders) and re-render.
    await act(async () => {
      await Promise.resolve();
    });

    // Both model display names must be visible.
    expect(screen.getByText("Opus 4.7")).toBeInTheDocument();
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
  });

  it("calls onSelectModel with the model id when a pill is clicked", async () => {
    listProvidersMock.mockResolvedValueOnce([
      {
        name: "anthropic",
        enabled: true,
        models: [
          {
            id: "claude-opus-4-7",
            displayName: "Opus 4.7",
            inputCostPerM: 15,
            outputCostPerM: 75,
            maxContext: 200000,
            supportsVision: true,
            supportsTools: true,
          },
        ],
        apiBase: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        protocol: "anthropic",
        local: false,
      },
      {
        name: "openai",
        enabled: true,
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            inputCostPerM: 5,
            outputCostPerM: 15,
            maxContext: 128000,
            supportsVision: true,
            supportsTools: true,
          },
        ],
        apiBase: "https://api.openai.com",
        apiKeyEnv: "OPENAI_API_KEY",
        protocol: "openai",
        local: false,
      },
    ]);

    const onSelect = vi.fn();

    render(<AgentBar activeModel="claude-opus-4-7" onSelectModel={onSelect} />);

    await act(async () => {
      await Promise.resolve();
    });

    // Click the openai pill.
    fireEvent.click(screen.getByText("GPT-4o"));
    expect(onSelect).toHaveBeenCalledWith("gpt-4o");
  });

  it("renders a muted message when no providers are enabled", async () => {
    listProvidersMock.mockResolvedValueOnce([]);

    render(<AgentBar activeModel="" onSelectModel={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/No models configured/i)).toBeInTheDocument();
  });

  it("highlights the active model with the active class", async () => {
    listProvidersMock.mockResolvedValueOnce([
      {
        name: "anthropic",
        enabled: true,
        models: [
          {
            id: "claude-opus-4-7",
            displayName: "Opus 4.7",
            inputCostPerM: 15,
            outputCostPerM: 75,
            maxContext: 200000,
            supportsVision: true,
            supportsTools: true,
          },
        ],
        apiBase: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        protocol: "anthropic",
        local: false,
      },
    ]);

    render(<AgentBar activeModel="claude-opus-4-7" onSelectModel={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });

    // The active button should carry the brass accent classes.
    const pill = screen.getByText("Opus 4.7").closest("button");
    expect(pill).toHaveClass("text-octo-accent");
  });
});
