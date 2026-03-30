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
    { model: "gemini-3-flash-preview", api: "v1beta" },
    { model: "gemini-3-pro-preview", api: "v1beta" },
    { model: "gemini-1.5-pro", api: "v1beta" },
    { model: "gemini-1.5-flash", api: "v1beta" },
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
    await say({ text: "Consultando guias e extraindo queries... 🧠", thread_ts: event.ts });
    
    const kb = await getConfluenceKnowledge();
    
    const fullPrompt = `
      PERSONA: Agente Digital Senior de N2 (Mentor Sênior de Integrações e Tech Support).
      CONTEXTO TÉCNICO (CONFLUENCE):
      ${kb}

      REGRAS DE RESPOSTA (OBRIGATÓRIAS - NÃO IGNORE):
      1. Seja DIRETO, técnico e use tom de autoridade sênior. Proibido saudações amigáveis.
      2. EXIBIÇÃO DE DADOS: Se houver URLs de instalação, caminhos de Admin (ex: /admin/v2/...), queries SQL ou IDs de Apps (ex: 4190) no contexto, você DEVE transcrevê-los integralmente. Não resuma processos se houver um atalho técnico disponível.
      3. PRIORIDADE TÉCNICA: Atalhos de URL para reinstalação, autorização de apps ou queries de banco têm prioridade máxima sobre manuais passo a passo.
      4. Use blocos de código Markdown (ex: \`\`\`sql ... \`\`\`) para queries e negrito para caminhos de URL.
      5. Se a solução envolver "forçar" ou "reinstalar", procure especificamente por links que contenham "/authorize" ou IDs de aplicativos.
      6. Limite a resposta estritamente ao questionamento técnico realizado.

      PERGUNTA DO ANALISTA:
      ${event.text}

      RESPOSTA SÊNIOR:
    `;
    
    const aiMessage = await generateWithFallback(fullPrompt);
    await say({ text: `*Willian Digital:* \n${aiMessage}`, thread_ts: event.ts });

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
