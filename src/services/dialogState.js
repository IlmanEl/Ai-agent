// src/services/dialogState.js

import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

const STATE_FILE = path.resolve(process.cwd(), 'dialog_state.json');

let allDialogs = {};
try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    allDialogs = JSON.parse(data) || {};
} catch (e) {
    if (e.code !== 'ENOENT') log.error('[State] Failed to load dialog state:', e.message);
    else log.warn('[State] No dialog state file found, starting fresh.');
}

export function saveDialogState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(allDialogs, null, 2), 'utf8');
    } catch (e) {
        log.error('[State] Failed to save dialog state:', e.message);
    }
}

const DEFAULT_STATE = { history: [], status: 'NEW', pendingReply: null, targetId: null, targetUsername: null };

export function getDialogState(targetUsername) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        return { ...DEFAULT_STATE, status: 'ERROR' };
    }
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    if (!allDialogs[cleanUsername]) {
        allDialogs[cleanUsername] = { ...DEFAULT_STATE, targetUsername: targetUsername };
        saveDialogState();
    }
    return allDialogs[cleanUsername];
}

export function getAllDialogs() {
    return allDialogs;
}

export function updateDialogState(targetUsername, updates) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        return;
    }
    const cleanUsername = targetUsername.startsWith('@') ? targetUsername.substring(1) : targetUsername;
    const state = getDialogState(targetUsername);
    allDialogs[cleanUsername] = { ...state, ...updates, lastUpdate: Date.now() };
    saveDialogState();
}

export function resetHandoverStatus(targetUsername) {
    if (typeof targetUsername !== 'string' || !targetUsername.trim()) {
        return;
    }
    updateDialogState(targetUsername, { status: 'ACTIVE', pendingReply: null });
    log.info(`[State] Reset handover status for ${targetUsername} to ACTIVE.`);
}