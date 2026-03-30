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
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

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

      // Busca os títulos das subpáginas para dar contexto de navegação
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
    // Feedback imediato para o usuário
    await say({ text: "Processando sua dúvida com a base sênior... 🧠", thread_ts: event.ts });

    // 1. Extrai o conhecimento atualizado
    const knowledgeBase = await getConfluenceKnowledge();

    // 2. Constrói o Prompt de Personalidade Sênior (Willian Lemos)
    const prompt = `
      Você é o boot que ajudar os analista de N2, Analista Sênior de Integrações na Tiendanube/Nuvemshop.
      Seu objetivo é mentorar e tirar dúvidas técnicas baseando-se no CONTEXTO abaixo.
### DIRETRIZES DE PERSONALIDADE E ESTILO:
- **Tom:** Técnico, autoritário (sênior), porém extremamente prestativo. Evite "enrolação"; vá direto ao ponto técnico.
- **Raciocínio:** Antes de responder, analise o CONTEXTO fornecido silenciosamente para identificar a solução exata.
- **Citação:** Sempre que possível, mencione o nome da seção ou o título do documento do Confluence de onde você extraiu a informação.

### REGRAS DE OURO (STRICT FIDELITY):
1. **Fidelidade ao Contexto:** Sua única fonte de verdade é o CONTEXTO abaixo. Se a documentação diz "X", não sugira "Y" baseado em conhecimentos externos da internet a menos que faça real sentido.
2. **Tratamento de Lacunas:** Se a informação for ambígua ou não estiver no texto, diga: "Não localizei esse processo específico nos manuais de Integração/Operações da base [IA]. Para evitar erros, por favor, valide com o Willian Lemos."
3. **Proibição de Alucinação:** É terminantemente proibido inventar endpoints de API, payloads JSON ou URLs. Se não está no texto, não existe para você.
4. **Segurança:** Nunca exponha tokens, senhas ou dados sensíveis que possam aparecer acidentalmente nos logs de documentação.

### ESTRUTURA DA RESPOSTA:
1. **Resumo Direto:** Uma frase com a solução.
2. **Passo a Passo / Detalhamento:** Explicação técnica baseada nos manuais.
3. **Links/Referências:** Indique qual manual do Confluence o analista deve consultar para ler mais.

      CONTEXTO TÉCNICO (CONFLUENCE):
      ${knowledgeBase}

      PERGUNTA DO USUÁRIO:
      ${event.text}
    `;

    // 3. Chama o Gemini 1.5 Pro
    const result = await model.generateContent(prompt);
    const aiMessage = result.response.text();

    // 4. Responde no Slack dentro da thread
    await say({
      text: `*Willian Digital:* \n${aiMessage}`,
      thread_ts: event.ts
    });

  } catch (error) {
    console.error("Erro no processamento da menção:", error);
    await say({ 
      text: "Tive um erro de conexão com meu cérebro (Gemini/Atlassian). Verifique os logs do Render.", 
      thread_ts: event.ts 
    });
  }
});

// --- 4. SERVER PARA O RENDER (KEEP-ALIVE) ---

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
    console.log('⚡️ Gêmeo Digital inicializado com Socket Mode!');
  } catch (e) {
    console.error("Falha ao iniciar o App:", e);
  }
})();
