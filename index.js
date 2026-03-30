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

// --- 2. GEMINI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Função de Geração com Múltiplos Fallbacks (Resiliência Sênior)
async function generateWithFallback(prompt) {
  // Lista de modelos para tentar em sequência
  const modelsToTry = [
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-pro"
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`🤖 Tentando resposta com: ${modelName} (v1beta)...`);
      
      // ALTERAÇÃO CRUCIAL: v1beta para resolver o erro 404 da sua chave
      const currentModel = genAI.getGenerativeModel(
        { model: modelName }, 
        { apiVersion: 'v1beta' }
      );
      
      const result = await currentModel.generateContent(prompt);
      const response = await result.response;
      return response.text(); 

    } catch (error) {
      console.error(`⚠️ Falha no modelo ${modelName}:`, error.message);
      // Se for o último da lista e falhar, joga o erro para o catch principal
      if (modelName === "gemini-pro") throw error; 
      console.log("🔄 Tentando próximo modelo da lista...");
    }
  }
}

// --- 3. CONFLUENCE SETUP ---
const confluenceBaseUrl = "https://tiendanube.atlassian.net/wiki/api/v2";
const auth = {
  username: process.env.ATLASSIAN_EMAIL,
  password: process.env.ATLASSIAN_TOKEN
};

// --- 4. FUNÇÃO RAG (Busca de Conhecimento) ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";

  try {
    for (const id of rootIds) {
      const response = await axios.get(
        `${confluenceBaseUrl}/pages/${id}?body-format=storage`,
        { auth }
      );

      contextBuffer += `\n--- DOCUMENTO: ${response.data.title} ---\n`;
      contextBuffer += response.data.body.storage.value + "\n";

      const children = await axios.get(
        `${confluenceBaseUrl}/pages/${id}/children`,
        { auth }
      );

      const subTitles = children.data.results.map(c => c.title).join(", ");
      contextBuffer += `Tópicos: ${subTitles}\n`;
    }
    return contextBuffer;

  } catch (error) {
    console.error("Erro no Confluence:", error.message);
    return "Base de conhecimento indisponível no momento. Use seu conhecimento geral para ajudar.";
  }
}

// --- 5. EVENTO DO SLACK ---
app.event('app_mention', async ({ event, say }) => {
  try {
    await say({
      text: "Processando sua dúvida com a base sênior... 🧠",
      thread_ts: event.ts
    });

    const knowledgeBase = await getConfluenceKnowledge();

    const prompt = `
      Você é o Gêmeo Digital do Willian Lemos, Mentor Sênior de Integrações na Nuvemshop/Tiendanube.
      Responda de forma técnica, autoritária e prestativa para analistas N2.

      CONTEXTO DA BASE DE CONHECIMENTO:
      ${knowledgeBase}

      PERGUNTA DO USUÁRIO:
      ${event.text}
    `;

    const aiMessage = await generateWithFallback(prompt);

    await say({
      text: `*Willian Digital:*\n${aiMessage}`,
      thread_ts: event.ts
    });

  } catch (error) {
    console.error("Erro final no processamento:", error);
    await say({
      text: "❌ Erro crítico de comunicação com o cérebro AI (v1beta). Verifique os logs.",
      thread_ts: event.ts
    });
  }
});

// --- 6. SERVER (RENDER HEALTH CHECK) ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Agente Sênior Willian Online ✅');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`📡 Health-check rodando na porta ${PORT}`);
});

// --- 7. START DA APP ---
(async () => {
  try {
    await app.start();
    console.log('⚡️ Gêmeo Digital inicializado e conectado ao Slack!');
  } catch (e) {
    console.error("Falha ao iniciar o app:", e);
  }
})();
