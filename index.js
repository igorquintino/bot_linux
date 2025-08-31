// index.js
/*
 * Bot WhatsApp - envia ofertas de mensagens.json para um grupo
 * - Corrige preços (vírgula/ponto) na legenda
 * - Prioriza "prioridade" e consome (remove) após enviar
 * - Evita repetir o mesmo item duas vezes seguidas
 * - Baixa imagens do Imgur/URL com headers reais para evitar 403
 */

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const mime = require('mime-types');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
require('dotenv').config();

/* ========================= Config ========================= */
const TEMPO_ENVIO =
  Number(process.env.TEMPO_ENVIO_MS) > 0 ? Number(process.env.TEMPO_ENVIO_MS) : 5 * 60 * 1000;

const JSON_PATH = process.env.JSON_PATH || './mensagens.json';
const GROUP_ID_ENV = process.env.GROUP_ID || '';
const GROUP_NAME_ENV = process.env.GROUP_NAME || '';

/* Chromium path (Linux/Windows) */
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}
const chromiumPath = findChromium();
if (chromiumPath) {
  console.log('🧭 Chromium/Chrome encontrado em:', chromiumPath);
} else {
  console.log('ℹ️ Sem CHROMIUM_PATH definido/encontrado — o puppeteer pode tentar baixar um Chromium.');
}

/* =================== JSON: carregar / salvar =================== */
function carregarEstrutura() {
  try {
    const raw = fs.readFileSync(JSON_PATH, 'utf8');
    const json = JSON.parse(raw);

    // Array simples? Vira {geral: [...], prioridade:[]}
    if (Array.isArray(json)) {
      return { geral: json, prioridade: [], _alterado: false };
    }

    const estrutura = {
      geral: Array.isArray(json.geral) ? json.geral : [],
      prioridade: Array.isArray(json.prioridade) ? json.prioridade : [],
      _alterado: false
    };

    // Merge de "prioritarios" -> "prioridade"
    if (Array.isArray(json.prioritarios) && json.prioritarios.length > 0) {
      estrutura.prioridade = [...estrutura.prioridade, ...json.prioritarios];
      estrutura._alterado = true;
    }
    return estrutura;
  } catch (err) {
    console.error('❌ Erro ao carregar JSON de mensagens:', err.message);
    return { geral: [], prioridade: [], _alterado: false };
  }
}

function salvarEstrutura(estrutura) {
  try {
    const toSave = { geral: estrutura.geral, prioridade: estrutura.prioridade };
    fs.writeFileSync(JSON_PATH, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Erro ao salvar JSON:', err.message);
  }
}

/* =================== Sorteio/Consumo =================== */
let ultimoHash = ''; // evita repetição consecutiva

function sortearEConsumir(estrutura) {
  const pick = (arr, consume = false) => {
    if (!arr.length) return null;
    const startIdx = Math.floor(Math.random() * arr.length);
    for (let k = 0; k < arr.length; k++) {
      const i = (startIdx + k) % arr.length;
      const cand = arr[i];
      const h = hashDoItem(cand);
      if (h !== ultimoHash) {
        if (consume) arr.splice(i, 1);
        return cand;
      }
    }
    // se todos repetem, devolve o primeiro
    if (consume) return arr.splice(startIdx, 1)[0];
    return arr[startIdx];
  };

  // 1) prioriza "prioridade" e consome
  const prio = pick(estrutura.prioridade, true);
  if (prio) {
    salvarEstrutura(estrutura);
    console.log(`⭐ Prioritário enviado. Restam ${estrutura.prioridade.length}.`);
    return { item: prio, origem: 'prioridade' };
  }

  // 2) caso contrário pega da geral (não consome)
  const geral = pick(estrutura.geral, false);
  if (geral) return { item: geral, origem: 'geral' };

  return { item: null, origem: null };
}

function hashDoItem(p) {
  try {
    return JSON.stringify([p?.nome, p?.preco, p?.preco_desconto, p?.link, p?.caminho || p?.imagem]);
  } catch {
    return String(Math.random());
  }
}

/* =================== Preço / Texto =================== */
const S = (v) => (v ?? '').toString().trim();

function extrairNumeroPreco(str) {
  if (!str) return null;
  let s = String(str)
    .replace(/\s+/g, ' ')
    .replace(/R\$\s*/gi, '')
    .replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function ehPreco(str) {
  return extrairNumeroPreco(str) !== null;
}
function fmtBR(n) {
  try {
    return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return `R$ ${n}`;
  }
}
function normalizarRotuloPreco(str) {
  if (!str) return '';
  const n = extrairNumeroPreco(str);
  if (n === null) return S(str);
  return fmtBR(n);
}

function montarLegenda(p) {
  const nome = S(p.nome);
  const precoRaw = S(p.preco);
  const precoDescRaw = S(p.preco_desconto);
  const link = S(p.link);
  const frete = S(p.frete_gratis);

  const temPreco = ehPreco(precoRaw);
  const temDesc = ehPreco(precoDescRaw);

  const preco = temPreco ? normalizarRotuloPreco(precoRaw) : S(precoRaw);
  const precoDesc = temDesc ? normalizarRotuloPreco(precoDescRaw) : S(precoDescRaw);

  const fraseFrete =
    (frete === 'Sim' || frete === 'TRUE' || frete === 'true' || frete === 'Frete Grátis' || p.frete_gratis === true)
      ? '🚚 Frete Grátis' : '';

  const linhas = [];
  if (nome) linhas.push(`🏷️ *${nome}*`);

  if (temPreco && temDesc) {
    linhas.push(`~${preco}~`);
    linhas.push(`💸 Agora por: *${precoDesc}*`);
  } else if (temPreco && precoDesc && !temDesc) {
    linhas.push(`${preco}`);
    linhas.push(precoDesc);
  } else if (temPreco && !precoDesc) {
    linhas.push(`${preco}`);
  } else if (!temPreco && temDesc) {
    linhas.push(`💸 Agora por: *${precoDesc}*`);
  } else {
    if (preco) linhas.push(preco);
    if (precoDesc) linhas.push(preco ? precoDesc : `${precoDesc}`);
  }

  if (fraseFrete) linhas.push(fraseFrete);
  if (link) linhas.push(`👉 ${link}`);

  return linhas.filter(Boolean).join('\n');
}

/* =================== Imagem =================== */
function normalizarUrlImagem(url) {
  if (!url || typeof url !== 'string') return { ok: false, url: null, motivo: 'URL vazia' };
  let u = url.trim().replace(/^\.+/, '');
  u = u.replace('https://raw.github.com/', 'https://raw.githubusercontent.com/');
  if (u.includes('imgur.com/a/') || u.includes('imgur.com/gallery/')) {
    return { ok: false, url: null, motivo: 'Imgur em álbum/página (use i.imgur.com/arquivo.jpg)' };
  }
  if (u.includes('://imgur.com/') && !u.includes('://i.imgur.com/')) {
    return { ok: false, url: null, motivo: 'Imgur não direto (use i.imgur.com/ARQUIVO.jpg)' };
  }
  return { ok: true, url: u };
}

function variantesImgur(url) {
  if (!url || !url.includes('i.imgur.com')) return [url];
  const semQuery = url.split('?')[0];
  const base = semQuery.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
  return [url, `${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`];
}

// Download com headers reais (fix para Imgur/403)
async function baixarMediaComoMessageMedia(url) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Referer': 'https://imgur.com/',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  const resp = await axios.get(url, { responseType: 'arraybuffer', headers, maxRedirects: 5 });

  let contentType = resp.headers['content-type'];
  if (!contentType || !contentType.startsWith('image/')) {
    const ext = (url.split('?')[0].match(/\.(jpg|jpeg|png|webp|gif)$/i) || ['.jpg'])[0];
    contentType = mime.lookup(ext) || 'image/jpeg';
  }

  const base64 = Buffer.from(resp.data).toString('base64');
  const filename =
    url.split('/').pop().split('?')[0] || `img.${mime.extension(contentType) || 'jpg'}`;
  return new MessageMedia(contentType, base64, filename);
}

/* =================== WhatsApp Client =================== */
let TARGET_CHAT_ID = ''; // definido ao iniciar

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.resolve('./.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    executablePath: chromiumPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('📱 Escaneie este QR no seu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('✅ WhatsApp pronto.');

  // se passou --list-groups, apenas lista e sai
  if (process.argv.includes('--list-groups')) {
    const chats = await client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    console.log('📋 Grupos encontrados:');
    groups.forEach((g) => console.log(' -', g.name, '->', g.id._serialized));
    process.exit(0);
  }

  await resolverDestino();
  await enviarMensagem();                // dispara já
  setInterval(enviarMensagem, TEMPO_ENVIO); // agenda
});

client.on('auth_failure', (m) => console.error('❌ Falha na autenticação:', m));
client.on('disconnected', (r) => console.error('❌ Desconectado:', r));

async function resolverDestino() {
  if (GROUP_ID_ENV) {
    TARGET_CHAT_ID = GROUP_ID_ENV.endsWith('@g.us') ? GROUP_ID_ENV : `${GROUP_ID_ENV}`;
    console.log('🎯 Usando GROUP_ID do .env =>', TARGET_CHAT_ID);
    return;
  }

  if (!GROUP_NAME_ENV) {
    console.error('⚠️ Defina GROUP_NAME ou GROUP_ID no .env para enviar ao grupo.');
    return;
  }

  try {
    const chats = await client.getChats();
    const groups = chats.filter((c) => c.isGroup);
    const exact = groups.find(
      (g) => (g.name || '').trim().toLowerCase() === GROUP_NAME_ENV.trim().toLowerCase()
    );
    const partial = groups.find((g) =>
      (g.name || '').toLowerCase().includes(GROUP_NAME_ENV.trim().toLowerCase())
    );
    const found = exact || partial;
    if (found) {
      TARGET_CHAT_ID = found.id._serialized;
      console.log('🎯 Grupo encontrado:', found.name, '->', TARGET_CHAT_ID);
    } else {
      console.error('❌ Grupo não encontrado pelo nome. Verifique GROUP_NAME no .env');
    }
  } catch (e) {
    console.error('❌ Erro ao buscar grupos:', e.message);
  }
}

/* =================== Envio principal =================== */
async function enviarMensagem() {
  if (!TARGET_CHAT_ID) {
    console.warn('⚠️ Sem TARGET_CHAT_ID ainda. Tentando resolver novamente...');
    await resolverDestino();
    if (!TARGET_CHAT_ID) return;
  }

  const estrutura = carregarEstrutura();
  if (estrutura._alterado) salvarEstrutura(estrutura);

  const { item: m, origem } = sortearEConsumir(estrutura);
  if (!m) {
    console.warn('⚠️ Sem produtos disponíveis.');
    return;
  }

  const caption = montarLegenda(m);
  const original = S(m.caminho) || S(m.imagem);
  const norm = normalizarUrlImagem(original);

  const hash = hashDoItem(m);
  ultimoHash = hash;

  if (original && norm.ok) {
    const tentativas = variantesImgur(norm.url);
    for (let i = 0; i < tentativas.length; i++) {
      try {
        const media = await baixarMediaComoMessageMedia(tentativas[i]);
        await client.sendMessage(TARGET_CHAT_ID, media, { caption });
        console.log(`✅ Foto enviada (${origem}) (tentativa ${i + 1}): ${tentativas[i]}`);
        return;
      } catch (e) {
        console.warn(
          `⚠️ Falha imagem tentativa ${i + 1}:`,
          e?.response?.status || '',
          e?.message || e
        );
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
    console.log(`✅ Mensagem (texto) enviada (${origem}).`);
  }
}

/* =================== Boot =================== */
console.log('🚀 Iniciando bot…');
client.initialize();