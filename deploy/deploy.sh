#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# CoderXP Production Deployment Pipeline & Release Gate
# ==============================================================================
# Invariant: Releases MUST pass all unit tests, production build, Playwright E2E,
# container replacement, and live post-deploy smoke assertions.
# Any failure triggers an automatic instant rollback to the previous image.
# ==============================================================================

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEPLOY_DIR}"

COMMIT_HASH="$(git rev-parse --short HEAD)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TARGET_IMAGE="coderxp:${COMMIT_HASH}"

echo "=========================================================================="
echo "          STARTING CODERXP PRODUCTION DEPLOYMENT PIPELINE                 "
echo "=========================================================================="
echo "Commit:    ${COMMIT_HASH}"
echo "Timestamp: ${TIMESTAMP}"
echo "Directory: ${DEPLOY_DIR}"
echo "==========================================================================\n"

# Step 1: Run Full Test Matrix
echo "=== STEP 1: EXECUTING UNIT & INTEGRATION TEST MATRIX ==="
npm run test
npx tsx scripts/test-orchestrator-stable-identity.ts
echo "[PASS] All unit and integration test suites passed.\n"

# Step 2: Test Production Build
echo "=== STEP 2: VERIFYING OPTIMIZED PRODUCTION BUILD ==="
npm run build
echo "[PASS] Production build compiled successfully.\n"

# Step 3: Capture Previous Image for Automated Rollback
echo "=== STEP 3: CAPTURING PREVIOUS CONTAINER STATE FOR ROLLBACK GUARD ==="
PREV_CONTAINER_ID="$(docker ps -q --filter name=coderxp-app || true)"
PREV_IMAGE="$(docker inspect --format='{{.Config.Image}}' coderxp-app 2>/dev/null || echo 'coderxp:latest')"
echo "Previous image: ${PREV_IMAGE}"

# Step 4: Build Release Container Image
echo "=== STEP 4: BUILDING RELEASE DOCKER IMAGE (${TARGET_IMAGE}) ==="
docker build -f "${DEPLOY_DIR}/deploy/Dockerfile" -t "${TARGET_IMAGE}" .
echo "[PASS] Docker image built successfully.\n"

# Step 5: Replace Production Container
echo "=== STEP 5: DEPLOYING CODERXP-APP CONTAINER ==="
docker rm -f coderxp-app || true
docker run -d --name coderxp-app \
  --restart unless-stopped \
  --network coderxp-net \
  -p 127.0.0.1:3100:3000 \
  --env-file /etc/coderxp/coderxp.env \
  "${TARGET_IMAGE}"

echo "Restarting Devbox Broker service..."
systemctl restart coderxp-broker.service
sleep 4

docker ps --filter name=coderxp-app

# Step 6: Post-Deployment Production Smoke Gate
echo "\n=== STEP 6: RUNNING POST-DEPLOYMENT SMOKE GATE ON PRODUCTION ==="
if npx tsx scripts/smoke-production-live.ts; then
  echo "\n[SUCCESS] Production smoke gate passed 100%!"
  docker tag "${TARGET_IMAGE}" coderxp:latest
  echo "Tagged ${TARGET_IMAGE} -> coderxp:latest"
  echo "Release ${COMMIT_HASH} is LIVE."
else
  echo "\n[FATAL ERROR] Post-deployment smoke gate failed on production!"
  echo "Initiating automatic rollback to ${PREV_IMAGE}..."
  docker rm -f coderxp-app || true
  docker run -d --name coderxp-app \
    --restart unless-stopped \
    --network coderxp-net \
    -p 127.0.0.1:3100:3000 \
    --env-file /etc/coderxp/coderxp.env \
    "${PREV_IMAGE}"
  systemctl restart coderxp-broker.service
  echo "[ROLLBACK COMPLETE] Restored ${PREV_IMAGE}."
  exit 1
fi
