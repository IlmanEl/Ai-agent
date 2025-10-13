// src/config/env.js

import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const schema = Joi.object({
  TG_API_ID: Joi.number().required(),
  TG_API_HASH: Joi.string().required(),
  TG_PHONE: Joi.string().required(),
  TG_SESSION: Joi.string().allow('', null).optional(),
  OPENAI_API_KEY: Joi.string().required(),
  SUPABASE_URL: Joi.string().allow('', null).optional(),
  SUPABASE_KEY: Joi.string().allow('', null).optional(),
  
  // !!! НОВЫЕ ПЕРЕМЕННЫЕ ДЛЯ CONTROL BOT'А !!!
  CONTROL_BOT_TOKEN: Joi.string().required(),
  CONTROL_SECRET_KEY: Joi.string().required(),
  CONTROL_ADMIN_ID: Joi.number().optional().allow(null), 

}).unknown(true); // Allow extra system env vars

const { error } = schema.validate(process.env);
if (error) {
  throw new Error('Invalid required env: ' + error.message);
}

export const config = {
  tg: {
    apiId: Number(process.env.TG_API_ID),
    apiHash: process.env.TG_API_HASH,
    phone: process.env.TG_PHONE,
    session: process.env.TG_SESSION || '',
  },
  openai: {
    key: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
  },
  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },
  
  // !!! НОВАЯ КОНФИГУРАЦИЯ CONTROL BOT'А !!!
  controlBot: {
    token: process.env.CONTROL_BOT_TOKEN,
    secretKey: process.env.CONTROL_SECRET_KEY, 
    adminId: Number(process.env.CONTROL_ADMIN_ID) || null,
  },

  testTarget: ['@ilmanEl'],
  rateLimit: { enabled: false, intervalMs: 600000 },
};