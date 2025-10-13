// src/modules/controlBot.js (Исправленная версия на Long Polling Bot API)

import { config } from '../config/env.js';
import { log } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

// --- (1) Внутреннее состояние Control Bot'а (для аутентификации) ---
const CONTROL_BOT_API = `https://api.telegram.org/bot${config.controlBot.token}`;
const CONTROL_STATE_FILE = path.resolve('control_state.json');

let verifiedAdminId = null;
let lastUpdateId = 0;

async function loadControlState() {
    try {
        const data = await fs.readFile(CONTROL_STATE_FILE, 'utf-8');
        const state = JSON.parse(data);
        verifiedAdminId = state.adminId || null;
        lastUpdateId = state.lastUpdateId || 0;
        log.info(`[ControlBot] State loaded. Admin ID: ${verifiedAdminId}`);
    } catch (e) {
        if (e.code !== 'ENOENT') log.warn(`[ControlBot] Cannot load state file: ${e.message}`);
        await saveControlState(); 
    }
}

async function saveControlState() {
    const state = { adminId: verifiedAdminId, lastUpdateId };
    await fs.writeFile(CONTROL_STATE_FILE, JSON.stringify(state, null, 2));
}

// --- (2) Вспомогательные функции API ---

async function sendTgMessage(chatId, text, reply_markup = null) {
    // Эта функция используется только для общения с админом через Bot API
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

// --- (3) Генерация кнопок для уведомления ---

export function getHandoverKeyboard(targetUsername) {
    return {
        inline_keyboard: [
            [
                // data: 'approve:TARGET_USERNAME'
                { text: '✅ ОДОБРИТЬ и ОТПРАВИТЬ', callback_data: `approve:${targetUsername}` },
                // data: 'reject:TARGET_USERNAME'
                { text: '❌ ОТКЛОНИТЬ (Сбросить Handover)', callback_data: `reject:${targetUsername}` }
            ]
        ]
    };
}

export async function sendHandoverNotification({ targetUsername, lastMessage, agentReply }) {
    if (!verifiedAdminId) {
        log.error("[ControlBot] Нет верифицированного администратора. Уведомление не отправлено. Запустите /start в Control Bot.");
        return;
    }

    const messageText = `❗️ **HANDOVER REQUIRED** ❗️\n\n` +
        `👤 **Клиент:** \`${targetUsername}\`\n` +
        `💬 **Последнее от клиента:** ${lastMessage}\n\n` +
        `🤖 **Предложение Агента (для отправки):**\n\`\`\`\n${agentReply}\n\`\`\``;
    
    // Отправляем уведомление с кнопками
    await sendTgMessage(verifiedAdminId, messageText, getHandoverKeyboard(targetUsername));
    
    // Инструкция для редактирования (включает ID Диалога для извлечения)
    await sendTgMessage(verifiedAdminId, 
        `Для **редактирования** ответа, просто **ответьте на это сообщение (Handover REQUIRED)** своим новым текстом. \n\n*ID Диалога: ${targetUsername}*`
    );
}

// --- (4) Основной обработчик Polling ---

async function processUpdate(update, deps) {
    // deps = { sendMessage, getDialogState, updateDialogState, resetHandoverStatus, agentClient }
    if (!update.message && !update.callback_query) return;

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

        // Б. Ввод ключа (нужно настроить CONTROL_BOT_SECRET_KEY в .env)
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
                // Извлекаем ID Диалога из инструкции (ID Диалога: @username)
                const match = reply.text.match(/\*ID Диалога: ([^\*]+)\*/);
                if (match) {
                    const targetUsername = match[1]; 
                    const state = deps.getDialogState(targetUsername);
                    const editedReply = text;

                    if (state) {
                        // 1. Отправляем отредактированный ответ клиенту через Agent Client (MTProto)
                        await deps.sendMessage({ client: deps.agentClient, target: targetUsername, text: editedReply });
                        
                        // 2. Обновляем историю и состояние
                        deps.updateDialogState(targetUsername, {
                            history: [...state.history, { role: 'assistant', content: editedReply }],
                            status: 'ACTIVE',
                            suggestedReply: null // Очищаем предложенный ответ
                        });
                        
                        // 3. Уведомляем админа
                        await sendTgMessage(chatId, `✅ **Отредактированный ответ успешно отправлен** клиенту \`${targetUsername}\`:\n${editedReply}`);
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

    // --- 4.2. Обработка Callback Query (Одобрение/Отклонение) ---
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const data = query.data;
        const [action, targetUsername] = data.split(':');
        
        // Скрыть "loading..."
        await fetch(`${CONTROL_BOT_API}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: query.id })
        });


        if (chatId !== verifiedAdminId) {
            await sendTgMessage(chatId, `⚠️ У вас нет прав администратора.`);
            return;
        }
        
        const state = deps.getDialogState(targetUsername);

        if (!state) {
            await sendTgMessage(chatId, `⚠️ Ошибка: Состояние диалога с клиентом ${targetUsername} не найдено.`);
            return;
        }

        // 1. ОТКЛОНЕНИЕ (Сброс статуса)
        if (action === 'reject') {
            deps.resetHandoverStatus(targetUsername); 
            await sendTgMessage(chatId, `❌ **Handover отклонён** для \`${targetUsername}\`. Статус сброшен на ACTIVE.`);
            return;
        }

        // 2. ОДОБРЕНИЕ (Отправка предложенного ответа)
        if (action === 'approve') {
            const agentReply = state.suggestedReply; 
            
            if (!agentReply) {
                await sendTgMessage(chatId, `⚠️ Ошибка: Предложенный ответ для \`${targetUsername}\` не найден. Попробуйте ответить на сообщение вручную.`);
                return;
            }

            // 1. Отправляем ответ клиенту через Agent Client (MTProto)
            await deps.sendMessage({ client: deps.agentClient, target: targetUsername, text: agentReply });
            
            // 2. Обновляем историю и состояние
            deps.updateDialogState(targetUsername, {
                history: [...state.history, { role: 'assistant', content: agentReply }],
                status: 'ACTIVE',
                suggestedReply: null 
            });
            
            // 3. Уведомляем админа и редактируем сообщение-уведомление
            await sendTgMessage(chatId, `✅ **Одобрено и отправлено** клиенту \`${targetUsername}\`:\n${agentReply}`);
        }
    }
}

// --- (5) Запуск Control Bot'а (Long Polling) ---

export async function startControlBotListener(deps) {
    if (!config.controlBot.token) {
        log.warn("[ControlBot] CONTROL_BOT_TOKEN не настроен. Control Bot не запущен.");
        return;
    }
    // Запускаем в фоновом режиме, не блокируя main()
    const pollingLoop = async () => {
        await loadControlState();
        log.info("[ControlBot] Starting Long Polling...");
        while (true) {
            try {
                const url = `${CONTROL_BOT_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.ok && data.result.length > 0) {
                    for (const update of data.result) {
                        await processUpdate(update, deps);
                        lastUpdateId = update.update_id;
                    }
                    await saveControlState(); 
                }
            } catch (e) {
                log.error(`[ControlBot] Long Polling Error: ${e.message}`);
            }
            // Короткая пауза для предотвращения спама при ошибке
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    // Запускаем цикл Long Polling асинхронно
    pollingLoop().catch(err => log.error('[ControlBot] Fatal Polling Error:', err));
}