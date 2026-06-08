const { App } = require('@slack/bolt');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// --- 1. SETUP SLACK ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

// --- 2. GEMINI SETUP (SCANNER UNIVERSAL) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateWithFallback(prompt) {
const configsToTry = [
    { model: "gemini-3-flash-preview", api: "v1beta" }, // Flash primeiro (mais cota)
    { model: "gemini-1.5-flash", api: "v1beta" },
    { model: "gemini-3-pro-preview", api: "v1beta" },   // Pro depois
    { model: "gemini-1.5-pro", api: "v1beta" },
    { model: "gemini-pro", api: "v1" }
  ];

  for (const config of configsToTry) {
    try {
      console.log(`🔍 Tentando: ${config.model} (${config.api})...`);
      const currentModel = genAI.getGenerativeModel(
        { model: config.model }, 
        { apiVersion: config.api }
      );
      
      const result = await currentModel.generateContent(prompt);
      const response = await result.response;
      return response.text();

    } catch (error) {
      console.error(`❌ Falhou ${config.model}: ${error.message}`);
      if (config === configsToTry[configsToTry.length - 1]) throw error;
    }
  }
}

// --- 3. CONFLUENCE RAG (BUSCA PROFUNDA) ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";
  const auth = { username: process.env.ATLASSIAN_EMAIL, password: process.env.ATLASSIAN_TOKEN };

  try {
    for (const id of rootIds) {
      // 1. Busca conteúdo da página Raiz
      const rootRes = await axios.get(`https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}?body-format=storage`, { auth });
      contextBuffer += `\n--- DOC PAI: ${rootRes.data.title} ---\n${rootRes.data.body.storage.value}\n`;

      // 2. Busca páginas filhas (onde geralmente ficam as queries específicas)
      const childrenRes = await axios.get(`https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}/children`, { auth });
      
      for (const child of childrenRes.data.results) {
        const childContent = await axios.get(`https://tiendanube.atlassian.net/wiki/api/v2/pages/${child.id}?body-format=storage`, { auth });
        contextBuffer += `\n--- SUB-DOC: ${childContent.data.title} ---\n${childContent.data.body.storage.value}\n`;
      }
    }
    return contextBuffer;
  } catch (e) { 
    console.error("Erro Confluence:", e.message);
    return "Nota: Base de conhecimento limitada. Tente ser específico no termo de busca."; 
  }
}

// --- 4. EVENTO SLACK COM EXTRAÇÃO TÉCNICA ---
app.event('app_mention', async ({ event, say }) => {
  try {
    await say({ text: "Deixe me ver se eu consigo te ajudar, só um instante.. 🧠", thread_ts: event.ts });
    
    const kb = await getConfluenceKnowledge();
    
const fullPrompt = `
PERSONA: Agente Digital Senior de N2 (Mentor Sênior de Integrações e Tech Support).

CONTEXTO TÉCNICO (CONFLUENCE):
${cleanKb}

# INSTRUÇÕES DO SISTEMA - AI_AGENTE_TS

Você é uma ferramenta de extração de dados técnicos. Sua função é converter perguntas de analistas em recursos acionáveis (URLs, Queries ou Comandos) baseando-se estritamente no contexto fornecido.

# REGRAS:

1. Se for saudação → "Pronto para extração. Informe a URL ou o erro."
2. Sem introdução ou explicação
3. Prioridade: URLs e Queries
4. Não inventar resposta
5. Se não encontrar: "ERRO: Procedimento não localizado na base técnica."
6. URLs em **negrito**
7. Queries em bloco de código

PERGUNTA:
${event.text}
`;
    
    const aiMessage = await generateWithFallback(fullPrompt);
    await say({ text: `*Agente:* \n${aiMessage}`, thread_ts: event.ts });

  } catch (err) {
    console.error("Erro Crítico:", err);
    await say({ text: "❌ Falha na comunicação com os modelos Gemini. Verifique os logs.", thread_ts: event.ts });
  }
});

// --- 5. SERVER & START ---
const server = http.createServer((req, res) => { 
  res.writeHead(200); 
  res.end('Agente Sênior Online ✅'); 
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`📡 Health-check na porta ${PORT}`);
});

(async () => {
  try {
    await app.start();
    console.log('⚡️ Agente inicializado com Busca Profunda!');
  } catch (e) {
    console.error("Falha no Start:", e);
  }
})();
