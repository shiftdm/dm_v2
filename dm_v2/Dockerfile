# -------------------------
# 1️⃣ Base image
# -------------------------
FROM node:20-slim

# -------------------------
# 2️⃣ Install Chrome + VNC + Display deps
# -------------------------
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk1.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -------------------------
# 3️⃣ Display environment
# -------------------------
ENV DISPLAY=:99

# -------------------------
# 4️⃣ Set working directory
# -------------------------
WORKDIR /app

# -------------------------
# 5️⃣ Copy package files & install deps
# -------------------------
COPY package*.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# -------------------------
# 6️⃣ Install Chrome via Puppeteer
# -------------------------
RUN npx puppeteer browsers install chrome

# Ruta fija para Chrome (symlink evita depender de versión exacta)
RUN CHROME_DIR=$(ls -d /root/.cache/puppeteer/chrome/linux-* 2>/dev/null | head -1) && \
    ln -sf "$CHROME_DIR/chrome-linux64/chrome" /opt/puppeteer-chrome

# -------------------------
# 7️⃣ Copy project files
# -------------------------
COPY . .

# -------------------------
# 8️⃣ Puppeteer env config
# -------------------------
ENV PUPPETEER_EXECUTABLE_PATH=/opt/puppeteer-chrome \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production

# -------------------------
# 9️⃣ Expose ports
# -------------------------
# 3001 → your API
# 6080 → noVNC (browser access)
EXPOSE 3001 6080

# -------------------------
# 🔟 Start everything
# -------------------------
CMD bash -c '\
Xvfb :99 -screen 0 1366x768x24 -ac & \
sleep 2; \
x11vnc -display :99 -rfbport 5900 -nopw -forever -shared & \
sleep 2; \
websockify --web=/usr/share/novnc/ 6080 localhost:5900 & \
pnpm start & \
wait -n'
