#!/usr/bin/env bash
set -e

KEY_SRC="/c/Users/hartm/strato-private-744"
TMP_KEY="/tmp/strato_deploy_key"

rm -f "$TMP_KEY"
cp "$KEY_SRC" "$TMP_KEY"
chmod 600 "$TMP_KEY"

ssh-keygen -p -f "$TMP_KEY" -N "" -P "Ecuagrowers10@@" >/dev/null 2>&1 || true

echo "=== 1. PRE-DEPLOY AUDIT: CineDrama Status ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  systemctl is-active cinedrama-web.service
  ss -ltnp | grep ':3000' || true
"

echo "=== 2. FETCHING main ON REMOTE HOST ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  cd /opt/coderxp/source
  git fetch origin main
  git checkout -f origin/main
  TAG=\$(git rev-parse --short HEAD)
  echo 'Current HEAD on main:' \$(git rev-parse HEAD)
"

echo "=== 3. BUILDING DOCKER IMAGE coderxp:v2.3 ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  TAG=\$(cd /opt/coderxp/source && git rev-parse --short HEAD)
  docker build -t coderxp:\$TAG -f /opt/coderxp/deploy/Dockerfile /opt/coderxp/source
  sed -i \"s|image: coderxp:.*|image: coderxp:\$TAG|\" /opt/coderxp/deploy/docker-compose.yml
  cat /opt/coderxp/deploy/docker-compose.yml
"

echo "=== 4. RESTARTING CONTAINER WITH DOCKER COMPOSE ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  cd /opt/coderxp/deploy
  docker compose up -d --remove-orphans
"

echo "=== 5. WAITING FOR CONTAINER HEALTHCHECK ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  for i in {1..30}; do
    STATUS=\$(docker inspect --format='{{.State.Health.Status}}' coderxp-app 2>/dev/null || echo 'starting')
    echo \"Healthcheck attempt \$i: \$STATUS\"
    if [ \"\$STATUS\" = \"healthy\" ]; then
      echo 'Container is healthy!'
      break
    fi
    sleep 2
  done
"

echo "=== 6. POST-DEPLOY VERIFICATION (COOP/COEP, HEALTH, BYOK, SMOKE, ISOLATION) ==="
ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$TMP_KEY" root@31.70.107.44 "
  echo '--- Health Endpoint ---'
  curl -s -i http://127.0.0.1:3100/api/agent/health
  echo ''
  echo '--- BYOK API Route Check ---'
  curl -s -i http://127.0.0.1:3100/api/agent/byok
  echo ''
  echo '--- COOP / COEP Headers on /workspace ---'
  curl -s -I http://127.0.0.1:3100/workspace | grep -iE 'cross-origin|vary'
  echo ''
  echo '--- Live SSE Stream Smoke Test (\"hi\") ---'
  curl -s -N -X POST http://127.0.0.1:3100/api/agent/stream \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -d '{
      \"runId\": \"run-v23-1\",
      \"turnId\": \"turn-v23-1\",
      \"requestId\": \"req-v23-1\",
      \"projectId\": \"proj-v23-1\",
      \"generation\": 1,
      \"messages\": [
        {
          \"id\": \"msg-1\",
          \"role\": \"user\",
          \"parts\": [
            { \"type\": \"text\", \"text\": \"hi\" }
          ],
          \"timestamp\": 1700000000000
        }
      ],
      \"tools\": []
    }' \
    --max-time 15
  echo ''
  echo '--- CineDrama Isolation Confirmation ---'
  systemctl is-active cinedrama-web.service
  ss -ltnp | grep ':3000'
"

rm -f "$TMP_KEY"
echo "=== V2.3 PRODUCTION DEPLOYMENT FINISHED ==="
