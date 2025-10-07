import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import input from 'input';
import { log } from '../utils/logger.js';

export async function getSession({ apiId, apiHash, phone }) {
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: () => phone,
    phoneCode: () => input.text('Код из TG: '),
    password: () => input.text('Пароль 2FA (Enter если нет): '),
    onError: (err) => log.error('Auth error:', err),
  });
  const sessionStr = client.session.save();
  await client.disconnect();
  return sessionStr;
}