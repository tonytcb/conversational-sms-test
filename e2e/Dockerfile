# Optional: run the e2e suite in CI against an already-running stack.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /e2e
COPY package*.json ./
RUN npm install
COPY . .
# Point these at the stack (e.g. service DNS names) when running in CI.
CMD ["npm", "test"]
