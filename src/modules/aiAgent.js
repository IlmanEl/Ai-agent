// src/modules/aiAgent.js
import OpenAI from 'openai';
import Joi from 'joi';
import { log } from '../utils/logger.js';

const schema = Joi.object({ 
    key: Joi.string().required(), 
    history: Joi.array().required(), 
    message: Joi.string().required(),
    system_prompt: Joi.string().required() 
});

export async function getReply(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: ' + error.message);

  const { key, history, message, system_prompt } = params;

  const openai = new OpenAI({ apiKey: key });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system_prompt }, 
        ...history.slice(-12)
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const jsonText = completion.choices[0].message.content;
    const jsonResponse = JSON.parse(jsonText);
    log.info('LLM Response (JSON): ' + JSON.stringify(jsonResponse));

    return {
        agentReply: jsonResponse.agentReply || "Пожалуйста, уточните ваш вопрос.",
        handoverIntent: jsonResponse.handoverIntent || 'NONE'
    };
    
  } catch (e) {
    log.error('OpenAI call failed or JSON parse error: ' + e.message);
   
    return { 
      agentReply: "Извините, сейчас небольшие технические неполадки. Я уточню ваш вопрос и скоро вернусь.", 
      handoverIntent: 'AI_FAILURE'
    };
  }
}