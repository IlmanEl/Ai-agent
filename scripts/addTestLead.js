// scripts/addTestLead.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config(); 


const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

const YOUR_AGENT_UUID = "8435c742-1f1e-4e72-a33b-2221985e9f83";
const YOUR_CLIENT_ID = "799bd492-5a5f-46e0-80ea-fc83f5fef360"; 
const YOUR_USERNAME_TO_TEST = "ilmanEl";

async function createTestCampaign() {
    console.log('Using Agent ID:', YOUR_AGENT_UUID);
    console.log('Using Client ID:', YOUR_CLIENT_ID);

    if (YOUR_CLIENT_ID.startsWith("ЗАМЕНИТЕ")) {
        console.error("Ошибка: Замените YOUR_CLIENT_ID в скрипте.");
        return;
    }

    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
            client_id: YOUR_CLIENT_ID,
            name: 'TEST: Ilman Dialog Test',
            status: 'ACTIVE'
        })
        .select()
        .single();

    if (campaignError) {
        console.error("Ошибка создания кампании:", campaignError.message);
        return;
    }
    console.log('✅ Создана кампания:', campaign.id);

    const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
            campaign_id: campaign.id,
            username: YOUR_USERNAME_TO_TEST,  
            channel_name: 'Test Channel',
            status: 'NEW',
            assigned_agent_id: YOUR_AGENT_UUID
        })
        .select();

    if (leadError) {
        console.error("Ошибка добавления лида:", leadError.message);
        return;
    }

    console.log('✅ Добавлен тестовый лид:', lead);
    console.log('\n🎉 Готово! Запускайте: node index.js');
}

createTestCampaign().catch(console.error);