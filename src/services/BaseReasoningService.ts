export interface ReasoningConfig {
  maxTokens?: number;
  temperature?: number;
  contextSize?: number;
  customPrompts?: {
    agent: string;
    regular: string;
  };
}

export abstract class BaseReasoningService {
  protected isProcessing = false;

  /**
   * Get reasoning prompt
   * Note: With the new multi-agent system, custom prompts are passed directly from agents.
   * This method now primarily serves as a fallback and for the prompt replacement logic.
   */
  protected getReasoningPrompt(
    text: string,
    agentName: string | null,
    config: ReasoningConfig = {}
  ): string {
    // Default prompts - kept for backward compatibility
    const DEFAULT_AGENT_PROMPT = `You are {{agentName}}, a helpful AI assistant. The user has given you a command or request. Complete the request and provide ONLY your response, without any preamble, explanations, or reference to your name:\n\n{{text}}`;
    const DEFAULT_REGULAR_PROMPT = `Clean up the following dictated text by fixing grammar, punctuation, and formatting. Output ONLY the cleaned text without any explanations, options, or commentary:\n\n{{text}}`;

    let agentPrompt = DEFAULT_AGENT_PROMPT;
    let regularPrompt = DEFAULT_REGULAR_PROMPT;

    // Use prompts from config if available (for testing in PromptStudio or direct agent calls)
    if (config.customPrompts) {
      agentPrompt = config.customPrompts.agent || DEFAULT_AGENT_PROMPT;
      regularPrompt = config.customPrompts.regular || DEFAULT_REGULAR_PROMPT;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      // Fallback to localStorage for backward compatibility
      const customPrompts = window.localStorage.getItem('customPrompts');
      if (customPrompts) {
        try {
          const parsed = JSON.parse(customPrompts);
          agentPrompt = parsed.agent || DEFAULT_AGENT_PROMPT;
          regularPrompt = parsed.regular || DEFAULT_REGULAR_PROMPT;
        } catch (error) {
          console.error('Failed to parse custom prompts:', error);
        }
      }
    }

    // Check if this is an agent command by presence of agent name
    // With the new multi-agent system, the wake word check is done in audioManager,
    // so we just need to determine which prompt to use based on agentName presence
    if (agentName) {
      const agentRegex = new RegExp(`^(hello|hi|hey|ok) ${agentName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[, ]`, 'i');
      if (agentRegex.test(text)) {
        // Agent-based prompt - replace placeholders
        return agentPrompt
          .replace(/\{\{agentName\}\}/g, agentName)
          .replace(/\{\{text\}\}/g, text);
      }
    }

    // Regular prompt - replace placeholders
    return regularPrompt.replace(/\{\{text\}\}/g, text);
  }

  /**
   * Calculate optimal max tokens based on input length
   */
  protected calculateMaxTokens(
    textLength: number,
    minTokens = 100,
    maxTokens = 2048,
    multiplier = 2
  ): number {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }

  /**
   * Check if service is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Process text with reasoning
   */
  abstract processText(
    text: string,
    modelId: string,
    agentName?: string | null,
    config?: ReasoningConfig
  ): Promise<string>;
}