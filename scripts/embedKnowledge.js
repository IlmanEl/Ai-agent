// scripts/embedKnowledge.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises'; 

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === КОНФИГУРАЦИЯ ===
const CLIENT_ID = "799bd492-5a5f-46e0-80ea-fc83f5fef360"; 
const KNOWLEDGE_FILE = "./knowledge/referendum.txt"; 
const CHUNK_SIZE = 500; // Символов на чанк (кусок)

// Умная разбивка по абзацам
function smartChunk(text, maxSize = CHUNK_SIZE) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 10); 
    const chunks = [];
    
    let currentChunk = "";
    for (const para of paragraphs) {
        if ((currentChunk + para).length > maxSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = para;
        } else {
            currentChunk += (currentChunk ? "\n\n" : "") + para;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    
    return chunks;
}

async function getEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text.substring(0, 8000)
        });
        return response.data[0].embedding;
    } catch (e) {
        console.error(`❌ Ошибка embedding: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log(`\n🚀 Загрузка базы знаний для client_id: ${CLIENT_ID}`);
    console.log(`📄 Файл: ${KNOWLEDGE_FILE}\n`);
    
    // 1. Читаем методичку из файла
    let knowledgeText;
    try {
        knowledgeText = await fs.readFile(KNOWLEDGE_FILE, 'utf-8');
        console.log(`✅ Прочитано ${knowledgeText.length} символов\n`);
    } catch (e) {
        console.error(`❌ Не могу прочитать файл ${KNOWLEDGE_FILE}: ${e.message}`);
        return;
    }
    
    // 2. Очистка старых знаний
    console.log('🧹 Удаляем старые знания...');
    const { error: deleteError } = await supabase
        .from('knowledge_base')
        .delete()
        .eq('client_id', CLIENT_ID);
    
    if (deleteError && deleteError.code !== 'PGRST116') {
        console.error('❌ Ошибка удаления:', deleteError.message);
        return;
    }
    console.log('✅ Старые знания удалены\n');

    // 3. Разбивка на чанки
    const chunks = smartChunk(knowledgeText);
    console.log(`📦 Разбито на ${chunks.length} чанков\n`);

    // 4. Загрузка
    let successCount = 0;
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`⏳ [${i + 1}/${chunks.length}] Обработка чанка (${chunk.length} символов)...`);
        
        const embedding = await getEmbedding(chunk);
        if (!embedding) {
            console.log(`❌ Пропуск\n`);
            continue;
        }

        const { error: insertError } = await supabase
            .from('knowledge_base')
            .insert({
                client_id: CLIENT_ID,
                content: chunk,
                embedding: embedding,
                source: `referendum.txt chunk ${i + 1}`
            });

        if (insertError) {
            console.log(`❌ Ошибка вставки: ${insertError.message}\n`);
        } else {
            console.log(`✅ Загружено\n`);
            successCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Задержка
    }

    console.log(`\n🎉 Готово! Загружено ${successCount}/${chunks.length} чанков\n`);
}

main().catch(console.error);