#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
PLAIN='\033[0m'

echo -e "${GREEN}Starting VPS Auto-Installer Web Panel Setup...${PLAIN}"

# 1. Install Node.js & Dependencies
echo -e "${YELLOW}[1/4] Installing Node.js & System Dependencies...${PLAIN}"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs git unzip curl

# 2. Setup Application Directory
echo -e "${YELLOW}[2/4] Setting up Application...${PLAIN}"
mkdir -p /opt/vps-installer
cd /opt/vps-installer

# Clone or Download Repo (Simulated here by assuming files are present or cloning)
# In real scenario: git clone https://github.com/2026musik-code/autoscrip.git .
# For now, we assume this script is run inside the repo or we clone it.
if [ -d ".git" ]; then
    echo "Updating existing repository..."
    git pull
else
    echo "Cloning repository..."
    git clone https://github.com/2026musik-code/autoscrip.git .
fi

# Install Node Modules
npm install

# 3. Configure Environment
echo -e "${YELLOW}[3/4] Configuring Environment...${PLAIN}"
ADMIN_KEY=$(openssl rand -base64 12)
ENCRYPTION_KEY=$(openssl rand -base64 32)

cat > .env <<EOF
PORT=3000
ADMIN_KEY=$ADMIN_KEY
ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF

# 4. Start with PM2
echo -e "${YELLOW}[4/4] Starting Server...${PLAIN}"
npm install -g pm2
pm2 stop vps-installer 2>/dev/null
pm2 start server.js --name vps-installer
pm2 save
pm2 startup | bash > /dev/null 2>&1

# Get Public IP
IP=$(curl -s http://checkip.amazonaws.com)

echo -e "${GREEN}==========================================${PLAIN}"
echo -e "${GREEN}       INSTALLATION COMPLETE!             ${PLAIN}"
echo -e "${GREEN}==========================================${PLAIN}"
echo -e "Web Panel URL : http://$IP:3000"
echo -e "Admin Key     : $ADMIN_KEY"
echo -e "=========================================="
echo -e "${YELLOW}SAVE THIS KEY! You will need it to login.${PLAIN}"
