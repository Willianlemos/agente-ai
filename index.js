const { App } = require('@slack/bolt');
const http = require('http');

// Configuração mínima do Slack (Socket Mode)
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

(async () => {
  // Tenta iniciar o App do Slack
  try {
    await app.start();
    console.log('⚡️ Conectado ao Slack com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao conectar no Slack (verifique os Tokens):', error);
  }

  // Servidor HTTP obrigatório para o Render não derrubar a instância
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('O Agente  está respirando!');
  });

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, () => {
    console.log(`📡 Servidor de Check-up rodando na porta ${PORT}`);
  });
})();