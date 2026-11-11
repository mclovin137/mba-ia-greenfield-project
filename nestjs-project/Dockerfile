FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /home/node/app
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .
RUN mkdir -p /var/tmp/videos && chown node:node /var/tmp/videos /home/node/app
USER node
RUN npm run build
CMD ["node", "dist/main.js"]
