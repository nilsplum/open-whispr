const { ipcMain, app, shell, BrowserWindow } = require("electron");
const crypto = require("crypto");
const dns = require("dns");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");

function isLocalhostHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isAllowedTranscriptionUrl(url) {
  if (!url || typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:" && isLocalhostHost(parsed.hostname)) return true;
  return false;
}

function buildMultipartBody({ fields, fileFieldName, filename, fileContentType, fileBuffer }) {
  const boundary = `----OpenWhisprBoundary${crypto.randomBytes(16).toString("hex")}`;
  const chunks = [];
  const push = (value) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));

  for (const [name, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    push(String(value));
    push("\r\n");
  }

  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="${fileFieldName}"; filename="${filename}"\r\n`
  );
  push(`Content-Type: ${fileContentType || "application/octet-stream"}\r\n\r\n`);
  push(fileBuffer);
  push("\r\n");
  push(`--${boundary}--\r\n`);

  const body = Buffer.concat(chunks);
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function httpRequestJson({ url, method, headers, body, timeoutMs = 60000 }) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  const requestImpl = isHttps ? https : http;

  const isRetryableError = (error) => {
    const code = error?.code;
    if (
      code === "ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ECONNREFUSED" ||
      code === "EPIPE" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND"
    ) {
      return true;
    }

    const message = String(error?.message || "").toLowerCase();
    if (message.includes("fetch failed")) return true;
    if (message.includes("sslv3_alert_bad_record_mac")) return true;
    return false;
  };

  const maxAttempts = 3;
  const backoffMs = [0, 400, 1200];
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (backoffMs[attempt - 1] > 0) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1]));
    }

    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        ...headers,
        // Force connection close to avoid stale connection pool issues
        Connection: "close",
      },
    };

    try {
      // eslint-disable-next-line no-await-in-loop
      return await new Promise((resolve, reject) => {
        const req = requestImpl.request(requestOptions, (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode || 0;
            if (status < 200 || status >= 300) {
              const error = new Error(
                `HTTP ${status}: ${raw || res.statusMessage || "Request failed"}`
              );
              error.statusCode = status;
              return reject(error);
            }

            try {
              resolve(raw ? JSON.parse(raw) : {});
            } catch (parseError) {
              const error = new Error(`Invalid JSON response: ${raw.substring(0, 200)}`);
              error.cause = parseError;
              reject(error);
            }
          });
        });

        req.on("error", reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        if (body) req.write(body);
        req.end();
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      debugLogger.log("httpRequestJson retrying", {
        url: parsed.origin,
        attempt,
        maxAttempts,
        code: error?.code,
        message: error?.message,
      });
    }
  }

  throw lastError;
}

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.whisperManager = managers.whisperManager;
    this.windowManager = managers.windowManager;
    this.modelManager = managers.modelManager;
    this.setupHandlers();
  }

  setupHandlers() {
    // Window control handlers
    ipcMain.handle("window-minimize", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (this.windowManager.controlPanelWindow) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.close();
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (this.windowManager.controlPanelWindow) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("app-quit", () => {
      app.quit();
    });

    ipcMain.handle("hide-window", () => {
      if (process.platform === "darwin") {
        this.windowManager.hideDictationPanel();
        if (app.dock) app.dock.show();
      } else {
        this.windowManager.hideDictationPanel();
      }
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    // Environment handlers
    ipcMain.handle("get-openai-key", async (event) => {
      return this.environmentManager.getOpenAIKey();
    });

    ipcMain.handle("save-openai-key", async (event, key) => {
      return this.environmentManager.saveOpenAIKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("save-settings", async (event, settings) => {
      try {
        // Save settings to environment and localStorage
        if (settings.apiKey) {
          await this.environmentManager.saveOpenAIKey(settings.apiKey);
        }
        return { success: true };
      } catch (error) {
        console.error("Failed to save settings:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-deleted", { id });
        });
      }
      return result;
    });

    // Clipboard handlers
    ipcMain.handle("paste-text", async (event, text) => {
      return this.clipboardManager.pasteText(text);
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text);
    });

    ipcMain.handle("copy-to-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text);
    });

    // Whisper handlers
    ipcMain.handle(
      "transcribe-local-whisper",
      async (event, audioBlob, options = {}) => {
        debugLogger.log('transcribe-local-whisper called', {
          audioBlobType: typeof audioBlob,
          audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
          options
        });
        
        try {
          const result = await this.whisperManager.transcribeLocalWhisper(
            audioBlob,
            options
          );

          debugLogger.log('Whisper result', {
            success: result.success,
            hasText: !!result.text,
            message: result.message,
            error: result.error
          });
          
          // Check if no audio was detected and send appropriate event
          if (!result.success && result.message === "No audio detected") {
            debugLogger.log('Sending no-audio-detected event to renderer');
            event.sender.send("no-audio-detected");
          }

          return result;
        } catch (error) {
          debugLogger.error('Local Whisper transcription error', error);
          throw error;
        }
      }
    );

    ipcMain.handle(
      "transcribe-cloud-whisper",
      async (_event, audioBuffer, options = {}) => {
        const apiKey = this.environmentManager.getOpenAIKey();
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
          return {
            success: false,
            error:
              "OpenAI API key not found. Please add your API key in Settings (it’s stored in your userData .env).",
          };
        }

        const endpoint =
          typeof options.endpoint === "string" && options.endpoint.trim()
            ? options.endpoint.trim()
            : "https://api.openai.com/v1/audio/transcriptions";

        if (!isAllowedTranscriptionUrl(endpoint)) {
          return {
            success: false,
            error:
              "Transcription endpoint must be HTTPS (or http://localhost). Please check your transcription base URL setting.",
          };
        }

        try {
          const fileBuffer = Buffer.from(audioBuffer);
          const model = typeof options.model === "string" ? options.model : "whisper-1";
          const language =
            typeof options.language === "string" && options.language.trim()
              ? options.language.trim()
              : undefined;

          debugLogger.log("transcribe-cloud-whisper request", {
            endpoint,
            model,
            hasLanguage: !!language,
            audioBytes: fileBuffer.length,
          });

          const { body, contentType } = buildMultipartBody({
            fields: {
              model,
              ...(language ? { language } : {}),
            },
            fileFieldName: "file",
            filename: "audio.wav",
            fileContentType: "audio/wav",
            fileBuffer,
          });

          const json = await httpRequestJson({
            url: endpoint,
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": contentType,
              "Content-Length": String(body.length),
            },
            body,
            timeoutMs: 120000,
          });

          if (json && typeof json.text === "string") {
            return { success: true, text: json.text };
          }

          return {
            success: false,
            error:
              "OpenAI transcription returned an unexpected response. Try again or check logs for details.",
          };
        } catch (error) {
          debugLogger.error("transcribe-cloud-whisper error", {
            message: error?.message,
            code: error?.code,
            statusCode: error?.statusCode,
            stack: error?.stack,
          });

          return {
            success: false,
            error:
              error?.message ||
              "Cloud transcription failed (network/TLS error). If you’re on a VPN/proxy, try disabling it.",
          };
        }
      }
    );

    ipcMain.handle("check-whisper-installation", async (event) => {
      return this.whisperManager.checkWhisperInstallation();
    });

    ipcMain.handle("check-python-installation", async (event) => {
      return this.whisperManager.checkPythonInstallation();
    });

    ipcMain.handle("install-python", async (event) => {
      try {
        const result = await this.whisperManager.installPython((progress) => {
          event.sender.send("python-install-progress", {
            type: "progress",
            stage: progress.stage,
            percentage: progress.percentage,
          });
        });
        return result;
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("install-whisper", async (event) => {
      try {
        // Set up progress forwarding for installation
        const originalConsoleLog = console.log;
        console.log = (...args) => {
          const message = args.join(" ");
          if (
            message.includes("Installing") ||
            message.includes("Downloading") ||
            message.includes("Collecting")
          ) {
            event.sender.send("whisper-install-progress", {
              type: "progress",
              message: message,
            });
          }
          originalConsoleLog(...args);
        };

        const result = await this.whisperManager.installWhisper();

        // Restore original console.log
        console.log = originalConsoleLog;

        return result;
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("download-whisper-model", async (event, modelName) => {
      try {
        const result = await this.whisperManager.downloadWhisperModel(
          modelName,
          (progressData) => {
            // Forward progress updates to the renderer
            event.sender.send("whisper-download-progress", progressData);
          }
        );

        // Send completion event
        event.sender.send("whisper-download-progress", {
          type: "complete",
          model: modelName,
          result: result,
        });

        return result;
      } catch (error) {

        // Send error event
        event.sender.send("whisper-download-progress", {
          type: "error",
          model: modelName,
          error: error.message,
        });

        throw error;
      }
    });

    ipcMain.handle("check-model-status", async (event, modelName) => {
      return this.whisperManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-whisper-models", async (event) => {
      return this.whisperManager.listWhisperModels();
    });

    ipcMain.handle("delete-whisper-model", async (event, modelName) => {
      return this.whisperManager.deleteWhisperModel(modelName);
    });

    ipcMain.handle("cancel-whisper-download", async (event) => {
      return this.whisperManager.cancelDownload();
    });

    ipcMain.handle("check-ffmpeg-availability", async (event) => {
      return this.whisperManager.checkFFmpegAvailability();
    });

    // Utility handlers
    ipcMain.handle("cleanup-app", async (event) => {
      try {
        AppUtils.cleanup(this.windowManager.mainWindow);
        return { success: true, message: "Cleanup completed successfully" };
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    // External link handler
    ipcMain.handle("open-external", async (event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Model management handlers
    ipcMain.handle("model-get-all", async () => {
      try {
        console.log('[IPC] model-get-all called');
        const modelManager = require("./modelManagerBridge").default;
        const models = await modelManager.getModelsWithStatus();
        console.log('[IPC] Returning models:', models.length);
        return models;
      } catch (error) {
        console.error('[IPC] Error in model-get-all:', error);
        throw error;
      }
    });

    ipcMain.handle("model-check", async (_, modelId) => {
      const modelManager = require("./modelManagerBridge").default;
      return modelManager.isModelDownloaded(modelId);
    });

    ipcMain.handle("model-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const result = await modelManager.downloadModel(
          modelId,
          (progress, downloadedSize, totalSize) => {
            event.sender.send("model-download-progress", {
              modelId,
              progress,
              downloadedSize,
              totalSize,
            });
          }
        );
        return { success: true, path: result };
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          details: error.details 
        };
      }
    });

    ipcMain.handle("model-delete", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteModel(modelId);
        return { success: true };
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          code: error.code,
          details: error.details 
        };
      }
    });

    ipcMain.handle("model-delete-all", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteAllModels();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-check-runtime", async (event) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.ensureLlamaCpp();
        return { available: true };
      } catch (error) {
        return { 
          available: false, 
          error: error.message,
          code: error.code,
          details: error.details 
        };
      }
    });

    ipcMain.handle("get-anthropic-key", async (event) => {
      return this.environmentManager.getAnthropicKey();
    });

    ipcMain.handle("get-gemini-key", async (event) => {
      return this.environmentManager.getGeminiKey();
    });

    ipcMain.handle("save-gemini-key", async (event, key) => {
      return this.environmentManager.saveGeminiKey(key);
    });

    ipcMain.handle("save-anthropic-key", async (event, key) => {
      return this.environmentManager.saveAnthropicKey(key);
    });

    // Local reasoning handler
    ipcMain.handle("process-local-reasoning", async (event, text, modelId, agentName, config) => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        const result = await LocalReasoningService.processText(text, modelId, agentName, config);
        return { success: true, text: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Anthropic reasoning handler
    ipcMain.handle("process-anthropic-reasoning", async (event, text, modelId, agentName, config) => {
      try {
        const apiKey = this.environmentManager.getAnthropicKey();
        
        if (!apiKey) {
          throw new Error("Anthropic API key not configured");
        }

        const systemPrompt = "You are a dictation assistant. Clean up text by fixing grammar and punctuation. Output ONLY the cleaned text without any explanations, options, or commentary.";
        const userPrompt = agentName && text.toLowerCase().includes(agentName.toLowerCase())
          ? `You are ${agentName}, a helpful AI assistant. Clean up the following dictated text by fixing grammar, punctuation, and formatting. Remove any reference to your name. Output ONLY the cleaned text without explanations or options:\n\n${text}`
          : `Clean up the following dictated text by fixing grammar, punctuation, and formatting. Output ONLY the cleaned text without any explanations, options, or commentary:\n\n${text}`;

        const requestBody = {
          model: modelId || "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: userPrompt }],
          system: systemPrompt,
          max_tokens: config?.maxTokens || Math.max(100, Math.min(text.length * 2, 4096)),
          temperature: config?.temperature || 0.3,
        };

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorData = { error: response.statusText };
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText || response.statusText };
          }
          throw new Error(errorData.error?.message || errorData.error || `Anthropic API error: ${response.status}`);
        }

        const data = await response.json();
        return { success: true, text: data.content[0].text.trim() };
      } catch (error) {
        debugLogger.error("Anthropic reasoning error:", error);
        return { success: false, error: error.message };
      }
    });


    // Check if local reasoning is available
    ipcMain.handle("check-local-reasoning-available", async () => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        return await LocalReasoningService.isAvailable();
      } catch (error) {
        return false;
      }
    });

    // llama.cpp installation handlers
    ipcMain.handle("llama-cpp-check", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const isInstalled = await llamaCppInstaller.isInstalled();
        const version = isInstalled ? await llamaCppInstaller.getVersion() : null;
        return { isInstalled, version };
      } catch (error) {
        return { isInstalled: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-install", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.install();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-uninstall", async () => {
      try {
        const result = await llamaCppInstaller.uninstall();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-log-level", async () => {
      return debugLogger.getLevel();
    });

    ipcMain.handle("app-log", async (event, entry) => {
      debugLogger.logEntry(entry);
      return { success: true };
    });
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;
