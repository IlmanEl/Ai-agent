// src/services/dialog.js

import { getReply } from '../modules/aiAgent.js';
import { log } from '../utils/logger.js';

// !!! ИСПРАВЛЕНИЕ: Добавляем `system_prompt` в параметры !!!
export async function handleDialog({ key, history, userReply, system_prompt }) {
  
  // !!! ИСПРАВЛЕНИЕ: Пробрасываем `system_prompt` дальше в `getReply` !!!
  const { agentReply, handoverIntent } = await getReply({ 
    key, 
    history, 
    message: userReply, 
    system_prompt 
  });

  log.info(`Agent Reply (Intent: ${handoverIntent}): ${agentReply}`);
  
  return { agentReply, handoverIntent };
}