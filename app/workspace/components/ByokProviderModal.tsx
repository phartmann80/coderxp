"use client";

/**
 * BYOK Provider Configuration Modal for CoderXP Revision 2.3.
 *
 * Implements Directive §10.2 & §10.3:
 * - Multi-provider configuration with key masking (…last4)
 * - Live validation probe on save
 * - Revocation removes keys and model optgroups immediately
 */

import React, { useState, useEffect } from "react";
import {
  BYOK_PROVIDER_DEFS,
  type ByokProviderId,
  type SavedByokConfig,
  validateProviderKey,
} from "@/lib/workspace/byok-providers";
import { maskApiKey, encryptSecret, decryptSecret } from "@/lib/workspace/byok-crypto";

export interface ByokProviderModalProps {
  isOpen: boolean;
  initialProviderId?: ByokProviderId;
  onClose: () => void;
  onSaved: (providerId: ByokProviderId) => void;
  onRevoked: (providerId: ByokProviderId) => void;
}

export function ByokProviderModal({
  isOpen,
  initialProviderId = "anthropic",
  onClose,
  onSaved,
  onRevoked,
}: ByokProviderModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<ByokProviderId>(initialProviderId);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [ollamaMode, setOllamaMode] = useState<"local" | "cloud">("local");
  const [showPlainKey, setShowPlainKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [maskedKey, setMaskedKey] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);

  const def = BYOK_PROVIDER_DEFS[selectedProvider];

  useEffect(() => {
    if (initialProviderId) {
      setSelectedProvider(initialProviderId);
    }
  }, [initialProviderId]);

  // Load saved config for the selected provider
  useEffect(() => {
    if (!isOpen) return;

    setValidationError(null);
    setValidationSuccess(null);
    setApiKey("");
    setShowPlainKey(false);

    try {
      const raw = localStorage.getItem(`coderxp_byok_${selectedProvider}`);
      if (raw) {
        const config = JSON.parse(raw) as SavedByokConfig;
        setIsSaved(true);
        setMaskedKey(config.maskedKey || "");
        setBaseUrl(config.baseUrl || "");
        if (config.mode) setOllamaMode(config.mode);
        // Asynchronously decrypt key for display if user toggles plaintext
        decryptSecret(config.encryptedKey).then((dec) => {
          if (dec) setApiKey(dec);
        });
      } else {
        setIsSaved(false);
        setMaskedKey("");
        setBaseUrl(def.defaultBaseUrl || "");
      }
    } catch {
      setIsSaved(false);
    }
  }, [isOpen, selectedProvider, def.defaultBaseUrl]);

  if (!isOpen) return null;

  async function handleSave() {
    setValidating(true);
    setValidationError(null);
    setValidationSuccess(null);

    const validation = await validateProviderKey(selectedProvider, apiKey, {
      baseUrl: baseUrl.trim() || undefined,
      mode: selectedProvider === "ollama" ? ollamaMode : undefined,
    });

    if (!validation.ok) {
      setValidating(false);
      setValidationError(validation.error || "Validation failed.");
      return;
    }

    try {
      const encrypted = await encryptSecret(apiKey.trim());
      const masked = maskApiKey(apiKey.trim());

      const config: SavedByokConfig = {
        providerId: selectedProvider,
        encryptedKey: encrypted,
        maskedKey: masked,
        baseUrl: baseUrl.trim() || undefined,
        mode: selectedProvider === "ollama" ? ollamaMode : undefined,
        customModels: validation.models,
        updatedAt: Date.now(),
      };

      localStorage.setItem(`coderxp_byok_${selectedProvider}`, JSON.stringify(config));
      setIsSaved(true);
      setMaskedKey(masked);
      setValidating(false);
      setValidationSuccess(`Validated! ${validation.models?.length || 0} models available.`);
      onSaved(selectedProvider);
    } catch (err: any) {
      setValidating(false);
      setValidationError(err.message || "Failed to save key.");
    }
  }

  function handleRevoke() {
    localStorage.removeItem(`coderxp_byok_${selectedProvider}`);
    setIsSaved(false);
    setMaskedKey("");
    setApiKey("");
    setValidationSuccess(null);
    setValidationError(null);
    onRevoked(selectedProvider);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="byokModalTitle"
    >
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-[500px] overflow-hidden flex flex-col font-sans text-[var(--text)] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)] bg-[var(--bg-side)]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-1.5 1.5L10 13l-4 4-4-4 4-4 7.5-7.5" />
            </svg>
            <h2 id="byokModalTitle" className="text-sm font-semibold">
              Bring Your Own Key (BYOK)
            </h2>
          </div>
          <button
            type="button"
            className="text-[var(--text-faint)] hover:text-[var(--text)] p-1 rounded hover:bg-[var(--bg-input)] cursor-pointer"
            aria-label="Close"
            onClick={onClose}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4 text-xs">
          {/* Provider selector tabs */}
          <div>
            <label className="block text-[var(--text-dim)] mb-1 font-medium">Select Provider</label>
            <select
              className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded px-3 py-2 text-xs text-[var(--text)] focus:border-[var(--accent)] outline-none"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as ByokProviderId)}
            >
              {Object.values(BYOK_PROVIDER_DEFS).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Provider info banner */}
          <div className="p-2.5 rounded bg-[var(--bg-input)] border border-[var(--border-soft)] flex items-center justify-between text-[11px] text-[var(--text-dim)]">
            <span>
              {isSaved ? (
                <span className="text-[var(--ok)] font-medium">Active: key saved ({maskedKey})</span>
              ) : (
                <span>No key configured for {def.name}</span>
              )}
            </span>
            {def.helpUrl && (
              <a
                href={def.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] hover:underline flex items-center gap-1"
              >
                <span>Get API key</span>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>
            )}
          </div>

          {/* Ollama Mode Selector */}
          {selectedProvider === "ollama" && (
            <div>
              <label className="block text-[var(--text-dim)] mb-1 font-medium">Ollama Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded border text-xs cursor-pointer ${
                    ollamaMode === "local"
                      ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium"
                      : "bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-dim)]"
                  }`}
                  onClick={() => setOllamaMode("local")}
                >
                  Local Daemon (Browser-Direct)
                </button>
                <button
                  type="button"
                  className={`flex-1 py-1.5 rounded border text-xs cursor-pointer ${
                    ollamaMode === "cloud"
                      ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-medium"
                      : "bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-dim)]"
                  }`}
                  onClick={() => setOllamaMode("cloud")}
                >
                  Remote / Cloud Endpoint
                </button>
              </div>
            </div>
          )}

          {/* Custom Base URL (if custom or Ollama) */}
          {(def.supportsCustomEndpoint || selectedProvider === "custom") && (
            <div>
              <label className="block text-[var(--text-dim)] mb-1 font-medium">Base URL</label>
              <input
                type="text"
                className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded px-3 py-2 text-xs font-mono text-[var(--text)] focus:border-[var(--accent)] outline-none"
                placeholder={def.defaultBaseUrl}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}

          {/* API Key Input */}
          {(selectedProvider !== "ollama" || ollamaMode === "cloud") && (
            <div>
              <label className="block text-[var(--text-dim)] mb-1 font-medium">
                API Key {isSaved && <span className="text-[var(--text-faint)] font-normal">({maskedKey})</span>}
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPlainKey ? "text" : "password"}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded px-3 py-2 pr-10 text-xs font-mono text-[var(--text)] focus:border-[var(--accent)] outline-none"
                  placeholder={def.keyPlaceholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 p-1 text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
                  title={showPlainKey ? "Hide key" : "Show key"}
                  onClick={() => setShowPlainKey((prev) => !prev)}
                >
                  {showPlainKey ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Validation Feedback */}
          {validationError && (
            <div className="p-2 rounded bg-red-950/30 border border-red-800/50 text-[var(--err)] text-[11px]">
              {validationError}
            </div>
          )}
          {validationSuccess && (
            <div className="p-2 rounded bg-emerald-950/30 border border-emerald-800/50 text-[var(--ok)] text-[11px]">
              {validationSuccess}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-soft)] bg-[var(--bg-side)]">
          {isSaved ? (
            <button
              type="button"
              className="text-xs text-[var(--err)] hover:underline cursor-pointer"
              onClick={handleRevoke}
            >
              Revoke Key
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-input)] cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)]"
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              disabled={validating || (!apiKey.trim() && (selectedProvider !== "ollama" || ollamaMode === "cloud"))}
              className="px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              onClick={handleSave}
            >
              {validating && (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              <span>{validating ? "Testing..." : "Validate & Save"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
