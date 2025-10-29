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
            .select('id, agent_name, tg_session_string, system_prompt, initial_opener_text')
            .eq('id', agent_id); 

        if (error) {
            log.error(`[DB] Error during agent fetch: ${error.message}`);
            throw error;
        }

        if (!data || data.length === 0) {
            log.error(`[DB] Error fetching agent: 0 rows found for UUID ${agent_id}`);
            return null;
        }
        
        return data[0]; 

    } catch (e) {
        log.error(`[DB] Catch exception fetching agent: ${e.message}`);
        return null;
    }
}

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