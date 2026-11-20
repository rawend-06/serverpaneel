# ---- stap 1: pakketten installeren (met bouwgereedschap voor de terminal, node-pty)
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++ linux-headers
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm_config_nodedir=/usr/local npm ci --omit=dev && npm cache clean --force

# ---- stap 2: het paneel zelf
FROM node:22-alpine
# docker (sites beheren), rsync/unzip/git (bijwerken), util-linux-misc (nsenter: terminal + herstarten), python3 (agenda-dienst Radicale)
RUN apk add --no-cache docker-cli docker-cli-compose rsync unzip git tzdata util-linux-misc python3 py3-pip \
 && (pip install --no-cache-dir --break-system-packages "radicale>=3.2,<4" && radicale --version || echo "LET OP: Radicale kon niet geinstalleerd worden, de agenda werkt dan zonder gsm-sync")
ENV NODE_ENV=production TZ=Europe/Brussels
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app/package.json ./
COPY app/server.js app/metrics.js ./
COPY app/lib ./lib
COPY app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/me >/dev/null || exit 1
CMD ["node", "server.js"]
