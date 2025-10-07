import dotenv from 'dotenv';
dotenv.config();

try {
  await import('telegram/client/TelegramClient.js');
} catch {
  throw new Error('Package telegram not installed or broken. Run npm i.');
}

import { getSession } from './src/modules/auth.js';
import { sendMessage } from './src/modules/send.js';
import { getDbClient } from './src/modules/db.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { log } from './src/utils/logger.js';
import { handleDialog } from './src/services/dialog.js';
import { config } from './src/config/env.js';
import { NewMessage } from 'telegram/events/index.js';


async function main() {
  const { apiId, apiHash, phone, session } = config.tg;

  if (!session) {
    const newSession = await getSession({ apiId, apiHash, phone });
    log.info('New session: ' + newSession + ' (add to .env TG_SESSION)');
    return;
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
  await client.start();

  const dbClient = getDbClient({ url: config.supabase.url, key: config.supabase.key });

  const target = config.testTarget;
  const history = [];

  // Initial
  const initialText = 'Привет. Я Ильман из Referendum. Мы помогаем каналам зарабатывать на опросах без лишней рекламы. Ты публикуешь вопрос в нашей мини-аппе. Получаешь выплаты за участие. Берем в ранний доступ. Хочешь пару строк деталей?';
  const sendRes = await sendMessage({ client, target, text: initialText });
  log.info('Initial send: ' + JSON.stringify(sendRes));
  await dbClient.insert('outbox', { target, text: initialText, status: sendRes.status }).catch(err => log.error('DB: ' + err));

  // Listener
client.addEventHandler(async (event) => {
  if (event.isPrivate && event.message.senderId.value === (await client.getEntity(target)).id.value) {
    const userReply = event.message.text;
    log.info('Received from ' + target + ': ' + userReply);

    const { agentReply, handoverRes } = await handleDialog({ key: config.openai.key, history, userReply });
    if (handoverRes.needHuman) {
      log.info('Handover: ' + handoverRes.suggested);
      return;
    }

    const sendReplyRes = await sendMessage({ client, target, text: agentReply });
    log.info('Send reply: ' + JSON.stringify(sendReplyRes));
    history.push({ role: 'assistant', content: agentReply });
  }
}, new NewMessage({}));


  log.info('Listener started. Жди ответа от Богдана - агент обработает.');
  process.on('SIGINT', async () => {
    log.info('Stopping...');
    await client.disconnect();
    process.exit(0);
  });
}

main().catch(err => log.error('Main error: ' + err));