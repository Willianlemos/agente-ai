const { App } = require('@slack/bolt');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// --- 1. SETUP INICIAL ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const confluenceBaseUrl = "https://tiendanube.atlassian.net/wiki/api/v2";
const auth = {
  username: process.env.ATLASSIAN_EMAIL,
  password: process.env.ATLASSIAN_TOKEN
};

// --- 2. FUNÇÃO RAG (BUSCA NO CONFLUENCE) ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";
  try {
    for (const id of rootIds) {
      const response = await axios.get(`${confluenceBaseUrl}/pages/${id}?body-format=storage`, { auth });
      contextBuffer += `\n--- DOCUMENTO: ${response.data.title} ---\n`;
      contextBuffer += response.data.body.storage.value + "\n";
      const children = await axios.get(`${confluenceBaseUrl}/pages/${id}/children`, { auth });
      const subTitles = children.data.results.map(c => c.title).join(", ");
      contextBuffer += `Tópicos detalhados nesta seção: ${subTitles}\n`;
    }
    return contextBuffer;
  } catch (error) {
    console.error("Erro na leitura do Confluence:", error.message);
    return "Nota: Não foi possível acessar a base de conhecimento completa da Tiendanube agora.";
  }
}

// --- 3. FLUXO DO SLACK ---
app.event('app_mention', async ({ event, say }) => {
  try {
    await say({ text: "Processando sua dúvida com a base sênior... 🧠", thread_ts: event.ts });
    const knowledgeBase = await getConfluenceKnowledge();
    const prompt = `
      Você é o Gêmeo Digital do Willian Lemos, Mentor Sênior.
      CONTEXTO: ${knowledgeBase}
      PERGUNTA: ${event.text}
    `;
    const result = await model.generateContent(prompt);
    const aiMessage = result.response.text();
    await say({ text: `*Willian Digital:* \n${aiMessage}`, thread_ts: event.ts });
  } catch (error) {
    console.error("Erro no processamento:", error);
    await say({ text: "Tive um erro técnico. Verifique os logs.", thread_ts: event.ts });
  }
});

// --- 4. SERVER PARA O RENDER ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Agente Sênior Willian Online ✅');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`📡 Health-check rodando na porta ${PORT}`);
});

(async () => {
  try {
    await app.start();
    console.log('⚡️ Gêmeo Digital inicializado!');
  } catch (e) {
    console.error("Falha ao iniciar:", e);
  }
})();