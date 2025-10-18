// src/modules/controlBot.js

import { config } from '../config/env.js';
import { log } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const CONTROL_BOT_API = `https://api.telegram.org/bot${config.controlBot.token}`;
const CONTROL_STATE_FILE = path.resolve('control_state.json');

let state = { adminId: null, lastUpdateId: 0, editContext: null };

async function loadControlState() {
    try {
        const data = await fs.readFile(CONTROL_STATE_FILE, 'utf-8');
        state = { ...state, ...JSON.parse(data) };
        log.info(`[ControlBot] State loaded. Admin ID: ${state.adminId}`);
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
        const response = await fetch(`${CONTROL_BOT_API}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!result.ok) log.error(`[ControlBot] Error sending message to ${chatId}: ${result.description}`);
        return result;
    } catch (error) {
        log.error(`[ControlBot] FATAL error in sendTgMessage: ${error.message}`);
        return { ok: false };
    }
}

function findActiveHandoverTarget(allDialogs) {
    if (!allDialogs) return null;
    for (const username in allDialogs) {
        if (allDialogs[username].status === 'PENDING_HANDOVER') {
            return allDialogs[username].targetUsername;
        }
    }
    return null;
}

export async function sendHandoverNotification({ targetUsername, lastMessage, agentReply }) {
    if (!state.adminId) return;
    state.editContext = null;
    await saveControlState();

    const messageText = `❗️ **HANDOVER REQUIRED** ❗️\n\n` +
        `👤 **Клиент:** \`${targetUsername}\`\n` +
        `💬 **Последнее от клиента:** ${lastMessage}\n\n` +
        `🤖 **Предложение Агента:**\n\`\`\`\n${agentReply}\n\`\`\``;
    
    const inlineKeyboard = { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve:${targetUsername}` }, { text: '❌ Отклонить', callback_data: `reject:${targetUsername}` }]] };
    
    await sendTgMessage(state.adminId, messageText, { reply_markup: inlineKeyboard });
    await sendTgMessage(state.adminId, `✍️ Чтобы **отредактировать**, просто пришлите мне новый текст.`);
}

async function processUpdate(update, deps) {
    const { getDialogState, updateDialogState, resetHandoverStatus, sendMessage, agentClient, getAllDialogs } = deps;

    if (update.message) {
        const { chat, text } = update.message;
        if (text === '/start' || text === config.controlBot.secretKey) {
            if (text === '/start') await sendTgMessage(chat.id, "👋 Привет! Для авторизации введите ваш секретный ключ.");
            if (text === config.controlBot.secretKey) {
                state.adminId = chat.id;
                await saveControlState();
                await sendTgMessage(chat.id, `🎉 **Авторизация успешна!**`);
            }
            return;
        }
        if (!state.adminId || chat.id !== state.adminId) return;
        
        const allDialogs = getAllDialogs(); 
        const activeHandoverTarget = findActiveHandoverTarget(allDialogs);

        if (activeHandoverTarget) {
            state.editContext = { targetUsername: activeHandoverTarget, tempMessage: text };
            await saveControlState();
            const confirmationText = `Вы хотите отправить клиенту \`${activeHandoverTarget}\` следующее сообщение?\n\n---\n*${text}*`;
            const confirmationKeyboard = { inline_keyboard: [[{ text: '✅ Да, отправить', callback_data: `confirm_send` }, { text: '✏️ Нет, переписать', callback_data: `rewrite` }]] };
            await sendTgMessage(state.adminId, confirmationText, { reply_markup: confirmationKeyboard });
        } else {
            await sendTgMessage(state.adminId, "Неизвестная команда. Я принимаю текст для редактирования только когда есть активный Handover.");
        }
        return;
    }

    if (update.callback_query) {
        const { message, data } = update.callback_query;
        const chatId = message.chat.id;
        
        if (data.startsWith('approve:')) {
            const targetUsername = data.split(':')[1];
            const dialog = getDialogState(targetUsername);
            if (dialog && dialog.status === 'PENDING_HANDOVER') {
                await sendMessage({ client: agentClient, target: targetUsername, text: dialog.pendingReply });
                const newHistory = [...dialog.history, { role: 'assistant', content: dialog.pendingReply }];
                updateDialogState(targetUsername, { history: newHistory, status: 'ACTIVE', pendingReply: null });
                await sendTgMessage(chatId, `✅ **Одобрено** клиенту \`${targetUsername}\`.`);
            }
        } else if (data.startsWith('reject:')) {
            const targetUsername = data.split(':')[1];
            resetHandoverStatus(targetUsername);
            await sendTgMessage(chatId, `❌ **Handover отклонён** для \`${targetUsername}\`.`);
        } else if (data === 'confirm_send') {
            if (state.editContext) {
                const { targetUsername, tempMessage } = state.editContext;
                const dialog = getDialogState(targetUsername);
                if (dialog && dialog.status === 'PENDING_HANDOVER') {
                    await sendMessage({ client: agentClient, target: targetUsername, text: tempMessage });
                    const newHistory = [...dialog.history, { role: 'assistant', content: tempMessage }];
                    updateDialogState(targetUsername, { history: newHistory, status: 'ACTIVE', pendingReply: null });
                    await sendTgMessage(chatId, `✅ **Ваш вариант отправлен** клиенту \`${targetUsername}\`.`);
                    state.editContext = null;
                    await saveControlState();
                }
            }
        } else if (data === 'rewrite') {
            state.editContext = null;
            await saveControlState();
            await sendTgMessage(chatId, "Отправка отменена. Пришлите новый вариант.");
        }
    }
}

export async function startControlBotListener(deps) {
    if (!config.controlBot.token) return;
    
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