FROM node:20-slim

WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

RUN mkdir -p /app/uploads

# Prisma generate en build: prisma-build.env (no está en .gitignore)
RUN cp prisma-build.env .env && npx prisma generate && rm .env

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]

