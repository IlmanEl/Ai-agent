// index.js

import dotenv from 'dotenv';
dotenv.config();

import { getSession } from './src/modules/auth.js';
import { sendMessage } from './src/modules/send.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { Api } from 'telegram';
import { log } from './src/utils/logger.js';
import { handleDialog } from './src/services/dialog.js';
import { config } from './src/config/env.js';
import { NewMessage } from 'telegram/events/index.js';
import { startControlBotListener, sendHandoverNotification } from './src/modules/controlBot.js'; 
import { getDialogState, updateDialogState, resetHandoverStatus, getAllDialogs } from './src/services/dialogState.js';

async function main() {
  const { apiId, apiHash, phone, session } = config.tg;

  if (!session) {
    const newSession = await getSession({ apiId, apiHash, phone });
    log.info('New session: ' + newSession);
    return;
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.start();
  
  const me = await client.getMe();
  const agentUsername = me.username ? '@' + me.username : null; 
  log.info(`Telegram Client started. Agent: ${agentUsername}`);
  
  startControlBotListener({
      sendMessage, getDialogState, updateDialogState, resetHandoverStatus, agentClient: client, getAllDialogs
  });

  // !!! ВОССТАНОВЛЕН КЛЮЧЕВОЙ БЛОК КОДА !!!
  let targets = Array.isArray(config.testTarget) ? config.testTarget : [config.testTarget];
  const initialText = 'Привет! Я Артем из Referendum. Мы помогаем TG-каналам зарабатывать на опросах, не размещая рекламу. Это дополнительный доход, который не снижает вовлеченность. Интересно узнать, как это работает?';

  for (const target of targets) {
    const targetState = getDialogState(target);
    if (targetState.status === 'NEW') {
        await sendMessage({ client, target, text: initialText });
        updateDialogState(target, { 
            status: 'ACTIVE', 
            history: [{ role: 'assistant', content: initialText }]
        });
    }
  }

  client.addEventHandler(async (event) => {
    if (!event.isPrivate || !event.message?.text) return;
    
    const userReply = event.message.text;
    const senderEntity = await event.message.getSender();
    const senderUsername = senderEntity.username ? '@' + senderEntity.username : senderEntity.id.toString();
    
    // ПРОВЕРКА НА `targets` ТЕПЕРЬ БУДЕТ РАБОТАТЬ
    if (senderUsername === agentUsername || !targets.includes(senderUsername)) return;

    try {
        await client.invoke(new Api.messages.ReadHistory({ peer: senderEntity }));
        log.info(`Messages from ${senderUsername} marked as read.`);
    } catch (e) {
        log.warn(`Could not mark history as read for ${senderUsername}: ${e.message}`);
    }

    const targetState = getDialogState(senderUsername); 
    if (targetState.status === 'PENDING_HANDOVER') {
        updateDialogState(senderUsername, { history: [...targetState.history, { role: 'user', content: userReply }] });
        return;
    }
    
    log.info(`Received from ${senderUsername}: ${userReply}`);
    const currentHistory = [...targetState.history, { role: 'user', content: userReply }];
    await client.invoke(new Api.messages.SetTyping({ peer: senderEntity, action: new Api.SendMessageTypingAction() }));
    
    const { agentReply, handoverIntent } = await handleDialog({ 
      key: config.openai.key, history: currentHistory, userReply 
    });
    
    if (handoverIntent && handoverIntent !== 'NONE') {
      log.warn(`Handover triggered for ${senderUsername}. Intent: ${handoverIntent}.`);
      updateDialogState(senderUsername, { 
          status: 'PENDING_HANDOVER', pendingReply: agentReply, history: currentHistory
      });
      await sendHandoverNotification({ 
        targetUsername: senderUsername, lastMessage: userReply, agentReply
      });
      return;
    }

    await sendMessage({ client, target: senderUsername, text: agentReply });
    const finalHistory = [...currentHistory, { role: 'assistant', content: agentReply }];
    updateDialogState(senderUsername, { history: finalHistory, status: 'ACTIVE' });

  }, new NewMessage({}));
  
  log.info('Listener started...');
}

main().catch(err => log.error('Main error: ' + err.message, err));