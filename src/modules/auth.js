// src/modules/auth.js

import { TelegramClient } from 'telegram/client/TelegramClient.js';
import { StringSession } from 'telegram/sessions/StringSession.js';
import prompt from 'async-prompt';
import { log } from '../utils/logger.js';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getSession({ apiId, apiHash, phone }) {
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

    await client.connect(); 

    log.info('Waiting 5 seconds for DC migration to complete...');
    await sleep(5000); 

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