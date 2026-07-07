FROM node:20-alpine

# Install dumb-init for proper signal handling (SIGTERM → graceful shutdown)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install dependencies first (layer cache — only re-runs if package.json changes)
COPY package.json ./
RUN npm install --omit=dev

# Copy source files
COPY . .

# Koyeb injects PORT automatically — don't hardcode it
EXPOSE 8000

# Use dumb-init so SIGTERM is forwarded correctly to node and child bots
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "deployer-server.js"]
