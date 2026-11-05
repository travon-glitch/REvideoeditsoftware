# Listing Video Studio — background workers (everything that can't run on Vercel), in one container:
# render worker (Chrome + FFmpeg), AI worker (depth camera moves, generative clips) and the voice service.
#
#   docker build -f deploy/worker.Dockerfile -t lvs-workers .
#   docker run --env-file workers.env -p 8790:8790 lvs-workers
#
# Settings (environment): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LVS_SECRETS_KEY,
# LVS_VOICE_SERVICE_SECRET, optional RENDER_WORKERS (default 1), AI_WORKER=0, PORT (voice service, default 8790).
FROM node:22-bookworm-slim

# FFmpeg, Google Chrome (H.264 support for AI clips in the renderer) and fonts
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg ffmpeg fonts-dejavu-core \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# install only what the workers need (the workspace manifests first, for layer caching)
COPY package.json package-lock.json ./
COPY packages/camera-presets/package.json packages/camera-presets/
COPY packages/fablecut-core/package.json packages/fablecut-core/
COPY packages/render-worker/package.json packages/render-worker/
COPY packages/ai-motion/package.json packages/ai-motion/
COPY packages/voice/package.json packages/voice/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund \
      -w @lvs/render-worker -w @lvs/ai-motion -w @lvs/voice -w @lvs/camera-presets -w @lvs/fablecut-core \
 && npm cache clean --force

COPY packages ./packages
COPY deploy ./deploy

# models: AI depth (MiDaS, MIT) and voice (Kokoro + Zipformer, Apache-2.0)
RUN node packages/ai-motion/scripts/fetch-model.mjs && node packages/voice/scripts/fetch-models.mjs

# run as a normal user; Chrome runs through the container wrapper (the container is the sandbox)
RUN useradd --create-home --uid 10001 lvs && chown -R lvs /app
USER lvs
ENV NODE_ENV=production LVS_CHROME_BIN=/usr/bin/google-chrome PORT=8790
EXPOSE 8790
CMD ["node", "deploy/start-workers.mjs"]
