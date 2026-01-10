import React, { useState, useMemo } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Trash2, 
  Save,
  RotateCcw,
  Sparkles,
  MessageSquare,
  Shield
} from "lucide-react";
import { useAgents, Agent } from "../hooks/useAgents";
import { UnifiedModelPickerCompact } from "./UnifiedModelPicker";
import { REASONING_PROVIDERS } from "../utils/languages";
import { modelRegistry } from "../models/ModelRegistry";
import ApiKeyInput from "./ui/ApiKeyInput";
import { API_ENDPOINTS } from "../config/constants";

interface AgentsPanelProps {
  showAlertDialog: (dialog: { title: string; description: string }) => void;
  pasteFromClipboard: (setter: (value: string) => void) => void;
}

interface AgentCardProps {
  agent: Agent;
  onUpdate: (id: string, updates: Partial<Agent>) => void;
  onDelete: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
  pasteFromClipboard: (setter: (value: string) => void) => void;
  // API keys from parent
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (url: string) => void;
}

function AgentCard({
  agent,
  onUpdate,
  onDelete,
  isExpanded,
  onToggleExpand,
  showAlertDialog,
  pasteFromClipboard,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
}: AgentCardProps) {
  const [localName, setLocalName] = useState(agent.name);
  const [localWakeWords, setLocalWakeWords] = useState(agent.wakeWords);
  const [localPrompt, setLocalPrompt] = useState(agent.prompt);
  const [selectedMode, setSelectedMode] = useState<'cloud' | 'local'>(
    modelRegistry.getAllProviders().map(p => p.id).includes(agent.provider) ? 'local' : 'cloud'
  );
  const [selectedCloudProvider, setSelectedCloudProvider] = useState(
    ['openai', 'anthropic', 'gemini', 'custom'].includes(agent.provider) ? agent.provider : 'openai'
  );
  const [selectedLocalProvider, setSelectedLocalProvider] = useState(
    modelRegistry.getAllProviders().map(p => p.id).includes(agent.provider) ? agent.provider : 'qwen'
  );

  const cloudProviders = ['openai', 'anthropic', 'gemini', 'custom'];
  const localProviders = modelRegistry.getAllProviders().map((p) => p.id);

  const isTextCorrection = agent.id === 'text-correction';

  const handleSave = () => {
    onUpdate(agent.id, {
      name: localName,
      wakeWords: localWakeWords,
      prompt: localPrompt,
    });
    showAlertDialog({
      title: "Agent Updated",
      description: `"${localName}" has been updated successfully.`,
    });
  };

  const handleModeChange = (mode: 'cloud' | 'local') => {
    setSelectedMode(mode);
    if (mode === 'cloud') {
      onUpdate(agent.id, {
        provider: selectedCloudProvider,
        model: REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS]?.models?.[0]?.value || 'gpt-4o-mini'
      });
    } else {
      const providerData = modelRegistry.getProvider(selectedLocalProvider);
      onUpdate(agent.id, {
        provider: selectedLocalProvider,
        model: providerData?.models?.[0]?.id || 'llama-3.2-3b'
      });
    }
  };

  const handleProviderChange = (provider: string, mode: 'cloud' | 'local') => {
    if (mode === 'cloud') {
      setSelectedCloudProvider(provider);
      const models = REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS]?.models || [];
      onUpdate(agent.id, {
        provider,
        model: models[0]?.value || 'gpt-4o-mini'
      });
    } else {
      setSelectedLocalProvider(provider);
      const providerData = modelRegistry.getProvider(provider);
      onUpdate(agent.id, {
        provider,
        model: providerData?.models?.[0]?.id || 'llama-3.2-3b'
      });
    }
  };

  const getProviderModels = () => {
    if (selectedMode === 'cloud') {
      if (selectedCloudProvider === 'custom') {
        return []; // Custom endpoint models handled separately
      }
      const provider = REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS];
      return provider?.models || [];
    } else {
      const providerData = modelRegistry.getProvider(selectedLocalProvider);
      return providerData?.models?.map(m => ({
        value: m.id,
        label: m.name,
        description: m.description
      })) || [];
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only"
                checked={agent.enabled}
                onChange={(e) => onUpdate(agent.id, { enabled: e.target.checked })}
              />
              <div className={`w-11 h-6 bg-gray-200 rounded-full transition-colors duration-200 ${
                agent.enabled ? "bg-green-600" : "bg-gray-300"
              }`}>
                <div className={`absolute top-0.5 left-0.5 bg-white border border-gray-300 rounded-full h-5 w-5 transition-transform duration-200 ${
                  agent.enabled ? "translate-x-5" : "translate-x-0"
                }`} />
              </div>
            </label>
            
            <div className="flex items-center gap-2">
              {isTextCorrection ? (
                <Sparkles className="w-5 h-5 text-purple-600" />
              ) : (
                <MessageSquare className="w-5 h-5 text-blue-600" />
              )}
              <CardTitle className="text-lg">{agent.name}</CardTitle>
              {agent.isDefault && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  Default
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!agent.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete "${agent.name}"?`)) {
                    onDelete(agent.id);
                  }
                }}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpand}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Agent Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Agent Name
            </label>
            <Input
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              placeholder="e.g., Assistant, Email Writer, Code Helper"
              className="w-full"
            />
          </div>

          {/* Wake Words */}
          {!isTextCorrection && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Wake Words Pattern
              </label>
              <Input
                value={localWakeWords}
                onChange={(e) => setLocalWakeWords(e.target.value)}
                placeholder="e.g., ^(hello|hi|hey) assistant"
                className="w-full font-mono text-sm"
              />
              <p className="text-xs text-gray-600 mt-1">
                Regular expression pattern to trigger this agent. Leave empty for catch-all.
              </p>
            </div>
          )}

          {isTextCorrection && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-purple-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-purple-900">Catch-All Agent</p>
                  <p className="text-xs text-purple-700 mt-1">
                    This agent processes all text that doesn't match other agents' wake words.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Custom Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Prompt
            </label>
            <Textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              rows={8}
              placeholder="Enter your custom prompt..."
              className="w-full font-mono text-sm"
            />
            <p className="text-xs text-gray-600 mt-1">
              Use <code>{"{{agentName}}"}</code> for agent name and <code>{"{{text}}"}</code> for user input.
            </p>
          </div>

          {/* Cloud vs Local Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Model Configuration
            </label>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => handleModeChange('cloud')}
                className={`p-3 border-2 rounded-lg text-left transition-all ${
                  selectedMode === 'cloud'
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="font-medium text-sm">Cloud AI</div>
                <div className="text-xs text-gray-600 mt-1">Powerful, requires internet</div>
              </button>
              <button
                onClick={() => handleModeChange('local')}
                className={`p-3 border-2 rounded-lg text-left transition-all ${
                  selectedMode === 'local'
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="font-medium text-sm">Local AI</div>
                <div className="text-xs text-gray-600 mt-1">Private, works offline</div>
              </button>
            </div>

            {/* Provider Selection */}
            {selectedMode === 'cloud' ? (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {cloudProviders.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleProviderChange(p, 'cloud')}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedCloudProvider === p
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {p === 'custom' ? 'Custom' : REASONING_PROVIDERS[p as keyof typeof REASONING_PROVIDERS]?.name}
                    </button>
                  ))}
                </div>

                {/* Model Selection */}
                {selectedCloudProvider !== 'custom' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Model
                    </label>
                    <UnifiedModelPickerCompact
                      models={getProviderModels()}
                      selectedModel={agent.model}
                      onModelSelect={(model) => onUpdate(agent.id, { model })}
                    />
                  </div>
                )}

                {/* API Key Configuration */}
                {selectedCloudProvider === 'openai' && (
                  <div className="pt-3 border-t">
                    <ApiKeyInput
                      apiKey={openaiApiKey}
                      setApiKey={setOpenaiApiKey}
                      helpText="Required for OpenAI models"
                    />
                  </div>
                )}

                {selectedCloudProvider === 'anthropic' && (
                  <div className="pt-3 border-t">
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="sk-ant-..."
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => pasteFromClipboard(setAnthropicApiKey)}
                      >
                        Paste
                      </Button>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Get your API key from console.anthropic.com
                    </p>
                  </div>
                )}

                {selectedCloudProvider === 'gemini' && (
                  <div className="pt-3 border-t">
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="AIza..."
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => pasteFromClipboard(setGeminiApiKey)}
                      >
                        Paste
                      </Button>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Get your API key from makersuite.google.com/app/apikey
                    </p>
                  </div>
                )}

                {selectedCloudProvider === 'custom' && (
                  <div className="pt-3 border-t space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Custom Endpoint URL
                      </label>
                      <Input
                        value={cloudReasoningBaseUrl}
                        onChange={(e) => setCloudReasoningBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="text-sm"
                      />
                      <p className="text-xs text-gray-600 mt-1">
                        OpenAI-compatible endpoint
                      </p>
                    </div>
                    <ApiKeyInput
                      apiKey={openaiApiKey}
                      setApiKey={setOpenaiApiKey}
                      helpText="Optional bearer token for custom endpoint"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {localProviders.map((p) => {
                    const providerData = modelRegistry.getProvider(p);
                    return (
                      <button
                        key={p}
                        onClick={() => handleProviderChange(p, 'local')}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          selectedLocalProvider === p
                            ? "bg-purple-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {providerData?.name}
                      </button>
                    );
                  })}
                </div>

                {/* Model Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Model
                  </label>
                  <UnifiedModelPickerCompact
                    models={getProviderModels()}
                    selectedModel={agent.model}
                    onModelSelect={(model) => onUpdate(agent.id, { model })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={handleSave} className="flex-1">
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function AgentsPanel({ showAlertDialog, pasteFromClipboard }: AgentsPanelProps) {
  const { agents, addAgent, updateAgent, deleteAgent, resetToDefaults } = useAgents();
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  // API keys state (shared across all agents)
  const [openaiApiKey, setOpenaiApiKey] = useState(
    localStorage.getItem("openaiApiKey") || ""
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState(
    localStorage.getItem("anthropicApiKey") || ""
  );
  const [geminiApiKey, setGeminiApiKey] = useState(
    localStorage.getItem("geminiApiKey") || ""
  );
  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrl] = useState(
    localStorage.getItem("cloudReasoningBaseUrl") || API_ENDPOINTS.OPENAI_BASE
  );

  // Sync API keys to localStorage
  React.useEffect(() => {
    if (openaiApiKey) localStorage.setItem("openaiApiKey", openaiApiKey);
  }, [openaiApiKey]);
  
  React.useEffect(() => {
    if (anthropicApiKey) localStorage.setItem("anthropicApiKey", anthropicApiKey);
  }, [anthropicApiKey]);
  
  React.useEffect(() => {
    if (geminiApiKey) localStorage.setItem("geminiApiKey", geminiApiKey);
  }, [geminiApiKey]);
  
  React.useEffect(() => {
    if (cloudReasoningBaseUrl) localStorage.setItem("cloudReasoningBaseUrl", cloudReasoningBaseUrl);
  }, [cloudReasoningBaseUrl]);

  const handleAddAgent = () => {
    const newAgent = addAgent({
      name: "New Agent",
      wakeWords: "",
      enabled: true,
    });
    setExpandedAgentId(newAgent.id);
    showAlertDialog({
      title: "Agent Created",
      description: "New agent created. Configure its settings below.",
    });
  };

  const handleResetDefaults = () => {
    if (confirm("Reset all agents to defaults? This will delete all custom agents.")) {
      resetToDefaults();
      showAlertDialog({
        title: "Reset Complete",
        description: "All agents have been reset to default settings.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Configure Your AI Agents
        </h3>
        <p className="text-sm text-gray-600">
          Create specialized AI agents with custom wake words, prompts, and models. 
          Agents are processed in order - the first matching wake word wins.
        </p>
      </div>

      {/* Agent Cards */}
      <div className="space-y-4">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onUpdate={updateAgent}
            onDelete={deleteAgent}
            isExpanded={expandedAgentId === agent.id}
            onToggleExpand={() => setExpandedAgentId(expandedAgentId === agent.id ? null : agent.id)}
            showAlertDialog={showAlertDialog}
            pasteFromClipboard={pasteFromClipboard}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            anthropicApiKey={anthropicApiKey}
            setAnthropicApiKey={setAnthropicApiKey}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={setGeminiApiKey}
            cloudReasoningBaseUrl={cloudReasoningBaseUrl}
            setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
          />
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-4 border-t">
        <Button onClick={handleAddAgent} variant="default" className="flex-1">
          <Plus className="w-4 h-4 mr-2" />
          Add New Agent
        </Button>
        <Button onClick={handleResetDefaults} variant="outline">
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset to Defaults
        </Button>
      </div>

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-2">💡 How Agents Work</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Wake Words:</strong> Say the pattern to activate (e.g., "hello assistant")</li>
          <li>• <strong>Text Correction:</strong> Has no wake words - processes unmatched text</li>
          <li>• <strong>Priority:</strong> Agents are checked top to bottom - first match wins</li>
          <li>• <strong>Prompts:</strong> Customize how each agent responds to your voice</li>
        </ul>
      </div>
    </div>
  );
}
