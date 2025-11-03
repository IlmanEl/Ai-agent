// index.js (Исправленная версия)
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
import { getAgent } from './src/modules/db.js';
import { campaignManager } from './src/services/campaignManager.js';

// --- ВАЖНО: ЗАДАЙТЕ UUID ВАШЕГО АГЕНТА ИЗ SUPABASE ЗДЕСЬ ---
const CURRENT_AGENT_UUID = "8435c742-1f1e-4e72-a33b-2221985e9f83"; // (Оставьте ваш UUID)
// -------------------------------------------------------------


async function main() {
  if (CURRENT_AGENT_UUID.startsWith("ЗАМЕНИТЕ_МЕНЯ")) {
      log.error("ОШИБКА: Укажите ваш `CURRENT_AGENT_UUID` в файле `index.js`");
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
      log.info('!!! ПОЖАЛУЙСТА, СКОПИРУЙТЕ ЭТУ СЕССИЮ В SUPABASE и перезапустите !!!');
      return; 
  }

  await client.start();
  
  const me = await client.getMe();
  const agentUsername = me.username ? '@' + me.username : null; 
  log.info(`Telegram Client started. Agent: ${agentUsername}`);
  
  startControlBotListener({
      sendMessage, getDialogState, updateDialogState, resetHandoverStatus, agentClient: client, getAllDialogs
  });

  // --- (ИЗМЕНЕНО) ЛОГИКА ЗАГРУЗКИ ЦЕЛЕЙ ---
  const activeDialogs = await campaignManager.getActiveDialogs(CURRENT_AGENT_UUID);
  log.info(`[Init] Найдено ${activeDialogs.length} активных диалогов для агента.`);
  
  let monitoredTargets = activeDialogs.map(d => '@' + d.username);
  
  if (!monitoredTargets.includes(config.testTarget)) {
      monitoredTargets.push(config.testTarget);
  }
  log.info(`[Init] Слушаем цели: ${monitoredTargets.join(', ')}`);
  
  const nextLead = await campaignManager.getNextLead(CURRENT_AGENT_UUID);
  const initialText = agentData.initial_opener_text; 

  // === (ИСПРАВЛЕНИЕ ЗДЕСЬ) ===
  // Я УБРАЛ ОШИБОЧНУЮ ПРОВЕРКУ 'dialog_state.json'
  // Если Supabase (nextLead) сказал, что лид 'NEW' - МЫ ОТПРАВЛЯЕМ.
  if (nextLead) {
      const targetUsername = '@' + nextLead.username;
      log.info(`[Init] Найдена НОВАЯ цель: ${targetUsername} (из кампании ${nextLead.campaign_id})`);
      
      // Отправляем как 'OUTGOING' (с задержкой и "печатает...")
      await sendMessage({ 
          client, 
          target: targetUsername, 
          text: initialText,
          messageType: 'OUTGOING'
      });
      
      await campaignManager.updateLeadStatus(nextLead.campaign_id, targetUsername, 'CONTACTED');
      
      // Мы все еще обновляем dialog_state.json, чтобы хранить историю
      await updateDialogState(CURRENT_AGENT_UUID, targetUsername, {
          status: 'ACTIVE', 
          history: [{ role: 'assistant', content: initialText }]
      });
      
      monitoredTargets.push(targetUsername);
      log.info(`[Init] ${targetUsername} добавлен в список мониторинга.`);
      
  } else {
      log.info('[Init] Нет новых лидов для отправки. Ждем входящих...');
  }
  // --- (КОНЕЦ ИСПРАВЛЕНИЙ) ---


  client.addEventHandler(async (event) => {
    if (!event.isPrivate || !event.message?.text) return;
    
    const userReply = event.message.text;
    const senderEntity = await event.message.getSender();
    const senderUsername = senderEntity.username ? '@' + senderEntity.username : senderEntity.id.toString();

    if (senderUsername === agentUsername || !monitoredTargets.includes(senderUsername)) {
        if (senderUsername !== agentUsername) {
            log.warn(`[Event] Игнор сообщения от ${senderUsername} (нет в списке целей)`);
        }
        return;
    }

    try {
        await client.invoke(new Api.messages.ReadHistory({ peer: senderEntity }));
    } catch (e) { log.warn(`Could not mark history as read: ${e.message}`); }

    const targetState = await getDialogState(CURRENT_AGENT_UUID, senderUsername);
    if (targetState.status === 'PENDING_HANDOVER') {
        await updateDialogState(CURRENT_AGENT_UUID, senderUsername, { history: [...targetState.history, { role: 'user', content: userReply }] });
        return;
    }
    
    log.info(`Received from ${senderUsername}: ${userReply}`);
    
    const lead = activeDialogs.find(d => '@' + d.username === senderUsername);
    if (lead && lead.status === 'CONTACTED') {
         await campaignManager.updateLeadStatus(lead.campaign_id, senderUsername, 'REPLIED');
    }
    
    const currentHistory = [...targetState.history, { role: 'user', content: userReply }];
    
    try {
      await client.invoke(new Api.messages.SetTyping({ peer: senderEntity, action: new Api.SendMessageTypingAction() }));
    } catch(e) { /* ignore */ }
    
    const { agentReply, handoverIntent } = await handleDialog({ 
      key: config.openai.key, 
      history: currentHistory, 
      userReply,
      system_prompt: agentData.system_prompt
    });
    
    if (handoverIntent && (handoverIntent === 'POSITIVE_CLOSE' || handoverIntent === 'AI_FAILURE')) {
      log.warn(`Handover triggered for ${senderUsername}. Intent: ${handoverIntent}.`);
      await updateDialogState(CURRENT_AGENT_UUID, senderUsername, {
          status: 'PENDING_HANDOVER', pending_reply: agentReply, history: currentHistory
      });
      
      if(lead) await campaignManager.updateLeadStatus(lead.campaign_id, senderUsername, 'HANDOVER');
      
      await sendHandoverNotification({ 
        agent_id: CURRENT_AGENT_UUID,
        target_username: senderUsername, 
        lastMessage: userReply, 
        agentReply
      });
      return;
    }

    await sendMessage({ 
        client, 
        target: senderUsername, 
        text: agentReply,
        messageType: 'REPLY'
    });
    
    const finalHistory = [...currentHistory, { role: 'assistant', content: agentReply }];
    await updateDialogState(CURRENT_AGENT_UUID, senderUsername, { history: finalHistory, status: 'ACTIVE' });

  }, new NewMessage({}));
  
  log.info('Listener started...');
}

main().catch(err => log.error('Main error: ' + err.message, err));