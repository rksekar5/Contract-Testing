FROM node:20-slim

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev && npm install tsx@^4.16.0

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001
ENV PORT=3001

CMD ["npx", "tsx", "src/index.ts"]
