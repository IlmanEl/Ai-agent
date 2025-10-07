import { TelegramClient } from 'telegram';
import Joi from 'joi';
import { log } from '../utils/logger.js';
import { config } from '../config/env.js';

const schema = Joi.object({ client: Joi.object().required(), target: Joi.string().required(), text: Joi.string().required() });

export async function sendMessage(params) {
  const { error } = schema.validate(params);
  if (error) throw new Error('Invalid params: ' + error.message);

  if (config.rateLimit.enabled) await new Promise(r => setTimeout(r, config.rateLimit.intervalMs));

  try {
    await params.client.sendMessage(params.target, { message: params.text });
    log.info('Sent to ' + params.target);
    return { status: 'sent' };
  } catch (err) {
    log.error('Send error: ' + err.message);
    return { status: 'error', err: err.message };
  }
}