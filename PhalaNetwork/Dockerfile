FROM node:22.22.1-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.1-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund && npm cache clean --force
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
