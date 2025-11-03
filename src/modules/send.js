// src/modules/send.js
import Joi from 'joi';
import { log } from '../utils/logger.js';

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
    messageType: Joi.string().valid('REPLY', 'OUTGOING').default('REPLY'),
});

export async function sendMessage(params) {
    const { error, value } = schema.validate(params);
    if (error) throw new Error('Invalid params: ' + error.message); 

    const { client, target, text, messageType } = value;

    if (messageType === 'OUTGOING') {
        
        const typingDuration = Math.min(text.length * 50, 3000); 
        log.info(`[Send] OUTGOING to ${target}. Simulating typing for ${typingDuration}ms...`);
        
        try {
            await client.invoke(new (await import('telegram')).Api.messages.SetTyping({
                peer: target,
                action: new (await import('telegram')).Api.SendMessageTypingAction()
            }));
        } catch (e) {  }

        await sleep(typingDuration);
    }

    if (messageType === 'REPLY') {
        const delay = randomInt(1000, 3000);
        log.info(`[Send] REPLY to ${target}. Light delay: ${Math.round(delay / 1000)}s`);
        await sleep(delay);
    }

    try {
        await client.sendMessage(target, { message: text });
        log.info(`[Send] ✅ (${messageType}) sent to ${target}`);
        return { status: 'sent' };
    } catch (err) {
        log.error(`[Send] (${messageType}) error: ${err.message}`);
        return { status: 'error', err: err.message };
    }
}