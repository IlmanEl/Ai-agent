// src/services/campaignManager.js
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { log } from '../utils/logger.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

class CampaignManager {
    
    /**
     * Получить ОДНОГО следующего лида для агента
     */
    async getNextLead(agent_id) {
        try {
            const { data, error } = await supabase
                .from('leads')
                .select('*, campaigns!inner(id, client_id, status)')
                .eq('assigned_agent_id', agent_id)
                .eq('status', 'NEW')
                .eq('campaigns.status', 'ACTIVE')
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = 0 строк, это не ошибка
                log.error(`[CampaignManager] Error fetching next lead: ${error.message}`);
                return null;
            }
            return data;
        } catch (e) {
            log.error(`[CampaignManager] Exception: ${e.message}`);
            return null;
        }
    }

    /**
     * Получить ВСЕХ, с кем агент УЖЕ общается
     */
    async getActiveDialogs(agent_id) {
        try {
            const { data, error } = await supabase
                .from('leads')
                .select('username, status, campaign_id')
                .eq('assigned_agent_id', agent_id)
                .in('status', ['CONTACTED', 'REPLIED', 'HANDOVER']) // Все, кто не 'NEW'
                .order('last_contact_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (e) {
            log.error(`[CampaignManager] Error fetching active dialogs: ${e.message}`);
            return [];
        }
    }

    /**
     * Обновить статус лида (e.g., 'NEW' -> 'CONTACTED')
     */
    async updateLeadStatus(campaign_id, username, newStatus, metadata = {}) {
        const cleanUsername = username.startsWith('@') ? username.substring(1) : username;
        
        try {
            const updateData = {
                status: newStatus,
                last_contact_at: new Date().toISOString(),
                ...metadata
            };

            if (newStatus === 'CONTACTED') {
                updateData.first_contact_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('leads')
                .update(updateData)
                .eq('campaign_id', campaign_id)
                .eq('username', cleanUsername);

            if (error) throw error;
            log.info(`[CampaignManager] Lead ${username} status -> ${newStatus}`);
        } catch (e) {
            log.error(`[CampaignManager] Error updating lead: ${e.message}`);
        }
    }
}

export const campaignManager = new CampaignManager();