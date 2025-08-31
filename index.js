

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const axios = require('axios');              // <— NOVO
const mime = require('mime-types');          // <— NOVO
const crypto = require('crypto');            // <— NOVO
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
require('dotenv').config();

const TEMPO_ENVIO =
  Number(process.env.TEMPO_ENVIO_MS) > 0 ? Number(process.env.TEMPO_ENVIO_MS) : 12 * 60 * 1000;

const JSON_PATH = process.env.JSON_PATH || './mensagens.json';
const GROUP_ID_ENV = process.env.GROUP_ID || '';
const GROUP_NAME_ENV = process.env.GROUP_NAME || '';
const HIST_PATH = process.env.HIST_PATH || './.enviados.json';  // <— NOVO
const HIST_LIMIT = Number(process.env.HIST_LIMIT || 30);         // <— NOVO

/* ------------- util: histórico anti-duplicado ------------- */
function loadHist() {
  try {
    return JSON.parse(fs.readFileSync(HIST_PATH, 'utf8'));
  } catch { return []; }
}
function saveHist(list) {
  try {
    fs.writeFileSync(HIST_PATH, JSON.stringify(list.slice(-HIST_LIMIT), null, 2), 'utf8');
  } catch {}
}
function hashMsg(obj) {
  const base = `${obj.nome || ''}|${obj.link || ''}|${obj.caminho || obj.imagem || ''}`;
  return crypto.createHash('md5').update(base).digest('hex');
}

/* ------------- carregar/normalizar JSON (igual você já tinha) ------------- */
// ... (mantenha suas funções carregarEstrutura/salvarEstrutura/normalizarUrlImagem/variantesImgur
// e helpers de preço/montarLegenda — não mudam)

/* ------------- baixar imagem (fix Imgur) ------------- */
async function baixarComoMedia(url) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Safari/537.36' }
  });
  const mimetype = resp.headers['content-type'] || mime.lookup(url) || 'image/jpeg';
  const b64 = Buffer.from(resp.data).toString('base64');
  const filename = path.basename(url.split('?')[0]) || 'foto.jpg';
  return new MessageMedia(mimetype, b64, filename);
}

/* ------------- escolha sem repetição imediata ------------- */
function sortearSemRepetir(estrutura) {
  const hist = loadHist();
  const usados = new Set(hist);

  // prioriza “prioridade”, consumindo do arquivo
  if (estrutura.prioridade.length > 0) {
    // tenta achar um prioritário que não esteja no hist
    let idxs = estrutura.prioridade.map((_, i) => i);
    for (let tent = 0; tent < idxs.length; tent++) {
      const i = idxs.splice(Math.floor(Math.random() * idxs.length), 1)[0];
      const cand = estrutura.prioridade[i];
      const h = hashMsg(cand);
      if (!usados.has(h) || idxs.length === 0) {
        estrutura.prioridade.splice(i, 1);       // consome!
        saveHist([...hist, h]);                   // atualiza histórico
        return cand;
      }
    }
  }

  // senão, sorteia da geral evitando repetição recente
  if (estrutura.geral.length > 0) {
    // tenta até 20 vezes achar algo fora do hist
    for (let t = 0; t < 20; t++) {
      const cand = estrutura.geral[Math.floor(Math.random() * estrutura.geral.length)];
      const h = hashMsg(cand);
      if (!usados.has(h) || t === 19) {
        saveHist([...hist, h]);
        return cand;
      }
    }
  }

  return null;
}

/* ------------- envio ------------- */
async function enviarMensagem() {
  if (!TARGET_CHAT_ID) {
    await resolverDestino();
    if (!TARGET_CHAT_ID) return;
  }

  const estrutura = carregarEstrutura();
  if (estrutura._alterado) salvarEstrutura(estrutura);

  const m = sortearSemRepetir(estrutura);          // <— usa a nova função
  if (!m) {
    console.warn('⚠️ Sem produtos disponíveis.');
    return;
  }

  const caption = montarLegenda(m);
  const original = (m.caminho || m.imagem || '').trim();
  const norm = normalizarUrlImagem(original);

  if (original && norm.ok) {
    const tentativas = variantesImgur(norm.url);
    for (let i = 0; i < tentativas.length; i++) {
      try {
        // ↓ baixa e envia como base64 (resolve “imgur não carrega”)
        const media = await baixarComoMedia(tentativas[i]);
        await client.sendMessage(TARGET_CHAT_ID, media, { caption });
        console.log(`✅ Foto enviada (tentativa ${i + 1}): ${tentativas[i]}`);
        return;
      } catch (e) {
        console.warn(`⚠️ Falha imagem tentativa ${i + 1}: ${e?.message || e}`);
        if (i === tentativas.length - 1) {
          await client.sendMessage(TARGET_CHAT_ID, caption);
          console.log('ℹ️ Fallback: enviado apenas texto.');
        }
      }
    }
  } else {
    if (original && !norm.ok) {
      console.warn(`⚠️ Ignorando imagem inválida: ${norm.motivo} | URL: ${original}`);
    }
    await client.sendMessage(TARGET_CHAT_ID, caption);
    console.log('✅ Mensagem (texto) enviada.');
  }
}