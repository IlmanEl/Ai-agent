// src/modules/send.js
import Joi from 'joi';
import { log } from '../utils/logger.js';

// Вспомогательные функции
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

const schema = Joi.object({
    client: Joi.object().required(),
    target: Joi.string().required(),
    text: Joi.string().required(),
    // НОВЫЙ ФЛАГ: 'REPLY' (ответ) или 'OUTGOING' (холодная)
    messageType: Joi.string().valid('REPLY', 'OUTGOING').default('REPLY'),
});

export async function sendMessage(params) {
    // *** (ИСПРАВЛЕНИЕ ЗДЕСЬ) ***
    const { error, value } = schema.validate(params);
    if (error) throw new Error('Invalid params: ' + error.message); // Убрана 'B '
    // *** (КОНЕЦ ИСПРАВЛЕНИЯ) ***

    const { client, target, text, messageType } = value;

    // === ЛОГИКА 1: Исходящие (холодные) сообщения ===
    if (messageType === 'OUTGOING') {
        // TODO: Здесь будет Rate Limiter
        
        // Имитация "человека": печатание + задержка
        const typingDuration = Math.min(text.length * 50, 3000); // 50ms/символ
        log.info(`[Send] OUTGOING to ${target}. Simulating typing for ${typingDuration}ms...`);
        
        try {
            await client.invoke(new (await import('telegram')).Api.messages.SetTyping({
                peer: target,
                action: new (await import('telegram')).Api.SendMessageTypingAction()
            }));
        } catch (e) { /* ignore */ }

        await sleep(typingDuration);
    }

    // === ЛОГИКА 2: Ответы (быстрые) ===
    if (messageType === 'REPLY') {
        // Легкая имитация "человечности": 1-3 секунды (не 90!)
        const delay = randomInt(1000, 3000);
        log.info(`[Send] REPLY to ${target}. Light delay: ${Math.round(delay / 1000)}s`);
        await sleep(delay);
    }

    // === Общая отправка ===
    try {
        await client.sendMessage(target, { message: text });
        log.info(`[Send] ✅ (${messageType}) sent to ${target}`);
        return { status: 'sent' };
    } catch (err) {
        log.error(`[Send] (${messageType}) error: ${err.message}`);
        return { status: 'error', err: err.message };
    }
}