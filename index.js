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
import { getDialogState, updateDialogState, resetHandoverStatus } from './src/services/dialogState.js';

async function main() {
  const { apiId, apiHash, phone, session } = config.tg;

  if (!session) {
    const newSession = await getSession({ apiId, apiHash, phone });
    log.info('New session: ' + newSession + ' (add to .env TG_SESSION)');
    return;
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.start();
  
  const me = await client.getMe();
  // Агент теперь гарантированно @referendumm
  const agentUsername = me.username ? '@' + me.username : null; 
  log.info(`Telegram Client started. Agent: ${agentUsername}`);

  // DB Client инициализируется, но его методы не вызываются.
  const dbClient = getDbClient({ url: config.supabase.url, key: config.supabase.key });

  // -----------------------------------------------------------
  // 1. Инициализация рассылки для всех целей из config.testTarget
  // -----------------------------------------------------------
  
  // Нормализуем config.testTarget в массив для унифицированной работы
  let targets = config.testTarget;
  if (typeof targets === 'string') {
    targets = [targets];
  } else if (!Array.isArray(targets)) {
      log.error(`Invalid config.testTarget format: expected string or array, got ${typeof targets}`);
      targets = [];
  }
  
  const initialText = 'Привет! Я Ильман из Referendum. Мы помогаем каналам зарабатывать на опросах без лишней рекламы. Ты публикуешь вопрос в нашей мини-аппе. Получаешь выплаты за участие. Берем в ранний доступ. Хочешь пару строк деталей?';

  // Запускаем цикл рассылки
  for (const target of targets) {
    const targetState = getDialogState(target);

    // Если статус NEW или ACTIVE (чтобы не потерять сообщение, если оно не было отправлено)
    if (targetState.status === 'NEW') {
        const sendRes = await sendMessage({ client, target, text: initialText });
        log.info(`Initial send to ${target}: ` + JSON.stringify(sendRes));
        
        // Обновляем статус и сохраняем историю
        const newHistory = [{ role: 'assistant', content: initialText }];
        updateDialogState(target, { 
            status: 'ACTIVE', 
            history: newHistory
        });

        // ВЫЗОВ DB.INSERT УДАЛЕН
    } else {
        log.info(`Initial message skipped. Dialog with ${target} is currently ${targetState.status}.`);
    }
  }

  // -----------------------------------------------------------
  // 2. Listener (обработка входящих сообщений)
  // -----------------------------------------------------------

  client.addEventHandler(async (event) => {
    if (event.isPrivate && event.message.text) {
      const userReply = event.message.text;
      
      const senderEntity = await client.getEntity(event.message.senderId);
      const senderUsername = senderEntity.username ? '@' + senderEntity.username : null;
      
      if (senderUsername === agentUsername) return; 

      const target = senderUsername; 
      
      if (targets.length > 0 && !targets.includes(target)) {
          log.warn(`Received message from non-target user: ${target}. Skipping.`);
          return;
      }

      const targetState = getDialogState(target); 
      let history = targetState.history || [];
      
      if (targetState.status === 'PENDING_HANDOVER') {
          log.warn(`Skipping AI reply for ${target}: Dialog is PENDING_HANDOVER.`);
          history.push({ role: 'user', content: userReply });
          updateDialogState(target, { history: history });
          return;
      }
      
      log.info('Received from ' + target + ': ' + userReply);

      history.push({ role: 'user', content: userReply });
      
      // БЕЗОПАСНОЕ ДЕСТРУКТУРИРОВАНИЕ для предотвращения TypeError
      const { agentReply, handoverRes = {} } = await handleDialog({ key: config.openai.key, history, userReply });
      
      // ИСПОЛЬЗУЕМ БЕЗОПАСНУЮ ПРОВЕРКУ
      if (handoverRes.needHuman === true) {
        log.info('Handover requested for ' + target + '. Suggested reply: ' + agentReply);
        
        const handoffRes = await sendMessage({ client, target, text: agentReply });
        
        history.push({ role: 'assistant', content: agentReply }); 
        updateDialogState(target, { 
            status: 'PENDING_HANDOVER', 
            pendingReply: agentReply,
            history: history
        });
        // ВЫЗОВ DB.INSERT УДАЛЕН
        
        return;
      }

      // Если бот отвечает
      const sendReplyRes = await sendMessage({ client, target, text: agentReply });
      log.info('Send reply: ' + JSON.stringify(sendReplyRes));
      
      history.push({ role: 'assistant', content: agentReply }); 
      updateDialogState(target, { history: history });
      
      // ВЫЗОВ DB.INSERT УДАЛЕН
    }
  }, new NewMessage({}));
  
  log.info('Listener started. Жди сообщений...');
}

main().catch(err => log.error('Main error: ' + err.message));