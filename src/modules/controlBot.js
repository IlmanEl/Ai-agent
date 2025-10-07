// src/modules/controlBot.js

import { config } from '../config/env.js';
import { log } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

const CONTROL_BOT_API = `https://api.telegram.org/bot${config.controlBot.token}`;
const STATE_FILE = path.resolve('control_state.json');

let verifiedAdminId = null;
let lastUpdateId = 0;

// --- 1. Управление состоянием Control Bot'а (храним ID администратора) ---
async function loadControlState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        verifiedAdminId = state.adminId || null;
        lastUpdateId = state.lastUpdateId || 0;
        log.info(`[ControlBot] State loaded. Admin ID: ${verifiedAdminId}`);
    } catch (e) {
        log.warn(`[ControlBot] Cannot load state file. Creating new: ${e.message}`);
        // Создаем новый файл, если его нет
        await saveControlState(); 
    }
}

async function saveControlState() {
    const state = { adminId: verifiedAdminId, lastUpdateId };
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- 2. Вспомогательные функции API ---

async function sendTgMessage(chatId, text, reply_markup = null) {
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
        };
        if (reply_markup) payload.reply_markup = reply_markup;

        const response = await fetch(`${CONTROL_BOT_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!result.ok) {
            log.error(`[ControlBot] Ошибка отправки сообщения ${chatId}: ${result.description}`);
        }
        return result;
    } catch (error) {
        log.error(`[ControlBot] FATAL ошибка при запросе sendTgMessage: ${error.message}`);
        return { ok: false };
    }
}

// --- 3. Функции Уведомления и Управления ---

export async function sendHandoverNotification(senderId, targetAddress, lastMessage, agentReply) {
    if (!verifiedAdminId) {
        log.error("[ControlBot] Нет верифицированного администратора. Уведомление не отправлено.");
        return;
    }

    const uniqueKey = `${Date.now()}`; 
    const callbackDataApprove = `APPROVE_${senderId}_${uniqueKey}`;
    
    const messageText = `❗️ **HANDOVER REQUIRED** ❗️\n\n` +
                        `👤 **Клиент:** \`${targetAddress}\` (ID: ${senderId})\n` +
                        `💬 **Последнее от клиента:** ${lastMessage}\n\n` +
                        `🤖 **Предложение Агента (для отправки):**\n\`\`\`\n${agentReply}\n\`\`\``;
    
    // Кнопка одобрения
    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: '✅ ОДОБРИТЬ и ОТПРАВИТЬ', callback_data: callbackDataApprove }
            ]
        ]
    };
    
    // Отправляем уведомление
    await sendTgMessage(verifiedAdminId, messageText, inlineKeyboard);
    
    // Также отправляем инструкцию
    await sendTgMessage(verifiedAdminId, 
        `Для **редактирования** ответа, просто **ответьте на это сообщение** (Handover REQUIRED) своим новым текстом.`
    );
}

// --- 4. Обработка Входящих Сообщений (Polling) ---

async function processUpdate(update, dialogState, tgClient) {
    if (!update.message && !update.callback_query) return;
    
    // Для динамического импорта и доступа к dbClient
    const dbModule = await import('./db.js');
    const sendModule = await import('./send.js');

    // --- 4.1. Обработка Сообщений (Аутентификация / Редактирование) ---
    if (update.message) {
        const message = update.message;
        const chatId = message.chat.id;
        const text = message.text ? message.text.trim() : '';
        const isVerifiedAdmin = verifiedAdminId && chatId === verifiedAdminId;

        // А. Аутентификация
        if (text.startsWith('/start')) {
            await sendTgMessage(chatId, "👋 Привет! Я Control Bot для управления AI-агентом Referendum. Для авторизации введите секретный ключ.");
            return;
        }

        // Б. Ввод ключа
        if (text === config.controlBot.secretKey) {
            verifiedAdminId = chatId;
            await saveControlState();
            await sendTgMessage(chatId, `🎉 **Авторизация успешна!** Вы назначены Администратором (ID: ${chatId}). Теперь вы будете получать все уведомления.`);
            return;
        }
        
        // В. Обработка ответа на уведомление (Редактирование/Отправка)
        if (message.reply_to_message && isVerifiedAdmin) {
            const reply = message.reply_to_message;
            if (reply.text && reply.text.includes('HANDOVER REQUIRED')) {
                // Извлекаем ID клиента из уведомления
                const match = reply.text.match(/ID: (\d+)/);
                if (match) {
                    const clientId = match[1];
                    const clientState = dialogState[clientId];
                    const editedReply = text; 
                    
                    if (clientState) {
                        // 1. Отправляем отредактированный ответ клиенту
                        await sendModule.sendMessage({ client: tgClient, target: clientState.targetAddress, text: editedReply });
                        
                        // 2. Обновляем историю и состояние
                        clientState.history.push({ role: 'assistant', content: editedReply });
                        clientState.status = 'ACTIVE';
                        clientState.pendingReply = null; // Очищаем ожидающий ответ
                        await dbModule.getDbClient().saveState(dialogState); 
                        
                        // 3. Уведомляем админа
                        await sendTgMessage(chatId, `✅ **Отредактированный ответ успешно отправлен** клиенту \`${clientState.targetAddress}\`:\n${editedReply}`);
                        return;
                    }
                }
            }
        }
        
        // Г. Неизвестное сообщение от админа
        if (isVerifiedAdmin) {
             await sendTgMessage(chatId, `Неизвестная команда. Вы можете ответить на уведомление о Handover, чтобы отредактировать ответ, или использовать /start.`);
        }
    }

    // --- 4.2. Обработка Callback Query (Одобрение) ---
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const data = query.data;

        if (chatId !== verifiedAdminId) {
             await sendTgMessage(chatId, `⚠️ У вас нет прав администратора.`);
             return;
        }
        
        // Парсим данные: ACTION_CLIENTID_UNIQUEKEY
        if (data.startsWith('APPROVE_')) {
            const [, clientId] = data.split('_'); 
            const clientState = dialogState[clientId];
            
            if (!clientState) {
                await sendTgMessage(chatId, `⚠️ Ошибка: Состояние диалога с клиентом ${clientId} не найдено.`);
                return;
            }

            const agentReply = clientState.pendingReply; // Берем предложенный ответ

            // 1. Отправляем ответ клиенту
            await sendModule.sendMessage({ client: tgClient, target: clientState.targetAddress, text: agentReply });
            
            // 2. Обновляем историю и состояние
            clientState.history.push({ role: 'assistant', content: agentReply });
            clientState.status = 'ACTIVE';
            clientState.pendingReply = null;
            await dbModule.getDbClient().saveState(dialogState);
            
            // 3. Уведомляем админа и редактируем сообщение-уведомление
            await sendTgMessage(chatId, `✅ **Одобрено и отправлено** клиенту \`${clientState.targetAddress}\`:\n${agentReply}`);
        }
    }
}


export async function startControlBotListener(dialogState, tgClient) {
    if (!config.controlBot.token) {
        log.warn("[ControlBot] CONTROL_BOT_TOKEN не настроен. Control Bot не запущен.");
        return;
    }
    
    await loadControlState();
    
    // Инициализируем dbClient
    const dbModule = await import('./db.js');
    tgClient.dbClient = dbModule.getDbClient();

    log.info("[ControlBot] Starting Long Polling...");
    
    while (true) {
        try {
            const url = `${CONTROL_BOT_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    await processUpdate(update, dialogState, tgClient);
                    lastUpdateId = update.update_id;
                }
                await saveControlState(); 
            }
        } catch (e) {
            log.error(`[ControlBot] Long Polling Error: ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}