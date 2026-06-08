const { App } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

// --- 1. SETUP SLACK ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

// --- 2. ANTHROPIC SETUP ---
const anthropic = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateWithFallback(prompt) {
  const modelsToTry = [
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
  ];

  for (const model of modelsToTry) {
    try {
      console.log(`🔍 Tentando: ${model}...`);
      const message = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      });
      return message.content[0].text;
    } catch (error) {
      console.error(`❌ Falhou ${model}: ${error.message}`);
      if (model === modelsToTry[modelsToTry.length - 1]) throw error;
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
      const rootRes = await axios.get(`https://tiendanube.atlassian.net/wiki/api/v2/pages/${id}?body-format=storage`, { auth });
      contextBuffer += `\n--- DOC PAI: ${rootRes.data.title} ---\n${rootRes.data.body.storage.value}\n`;

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
    await say({ text: `*Agente:* \n${aiMessage}`, thread_ts: event.ts });

  } catch (err) {
    console.error("Erro Crítico:", err);
    await say({ text: "❌ Falha na comunicação com a API. Verifique os logs.", thread_ts: event.ts });
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
    console.log('⚡️ Agente inicializado com Anthropic!');
  } catch (e) {
    console.error("Falha no Start:", e);
  }
})();
