import { useState, useEffect, useCallback } from "react";
import { getModelProvider } from "../utils/languages";

export interface Agent {
  id: string;              // unique identifier (uuid)
  name: string;            // e.g., "Assistant", "Email Writer", "Text Correction"
  wakeWords: string;       // regex pattern, e.g., "^(hello|hi|hey) assistant" or empty for catch-all
  prompt: string;          // custom prompt template with {{agentName}} and {{text}} placeholders
  model: string;           // e.g., "gpt-4o-mini"
  provider: string;        // e.g., "openai", "anthropic", "local"
  enabled: boolean;        // toggle on/off
  isDefault: boolean;      // true for Assistant & Text Correction (cannot be deleted)
  order: number;           // for sorting (lower = higher priority)
}

const AGENTS_STORAGE_KEY = "agents";
const MIGRATION_FLAG_KEY = "agents_migrated";

const DEFAULT_AGENT_PROMPT = `You are {{agentName}}, a helpful AI assistant. The user has given you a command or request. Complete the request and provide ONLY your response, without any preamble, explanations, or reference to your name:\n\n{{text}}`;

const DEFAULT_CORRECTION_PROMPT = `Clean up the following dictated text by fixing grammar, punctuation, and formatting. Output ONLY the cleaned text without any explanations, options, or commentary:\n\n{{text}}`;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDefaultAgents(): Agent[] {
  // Check if user has customized the agent name during onboarding
  const customAgentName = localStorage.getItem("agentName");
  const agentName = customAgentName || "Assistant";
  
  return [
    {
      id: "text-correction",
      name: "Text Correction",
      wakeWords: "", // Empty = catch-all (no wake words required)
      prompt: DEFAULT_CORRECTION_PROMPT,
      model: "gpt-4o-mini",
      provider: "openai",
      enabled: true,
      isDefault: true,
      order: 0,
    },
    {
      id: "assistant",
      name: agentName,
      wakeWords: agentName,
      prompt: DEFAULT_AGENT_PROMPT,
      model: "gpt-4o-mini",
      provider: "openai",
      enabled: true,
      isDefault: true,
      order: 1,
    },
  ];
}

function migrateFromOldSettings(): Agent[] {
  try {
    // Check if migration already done
    const migrationDone = localStorage.getItem(MIGRATION_FLAG_KEY);
    if (migrationDone === "true") {
      const stored = localStorage.getItem(AGENTS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
      return getDefaultAgents();
    }

    console.log("[Migration] Starting migration from old settings to agents...");

    // Load old settings
    const agentName = localStorage.getItem("agentName") || "Assistant";
    const useAgent = localStorage.getItem("useAgent") !== "false"; // Default true
    const agentModel = localStorage.getItem("agentModel") || "gpt-4o-mini";
    const useCorrection = localStorage.getItem("useCorrection") !== "false"; // Default true
    const correctionModel = localStorage.getItem("correctionModel") || "gpt-4o-mini";
    const customPromptsStr = localStorage.getItem("customPrompts");

    let agentPrompt = DEFAULT_AGENT_PROMPT;
    let correctionPrompt = DEFAULT_CORRECTION_PROMPT;

    // Try to load custom prompts
    if (customPromptsStr) {
      try {
        const parsed = JSON.parse(customPromptsStr);
        agentPrompt = parsed.agent || agentPrompt;
        correctionPrompt = parsed.regular || correctionPrompt;
      } catch (e) {
        console.warn("[Migration] Failed to parse customPrompts:", e);
      }
    }

    // Create agents with migrated data
    const agents: Agent[] = [
      {
        id: "text-correction",
        name: "Text Correction",
        wakeWords: "", // No wake words = catch-all
        prompt: correctionPrompt,
        model: correctionModel,
        provider: getModelProvider(correctionModel),
        enabled: useCorrection,
        isDefault: true,
        order: 0,
      },
      {
        id: "assistant",
        name: agentName,
        wakeWords: agentName,
        prompt: agentPrompt,
        model: agentModel,
        provider: getModelProvider(agentModel),
        enabled: useAgent,
        isDefault: true,
        order: 1,
      },
    ];

    // Save migrated agents
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
    localStorage.setItem(MIGRATION_FLAG_KEY, "true");

    console.log("[Migration] Migration completed successfully:", agents);

    return agents;
  } catch (error) {
    console.error("[Migration] Migration failed, using defaults:", error);
    return getDefaultAgents();
  }
}

function loadAgents(): Agent[] {
  try {
    // First, try migration
    return migrateFromOldSettings();
  } catch (error) {
    console.error("Failed to load agents:", error);
    return getDefaultAgents();
  }
}

function saveAgents(agents: Agent[]): void {
  try {
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
  } catch (error) {
    console.error("Failed to save agents:", error);
  }
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>(() => loadAgents());

  // Sync to localStorage whenever agents change
  useEffect(() => {
    saveAgents(agents);
  }, [agents]);

  const addAgent = useCallback((agent: Partial<Agent>): Agent => {
    const newAgent: Agent = {
      id: generateId(),
      name: agent.name || "New Agent",
      wakeWords: agent.wakeWords || "",
      prompt: agent.prompt || DEFAULT_AGENT_PROMPT,
      model: agent.model || "gpt-4o-mini",
      provider: agent.provider || getModelProvider(agent.model || "gpt-4o-mini"),
      enabled: agent.enabled !== false, // Default true
      isDefault: false,
      order: agents.length, // Add to end
    };

    setAgents((prev) => [...prev, newAgent]);
    return newAgent;
  }, [agents.length]);

  const updateAgent = useCallback((id: string, updates: Partial<Agent>): void => {
    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.id !== id) return agent;

        const updatedAgent = { ...agent, ...updates };

        // Auto-update provider when model changes
        if (updates.model && updates.model !== agent.model) {
          updatedAgent.provider = getModelProvider(updates.model);
        }

        return updatedAgent;
      })
    );
  }, []);

  const deleteAgent = useCallback((id: string): void => {
    setAgents((prev) => {
      const agent = prev.find((a) => a.id === id);
      
      // Prevent deletion of default agents
      if (agent?.isDefault) {
        console.warn("Cannot delete default agent:", agent.name);
        return prev;
      }

      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const reorderAgents = useCallback((newOrder: Agent[]): void => {
    const reordered = newOrder.map((agent, index) => ({
      ...agent,
      order: index,
    }));
    setAgents(reordered);
  }, []);

  const getEnabledAgents = useCallback((): Agent[] => {
    return agents
      .filter((a) => a.enabled)
      .sort((a, b) => a.order - b.order);
  }, [agents]);

  const resetToDefaults = useCallback((): void => {
    const defaults = getDefaultAgents();
    setAgents(defaults);
    localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(defaults));
  }, []);

  return {
    agents,
    addAgent,
    updateAgent,
    deleteAgent,
    reorderAgents,
    getEnabledAgents,
    resetToDefaults,
  };
}

// Export default prompts for use in other components
export { DEFAULT_AGENT_PROMPT, DEFAULT_CORRECTION_PROMPT };
