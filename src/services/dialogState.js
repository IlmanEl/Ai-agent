// src/services/dialogState.js
import { getDialog, upsertDialog } from '../modules/db.js';
import { log } from '../utils/logger.js';

const DEFAULT_STATE = { 
    history: [], 
    status: 'NEW', 
    pending_reply: null,
    last_update: new Date().toISOString()
};

/**
 * АСИНХРОННО получает состояние диалога из БД.
 */
export async function getDialogState(agent_id, target_username) {
    if (!agent_id || !target_username) {
        log.warn('[State] Invalid agent_id or target_username to getDialogState');
        return { ...DEFAULT_STATE, status: 'ERROR' };
    }
    
    const dbState = await getDialog(agent_id, target_username);

    if (dbState) {
        return { 
            ...DEFAULT_STATE, 
            ...dbState 
        };
    } else {
        // Создаем новое состояние в памяти (оно будет сохранено при первом update)
        return { 
            ...DEFAULT_STATE, 
            agent_id: agent_id,
            target_username: target_username 
        };
    }
}

/**
 * АСИНХРОННО обновляет состояние диалога в БД.
 */
export async function updateDialogState(agent_id, target_username, updates) {
    if (!agent_id || !target_username) {
        log.warn('[State] Invalid agent_id or target_username to updateDialogState');
        return;
    }

    const currentState = await getDialogState(agent_id, target_username);
    
    const newState = {
        ...currentState,
        ...updates,
        last_update: new Date().toISOString(),
        agent_id: agent_id, // Убедимся, что ключи на месте
        target_username: target_username
    };
    
    // `upsertDialog` сам справится с созданием или обновлением
    await upsertDialog(newState);
}

export async function resetHandoverStatus(agent_id, target_username) {
    if (!agent_id || !target_username) {
        return;
    }
    await updateDialogState(agent_id, target_username, { status: 'ACTIVE', pending_reply: null });
    log.info(`[State] Reset handover status for ${target_username} to ACTIVE.`);
}

/**
 * Эта функция больше не нужна в новой логике
 */
export async function getAllDialogs() {
    log.warn('[State] getAllDialogs() is deprecated.');
    return {};
}