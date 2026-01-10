import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { getModelProvider } from "../utils/languages";
import { API_ENDPOINTS } from "../config/constants";

export interface TranscriptionSettings {
  useLocalWhisper: boolean;
  whisperModel: string;
  allowOpenAIFallback: boolean;
  allowLocalFallback: boolean;
  fallbackWhisperModel: string;
  preferredLanguage: string;
  cloudTranscriptionBaseUrl?: string;
}

export interface CorrectionSettings {
  useCorrection: boolean;
  correctionModel: string;
  correctionProvider: string;
  cloudReasoningBaseUrl?: string;
}

export interface AgentSettings {
  useAgent: boolean;
  agentModel: string;
  agentProvider: string;
}

export interface HotkeySettings {
  dictationKey: string;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
}

export function useSettings() {
  const [useLocalWhisper, setUseLocalWhisper] = useLocalStorage(
    "useLocalWhisper",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );

  const [whisperModel, setWhisperModel] = useLocalStorage(
    "whisperModel",
    "base",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [allowOpenAIFallback, setAllowOpenAIFallback] = useLocalStorage(
    "allowOpenAIFallback",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );

  const [allowLocalFallback, setAllowLocalFallback] = useLocalStorage(
    "allowLocalFallback",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );

  const [fallbackWhisperModel, setFallbackWhisperModel] = useLocalStorage(
    "fallbackWhisperModel",
    "base",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [preferredLanguage, setPreferredLanguage] = useLocalStorage(
    "preferredLanguage",
    "en",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionBaseUrl, setCloudTranscriptionBaseUrl] = useLocalStorage(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrl] = useLocalStorage(
    "cloudReasoningBaseUrl",
    API_ENDPOINTS.OPENAI_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Correction settings
  const [useCorrection, setUseCorrection] = useLocalStorage(
    "useCorrection",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false", // Default true
    }
  );

  const [correctionModel, setCorrectionModel] = useLocalStorage(
    "correctionModel",
    "gpt-4o-mini",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Agent settings
  const [useAgent, setUseAgent] = useLocalStorage(
    "useAgent",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false", // Default true
    }
  );

  const [agentModel, setAgentModel] = useLocalStorage(
    "agentModel",
    "gpt-4o-mini",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // API keys
  const [openaiApiKey, setOpenaiApiKey] = useLocalStorage("openaiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [anthropicApiKey, setAnthropicApiKey] = useLocalStorage(
    "anthropicApiKey",
    "",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [geminiApiKey, setGeminiApiKey] = useLocalStorage(
    "geminiApiKey",
    "",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Hotkey
  const [dictationKey, setDictationKey] = useLocalStorage("dictationKey", "", {
    serialize: String,
    deserialize: String,
  });

  // Computed values
  const correctionProvider = getModelProvider(correctionModel);
  const agentProvider = getModelProvider(agentModel);

  const setProvider = (
    provider: string,
    setModel: (model: string) => void
  ) => {
    if (provider === "custom") {
      return;
    }

    const providerModels = {
      openai: "gpt-4o-mini",
      anthropic: "claude-3-5-sonnet-20241022",
      gemini: "gemini-2.5-flash",
      local: "llama-3.2-3b",
    };
    setModel(
      providerModels[provider as keyof typeof providerModels] || "gpt-4o-mini"
    );
  };

  const setCorrectionProvider = (provider: string) => {
    setProvider(provider, setCorrectionModel);
  };

  const setAgentProvider = (provider: string) => {
    setProvider(provider, setAgentModel);
  };

  // Batch operations
  const updateTranscriptionSettings = useCallback(
    (settings: Partial<TranscriptionSettings>) => {
      if (settings.useLocalWhisper !== undefined)
        setUseLocalWhisper(settings.useLocalWhisper);
      if (settings.whisperModel !== undefined)
        setWhisperModel(settings.whisperModel);
      if (settings.allowOpenAIFallback !== undefined)
        setAllowOpenAIFallback(settings.allowOpenAIFallback);
      if (settings.allowLocalFallback !== undefined)
        setAllowLocalFallback(settings.allowLocalFallback);
      if (settings.fallbackWhisperModel !== undefined)
        setFallbackWhisperModel(settings.fallbackWhisperModel);
      if (settings.preferredLanguage !== undefined)
        setPreferredLanguage(settings.preferredLanguage);
      if (settings.cloudTranscriptionBaseUrl !== undefined)
        setCloudTranscriptionBaseUrl(settings.cloudTranscriptionBaseUrl);
    },
    [
      setUseLocalWhisper,
      setWhisperModel,
      setAllowOpenAIFallback,
      setAllowLocalFallback,
      setFallbackWhisperModel,
      setPreferredLanguage,
      setCloudTranscriptionBaseUrl,
    ]
  );

  const updateCorrectionSettings = useCallback(
    (settings: Partial<CorrectionSettings>) => {
      if (settings.useCorrection !== undefined)
        setUseCorrection(settings.useCorrection);
      if (settings.correctionModel !== undefined)
        setCorrectionModel(settings.correctionModel);
      if (settings.cloudReasoningBaseUrl !== undefined)
        setCloudReasoningBaseUrl(settings.cloudReasoningBaseUrl);
    },
    [setUseCorrection, setCorrectionModel, setCloudReasoningBaseUrl]
  );

  const updateAgentSettings = useCallback(
    (settings: Partial<AgentSettings>) => {
      if (settings.useAgent !== undefined) setUseAgent(settings.useAgent);
      if (settings.agentModel !== undefined) setAgentModel(settings.agentModel);
    },
    [setUseAgent, setAgentModel]
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.openaiApiKey !== undefined) setOpenaiApiKey(keys.openaiApiKey);
      if (keys.anthropicApiKey !== undefined)
        setAnthropicApiKey(keys.anthropicApiKey);
      if (keys.geminiApiKey !== undefined) setGeminiApiKey(keys.geminiApiKey);
    },
    [setOpenaiApiKey, setAnthropicApiKey, setGeminiApiKey]
  );

  return {
    useLocalWhisper,
    whisperModel,
    allowOpenAIFallback,
    allowLocalFallback,
    fallbackWhisperModel,
    preferredLanguage,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    useCorrection,
    correctionModel,
    correctionProvider,
    useAgent,
    agentModel,
    agentProvider,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    dictationKey,
    setUseLocalWhisper,
    setWhisperModel,
    setAllowOpenAIFallback,
    setAllowLocalFallback,
    setFallbackWhisperModel,
    setPreferredLanguage,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseCorrection,
    setCorrectionModel,
    setUseAgent,
    setAgentModel,
    setCorrectionProvider,
    setAgentProvider,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setDictationKey,
    updateTranscriptionSettings,
    updateCorrectionSettings,
    updateAgentSettings,
    updateApiKeys,
  };
}
