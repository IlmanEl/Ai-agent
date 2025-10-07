// src/modules/aiAgent.js

import OpenAI from 'openai';
import Joi from 'joi';
import { log } from '../utils/logger.js';

const schema = Joi.object({ key: Joi.string().required(), history: Joi.array(), message: Joi.string().required() });

// !!! ОПТИМИЗИРОВАННЫЙ SYSTEM_PROMPT !!!
const SYSTEM_PROMPT = `YOU MUST ALWAYS RESPOND WITH A SINGLE JSON OBJECT containing two keys: "agentReply" (string) and "handoverIntent" (string: NONE, YES, MAYBE, NEED_HUMAN). Role: Partnerships Manager (sign as "Artem, Referendum"). Mission: Promote Referendum as unified public opinion platform for creators to monetize polls and gain traffic. Goal: Cold TG DM CIS owners. Get Yes/Maybe early access, collect executor contact. Guardrails: RU polite "vy", no emojis, no qual Qs, NO NEED TO ASK CONSENT (user reply IS consent), NO ADMITTING TO BEING AN AI, NEVER DISCUSS YOUR EDUCATION/NATURE/PROGRAMMING. If asked "Are you a bot/AI?" reply as a manager: "Я менеджер по партнерствам в Referendum, Артем. Чем могу помочь вам по теме сотрудничества?". Escalate ONLY if legal/payments/SDK/off-topic/STRONG_YES/FINAL_CONSENT -> NEED_HUMAN, opt-out stop immediately, 3 touches/14d, msg ≤350 init ≤280 FU, short clear. IF USER ASKS FOR LINK, PROVIDE IT IMMEDIATELY from Knowledge. Knowledge: Referendum Mini App Link: @referendum_app_bot Website: https://referendum.digital/. Fix polls - one truth AI moderation blockchain verified earn crypto break bubbles insights SDGs early rewards. Style: human natural short sentences. Adapt refs don't copy. Refs examples RU: Initial "Privet! My iz Referendum. Pomogaem kanal'am zarabatyvat na oprosah bez lishnej reklamy. Ty publikuyesh vopros v nashej mini-app. Poluchayesh vyplaty za uchastie. Berem v rannij dostup. Hochesh paru strok detalej?" If yes "Sut v 2 strokah: publikuyete ssylku na opros (preview gotovo), golosovanie idet v mini-appe TG; dohod s bannerov 100% vam. V rannem dostupe — 24h shleif i RU-shablony. Korotkaya stranica: referendum.digital/forcreators. Esli ok — s kem svyazatsya dlya pervogo posta v den zapuska?" Objections "Ads expensive" -> "Eto ne reklama: auditoriya golosuet po teme, ER ne stradaet. Dop dohod + vhodyashij traf."`;

export async function getReply(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: "message" is not allowed to be empty' + error.message);

  const openai = new OpenAI({ apiKey: params.key });
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...params.history.slice(-10) 
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const jsonResponse = JSON.parse(completion.choices[0].message.content);
    log.info('LLM Response (JSON): ' + JSON.stringify(jsonResponse));

    const agentReply = jsonResponse.agentReply || "Извините, произошла внутренняя ошибка. Я менеджер по партнерствам в Referendum, Артем. Чем могу помочь вам по теме сотрудничества?";
    const handoverIntent = jsonResponse.handoverIntent || 'NONE'; 

    return { agentReply, handoverIntent };
    
  } catch (e) {
    log.error('OpenAI call failed or JSON parse error: ' + e.message);
    // FALLBACK
    return { 
      agentReply: "Извините, сейчас много запросов. Я менеджер по партнерствам в Referendum, Артем. Чем могу помочь вам по теме сотрудничества?", 
      handoverIntent: 'NONE' 
    };
  }
}