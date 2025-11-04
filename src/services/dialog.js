import { getReply } from '../modules/aiAgent.js'; // Убедитесь, что путь правильный
import { log } from '../utils/logger.js';

export async function handleDialog({ key, history, userReply, agentData }) {
  
  const { agentReply, handoverIntent } = await getReply({ 
    key, 
    history, 
    userReply: userReply, 
    agentData // ← Передаем весь объект
  });

  log.info(`[Dialog] Intent: ${handoverIntent}, Reply: ${agentReply.substring(0, 50)}...`);
  
  return { agentReply, handoverIntent };
}