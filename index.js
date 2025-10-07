// index.js

import dotenv from 'dotenv';
dotenv.config();

try {
  await import('telegram/client/TelegramClient.js');
} catch {
  throw new Error('Package telegram not installed or broken. Run npm i.');
}

import { getSession } from './src/modules/auth.js';
import { sendMessage } from './src/modules/send.js';
import { getDbClient } from './src/modules/db.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { log } from './src/utils/logger.js';
import { handleDialog } from './src/services/dialog.js';
import { config } from './src/config/env.js';
import { NewMessage } from 'telegram/events/index.js';
// !!! ИМПОРТ CONTROL BOT'А !!!
import { startControlBotListener, sendHandoverNotification } from './src/modules/controlBot.js';


let dialogState = {};
let dbClient = null;

async function initDialog(targetAddress) {
  if (dialogState[targetAddress]) {
    log.info(`[${targetAddress}] Dialog already initialized.`);
    return;
  }
  
  dialogState[targetAddress] = {
    targetAddress: targetAddress,
    history: [],
    status: 'NEW', // NEW, ACTIVE, PENDING_HANDOVER
    pendingReply: null,
    targetId: null,
  };
  log.info(`[${targetAddress}] Initialized new dialog state.`);
}

async function main() {
  const { apiId, apiHash, phone, session } = config.tg;

  if (!session) {
    const newSession = await getSession({ apiId, apiHash, phone });
    log.info('New session: ' + newSession + ' (add to .env TG_SESSION)');
    return;
  }

  let client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.start();
  log.info('Telegram Client started.');
  
  dbClient = getDbClient({ url: config.supabase.url, key: config.supabase.key });

  // --- 1. Загрузка глобального состояния ---
  dialogState = await dbClient.loadState();
  log.info(`Loaded ${Object.keys(dialogState).length} dialogs from DB.`);
  
  const targets = Array.isArray(config.testTarget) ? config.testTarget : [config.testTarget];

  // --- 2. Инициализация диалогов для ВСЕХ целей ---
  for (const target of targets) {
    await initDialog(target);
  }

  // --- 3. Запуск Control Bot'а (в фоновом режиме) ---
  if (config.controlBot.token) {
      // Передаем dialogState и client, чтобы Control Bot мог отправлять ответы
      startControlBotListener(dialogState, client).catch(err => log.error('Control Bot Listener Error: ' + err.message));
      log.info('Control Bot listener started.');
  }

  // --- 4. Listener Logic ---
  client.addEventHandler(async (event) => {
    if (!event.isPrivate || !event.message || !event.message.text) return;
    
    const senderId = event.message.senderId ? event.message.senderId.toString() : null;
    let targetAddress = event.message.sender ? (event.message.sender.username || senderId) : senderId;
    const trimmedUserReply = event.message.text.trim();
    
    // Поиск по ID, если нет username
    const foundKey = Object.keys(dialogState).find(key => dialogState[key].targetId === senderId);
    if (foundKey) {
        targetAddress = foundKey;
    } else if (!dialogState[targetAddress]) {
        // Если это нецелевой пользователь и его нет в состоянии, игнорируем
        log.warn(`Received message from a non-target user: ${targetAddress}. Ignoring.`);
        return;
    }

    const targetState = dialogState[targetAddress];
    
    // Сохраняем targetId для обратной связи
    if (!targetState.targetId) {
        targetState.targetId = senderId;
        log.info(`[${targetAddress}] Saved targetId: ${senderId}`);
    }
    
    log.info(`\n<<< RECEIVED from ${targetAddress} (ID: ${senderId}): ${trimmedUserReply} >>>`);

    // Если диалог в режиме ожидания ответа человека, не отвечаем автоматически
    if (targetState.status === 'PENDING_HANDOVER') {
        log.warn(`[${targetAddress}] Status: PENDING_HANDOVER. Ignoring auto-reply.`);
        return;
    }
    
    // Добавляем сообщение клиента в историю перед вызовом AI
    targetState.history.push({ role: 'user', content: trimmedUserReply });

    // Вызываем AI для ответа и намерения
    const { agentReply, handoverIntent } = await handleDialog({ key: config.openai.key, history: targetState.history, userReply: trimmedUserReply });

    // 1. Логика Handover (более строгая)
    if (handoverIntent === 'NONE') {
      // --- АВТОМАТИЧЕСКИЙ ОТВЕТ (Диалог продолжается) ---
      log.info(`[AUTO] Intent: NONE. Sending reply to ${targetAddress}.`);
      
      const finalAddress = targetState.targetAddress || senderId; 
      const sendReplyRes = await sendMessage({ client, target: finalAddress, text: agentReply });
      
      if (sendReplyRes.status === 'sent') {
          // Добавляем ответ AI в историю только после успешной отправки
          targetState.history.push({ role: 'assistant', content: agentReply });
      } else {
          // Если ошибка отправки, удаляем последнее сообщение пользователя из истории, чтобы попробовать снова
          targetState.history.pop();
      }
      targetState.status = 'ACTIVE';
    } else {
      // --- ПЕРЕХВАТ УПРАВЛЕНИЯ (Уведомление Control Bot'а) ---
      targetState.pendingReply = agentReply;
      targetState.status = 'PENDING_HANDOVER';
      
      log.warn(`\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      log.warn(`!!! HANDOVER REQUIRED for ${targetAddress}: ${handoverIntent} !!!`);
      log.warn(`[Client: ${targetAddress}] Last message: ${trimmedUserReply}`);
      log.warn(`[Agent Proposal]: ${agentReply}`);
      log.warn(`\n[ACTION REQUIRED]: Sending notification to Control Bot...`);
      log.warn(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n\n`);
      
      await sendHandoverNotification(senderId, targetAddress, trimmedUserReply, agentReply);
    }
    
    // 2. Сохраняем обновленное состояние
    await dbClient.saveState(dialogState);

  }, new NewMessage({}));

  log.info('Listener started. Жди сообщений...');
}

main().catch(err => {
  log.error('Main error: ' + err.message);
  process.exit(1);
});