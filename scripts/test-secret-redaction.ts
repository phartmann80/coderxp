import assert from "node:assert/strict";
import { redactSecrets } from "../lib/workspace/secret-redaction";
import { StreamingRedactor } from "../lib/workspace/agent-process-stream";

console.log("=== RUNNING SECRET REDACTION TESTS ===");

// 1. GitHub Classic & Fine-grained PAT Redaction
console.log("--- 1. GitHub Token Redaction ---");
const ghpToken = "ghp_1234567890abcdef1234567890abcdef1234";
const ghpOutput = `git clone https://${ghpToken}@github.com/org/repo.git`;
const redactedGhp = redactSecrets(ghpOutput);
assert.equal(redactedGhp.includes(ghpToken), false, "ghp token is redacted");
assert.equal(redactedGhp.includes("[REDACTED"), true, "redaction marker present");

const patToken = "github_pat_11AABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const patOutput = `Authorization: Bearer ${patToken}`;
const redactedPat = redactSecrets(patOutput);
assert.equal(redactedPat.includes(patToken), false, "github_pat token is redacted");
console.log("[PASS] GitHub Classic & Fine-grained PATs redacted.");

// 2. Anthropic & OpenAI API Key Redaction
console.log("--- 2. AI Provider Key Redaction ---");
const anthropicKey = "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const antOutput = `export ANTHROPIC_API_KEY=${anthropicKey}`;
const redactedAnt = redactSecrets(antOutput);
assert.equal(redactedAnt.includes(anthropicKey), false, "Anthropic API key is redacted");

const openAiKey = "sk-1234567890abcdef1234567890abcdef";
const openAiOutput = `const key = "${openAiKey}";`;
const redactedOpenAi = redactSecrets(openAiOutput);
assert.equal(redactedOpenAi.includes(openAiKey), false, "OpenAI API key is redacted");
console.log("[PASS] AI provider API keys redacted.");

// 3. Streaming Redactor Cross-Chunk Withholding
console.log("--- 3. Streaming Redactor Cross-Chunk Withholding ---");
const redactor = new StreamingRedactor();
const chunk1 = "Connecting to upstream with Bearer ";
const chunk2 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.do_not_leak_me";

const out1 = redactor.processChunk(chunk1);
// Chunk 1 should withhold the trailing Bearer prefix
assert.equal(out1.includes("eyJ"), false, "Payload not emitted prematurely");

const out2 = redactor.processChunk(chunk2);
const finalOut = out2 + redactor.flush();
assert.equal(finalOut.includes("do_not_leak_me"), false, "Bearer token redacted across chunks");
assert.equal(finalOut.includes("[REDACTED"), true, "Contains redaction indicator");
console.log("[PASS] Streaming redactor withholds and redacts secrets split across chunk boundaries.");

console.log("=== ALL SECRET REDACTION TESTS PASSED ===");
