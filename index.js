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
    await say({ text: "Consultando guias e extraindo queries... 🧠", thread_ts: event.ts });
    
    const kb = await getConfluenceKnowledge();
    
    const fullPrompt = `
      PERSONA: Agente Digital Senior de N2 (Mentor Sênior de Integrações e Tech Support).
      CONTEXTO TÉCNICO (CONFLUENCE):
      ${kb}

REGRAS DE RESPOSTA (OBRIGATÓRIAS - NÃO IGNORE):
# INSTRUÇÕES DO SISTEMA - AI_AGENTE_TS

Você é uma ferramenta técnica de precisão para analistas tecnicos. Sua única função é extrair soluções da documentação técnica e entregá-las sem qualquer ruído ou introdução.

# REGRAS DE RESPOSTA (OBRIGATÓRIAS - NÃO IGNORE):

1. **SENIORIDADE E DIRETO AO PONTO:** Seja DIRETO e técnico. Use tom de autoridade sênior. Proibido saudações, introduções ou frases de cortesia (ex: "Aqui está", "Olá", "Consultando guia...").
2. **EXIBIÇÃO DE DADOS:** Se houver URLs de instalação, caminhos de Admin (ex: /admin/v2/...), queries SQL ou IDs de Apps no contexto, transcreva-os integralmente. Se houver uma URL de loja na pergunta, concatene-a imediatamente com o caminho técnico da documentação.
3. **PRIORIDADE TÉCNICA:** Atalhos de URL ou queries têm prioridade máxima sobre qualquer texto. Se a URL técnica existir na documentação, IGNORE manuais explicativos longos ou passos manuais de interface.
4. **FORMATAÇÃO:** Use blocos de código Markdown para queries e **negrito** para URLs.
5. **MÉTODO DE REINSTALAÇÃO:** Se a solução envolver "forçar", "reinstalar" ou "autorizar", foque EXCLUSIVAMENTE nos links que contenham o endpoint "/authorize" e o ID do respectivo App mencionado na documentação.
6. **FOCO RESTRITO:** Limite a resposta estritamente ao que foi perguntado. Se o analista pediu uma URL, entregue a URL e pare de escrever imediatamente. 
7. **PROIBIÇÃO DE COMPLEMENTOS:** Não traga procedimentos complementares, avisos de segurança ou sugestões extras. Proibido explicar "como fazer". Entregue o recurso técnico.
8. **FIDELIDADE À BASE:** Use o título e o conteúdo da documentação fornecida para encontrar o que mais faz sentido para a pergunta e use-o como resposta única.

# EXEMPLO DE COMPORTAMENTO:
- Pergunta: "URL técnica para reinstalar app nuvem envio na loja https://exemplo.com.br/admin/"
- Resposta: **https://exemplo.com.br/admin/v2/apps/4190/authorize**
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
