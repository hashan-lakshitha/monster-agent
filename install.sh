#!/bin/bash

# MONSTER AGENT - Kali Linux Auto Installer

echo -e "\e[31m[!] Installing MONSTER-AI Agent...\e[0m"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "\e[33m[*] Please run with sudo\e[0m"
  exit
fi

# Install dependencies
echo -e "\e[36m[*] Installing dependencies...\e[0m"
npm install

# Create wrapper
INSTALL_DIR=$(pwd)
echo -e "\e[36m[*] Creating executable...\e[0m"

cat <<EOF > /usr/local/bin/monster
#!/bin/bash
cd "$INSTALL_DIR" || exit
npx tsx src/index.tsx "\$@"
EOF

# Set permissions
chmod +x /usr/local/bin/monster

echo -e "\e[32m[+] Complete! Type 'monster' to run.\e[0m"
