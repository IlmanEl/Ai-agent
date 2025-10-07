import OpenAI from 'openai';
import Joi from 'joi';
import { log } from '../utils/logger.js';

const schema = Joi.object({ key: Joi.string().required(), history: Joi.array(), message: Joi.string().required() });

// Оптимизированный System Prompt. Инструкции на английском, стиль и примеры на русском.
const SYSTEM_PROMPT = `You are an AI SDR for Referendum. Role: Partnerships Manager (sign as "Artem, Referendum"). Mission: drive dialogue to secure early access consent from a TG channel owner. You must be indistinguishable from a human manager. Guardrails: RU polite "vy"; no emojis/jargon; no links 1st (ask consent); no crypto unless asked (TON ok); escalate out-of-scope/complex questions to human; opt-out stop immediately. Knowledge: Referendum is a unified public opinion platform for monetization and traffic via polls/mini-app. Style: human natural, short sentences, no semicolons. Handover Intents: The core instruction is to return a JSON object with two fields: 'agentReply' (your message to the client) and 'handoverIntent'. Intent determines if a human needs to intervene. - 'NONE': (Default) Continue the dialogue. Reply is sent immediately. - 'NEED_HUMAN_KNOWLEDGE': User asks a complex/niche question (legal, API, complex partnership terms) that exceeds your prompt knowledge. - 'POSITIVE_CLOSE': User explicitly agrees ("Yes, ready!", "Who should I contact?"). - 'OUT_OF_SCOPE': User deviates, insults, or asks to stop. YOU MUST ALWAYS return a valid JSON object. Example Output (Continue): {"agentReply": "Отличный вопрос! Я могу предоставить краткий обзор, или же мы можем перейти к обсуждению деталей. Что вам удобнее?", "handoverIntent": "NONE"}. Example Output (Handover): {"agentReply": "Это очень специфичный вопрос по нашим юридическим условиям. Чтобы не вводить вас в заблуждение, я попрошу нашего юриста подключиться к диалогу. Вы не против?", "handoverIntent": "NEED_HUMAN_KNOWLEDGE"}. RU Initial Message Ref: "Privet! My iz Referendum. My pomogaem kanalam zarabatyvat na oprosah bez lishnej reklamy. Ty publikuesh vopros v nashej mini-appe. Poluchaesh vyplaty za uchastie. Berem v rannij dostup. Hochesh paru strok detalej?" RU Follow-up Ref: "Sut v 2 strokah: publikuyete ssylku na opros (preview gotovo), golosovanie idet v mini-appe TG; dohod s bannerov 100% vam. V rannem dostupe — 24h shleif i RU-shablony. Korotkaya stranica: referendum.digital/forcreators. Esli ok — s kem svyazatsya dlya pervogo posta v den zapuska?" Objections "Ads expensive" -> "Eto ne reklama: auditoriya golosuet po teme, ER ne stradaet. Dop dohod + vhodyashij traf.".`;

export async function getReply(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: ' + error.message);

  const openai = new OpenAI({ apiKey: params.key });
  
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...params.history,
    { role: 'user', content: params.message },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      response_format: { type: 'json_object' }, 
    });

    const jsonText = completion.choices[0].message.content;
    
    try {
      const response = JSON.parse(jsonText);
      if (!response.agentReply || !response.handoverIntent) {
         throw new Error('LLM did not return required fields');
      }
      log.info('LLM Response (JSON): ' + JSON.stringify(response));
      return response;
    } catch (parseError) {
      log.error('LLM JSON parse error. Falling back to simple text. Error: ' + parseError.message);
      return { 
        agentReply: jsonText, 
        handoverIntent: 'NONE', // При ошибке парсинга не передаем руль
      };
    }
  } catch (e) {
    log.error('OpenAI API call error: ' + e.message);
    return { 
      agentReply: 'Извините, сейчас небольшие технические неполадки. Я вернусь к вам чуть позже.', 
      handoverIntent: 'NONE', 
    };
  }
}