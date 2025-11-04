// scripts/embedKnowledge.js (ИСПРАВЛЕННАЯ ВЕРСИЯ)
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// === КОНФИГУРАЦИЯ ===
// Убедитесь, что ID клиента правильный
const CLIENT_ID = "799bd492-5a5f-46e0-80ea-fc83f5fef360"; // Referendum
const KNOWLEDGE_FILE = "./knowledge/referendum.txt"; // Читаем из файла!
const CHUNK_SIZE = 500; // Целевой размер чанка в символах

// --- (ИСПРАВЛЕННАЯ ЛОГИКА РАЗБИВКИ) ---
function smartChunk(text, maxSize = CHUNK_SIZE) {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 10);
    const chunks = [];
    
    for (const para of paragraphs) {
        // Если абзац сам по себе больше CHUNK_SIZE, делим его
        if (para.length > maxSize) {
            // Делим по точкам, вопросам, восклицаниям И переносам строки
            const sentences = para.split(/([.?!]|\n)/g);
            let currentChunk = "";
            for (let i = 0; i < sentences.length; i++) {
                const sentence = sentences[i];
                if ((currentChunk + sentence).length > maxSize && currentChunk.length > 0) {
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence;
                } else {
                    currentChunk += sentence;
                }
            }
            if (currentChunk.trim().length > 10) {
                chunks.push(currentChunk.trim());
            }
        } else {
            // Абзац помещается в чанк
            chunks.push(para.trim());
        }
    }
    
    return chunks.filter(c => c.length > 0);
}
// --- (КОНЕЦ ИСПРАВЛЕНИЯ) ---

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
    
    let knowledgeText;
    try {
        knowledgeText = await fs.readFile(KNOWLEDGE_FILE, 'utf-8');
        console.log(`✅ Прочитано ${knowledgeText.length} символов\n`);
    } catch (e) {
        console.error(`❌ Не могу прочитать файл ${KNOWLEDGE_FILE}: ${e.message}`);
        return;
    }
    
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

    const chunks = smartChunk(knowledgeText);
    console.log(`📦 Разбито на ${chunks.length} чанков\n`);

    if (chunks.length <= 1 && knowledgeText.length > CHUNK_SIZE) {
         console.warn("ВНИМАНИЕ: Не удалось эффективно разбить текст на чанки. Проверьте формат файла 'referendum.txt'. Он должен содержать пустые строки (двойные переносы) между абзацами.");
    }

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
        await new Promise(resolve => setTimeout(resolve, 100)); // Задержка от спама API
    }

    console.log(`\n🎉 Готово! Загружено ${successCount}/${chunks.length} чанков\n`);
}

main().catch(console.error);