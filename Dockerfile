FROM node:20-alpine

WORKDIR /app

# Tiny healthcheck helper
RUN apk add --no-cache wget

# App source (see .dockerignore)
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY index.html style.css app.js data.js seat-entry.js ./
COPY maps ./maps

# Runtime dirs (DATA_DIR mounted over /app/data in compose)
RUN mkdir -p /app/data /app/maps \
 && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
