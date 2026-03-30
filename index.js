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
  // Lista prioritária baseada no seu acesso ao Gemini 3 Flash Preview
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

// --- 3. CONFLUENCE RAG (BUSCA TÉCNICA) ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";
  try {
    for (const id of rootIds) {
      const response = await axios.get(
        `https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}?body-format=storage`, 
        { auth: { username: process.env.ATLASSIAN_EMAIL, password: process.env.ATLASSIAN_TOKEN } }
      );
      contextBuffer += `\n--- DOC: ${response.data.title} ---\n${response.data.body.storage.value}\n`;
    }
    return contextBuffer;
  } catch (e) { 
    console.error("Erro Confluence:", e.message);
    return "Nota: Base de conhecimento do Confluence temporariamente indisponível."; 
  }
}

// --- 4. EVENTO SLACK COM PROMPT OBJETIVO N2 ---
app.event('app_mention', async ({ event, say }) => {
  try {
    await say({ text: "Analisando sua dúvida técnica... 🧠", thread_ts: event.ts });
    
    const kb = await getConfluenceKnowledge();
    
    // PROMPT ESTRUTURADO PARA ANALISTAS N2
    const fullPrompt = `
      PERSONA: Agente Digital Senior de N2 (Mentor Sênior de Integrações e Tech Support).
      PÚBLICO: Suporte N2 Nuvemshop/Tiendanube.
      CONTEXTO TÉCNICO (CONFLUENCE):
      ${kb}

      REGRAS DE RESPOSTA:
      1. Seja DIRETO, técnico e use tom de autoridade sênior.
      2. Priorize a documentação acima. Se não encontrar, use conhecimento geral citando a fonte se fizer sentido com algo encontrado na documentação Confluence.
      3. Use Markdown para endpoints (\`GET /exemplo\`) e códigos.
      4. Listas numeradas para procedimentos de troubleshooting.
      5. Evite saudações longas. Vá direto à solução.
      6. Deixar o resposta limitada ao questionamento quando perguntas de processos.
      

      PERGUNTA DO ANALISTA:
      ${event.text}

      RESPOSTA SÊNIOR:
    `;
    
    const aiMessage = await generateWithFallback(fullPrompt);
    await say({ text: `*Willian Digital:*\n${aiMessage}`, thread_ts: event.ts });

  } catch (err) {
    console.error("Erro Crítico:", err);
    await say({ text: "❌ Erro: Todos os modelos falharam. Verifique as cotas da API.", thread_ts: event.ts });
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
    console.log('⚡️ Agente inicializado com Prompt N2!');
  } catch (e) {
    console.error("Falha no Start:", e);
  }
})();
