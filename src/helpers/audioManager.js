import ReasoningService from "../services/ReasoningService";
import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../config/constants";
import { getModelProvider } from "../utils/languages";
import logger from "../utils/logger";

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const REASONING_CACHE_TTL = 30000; // 30 seconds


class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.cachedApiKey = null;
    this.cachedTranscriptionEndpoint = null;
    this.recordingStartTime = null;
    this.reasoningAvailabilityCache = {}; // Cache object keyed by providerId
    this.cachedReasoningPreference = null;
  }

  setCallbacks({ onStateChange, onError, onTranscriptionComplete }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
  }

  async startRecording() {
    try {
      if (this.isRecording) {
        return false;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter(
        (device) => device.kind === "audioinput"
      );

      let deviceId = null;
      // Always prioritize the actual built-in/internal computer microphone
      // Avoid "default" which could be external devices like AirPods
      // macOS: "Built-in Microphone", "Internal Microphone", "MacBook Pro Microphone"
      // Windows: "Microphone (Built-in)", "Microphone Array (Built-in)"
      // Linux: "Built-in Audio Analog Stereo", "Internal Audio"
      const internalMic = audioInputDevices.find((device) => {
        const label = device.label.toLowerCase();
        // First priority: exact "built-in" matches
        if (/built-in microphone|built-in audio/i.test(device.label)) {
          return true;
        }
        // Second priority: internal computer microphone
        if (/internal (microphone|audio)/i.test(device.label)) {
          return true;
        }
        // Third priority: MacBook-specific
        if (/macbook.*microphone/i.test(device.label)) {
          return true;
        }
        // Fourth priority: Built-in arrays (Windows)
        if (/microphone array.*built-in/i.test(device.label)) {
          return true;
        }
        return false;
      });

      if (internalMic) {
        deviceId = internalMic.deviceId;
      }

      const audioConstraints = deviceId
        ? { audio: { deviceId: { exact: deviceId } } }
        : { audio: true };

      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);


      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordingStartTime = Date.now();

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        this.isProcessing = true;
        this.onStateChange?.({ isRecording: false, isProcessing: true });

        const audioBlob = new Blob(this.audioChunks, { type: "audio/wav" });
        
        if (audioBlob.size === 0) {
        }
        
        const durationSeconds = this.recordingStartTime
          ? (Date.now() - this.recordingStartTime) / 1000
          : null;
        this.recordingStartTime = null;
        await this.processAudio(audioBlob, { durationSeconds });

        // Clean up stream
        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      return true;
    } catch (error) {
      
      // Provide more specific error messages
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;
      
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription = "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription = "The microphone is being used by another application. Please close other apps and try again.";
      }
      
      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      // State change will be handled in onstop callback
      return true;
    }
    return false;
  }

  async processAudio(audioBlob, metadata = {}) {
    try {
      const useLocalWhisper = localStorage.getItem("useLocalWhisper") === "true";
      const whisperModel = localStorage.getItem("whisperModel") || "base";

      let result;
      if (useLocalWhisper) {
        result = await this.processWithLocalWhisper(audioBlob, whisperModel, metadata);
      } else {
        result = await this.processWithOpenAIAPI(audioBlob, metadata);
      }
      this.onTranscriptionComplete?.(result);
    } catch (error) {
      if (error.message !== "No audio detected") {
        this.onError?.({
          title: "Transcription Error",
          description: `Transcription failed: ${error.message}`,
        });
      }
    } finally {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  async processWithLocalWhisper(audioBlob, model = "base", metadata = {}) {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = localStorage.getItem("preferredLanguage");
      const options = { model };
      if (language && language !== "auto") {
        options.language = language;
      }

      const result = await window.electronAPI.transcribeLocalWhisper(
        arrayBuffer,
        options
      );

      if (result.success && result.text) {
        const text = await this.processTranscription(result.text, "local");
        if (text !== null && text !== undefined) {
          return { success: true, text: text || result.text, source: "local" };
        } else {
          throw new Error("No text transcribed");
        }
      } else if (result.success === false && result.message === "No audio detected") {
        this.onError?.({
          title: "No Audio Detected",
          description: "The recording contained no detectable audio. Please check your microphone settings.",
        });
        throw new Error("No audio detected");
      } else {
        throw new Error(result.error || "Local Whisper transcription failed");
      }
    } catch (error) {
      if (error.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(`Local Whisper failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`);
        }
      } else {
        throw new Error(`Local Whisper failed: ${error.message}`);
      }
    }
  }

  async getAPIKey() {
    if (this.cachedApiKey) {
      return this.cachedApiKey;
    }

    let apiKey = await window.electronAPI.getOpenAIKey();
    if (
      !apiKey ||
      apiKey.trim() === "" ||
      apiKey === "your_openai_api_key_here"
    ) {
      apiKey = localStorage.getItem("openaiApiKey");
    }

    if (
      !apiKey ||
      apiKey.trim() === "" ||
      apiKey === "your_openai_api_key_here"
    ) {
      throw new Error(
        "OpenAI API key not found. Please set your API key in the .env file or Control Panel."
      );
    }

    this.cachedApiKey = apiKey;
    return apiKey;
  }

  async optimizeAudio(audioBlob) {
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Convert to 16kHz mono for smaller size and faster upload
          const sampleRate = 16000;
          const channels = 1;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(
            channels,
            length,
            sampleRate
          );

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();
          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (error) {
          // If optimization fails, use original
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async processWithReasoningModel(text, model, agentName) {
    logger.logReasoning("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length
    });
    
    const startTime = Date.now();
    
    try {
      const result = await ReasoningService.processText(text, model, agentName);
      
      const processingTime = Date.now() - startTime;
      
      logger.logReasoning("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true
      });
      
      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.logReasoning("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  async isProviderConfigured(providerId) {
    const now = Date.now();
    // Simple cache to avoid spamming checks for the same provider
    if (this.reasoningAvailabilityCache[providerId] && now < this.reasoningAvailabilityCache[providerId].expiresAt) {
      return this.reasoningAvailabilityCache[providerId].value;
    }

    try {
      const isConfigured = await ReasoningService.isAvailable(providerId);
      this.reasoningAvailabilityCache[providerId] = {
        value: isConfigured,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      return isConfigured;
    } catch (error) {
      logger.logReasoning("REASONING_CONFIG_CHECK_ERROR", {
        providerId,
        error: error.message,
        stack: error.stack,
      });
      this.reasoningAvailabilityCache[providerId] = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      return false;
    }
  }

  async processTranscription(text, source) {
    const normalizedText = typeof text === "string" ? text.trim() : "";
    
    if (!normalizedText) {
      return normalizedText;
    }

    // Get all enabled agents from the new multi-agent system
    const agents = this.getEnabledAgents();
    
    if (agents.length === 0) {
      // No agents configured, return original text
      return normalizedText;
    }

    // First pass: Check agents with wake words
    // Second pass: Use catch-all agent if no match
    let catchAllAgent = null;
    
    // Loop through agents and find first match
    for (const agent of agents) {
      // Store catch-all agent (empty wake words) for later
      if (!agent.wakeWords || agent.wakeWords.trim() === '') {
        if (agent.enabled && !catchAllAgent) {
          catchAllAgent = agent;
        }
        continue; // Skip catch-all agents in first pass
      }
      
      // Check if text matches this agent's wake words
      try {
        // Build a flexible wake word pattern:
        // - Optional greeting prefix (hello, hi, hey, ok)
        // - The wake word
        // - Optional punctuation/separator (, or space)
        // Example: "Jarvis" becomes /^(hello |hi |hey |ok )?\s*jarvis[\s,.]*/i
        const escapedWakeWord = agent.wakeWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flexiblePattern = `^(hello |hi |hey |ok )?\\s*${escapedWakeWord}[\\s,.]*`;
        const wakeRegex = new RegExp(flexiblePattern, 'i');
        
        const match = normalizedText.match(wakeRegex);
        if (match) {
          // Found a match! Remove the wake word phrase from the text
          const textWithoutWakeWord = normalizedText.substring(match[0].length).trim();
          
          // If nothing left after removing wake word, return original
          if (!textWithoutWakeWord) {
            return normalizedText;
          }
          
          const provider = getModelProvider(agent.model);
          const isConfigured = await this.isProviderConfigured(provider);
          
          if (!isConfigured) {
            this.onError?.({
              title: `${agent.name} Not Configured`,
              description: `Please configure the ${provider} provider in settings to use "${agent.name}".`,
            });
            return normalizedText;
          }
          
          try {
            return await this.processWithAgent(textWithoutWakeWord, agent);
          } catch (error) {
            this.onError?.({
              title: `${agent.name} Error`,
              description: error.message,
            });
            return normalizedText;
          }
        }
      } catch (regexError) {
        console.error(`Invalid regex for agent ${agent.name}:`, regexError);
        // Continue to next agent if regex is invalid
        continue;
      }
    }
    
    // No specific agent matched, use catch-all agent if available
    if (catchAllAgent) {
      try {
        return await this.processWithAgent(normalizedText, catchAllAgent);
      } catch (error) {
        this.onError?.({
          title: `${catchAllAgent.name} Error`,
          description: error.message,
        });
        return normalizedText;
      }
    }
    
    // No agent matched at all, return original text
    return normalizedText;
  }

  getEnabledAgents() {
    try {
      const stored = localStorage.getItem('agents');
      if (!stored) {
        return [];
      }
      
      const agents = JSON.parse(stored);
      return agents
        .filter(a => a.enabled)
        .sort((a, b) => a.order - b.order);
    } catch (error) {
      console.error('Failed to load agents:', error);
      return [];
    }
  }

  async processWithAgent(text, agent) {
    logger.logReasoning("PROCESSING_WITH_AGENT", {
      agentId: agent.id,
      agentName: agent.name,
      model: agent.model,
      provider: agent.provider,
      textLength: text.length
    });

    // Use agent's custom prompt
    const prompt = agent.prompt
      .replace(/\{\{agentName\}\}/g, agent.name)
      .replace(/\{\{text\}\}/g, text);
    
    logger.logReasoning("AGENT_PROMPT_PREPARED", {
      agentId: agent.id,
      agentName: agent.name,
      promptLength: prompt.length
    });

    // Process with agent's model using the custom prompt
    const result = await ReasoningService.processText(
      text, 
      agent.model, 
      agent.name,
      {
        customPrompts: {
          agent: agent.prompt,
          regular: agent.prompt // Use same prompt
        }
      }
    );
    
    logger.logReasoning("AGENT_PROCESSING_COMPLETE", {
      agentId: agent.id,
      agentName: agent.name,
      resultLength: result.length
    });

    return result;
  }

  async processWithOpenAIAPI(audioBlob, metadata = {}) {
    const language = localStorage.getItem("preferredLanguage");
    const allowLocalFallback =
      localStorage.getItem("allowLocalFallback") === "true";
    const fallbackModel = localStorage.getItem("fallbackWhisperModel") || "base";

    try {

      const durationSeconds = metadata.durationSeconds ?? null;
      const shouldSkipOptimizationForDuration =
        typeof durationSeconds === "number" &&
        durationSeconds > 0 &&
        durationSeconds < SHORT_CLIP_DURATION_SECONDS;

      const shouldOptimize =
        !shouldSkipOptimizationForDuration && audioBlob.size > 1024 * 1024;

      const [apiKey, optimizedAudio] = await Promise.all([
        this.getAPIKey(),
        shouldOptimize ? this.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
      ]);

      const formData = new FormData();
      formData.append("file", optimizedAudio, "audio.wav");
      formData.append("model", "whisper-1");

      if (language && language !== "auto") {
        formData.append("language", language);
      }

      const response = await fetch(
        this.getTranscriptionEndpoint(),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (result.text) {
        const processedText = await this.processTranscription(result.text, "openai");
        const source = result.text !== processedText ? "openai-reasoned" : "openai";
        return { success: true, text: processedText, source };
      } else {
        throw new Error("No text transcribed");
      }
    } catch (error) {
      const isOpenAIMode = localStorage.getItem("useLocalWhisper") !== "true";

      if (allowLocalFallback && isOpenAIMode) {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const options = { model: fallbackModel };
          if (language && language !== "auto") {
            options.language = language;
          }

          const result = await window.electronAPI.transcribeLocalWhisper(
            arrayBuffer,
            options
          );

          if (result.success && result.text) {
            const text = await this.processTranscription(result.text, "local-fallback");
            if (text) {
              return { success: true, text, source: "local-fallback" };
            }
          }
          throw error;
        } catch (fallbackError) {
          throw new Error(
            `OpenAI API failed: ${error.message}. Local fallback also failed: ${fallbackError.message}`
          );
        }
      }

      throw error;
    }
  }

  getTranscriptionEndpoint() {
    if (this.cachedTranscriptionEndpoint) {
      return this.cachedTranscriptionEndpoint;
    }

    try {
      const stored = typeof localStorage !== "undefined"
        ? localStorage.getItem("cloudTranscriptionBaseUrl") || ""
        : "";
      const trimmed = stored.trim();
      const base = trimmed ? trimmed : API_ENDPOINTS.TRANSCRIPTION_BASE;
      const normalizedBase = normalizeBaseUrl(base);

      if (!normalizedBase) {
        this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
        return API_ENDPOINTS.TRANSCRIPTION;
      }

      const isLocalhost = normalizedBase.includes('://localhost') || normalizedBase.includes('://127.0.0.1');
      if (!normalizedBase.startsWith('https://') && !isLocalhost) {
        console.warn('Non-HTTPS endpoint rejected for security. Using default.');
        this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
        return API_ENDPOINTS.TRANSCRIPTION;
      }

      let endpoint;
      if (/\/audio\/(transcriptions|translations)$/i.test(normalizedBase)) {
        endpoint = normalizedBase;
      } else {
        endpoint = buildApiUrl(normalizedBase, '/audio/transcriptions');
      }

      this.cachedTranscriptionEndpoint = endpoint;
      return endpoint;
    } catch (error) {
      console.warn('Failed to resolve transcription endpoint:', error);
      this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
      return API_ENDPOINTS.TRANSCRIPTION;
    }
  }

  async safePaste(text) {
    try {
      await window.electronAPI.pasteText(text);
      return true;
    } catch (error) {
      this.onError?.({
        title: "Paste Error",
        description: `Failed to paste text. Please check accessibility permissions. ${error.message}`,
      });
      return false;
    }
  }

  async saveTranscription(text) {
    try {
      await window.electronAPI.saveTranscription(text);
      return true;
    } catch (error) {
      return false;
    }
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
    };
  }

  cleanup() {
    if (this.mediaRecorder && this.isRecording) {
      this.stopRecording();
    }
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
  }
}

export default AudioManager;
