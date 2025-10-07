// src/services/dialog.js

import { getReply } from '../modules/aiAgent.js';
import { log } from '../utils/logger.js';

export async function handleDialog({ key, history, userReply }) {
  // history.push({ role: 'user', content: userReply }); // Временно убрано, т.к. добавляется в index.js после успешной отправки
  
  const { agentReply, handoverIntent } = await getReply({ key, history, message: userReply });
  log.info(`Agent Reply (Intent: ${handoverIntent}): ${agentReply}`);
  
  return { agentReply, handoverIntent };
}