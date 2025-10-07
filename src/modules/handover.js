import Joi from 'joi';
import { log } from '../utils/logger.js';

const schema = Joi.object({
  intent: Joi.string().required(),
  history: Joi.array().required()
});

export function prepareHandover(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: ' + error.message);

  const { intent, history } = params;

  // Если человек проявил интерес, но мы хотим вести короткий диалог
  if (intent === 'YES' || intent === 'MAYBE') {
    const lastMessage = history.at(-1)?.text?.toLowerCase() || '';

    // Этап 1 — начальный ответ на интерес
    if (lastMessage.includes('давай') || lastMessage.includes('интересно')) {
      const autoReply = 'Отлично! Хотите, я коротко расскажу, как это работает, или сразу обсудим детали?';
      log.info('Auto-reply (stage 1): ' + autoReply);
      return { autoReply, needHuman: false };
    }

    // Этап 2 — если пользователь ответил утвердительно на вышее сообщение
    const confirmed = history.some(m => /да|ок|расскажи|интересно/i.test(m.text));
    if (confirmed) {
      const suggested = 'Привет. Давай обсудим детали. Когда удобно?';
      log.info('Handover needed. Suggested: ' + suggested);
      return { autoReply: suggested, needHuman: true };
    }
  }

  return { needHuman: false };
}
