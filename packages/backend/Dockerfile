# Сборка из корня репозитория: docker build -f packages/backend/Dockerfile -t beeline-resize-backend .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/plugin/package.json packages/plugin/
RUN npm ci --workspace @beeline-resize/backend --include-workspace-root
COPY packages/shared packages/shared
COPY packages/backend packages/backend
RUN npm run build -w @beeline-resize/backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/packages/backend/dist ./dist
RUN npm install --omit=dev --no-save fastify@^5.6.0 zod@^4.1.0
COPY config ./config
ENV CONFIG_DIR=/app/config
EXPOSE 8787
CMD ["node", "dist/index.mjs"]
