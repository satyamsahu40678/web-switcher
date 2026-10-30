FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production ONLINE_BIND=0.0.0.0 ONLINE_PORT=8082 ONLINE_DATABASE_PATH=/var/lib/web-switcher-discovery/state.sqlite
RUN mkdir -p /var/lib/web-switcher-discovery && chown node:node /var/lib/web-switcher-discovery && chmod 700 /var/lib/web-switcher-discovery
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node online-discovery/package.json online-discovery/server.mjs online-discovery/store.mjs online-discovery/runner.mjs online-discovery/providers.mjs online-discovery/backup.mjs ./online-discovery/
COPY --chown=node:node extension/core.js extension/continuity.js extension/continuity-probe.js extension/internet-contract.js extension/internet-sources.js ./extension/
COPY --chown=node:node extension/security/catalog.mjs ./extension/security/catalog.mjs
COPY --chown=node:node packages/security/catalog.mjs ./packages/security/catalog.mjs
USER node
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "require('node:http').get('http://127.0.0.1:8082/health/live',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "online-discovery/server.mjs"]
