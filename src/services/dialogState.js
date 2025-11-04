// src/services/dialogState.js (ПРАВИЛЬНАЯ ВЕРСИЯ)
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

// Файл, где хранится состояние диалогов
const STATE_FILE = path.resolve(process.cwd(), 'dialog_state.json');

// --- 1. Чтение и Запись Файла Состояния ---

let allDialogs = {};
try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    allDialogs = JSON.parse(data);
    log.info(`[State] Loaded ${Object.keys(allDialogs).length} dialogs from file.`);
} catch (e) {
    if (e.code !== 'ENOENT') log.error('[State] Failed to load dialog state:', e.message);
    else log.warn('[State] No dialog state file found, starting fresh.');
    allDialogs = {};
}

export function saveDialogState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(allDialogs, null, 2), 'utf8');
    } catch (e) {
        log.error('[State] Failed to save dialog state:', e.message);
    }
}

// --- 2. Функции Получения и Обновления Состояния ---

const DEFAULT_STATE = { history: [], status: 'NEW', pendingReply: null, targetId: null, targetUsername: null };

export function getDialogState(agentId, targetUsername) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        log.error('[State] Invalid targetUsername provided for getDialogState.', { targetUsername });
        return { ...DEFAULT_STATE, status: 'ERROR' };
    }
    
    // Юзернейм должен быть без @
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    // Ключ = AGENT_ID + USERNAME (для поддержки нескольких агентов)
    const key = `${agentId}_${cleanUsername}`; 
    
    if (!allDialogs[key]) {
        allDialogs[key] = { ...DEFAULT_STATE, targetUsername: targetUsername };
        saveDialogState();
    }
    return allDialogs[key];
}

export function updateDialogState(agentId, targetUsername, updates) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        log.error('[State] Invalid targetUsername provided for update.', { targetUsername });
        return;
    }
    
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    const key = `${agentId}_${cleanUsername}`;
    
    // Используем getDialogState, чтобы создать запись, если ее нет
    const state = getDialogState(agentId, targetUsername); 
    
    allDialogs[key] = {
        ...state,
        ...updates,
        lastUpdate: Date.now(),
    };
    saveDialogState();
    return allDialogs[key];
}

// Эта функция нужна для Control Bot'а
export function resetHandoverStatus(agentId, targetUsername) {
    updateDialogState(agentId, targetUsername, { status: 'ACTIVE', pendingReply: null });
    log.info(`[State] Reset handover status for ${targetUsername} to ACTIVE.`);
}

// Эта функция нужна для Control Bot'а
export function getAllDialogs(agentId) {
     const agentDialogs = {};
     for (const key in allDialogs) {
         if (key.startsWith(agentId + '_')) {
             agentDialogs[key] = allDialogs[key];
         }
     }
     return agentDialogs;
}