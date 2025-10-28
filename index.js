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
import { getDialogState, updateDialogState, resetHandoverStatus } from './src/services/dialogState.js';
import { getAgent } from './src/modules/db.js'; // Нам нужно загружать агента

// --- ВАЖНО: ЗАДАЙТЕ UUID ВАШЕГО АГЕНТА ИЗ SUPABASE ЗДЕСЬ ---
// (Это временное решение, пока нет админ-панели)
// 1. Зайдите в Supabase -> Table Editor -> `ai_agents`
// 2. Нажмите "Insert row"
// 3. Заполните поля (agent_name, system_prompt, initial_opener_text)
// 4. Скопируйте `id` (UUID) этой строки и вставьте сюда:
const CURRENT_AGENT_UUID = "ebb7d2b3-040f-478e-b3aa-79bf18929e73"; 
// -------------------------------------------------------------

async function main() {
  if (CURRENT_AGENT_UUID.startsWith("ВСТАВЬТЕ_СЮДА")) {
      log.error("---------------------------------------------------------------");
      log.error("ОШИБКА: Укажите ваш `CURRENT_AGENT_UUID` в файле `index.js` (строка 21)");
      log.error("---------------------------------------------------------------");
      return;
  }

  const agentData = await getAgent(CURRENT_AGENT_UUID);
  if (!agentData) {
      log.error(`Не удалось загрузить данные агента с UUID: ${CURRENT_AGENT_UUID}`);
      return;
  }
  log.info(`Запускаем агента: ${agentData.agent_name}`);

  const client = new TelegramClient(new StringSession(agentData.tg_session_string || ''), config.tg.apiId, config.tg.apiHash, { connectionRetries: 5 });
  
  if (!agentData.tg_session_string) {
      log.warn("Сессия агента не найдена в БД. Запускаем получение новой сессии...");
      const newSession = await getSession({ 
          apiId: config.tg.apiId, 
          apiHash: config.tg.apiHash, 
          phone: config.tg.phone 
      });
      log.info('New session: ' + newSession);
      log.info('!!! ПОЖАЛУЙСТА, СКОПИРУЙТЕ ЭТУ СЕССИЮ В SUPABASE (поле tg_session_string) и перезапустите !!!');
      return; // Останавливаемся, чтобы юзер мог сохранить сессию
  }

  await client.start();
  
  const me = await client.getMe();
  const agentUsername = me.username ? '@' + me.username : null; 
  log.info(`Telegram Client started. Agent: ${agentUsername}`);
  
  startControlBotListener({
      sendMessage, getDialogState, updateDialogState, resetHandoverStatus, agentClient: client,
  });

  let targets = Array.isArray(config.testTarget) ? config.testTarget : [config.testTarget];
  const initialText = agentData.initial_opener_text; // Берем из БД

  for (const target of targets) {
    const targetState = await getDialogState(CURRENT_AGENT_UUID, target);
    if (targetState.status === 'NEW') {
        await sendMessage({ client, target, text: initialText });
        await updateDialogState(CURRENT_AGENT_UUID, target, {
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

    if (senderUsername === agentUsername || !targets.includes(senderUsername)) return;

    try {
        await client.invoke(new Api.messages.ReadHistory({ peer: senderEntity }));
    } catch (e) {
        log.warn(`Could not mark history as read: ${e.message}`);
    }

    const targetState = await getDialogState(CURRENT_AGENT_UUID, senderUsername);
    if (targetState.status === 'PENDING_HANDOVER') {
        await updateDialogState(CURRENT_AGENT_UUID, senderUsername, { history: [...targetState.history, { role: 'user', content: userReply }] });
        return;
    }
    
    log.info(`Received from ${senderUsername}: ${userReply}`);
    const currentHistory = [...targetState.history, { role: 'user', content: userReply }];
    await client.invoke(new Api.messages.SetTyping({ peer: senderEntity, action: new Api.SendMessageTypingAction() }));
    
    const { agentReply, handoverIntent } = await handleDialog({ 
      key: config.openai.key, 
      history: currentHistory, 
      userReply,
      system_prompt: agentData.system_prompt // Передаем промпт из БД
    });
    
    if (handoverIntent && (handoverIntent === 'POSITIVE_CLOSE' || handoverIntent === 'AI_FAILURE')) {
      log.warn(`Handover triggered for ${senderUsername}. Intent: ${handoverIntent}.`);
      await updateDialogState(CURRENT_AGENT_UUID, senderUsername, {
          status: 'PENDING_HANDOVER', pending_reply: agentReply, history: currentHistory
      });
      await sendHandoverNotification({ 
        agent_id: CURRENT_AGENT_UUID,
        target_username: senderUsername, 
        lastMessage: userReply, 
        agentReply
      });
      return;
    }

    await sendMessage({ client, target: senderUsername, text: agentReply });
    const finalHistory = [...currentHistory, { role: 'assistant', content: agentReply }];
    await updateDialogState(CURRENT_AGENT_UUID, senderUsername, { history: finalHistory, status: 'ACTIVE' });

  }, new NewMessage({}));
  
  log.info('Listener started...');
}

main().catch(err => log.error('Main error: ' + err.message, err));