import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

// Файл, где хранится состояние диалогов
const STATE_FILE = path.resolve(process.cwd(), 'dialog_state.json');

// --- 1. Чтение и Запись Файла Состояния ---

let allDialogs = {};
try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    const loadedData = JSON.parse(data); 
    
    // Фильтруем ключи при загрузке, чтобы избежать TypeError
    for (const key in loadedData) {
        if (typeof key === 'string' && key.trim().length > 0) {
             allDialogs[key] = loadedData[key];
        } else {
             log.warn(`[State] Skipping invalid key during load: ${key}`);
        }
    }
    log.info(`[State] Loaded ${Object.keys(allDialogs).length} dialogs from file.`);
} catch (e) {
    if (e.code !== 'ENOENT') log.error('[State] Failed to load dialog state:', e.message);
    log.warn('[State] No dialog state file found or file corrupted, starting fresh.');
}

export function saveDialogState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(allDialogs, null, 2), 'utf8');
    } catch (e) {
        log.error('[State] Failed to save dialog state:', e.message);
    }
}

// --- 2. Функции Получения и Обновления Состояния ---

const DEFAULT_STATE = {
    history: [],
    status: 'NEW', // NEW, ACTIVE, PENDING_HANDOVER
    pendingReply: null, // Предложение агента, которое ждет одобрения
    targetId: null, // ID пользователя
    targetUsername: null, // Юзернейм пользователя
    lastUpdate: Date.now(),
};

export function getDialogState(targetUsername) {
    // Проверка типа в начале функции
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        log.error('[State] Invalid targetUsername provided.', { targetUsername });
        return { targetUsername: null, history: [], status: 'ERROR' };
    }
    
    // Юзернейм должен быть без символа '@' для использования в качестве ключа
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    
    if (!allDialogs[cleanUsername]) {
        // Сохраняем полный юзернейм в объекте для удобства
        allDialogs[cleanUsername] = { ...DEFAULT_STATE, targetUsername: targetUsername }; 
        saveDialogState();
    }
    return allDialogs[cleanUsername];
}

export function updateDialogState(targetUsername, updates) {
    // Проверка типа в начале функции
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        log.error('[State] Invalid targetUsername provided for update.', { targetUsername });
        return; 
    }
    
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    const state = getDialogState(targetUsername);
    
    allDialogs[cleanUsername] = {
        ...state,
        ...updates,
        lastUpdate: Date.now(),
    };
    saveDialogState();
    return allDialogs[cleanUsername];
}

// !!! НЕДОСТАЮЩАЯ ФУНКЦИЯ ДЛЯ ИСПРАВЛЕНИЯ SyntaxError !!!
export function resetHandoverStatus(targetUsername) {
    // Сбрасываем статус с PENDING_HANDOVER на ACTIVE
    updateDialogState(targetUsername, { status: 'ACTIVE', pendingReply: null });
    log.info(`[State] Reset handover status for ${targetUsername} to ACTIVE.`);
}