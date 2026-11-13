FROM node:24-alpine

RUN echo "os-refresh 2026-11-13" && apk upgrade --no-cache

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

COPY package.json ./
COPY server ./server
COPY assets ./assets
COPY index.html feed.html watch.html upload.html studio.html earnings.html admin.html live.html login.html signup.html ./

RUN mkdir -p /app/data/uploads && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["node", "server/index.js"]
