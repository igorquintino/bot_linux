# Muleke das Promos — Bot WhatsApp (Linux Lite)

Envia uma oferta **a cada 5 minutos** no **grupo do WhatsApp**, consumindo primeiro as mensagens **prioritárias** e depois sorteando da lista **geral**. Suporta **imagens por URL** (Imgur direto `i.imgur.com/arquivo.jpg`, GitHub Raw, etc.).

## 1) Preparar Linux Lite
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl

sudo apt install -y chromium-browser chromium-codecs-ffmpeg libnss3 libatk1.0-0 \
libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxrandr2 libxdamage1 \
libgbm1 libasound2


cd ~
git clone <URL_DO_SEU_REPO_GITHUB> whatsapp-bot
cd whatsapp-bot
npm install

GROUP_NAME=Muleke das Promos 🔥
# OU use GROUP_ID se preferir (termina com @g.us)
# GROUP_ID=1234567890-123456789@g.us

# Opcional
# CHROMIUM_PATH=/usr/bin/chromium-browser
# TEMPO_ENVIO_MS=300000
JSON_PATH=./mensagens.json

npm run start

sudo npm install -g pm2

pm2 start index.js --name muleke-bot
pm2 save
pm2 startup
# siga a instrução que o PM2 imprimir (um comando sudo) e depois:
pm2 save

pm2 logs muleke-bot    # ver logs em tempo real
pm2 restart muleke-bot # reiniciar
pm2 stop muleke-bot    # parar
pm2 delete muleke-bot  # remover do PM2
