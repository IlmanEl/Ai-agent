// src/services/dialogState.js 
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';


const STATE_FILE = path.resolve(process.cwd(), 'dialog_state.json');



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


const DEFAULT_STATE = { history: [], status: 'NEW', pendingReply: null, targetId: null, targetUsername: null };

export function getDialogState(agentId, targetUsername) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        log.error('[State] Invalid targetUsername provided for getDialogState.', { targetUsername });
        return { ...DEFAULT_STATE, status: 'ERROR' };
    }
    
   
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;

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
    

    const state = getDialogState(agentId, targetUsername); 
    
    allDialogs[key] = {
        ...state,
        ...updates,
        lastUpdate: Date.now(),
    };
    saveDialogState();
    return allDialogs[key];
}

export function resetHandoverStatus(agentId, targetUsername) {
    updateDialogState(agentId, targetUsername, { status: 'ACTIVE', pendingReply: null });
    log.info(`[State] Reset handover status for ${targetUsername} to ACTIVE.`);
}


export function getAllDialogs(agentId) {
     const agentDialogs = {};
     for (const key in allDialogs) {
         if (key.startsWith(agentId + '_')) {
             agentDialogs[key] = allDialogs[key];
         }
     }
     return agentDialogs;
}