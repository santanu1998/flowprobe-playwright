# Pinned to the Playwright image whose browser build matches the installed @playwright/test,
# so a container run and a laptop run exercise the same engines.
FROM mcr.microsoft.com/playwright:v1.64.0-jammy

WORKDIR /suite

# Dependency layer first: day-to-day builds reuse it instead of reinstalling every time.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV CI=true \
    FLOWPROBE_TEST_MODE=1 \
    PORT=4173

# The suite boots the application itself, so the container needs nothing else to run.
ENTRYPOINT ["npx", "playwright", "test"]
CMD ["--project=api", "--project=chromium"]
