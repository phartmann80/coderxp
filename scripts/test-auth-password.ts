import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  verifyAdminCredentials,
  updateAdminPassword,
  ADMIN_CONFIG,
} from "../lib/server/auth";

async function main() {
  console.log("=== RUNNING AUTH PASSWORD HASHING & CHANGE TESTS ===");

  // 1. Initial State: Plaintext or Hash Verification
  console.log("--- 1. Initial Credential Verification ---");
  const initialPass = "coderxp-pilot-2026";
  assert.equal(verifyAdminCredentials("coderxpadmin", initialPass), true);
  assert.equal(verifyAdminCredentials("coderxpadmin", "wrong-pass"), false);
  assert.equal(verifyAdminCredentials("paul@coderxp.pro", initialPass), true);
  console.log("[PASS] Initial credentials verified correctly.");

  // 2. PBKDF2 Hashing
  console.log("--- 2. PBKDF2 Hashing & Verification ---");
  const hashed = hashPassword("super-secret-paul-pass-2026");
  assert.ok(hashed.startsWith("pbkdf2$100000$"), "PBKDF2 prefix and iterations match");
  assert.equal(verifyPassword("super-secret-paul-pass-2026", hashed), true);
  assert.equal(verifyPassword("wrong-attempt", hashed), false);
  console.log("[PASS] PBKDF2 hashing and constant-time verification passed.");

  // 3. Password Update & Verification
  console.log("--- 3. Password Update at Runtime ---");
  updateAdminPassword("new-authenticated-password-2026");
  assert.ok(ADMIN_CONFIG.password.startsWith("pbkdf2$100000$"), "Admin password updated to PBKDF2 hash");
  assert.equal(verifyAdminCredentials("coderxpadmin", "new-authenticated-password-2026"), true);
  assert.equal(verifyAdminCredentials("coderxpadmin", initialPass), false);
  console.log("[PASS] Runtime password update immediately enforces new PBKDF2 hash.");

  // Restore initial password for further tests
  ADMIN_CONFIG.password = initialPass;

  console.log("=== ALL AUTH PASSWORD TESTS PASSED ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
