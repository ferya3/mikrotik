# Build context: repository root  (docker build -f apps/web/Dockerfile .)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --no-audit --no-fund
COPY apps/web apps/web
# Production: browser talks to the same origin; Nginx routes /api (and the WebSocket) to the API.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
