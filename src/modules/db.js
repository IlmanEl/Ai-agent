// src/modules/db.js
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { log } from '../utils/logger.js';

let supabase;
try {
    supabase = createClient(config.supabase.url, config.supabase.key);
    log.info('[DB] Supabase client initialized.');
} catch (e) {
    log.error('[DB] Supabase client initialization failed:', e.message);
    supabase = null;
}

/**
 * Получает ОДИН диалог по `agent_id` и `target_username`
 */
export async function getDialog(agent_id, target_username) {
    if (!supabase) {
        log.error('[DB] Supabase client not available.');
        return null;
    }
    const cleanUsername = target_username.startsWith('@') ? target_username.substring(1) : target_username;

    try {
        const { data, error } = await supabase
            .from('dialogs')
            .select('*')
            .eq('agent_id', agent_id)
            .eq('target_username', cleanUsername)
            .single();

        if (error && error.code !== 'PGRST116') { // 'No rows found' (это не ошибка)
            log.error(`[DB] Error fetching dialog for ${cleanUsername}:`, error.message);
            return null;
        }
        return data; // null или объект
    } catch (e) {
        log.error(`[DB] Exception fetching dialog: ${e.message}`);
        return null;
    }
}

/**
 * Создает или обновляет диалог
 */
export async function upsertDialog(dialogData) {
    if (!supabase) {
        log.error('[DB] Supabase client not available.');
        return null;
    }
    
    // Убедимся, что `target_username` без "@"
    if (dialogData.target_username) {
        dialogData.target_username = dialogData.target_username.startsWith('@') 
            ? dialogData.target_username.substring(1) 
            : dialogData.target_username;
    }

    try {
        const { data, error } = await supabase
            .from('dialogs')
            .upsert(dialogData, { onConflict: 'agent_id, target_username' }) // Уникальный ключ
            .select()
            .single();

        if (error) {
            log.error(`[DB] Error upserting dialog:`, error.message);
            return null;
        }
        return data;
    } catch (e) {
        log.error(`[DB] Exception upserting dialog: ${e.message}`);
        return null;
    }
}

/**
 * Получает одного агента по его ID
 */
export async function getAgent(agent_id) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('ai_agents')
            .select('*')
            .eq('id', agent_id)
            .single();
        if (error) throw error;
        return data;
    } catch (e) {
        log.error(`[DB] Error fetching agent: ${e.message}`);
        return null;
    }
}

/**
 * Получает ОДНОГО клиента по его ID
 */
export async function getClient(client_id) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('id', client_id)
            .single();
        if (error) throw error;
        return data;
    } catch (e) {
        log.error(`[DB] Error fetching client: ${e.message}`);
        return null;
    }
}