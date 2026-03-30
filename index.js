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

// Inicializa o Gemini (Usando 1.5-flash para maior estabilidade e velocidade)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const confluenceBaseUrl = "https://tiendanube.atlassian.net/wiki/api/v2";
const auth = {
  username: process.env.ATLASSIAN_EMAIL,
  password: process.env.ATLASSIAN_TOKEN
};

// --- 2. FUNÇÃO RAG (BUSCA NO CONFLUENCE) ---

async function getConfluenceKnowledge() {
  const rootIds = ['443941204', '443941286']; // Integrações e Operações
  let contextBuffer = "";

  try {
    for (const id of rootIds) {
      // Busca a página principal com o corpo do texto
      const response = await axios.get(`${confluenceBaseUrl}/pages/${id}?body-format=storage`, { auth });
      contextBuffer += `\n--- DOCUMENTO: ${response.data.title} ---\n`;
      contextBuffer += response.data.body.storage.value + "\n";

      // Busca os títulos das subpáginas para contexto
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
    // Feedback visual imediato
    await say({ text: "Processando sua dúvida com a base sênior... 🧠", thread_ts: event.ts });

    // 1. Extrai o conhecimento atualizado
    const knowledgeBase = await getConfluenceKnowledge();

    // 2. Monta o Prompt de Personalidade Sênior
    const prompt = `
Você é o Gêmeo Digital do Willian Lemos, atuando como Mentor de Integrações Sênior para o time de N2 da Tiendanube/Nuvemshop.

### DIRETRIZES DE PERSONALIDADE:
- **Tom:** Técnico, autoritário (sênior), porém prestativo. Direto ao ponto.
- **Citação:** Sempre mencione o nome da seção do Confluence de onde veio a info.

### REGRAS DE OURO (STRICT FIDELITY):
1. **Fidelidade ao Contexto:** Use APENAS o contexto abaixo. Não invente.
2. **Tratamento de Lacunas:** Se não estiver no texto, diga: "Não localizei esse processo específico nos manuais de Integração/Operações da base [IA]. Valide com o Willian Lemos."
3. **Proibição de Alucinação:** Não invente URLs ou Endpoints de API.

### ESTRUTURA DA RESPOSTA:
1. **Resumo Direto:** Uma frase com a solução.
2. **Passo a Passo:** Explicação técnica baseada nos manuais.
3. **Referências:** Nome do manual consultado.

CONTEXTO TÉCNICO (CONFLUENCE):
${knowledgeBase}

PERGUNTA DO ANALISTA:
${event.text}
    `;

    // 3. Chama o Gemini
    const result = await model.generateContent(prompt);
    const aiMessage = result.response.text();

    // 4. Responde na thread
    await say({
      text: `*Willian Digital:* \n${aiMessage}`,
      thread_ts: event.ts
    });

  } catch (error) {
    console.error("Erro no processamento:", error);
    await say({ 
      text: "Tive um soluço técnico ao acessar