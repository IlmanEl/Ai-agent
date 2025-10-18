// src/services/dialog.js

import { getReply } from '../modules/aiAgent.js';
import { log } from '../utils/logger.js';

/**
 * Processes the dialog by calling the LLM and returning its structured response.
 * @returns {Promise<object>} - { agentReply: string, handoverIntent: string }
 */
export async function handleDialog({ key, history, userReply }) {
  
  // Call the LLM to get a structured response { agentReply, handoverIntent }
  const llmResponse = await getReply({ key, history, message: userReply });
  
  log.info(`Agent Reply (Intent: ${llmResponse.handoverIntent}): ${llmResponse.agentReply}`);
  
  // Directly return the structured response from the AI agent
  return llmResponse;
}