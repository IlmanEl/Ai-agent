import { getReply } from '../modules/aiAgent.js';
import { prepareHandover } from '../modules/handover.js';
import { log } from '../utils/logger.js';

export async function handleDialog({ key, history, userReply }) {
  history.push({ role: 'user', content: userReply });
  const agentReply = await getReply({ key, history, message: userReply });
  log.info('Agent reply: ' + agentReply);

  const intent = 'MAYBE'; // Тест, потом LLM
  const handoverRes = prepareHandover({ intent, history });
  return { agentReply, handoverRes };
}