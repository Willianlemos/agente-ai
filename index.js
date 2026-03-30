const { App } = require('@slack/bolt');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const http = require('http');
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- FUNÇÃO DE GERAÇÃO COM BUSCA EXAUSTIVA ---
async function generateWithFallback(prompt) {
  // Matriz de teste: Modelos vs Versões de API
const configsToTry = [
    { model: "gemini-3-flash-preview", api: "v1beta" }, // O que aparece no seu print!
    { model: "gemini-3-pro-preview", api: "v1beta" },
    { model: "gemini-1.5-pro", api: "v1beta" },
    { model: "gemini-1.5-flash", api: "v1beta" },
    { model: "gemini-pro", api: "v1" }
  ];

  for (const config of configsToTry) {
    try {
      console.log(`🔍 Testando: ${config.model} na porta ${config.api}...`);
      
      const currentModel = genAI.getGenerativeModel(
        { model: config.model }, 
        { apiVersion: config.api }
      );
      
      const result = await currentModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ SUCESSO! Usando ${config.model} (${config.api})`);
      return text;

    } catch (error) {
      console.error(`❌ Falhou: ${config.model}/${config.api} -> ${error.message}`);
      // Se for a última tentativa da lista e falhar, explode o erro
      if (config === configsToTry[configsToTry.length - 1]) throw error;
      console.log("🔄 Tentando próxima combinação...");
    }
  }
}

// --- CONFLUENCE RAG ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";
  try {
    for (const id of rootIds) {
      const response = await axios.get(`https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}?body-format=storage`, {
        auth: { username: process.env.ATLASSIAN_EMAIL, password: process.env.ATLASSIAN_TOKEN }
      });
      contextBuffer += `\n--- DOC: ${response.data.title} ---\n${response.data.body.storage.value}\n`;
    }
    return contextBuffer;
  } catch (e) { return "Conhecimento base indisponível."; }
}

// --- EVENTO SLACK ---
app.event('app_mention', async ({ event, say }) => {
  try {
    await say({ text: "Consultando todos os meus modelos cerebrais... 🧠", thread_ts: event.ts });
    const kb = await getConfluenceKnowledge();
    const fullPrompt = `Você é o Gêmeo Digital do Willian Lemos. Contexto: ${kb}. Pergunta: ${event.text}`;
    
    const aiMessage = await generateWithFallback(fullPrompt);
    await say({ text: `*Willian Digital:*\n${aiMessage}`, thread_ts: event.ts });
  } catch (err) {
    await say({ text: "❌ Erro: Nenhum modelo Gemini respondeu nesta conta.", thread_ts: event.ts });
  }
});

// --- SERVER & START ---
const server = http.createServer((req, res) => { res.writeHead(200); res.end('Online ✅'); });
server.listen(process.env.PORT || 10000);

(async () => {
  await app.start();
  console.log('⚡️ Agente Sênior em modo de Varredura Total inicializado!');
})();
