// src/modules/controlBot.js
import { config } from '../config/env.js';
import { log } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const CONTROL_BOT_API = `https://api.telegram.org/bot${config.controlBot.token}`;
const CONTROL_STATE_FILE = path.resolve('control_state.json');

let state = {
    lastUpdateId: 0,
    editContext: null 
};

const VERIFIED_ADMIN_ID = config.controlBot.adminId;

async function loadControlState() {
    try {
        const data = await fs.readFile(CONTROL_STATE_FILE, 'utf-8');
        const loaded = JSON.parse(data);
        state.lastUpdateId = loaded.lastUpdateId || 0;
        state.editContext = loaded.editContext || null;
        log.info(`[ControlBot] State loaded. Admin ID is ${VERIFIED_ADMIN_ID} (from .env). LastUpdateId: ${state.lastUpdateId}`);
    } catch (e) {
        if (e.code !== 'ENOENT') log.warn(`[ControlBot] Cannot load state file: ${e.message}`);
        await saveControlState();
    }
}

async function saveControlState() {
    await fs.writeFile(CONTROL_STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendTgMessage(chatId, text, options = {}) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown', ...options };
        const response = await fetch(`${CONTROL_BOT_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!result.ok) log.error(`[ControlBot] Error sending message to ${chatId}: ${result.description}`);
        return result;
    } catch (error) {
        log.error(`[ControlBot] FATAL error in sendTgMessage: ${error.message}`);
        return { ok: false };
    }
}

export async function sendHandoverNotification({ agent_id, target_username, lastMessage, agentReply }) {
    if (!VERIFIED_ADMIN_ID) {
        log.error("[ControlBot] CONTROL_ADMIN_ID is not set in .env. Notification failed.");
        return;
    }
    
    state.editContext = { agent_id: agent_id, target_username: target_username, tempMessage: null };
    await saveControlState();

    const messageText = `❗️ **HANDOVER REQUIRED** ❗️\n\n` +
        `👤 **Клиент:** \`${target_username}\`\n` +
        `💬 **Последнее от клиента:** ${lastMessage}\n\n` +
        `🤖 **Предложение Агента:**\n\`\`\`\n${agentReply}\n\`\`\``;
    
    const callbackApprove = `approve:${agent_id}:${target_username}`;
    const callbackReject = `reject:${agent_id}:${target_username}`;

    const inlineKeyboard = {
        inline_keyboard: [[
            { text: '✅ Одобрить', callback_data: callbackApprove },
            { text: '❌ Отклонить', callback_data: callbackReject }
        ]]
    };
    
    await sendTgMessage(VERIFIED_ADMIN_ID, messageText, { reply_markup: inlineKeyboard });
    await sendTgMessage(VERIFIED_ADMIN_ID, `✍️ Чтобы **отредактировать**, просто пришлите мне новый текст.`);
}

async function processUpdate(update, deps) {
    const { getDialogState, updateDialogState, resetHandoverStatus, sendMessage, agentClient } = deps;
    
    const chatId = update.message ? update.message.chat.id : (update.callback_query ? update.callback_query.message.chat.id : null);
    
    if (chatId != VERIFIED_ADMIN_ID) { 
        log.warn(`[ControlBot] Received message from unauthorized user: ${chatId}`);
        return;
    }

    if (update.message) {
        const { text } = update.message;

        if (text === '/start') {
            await sendTgMessage(VERIFIED_ADMIN_ID, "Бот-контроллер активен.");
            return;
        }

        if (state.editContext && state.editContext.target_username) {
            state.editContext.tempMessage = text;
            await saveControlState();

            const confirmationText = `Вы хотите отправить клиенту \`${state.editContext.target_username}\` следующее сообщение?\n\n---\n*${text}*`;
            const confirmationKeyboard = {
                inline_keyboard: [[
                    { text: '✅ Да, отправить', callback_data: `confirm_send` },
                    { text: '✏️ Нет, переписать', callback_data: `rewrite` }
                ]]
            };
            await sendTgMessage(VERIFIED_ADMIN_ID, confirmationText, { reply_markup: confirmationKeyboard });

        } else {
            await sendTgMessage(VERIFIED_ADMIN_ID, "Неизвестная команда. Я принимаю текст для редактирования только когда есть активный Handover.");
        }
        return;
    }

    if (update.callback_query) {
        const { data } = update.callback_query;
        
        if (data.startsWith('approve:') || data.startsWith('reject:')) {
            const parts = data.split(':');
            const action = parts[0];
            const agent_id = parts[1];
            const target_username = parts[2];

            const dialog = await getDialogState(agent_id, target_username);
            if (!dialog || dialog.status !== 'PENDING_HANDOVER') {
                 await sendTgMessage(chatId, `⚠️ Действие для \`${target_username}\` уже не актуально.`);
                 return;
            }

            if (action === 'approve') {
                await sendMessage({ client: agentClient, target: target_username, text: dialog.pending_reply });
                const newHistory = [...dialog.history, { role: 'assistant', content: dialog.pending_reply }];
                await updateDialogState(agent_id, target_username, { history: newHistory, status: 'ACTIVE', pending_reply: null });
                await sendTgMessage(chatId, `✅ **Одобрено** клиенту \`${target_username}\`.`);
            } else { // reject
                await resetHandoverStatus(agent_id, target_username);
                await sendTgMessage(chatId, `❌ **Handover отклонён** для \`${target_username}\`.`);
            }
            state.editContext = null;
            await saveControlState();
        
        } else if (data === 'confirm_send') {
            if (state.editContext && state.editContext.agent_id && state.editContext.tempMessage) {
                const { agent_id, target_username, tempMessage } = state.editContext;
                const dialog = await getDialogState(agent_id, target_username);
                
                if (dialog && dialog.status === 'PENDING_HANDOVER') {
                    await sendMessage({ client: agentClient, target: target_username, text: tempMessage });
                    const newHistory = [...dialog.history, { role: 'assistant', content: tempMessage }];
                    await updateDialogState(agent_id, target_username, { history: newHistory, status: 'ACTIVE', pending_reply: null });
                    await sendTgMessage(chatId, `✅ **Ваш вариант отправлен** клиенту \`${target_username}\`.`);
                    state.editContext = null;
                    await saveControlState();
                } else {
                    await sendTgMessage(chatId, `⚠️ Ошибка: диалог с \`${target_username}\` уже не в режиме ожидания.`);
                }
            }
        } else if (data === 'rewrite') {
            if (state.editContext) {
                state.editContext.tempMessage = null;
                await saveControlState();
            }
            await sendTgMessage(chatId, "Хорошо, отправка отменена. Пришлите новый вариант текста.");
        }
    }
}

export async function startControlBotListener(deps) {
    if (!config.controlBot.token) {
        log.warn("[ControlBot] CONTROL_BOT_TOKEN не настроен.");
        return;
    }
    if (!VERIFIED_ADMIN_ID) {
        log.error("[ControlBot] CONTROL_ADMIN_ID не указан в .env! Бот не может запуститься.");
        return;
    }
    
    const pollingLoop = async () => {
        await loadControlState();
        log.info("[ControlBot] Starting Long Polling...");
        while (true) {
            try {
                const url = `${CONTROL_BOT_API}/getUpdates?offset=${state.lastUpdateId + 1}&timeout=30`;
                const response = await fetch(url); 
                const data = await response.json();

                if (data.ok && data.result.length > 0) {
                    for (const update of data.result) {
                        state.lastUpdateId = update.update_id;
                        await processUpdate(update, deps);
                    }
                    await saveControlState(); 
                }
            } catch (e) {
                log.error(`[ControlBot] Long Polling Error: ${e.message}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    };
    
    pollingLoop().catch(err => log.error('[ControlBot] Fatal Polling Error:', err));
}