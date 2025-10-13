// src/modules/auth.js

import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import prompt from 'async-prompt';
import { log } from '../utils/logger.js';

// Функция для создания задержки (ДОЛЖНА БЫТЬ)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getSession({ apiId, apiHash, phone }) {
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

    // --- 1. Клиент запускается без запроса кода ---
    await client.connect(); 

    // --- 2. Ждем, чтобы избежать ошибки миграции DC ---
    log.info('Waiting 5 seconds for DC migration to complete...');
    await sleep(5000); 

    // --- 3. Только теперь запускаем авторизацию с запросом кода ---
    await client.start({
        phoneNumber: async () => phone,
        password: async () => await prompt('Пароль 2FA (если есть): '),
        phoneCode: async () => await prompt('Код из TG: '),
        onError: (err) => log.error('Auth error: ' + err.message + ' (caused by ' + err.className + ')', err.original)
    });

    const sessionString = client.session.save();
    client.disconnect();
    return sessionString;
}