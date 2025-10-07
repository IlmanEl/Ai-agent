import fs from 'fs/promises';
import { log } from '../utils/logger.js';

const FILE_PATH = './dialog_state.json';

// Имитация БД. Читает и записывает JSON файл.
export function getDbClient() {
    
    /**
     * Записывает полный стейт диалогов в JSON файл.
     * @param {object} state - Объект, содержащий всю историю диалогов.
     */
    const saveState = async (state) => {
        try {
            await fs.writeFile(FILE_PATH, JSON.stringify(state, null, 2));
        } catch (err) {
            log.error('DB: Error saving state to JSON: ' + err.message);
        }
    };

    /**
     * Читает полный стейт диалогов из JSON файла.
     * @returns {Promise<object>} - Объект состояния или пустой объект.
     */
    const loadState = async () => {
        try {
            const data = await fs.readFile(FILE_PATH, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            // Файл не существует или невалиден (нормально при первом запуске)
            return {};
        }
    };

    return { saveState, loadState };
}

// Теперь этот модуль экспортирует только функции для работы с файлом.
// Все упоминания Supabase удалены.