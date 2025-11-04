// src/services/aiAgent.js
import OpenAI from 'openai';
import Joi from 'joi';
import { log } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const supabase = createClient(config.supabase.url, config.supabase.key);

// Схема Joi для валидации
const schema = Joi.object({ 
    key: Joi.string().required(), 
    history: Joi.array().required(), 
    userReply: Joi.string().required(),
    agentData: Joi.object({
        client_id: Joi.string().required(),
        core_system_prompt: Joi.string().required(),
        agent_persona: Joi.string().required()
    }).required().unknown(true) // .unknown(true) важно, т.к. agentData > чем схема
});

/**
 * RAG: Поиск в базе знаний
 */
async function searchKnowledge(query, clientId) {
    try {
        const openai = new OpenAI({ apiKey: config.openai.key });
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query.substring(0, 8000)
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;

        // Вызываем SQL-функцию из Supabase
        const { data, error } = await supabase.rpc('match_knowledge', {
            query_embedding: queryEmbedding,
            match_threshold: 0.75, // Порог схожести
            match_count: 3,        // Кол-во кусков
            filter_client_id: clientId
        });

        if (error) {
            log.error(`[RAG] Search error: ${error.message}`);
            return "(База знаний недоступна)";
        }
        if (!data || data.length === 0) {
            log.warn('[RAG] No relevant knowledge found');
            return "(Нет релевантной информации в базе знаний)";
        }

        return data.map(item => item.content).join('\n\n---\n\n');
        
    } catch (e) {
        log.error(`[RAG] Exception: ${e.message}`);
        return "(Ошибка доступа к базе знаний)";
    }
}

/**
 * Генерация ответа
 */
export async function getReply(params) {
    const { error } = schema.validate(params);
    if (error) throw new Error('Invalid params: ' + error.message);

    const { key, history, userReply, agentData } = params;
    const openai = new OpenAI({ apiKey: key });
    
    try {
        // 1. RAG поиск
        const knowledgeContext = await searchKnowledge(userReply, agentData.client_id);
        log.info(`[RAG] Found ${knowledgeContext.length} chars of context`);

        // 2. Собираем финальный промпт из БД
        const finalPrompt = `${agentData.core_system_prompt}

${agentData.agent_persona}

[БАЗА ЗНАНИЙ]
${knowledgeContext}`;
        
        // 3. Вызов LLM
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: finalPrompt },
                ...history.slice(-10) // Последние 10 сообщений
            ],
            temperature: 0.6, // Баланс (выбор Claude)
            response_format: { type: "json_object" }
        });

        const jsonResponse = JSON.parse(completion.choices[0].message.content);
        log.info(`[AI] Response: ${JSON.stringify(jsonResponse)}`);

        return {
            agentReply: jsonResponse.agentReply || "Извините, не могу обработать запрос.",
            handoverIntent: jsonResponse.handoverIntent || 'AI_FAILURE'
        };
        
    } catch (e) {
        log.error(`[AI] Error: ${e.message}`);
        return { 
            agentReply: "Извините, технические неполадки. Передаю коллеге.", 
            handoverIntent: 'AI_FAILURE' 
        };
    }
}