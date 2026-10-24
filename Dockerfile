FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm ci --prefix collector --omit=dev --ignore-scripts

FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DLAR_DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/collector ./collector
COPY package.json ./
COPY src/draft.js src/stats.js src/workspace-model.js src/analytics.js src/heroes.json ./src/
CMD ["node", "collector/cloud-server.mjs"]
