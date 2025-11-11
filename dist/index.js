import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, jidNormalizedUser, } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
// Tempo para encerrar atendimento por inatividade (minutos)
const INACTIVITY_MINUTES = 5;
// Mapa: chave = número (remoteJid), valor = timeout de inatividade (NodeJS.Timeout)
const atendendo = new Map();
// Função auxiliar para determinar a saudação com base na hora atual
function saudacaoPorHora() {
    const hora = new Date().getHours();
    if (hora >= 0 && hora < 12)
        return "Bom dia";
    if (hora >= 12 && hora < 18)
        return "Boa tarde";
    return "Boa noite";
}
// Retorna o texto formatado do menu
function getMenuText() {
    return `
📋 *Menu Principal*

*1* - Orçamento
*2* - Solicitar Ligação/Contato
*3* - Dúvidas Gerais e Suporte
*4* - Pedido
*5* - Falar com um Atendente
`;
}
// --- FUNÇÃO DE EXTRAÇÃO DE TEXTO ---
/**
 * Função utilitária para extrair o texto de vários tipos de mensagens
 */
function getMessageText(message) {
    if (message.message?.conversation) {
        return message.message.conversation;
    }
    if (message.message?.extendedTextMessage?.text) {
        return message.message.extendedTextMessage.text;
    }
    if (message.message?.buttonsResponseMessage?.selectedDisplayText) {
        return message.message.buttonsResponseMessage.selectedDisplayText;
    }
    if (message.message?.listResponseMessage?.title) {
        // Se for uma resposta de lista
        return message.message.listResponseMessage.title;
    }
    if (message.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
        // Se for uma seleção de linha em uma lista
        return message.message.listResponseMessage.singleSelectReply.selectedRowId;
    }
    // Adicione outras verificações (e.g., listMessage, imageWithCaption) conforme necessário
    return "";
}
async function startBot() {
    // O 'auth_info' guarda a sessão de login. Mantenha esta pasta na raiz.
    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        syncFullHistory: false,
        // A propriedade incorreta 'is' foi removida.
        // O caching de sessão agora é padrão ou deve ser implementado de forma mais complexa.
        generateHighQualityLinkPreview: true,
    });
    // Salva as credenciais do login sempre que houver uma atualização
    sock.ev.on("creds.update", saveCreds);
    // Manipulador de eventos de conexão
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.clear();
            console.log("📲 Escaneie o QR abaixo para conectar:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === "close") {
            // Usamos 'Boom' para tipagem correta do erro de desconexão
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexão fechada (${statusCode}). Reconectar? ${shouldReconnect}`);
            if (shouldReconnect) {
                // Tenta reconectar após um breve atraso
                setTimeout(() => {
                    startBot().catch((e) => console.error("Erro fatal ao reconectar:", e));
                }, 3000);
            }
            else {
                console.log("Sessão deslogada. Apague a pasta 'auth_info' para reautenticar.");
            }
        }
        else if (connection === "open") {
            console.log(`✅ Bot conectado com sucesso! JID: ${jidNormalizedUser(sock.user?.id || "")}`);
        }
    });
    // Manipulador de mensagens
    sock.ev.on("messages.upsert", async (msgUpdate) => {
        try {
            const message = msgUpdate.messages?.[0];
            // Garante que é uma mensagem, tem conteúdo e não é enviada pelo próprio bot
            if (!message || !message.message || message.key.fromMe)
                return;
            const from = message.key.remoteJid;
            if (!from)
                return;
            // Função para extrair texto de diferentes tipos de mensagens
            const incomingText = getMessageText(message);
            const text = incomingText.toLowerCase().trim();
            console.log(`💬 Mensagem recebida de ${from}: ${incomingText}`);
            // --- LÓGICA DE ATENDIMENTO (TIMEOUT) ---
            if (atendendo.has(from)) {
                // 1. Limpa o timeout anterior e define um novo
                clearTimeout(atendendo.get(from));
                const newTimeout = setTimeout(async () => {
                    atendendo.delete(from);
                    await sock.sendMessage(from, {
                        text: "⏰ O atendimento foi encerrado por inatividade. Digite *MENU* para voltar ao início.",
                    });
                    console.log(`⏰ Atendimento automático encerrado para ${from}`);
                }, INACTIVITY_MINUTES * 60 * 1000); // INACTIVITY_MINUTES minutos
                atendendo.set(from, newTimeout);
                // 2. Verifica se o usuário quer sair do atendimento
                if (text === "menu") {
                    clearTimeout(newTimeout);
                    atendendo.delete(from);
                    await sock.sendMessage(from, { text: getMenuText() });
                    console.log(`ℹ️ ${from} saiu do modo atendimento via MENU`);
                }
                else {
                    console.log(`🤝 ${from} está em atendimento — bot silenciado.`);
                    // Você pode querer encaminhar esta mensagem para um atendente real aqui.
                }
                return; // Sai do processamento para não responder
            }
            // --- LÓGICA DE MENU PRINCIPAL ---
            let resposta;
            if (["1", "2", "3", "4", "5"].includes(text)) {
                // Opções de 1 a 5
                switch (text) {
                    case "1":
                        resposta = `
*✅ Opção 1: Orçamento*
Por favor, envie o máximo de detalhes possível sobre o seu orçamento (tipo de construção, tamanho, localização). Nossa equipe irá analisar e entrar em contato em breve.

_Você está em modo atendimento. Digite *MENU* para voltar às opções._
            `;
                        break;
                    case "2":
                        resposta = `
*✅ Opção 2: Solicitar Ligação/Contato*
Retornaremos o mais rápido possível.

_Você está em modo atendimento. Digite *MENU* para voltar às opções._
            `;
                        break;
                    case "3":
                        resposta = `
*✅ Opção 3: Dúvidas Gerais e Suporte*
Por favor, escreva sua pergunta. Um atendente (se disponível) ou um membro da equipe de suporte responderá assim que possível.

_Você está em modo atendimento. Digite *MENU* para voltar às opções._
            `;
                        break;
                    case "4":
                        resposta = `
*✅ Opção 4: Pedido*
Por favor, descreva seu pedido, detalhando o máximo possível de material, tamanhos, quantidades etc. Mande também sua localização com ponto de referência.

_Você está em modo atendimento. Digite *MENU* para voltar às opções._
            `;
                        break;
                    case "5":
                        resposta = `
*✅ Opção 5: Falar com um Atendente*
Aguarde um momento, você será atendido em breve.

_Você está em modo atendimento. Digite *MENU* para voltar às opções._
            `;
                        break;
                }
                // Entra no modo atendimento (inicia o timeout)
                const newTimeout = setTimeout(async () => {
                    atendendo.delete(from);
                    await sock.sendMessage(from, {
                        text: "⏰ O atendimento foi encerrado por inatividade. Digite *MENU* para voltar ao início.",
                    });
                    console.log(`⏰ Atendimento automático encerrado para ${from}`);
                }, INACTIVITY_MINUTES * 60 * 1000);
                atendendo.set(from, newTimeout);
                console.log(`👤 ${from} entrou no modo atendimento (opção ${text})`);
            }
            else if (text === "menu") {
                // Se já não estava em atendimento e digitou menu
                resposta = getMenuText();
            }
            else {
                // Mensagem inicial (qualquer outra coisa)
                resposta = `
Olá! 👋 ${saudacaoPorHora()}!

Bem-vindo(a) à *Ednaldo Construções*! 
Escolha uma das opções abaixo digitando o número correspondente:

${getMenuText()}
        `;
            }
            if (resposta) {
                await sock.sendMessage(from, { text: resposta.trim() });
            }
        }
        catch (err) {
            console.error("Erro ao processar mensagem:", err);
        }
    });
}
// Inicia o bot com tratamento de erro
startBot().catch((e) => console.error("Erro fatal ao iniciar bot:", e));
