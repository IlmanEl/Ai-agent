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
        if (error && error.code !== 'PGRST116') {
            log.error(`[DB] Error fetching dialog for ${cleanUsername}:`, error.message);
            return null;
        }
        return data;
    } catch (e) {
        log.error(`[DB] Exception fetching dialog: ${e.message}`);
        return null;
    }
}
export async function upsertDialog(dialogData) {
    if (!supabase) {
        log.error('[DB] Supabase client not available.');
        return null;
    }
    if (dialogData.target_username) {
        dialogData.target_username = dialogData.target_username.startsWith('@') 
            ? dialogData.target_username.substring(1) 
            : dialogData.target_username;
    }
    try {
        const { data, error } = await supabase
            .from('dialogs')
            .upsert(dialogData, { onConflict: 'agent_id, target_username' })
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


export async function getAgent(agent_id) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('ai_agents')
            .select(`
                id, 
                agent_name, 
                tg_session_string, 
                initial_opener_text,
                client_id,
                core_system_prompt,
                agent_persona
            `)
            .eq('id', agent_id)
            .single();

        if (error) {
            log.error(`[DB] Error fetching agent: ${error.message}`);
            return null;
        }
        if (!data) {
            log.error(`[DB] Agent not found: ${agent_id}`);
            return null;
        }
        // Валидация (проверка), что промпты не пустые
        if (!data.client_id) {
            log.error(`[DB] Agent ${agent_id} не привязан к client_id!`);
            return null;
        }
        if (!data.core_system_prompt || !data.agent_persona) {
            log.error(`[DB] Agent ${agent_id}: core_system_prompt или agent_persona ПУСТЫЕ! Заполните их в Supabase (Шаг 1).`);
            return null;
        }
        
        return data;

    } catch (e) {
        log.error(`[DB] Exception fetching agent: ${e.message}`);
        return null;
    }
}