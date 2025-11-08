// src/modules/db.js (ПРАВИЛЬНАЯ ВЕРСИЯ)
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { log } from '../utils/logger.js';

let supabase = null;
if (config.supabase.url && config.supabase.key) {
    supabase = createClient(config.supabase.url, config.supabase.key);
    log.info('[DB] Supabase client initialized.');
} else {
    log.warn('[DB] Supabase URL or Key not provided. DB features will be disabled.');
}

// Эта функция теперь читает НОВЫЕ поля (core_system_prompt и agent_persona)
export async function getAgent(agent_id) {
    if (!supabase) {
        log.error("[DB] Supabase client not initialized.");
        return null;
    }
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
            log.error(`[DB] Agent ${agent_id}: core_system_prompt или agent_persona ПУСТЫЕ! Заполните их в Supabase.`);
            return null;
        }
        
        return data;

    } catch (e) {
        log.error(`[DB] Exception fetching agent: ${e.message}`);
        return null;
    }
}