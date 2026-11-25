# The ERP's web pages on the production server: the Next.js production build (docker-compose.prod.yml;
# knowledge base: PROJECTS/ERP/hosting_design.md).
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API's address is built into the pages: the server's own address (same site, through Caddy).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Hosts with separate addresses for the pages and the API (Render): the API's address, to which the pages forward
# /api/… (next.config.ts). Read when the pages are built, so it must be known here; empty behind Caddy.
ARG API_PROXY_URL
ENV API_PROXY_URL=${API_PROXY_URL}
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ARG API_PROXY_URL
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    API_PROXY_URL=${API_PROXY_URL}
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
