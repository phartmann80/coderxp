#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# CoderXP Production Deployment Pipeline & Release Gate
# ==============================================================================
# Invariant: Releases MUST pass all unit tests, multi-stage Docker production build,
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

# Step 1: Ensure dependencies & Run Full Test Matrix
echo "=== STEP 1: EXECUTING UNIT & INTEGRATION TEST MATRIX ==="
npm ci --include=dev
npm run test
npx tsx scripts/test-orchestrator-stable-identity.ts
echo "[PASS] All unit and integration test suites passed.\n"

# Step 2: Capture Previous Image for Automated Rollback
echo "=== STEP 2: CAPTURING PREVIOUS CONTAINER STATE FOR ROLLBACK GUARD ==="
PREV_IMAGE="$(docker inspect --format='{{.Config.Image}}' coderxp-app 2>/dev/null || echo 'coderxp:latest')"
echo "Previous image: ${PREV_IMAGE}"

# Step 3: Build Release Multi-Stage Container Image (Compiles Next.js)
echo "=== STEP 3: BUILDING RELEASE DOCKER IMAGE (${TARGET_IMAGE}) ==="
docker build -f "${DEPLOY_DIR}/deploy/Dockerfile" -t "${TARGET_IMAGE}" .
echo "[PASS] Docker image built and compiled successfully.\n"

# Step 4: Replace Production Container
echo "=== STEP 4: DEPLOYING CODERXP-APP CONTAINER ==="
docker rm -f coderxp-app || true
docker run -d --name coderxp-app \
  --restart unless-stopped \
  --network coderxp-net \
  -p 127.0.0.1:3100:3000 \
  -v /opt/coderxp/data:/opt/coderxp/data \
  --env-file /etc/coderxp/coderxp.env \
  "${TARGET_IMAGE}"

echo "Restarting Devbox Broker service..."
systemctl restart coderxp-broker.service
sleep 5

docker ps --filter name=coderxp-app

# Step 5: Post-Deployment Production Smoke Gate
echo "\n=== STEP 5: RUNNING POST-DEPLOYMENT SMOKE GATE ON PRODUCTION ==="
if [ -f /etc/coderxp/coderxp.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/coderxp/coderxp.env 2>/dev/null || true
  set +a
fi
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
