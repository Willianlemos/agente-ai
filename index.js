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

async function generateWithFallback(prompt) {
  const models = [
    "gemini-1.5-flash",
    "gemini-1.5-pro"
  ];

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];

    try {
      console.log(`🔍 Tentando modelo: ${modelName}`);

      const model = genAI.getGenerativeModel({
        model: modelName
      });

      const result = await model.generateContent(prompt);
      const response = result.response;

      return response.text();

    } catch (error) {
      console.error(`❌ Falhou ${modelName}: ${error.message}`);
      if (i === models.length - 1) throw error;
    }
  }
}

// --- 3. CONFLUENCE RAG ---
async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286'];
  let contextBuffer = "";

  const auth = {
    username: process.env.ATLASSIAN_EMAIL,
    password: process.env.ATLASSIAN_TOKEN
  };

  try {
    for (const id of rootIds) {

      // Página raiz
      const rootRes = await axios.get(
        `https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}?body-format=storage`,
        { auth, timeout: 5000 }
      );

      contextBuffer += `\n--- DOC PAI: ${rootRes.data.title} ---\n${rootRes.data.body.storage.value}\n`;

      // Filhas
      const childrenRes = await axios.get(
        `https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}/children`,
        { auth, timeout: 5000 }
      );

      for (const child of childrenRes.data.results) {

        const childContent = await axios.get(
          `https://tiendanube.atlassian.net/wiki/api/v2/pages/${child.id}?body-format=storage`,
          { auth, timeout: 5000 }
        );

        contextBuffer += `\n--- SUB-DOC: ${childContent.data.title} ---\n${childContent.data.body.storage.value}\n`;

        // 🔥 Limite de tamanho (evita estouro de token)
        if (contextBuffer.length > 15000) {
          return contextBuffer;
        }
      }
    }

    return contextBuffer;

  } catch (e) {
    console.error("Erro Confluence:", e.message);
    return "Nota: Base de conhecimento limitada.";
  }
}

// --- 4. EVENTO SLACK ---
app.event('app_mention', async ({ event, say }) => {
  try {
    const thread = event.thread_ts || event.ts;

    await say({
      text: "Deixe me ver se eu consigo te ajudar... 🧠",
      thread_ts: thread
    });

    const kb = await getConfluenceKnowledge();

    const fullPrompt = `
PERSONA: Agente Digital Senior de N2 (Mentor Sênior de Integrações e Tech Support).

CONTEXTO TÉCNICO (CONFLUENCE):
${kb}

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

    await say({
      text: `*Agente:*\n${aiMessage}`,
      thread_ts: thread
    });

  } catch (err) {
    console.error("Erro Crítico:", err);

    await say({
      text: "❌ Falha ao processar. Verifique os logs.",
      thread_ts: event.thread_ts || event.ts
    });
  }
});

// --- 5. HEALTH CHECK SERVER ---
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Agente Sênior Online ✅');
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`📡 Health-check na porta ${PORT}`);
});

// --- 6. START ---
(async () => {
  try {
    await app.start();
    console.log('⚡️ Agente inicializado com sucesso!');
  } catch (e) {
    console.error("Falha no Start:", e);
  }
})();
