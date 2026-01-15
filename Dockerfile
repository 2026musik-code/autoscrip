FROM node:18-alpine

WORKDIR /app

# Install SSH client for local testing if needed, though app uses ssh2 lib
RUN apk add --no-cache openssh-client

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
