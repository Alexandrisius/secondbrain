/**
 * @file embeddings.ts
 * @description IndexedDB хранилище для эмбеддингов карточек
 * 
 * Использует Dexie.js - типизированную обёртку над IndexedDB.
 * Хранит векторные представления карточек для семантического поиска.
 * 
 * Основные возможности:
 * - Сохранение/обновление эмбеддингов карточек
 * - Получение эмбеддингов по ID ноды или холста
 * - Удаление эмбеддингов при удалении карточек
 * - Очистка устаревших данных
 */

import Dexie, { type Table } from 'dexie';
/**
 * Запись эмбеддинга в IndexedDB
 * 
 * Хранит векторное представление карточки для семантического поиска.
 * Связана с конкретной нодой и холстом.
 */
export interface EmbeddingRecord {
  /** Уникальный ID записи (совпадает с nodeId для простоты) */
  id: string;
  
  /** ID ноды (карточки) */
  nodeId: string;
  
  /** ID холста, на котором находится нода */
  canvasId: string;
  
  /** Вектор эмбеддинга (размерность зависит от модели) */
  embedding: number[];
  
  /** Оригинальный промпт карточки (для отображения в результатах) */
  prompt: string;
  
  /** ПОЛНЫЙ ТЕКСТ ОТВЕТА (для контекста NeuroSearch) */
  responsePreview: string;
  
  /** Временная метка создания/обновления эмбеддинга */
  updatedAt: number;
  
  /** Размерность вектора (для валидации) */
  dimension: number;
}

// =============================================================================
// КЛАСС БАЗЫ ДАННЫХ
// =============================================================================

/**
 * Класс базы данных для хранения эмбеддингов
 * 
 * Наследует от Dexie и определяет схему таблиц.
 * Использует версионирование для безопасных миграций.
 */
class EmbeddingsDatabase extends Dexie {
  /**
   * Таблица эмбеддингов
   * Индексы: id (primary), nodeId, canvasId, updatedAt
   */
  embeddings!: Table<EmbeddingRecord, string>;

  constructor() {
    super('NeuroCanvasEmbeddings');
    
    // Версия 1: начальная схема
    this.version(1).stores({
      // Определяем индексы:
      // - id: первичный ключ
      // - nodeId: для поиска по ID карточки
      // - canvasId: для поиска всех эмбеддингов холста
      // - updatedAt: для сортировки и очистки старых
      embeddings: 'id, nodeId, canvasId, updatedAt',
    });
  }
}

// =============================================================================
// СИНГЛТОН ЭКЗЕМПЛЯР БАЗЫ ДАННЫХ
// =============================================================================

/**
 * Единственный экземпляр базы данных
 * Создаётся лениво при первом обращении
 */
let db: EmbeddingsDatabase | null = null;

/**
 * Получить экземпляр базы данных
 * Создаёт новый экземпляр если ещё не создан
 * 
 * @returns Экземпляр EmbeddingsDatabase
 */
function getDatabase(): EmbeddingsDatabase {
  if (!db) {
    db = new EmbeddingsDatabase();
  }
  return db;
}

// =============================================================================
// ФУНКЦИИ РАБОТЫ С ЭМБЕДДИНГАМИ
// =============================================================================

/**
 * Сохранить или обновить эмбеддинг карточки
 * 
 * Если эмбеддинг для данной ноды уже существует - обновляет его.
 * Если не существует - создаёт новую запись.
 * 
 * @param nodeId - ID карточки
 * @param canvasId - ID холста
 * @param embedding - Вектор эмбеддинга
 * @param prompt - Текст промпта
 * @param response - Текст ответа (будет обрезан для превью)
 */
export async function saveEmbedding(
  nodeId: string,
  canvasId: string,
  embedding: number[],
  prompt: string,
  response: string
): Promise<void> {
  const database = getDatabase();
  
  // Логируем размерность для отладки (разные модели имеют разную размерность)
  console.log(
    `[EmbeddingsDB] Сохранение эмбеддинга для ноды ${nodeId}, размерность: ${embedding.length}`
  );
  
  // Сохраняем ПОЛНЫЙ ответ, чтобы использовать его как контекст
  // Ранее здесь была обрезка до RESPONSE_PREVIEW_LENGTH, но для NeuroSearch нужен полный текст
  const responseContent = response;
  
  // Формируем запись
  const record: EmbeddingRecord = {
    id: nodeId, // Используем nodeId как первичный ключ
    nodeId,
    canvasId,
    embedding,
    prompt,
    responsePreview: responseContent, // Теперь здесь полный ответ
    updatedAt: Date.now(),
    dimension: embedding.length,
  };
  
  // Сохраняем (put перезаписывает если запись существует)
  await database.embeddings.put(record);
  
  console.log(`[EmbeddingsDB] Сохранён эмбеддинг для ноды ${nodeId}`);
}

/**
 * Получить эмбеддинг по ID ноды
 * 
 * @param nodeId - ID карточки
 * @returns Запись эмбеддинга или undefined
 */
export async function getEmbedding(nodeId: string): Promise<EmbeddingRecord | undefined> {
  const database = getDatabase();
  return database.embeddings.get(nodeId);
}

/**
 * Получить все эмбеддинги для холста
 * 
 * Используется для семантического поиска в рамках одного холста.
 * 
 * @param canvasId - ID холста
 * @returns Массив записей эмбеддингов
 */
export async function getEmbeddingsByCanvas(canvasId: string): Promise<EmbeddingRecord[]> {
  const database = getDatabase();
  return database.embeddings.where('canvasId').equals(canvasId).toArray();
}

/**
 * Получить все эмбеддинги из базы данных
 * 
 * Используется для глобального поиска по всем холстам.
 * 
 * @returns Массив всех записей эмбеддингов
 */
export async function getAllEmbeddings(): Promise<EmbeddingRecord[]> {
  const database = getDatabase();
  return database.embeddings.toArray();
}

/**
 * Удалить эмбеддинг по ID ноды
 * 
 * Вызывается при удалении карточки.
 * 
 * @param nodeId - ID карточки
 */
export async function deleteEmbedding(nodeId: string): Promise<void> {
  const database = getDatabase();
  await database.embeddings.delete(nodeId);
  console.log(`[EmbeddingsDB] Удалён эмбеддинг для ноды ${nodeId}`);
}

/**
 * Удалить все эмбеддинги для холста
 * 
 * Вызывается при удалении холста.
 * 
 * @param canvasId - ID холста
 * @returns Количество удалённых записей
 */
export async function deleteEmbeddingsByCanvas(canvasId: string): Promise<number> {
  const database = getDatabase();
  const count = await database.embeddings.where('canvasId').equals(canvasId).delete();
  console.log(`[EmbeddingsDB] Удалено ${count} эмбеддингов для холста ${canvasId}`);
  return count;
}

/**
 * Проверить существование эмбеддинга
 * 
 * @param nodeId - ID карточки
 * @returns true если эмбеддинг существует
 */
export async function hasEmbedding(nodeId: string): Promise<boolean> {
  const database = getDatabase();
  const count = await database.embeddings.where('id').equals(nodeId).count();
  return count > 0;
}

/**
 * Получить количество эмбеддингов в базе данных
 * 
 * @returns Общее количество записей
 */
export async function getEmbeddingsCount(): Promise<number> {
  const database = getDatabase();
  return database.embeddings.count();
}

/**
 * Получить количество эмбеддингов для холста
 * 
 * @param canvasId - ID холста
 * @returns Количество записей для холста
 */
export async function getEmbeddingsCountByCanvas(canvasId: string): Promise<number> {
  const database = getDatabase();
  return database.embeddings.where('canvasId').equals(canvasId).count();
}

/**
 * Очистить все эмбеддинги
 * 
 * ВНИМАНИЕ: Удаляет все данные! Использовать осторожно.
 */
export async function clearAllEmbeddings(): Promise<void> {
  const database = getDatabase();
  await database.embeddings.clear();
  console.log('[EmbeddingsDB] Все эмбеддинги удалены');
}

/**
 * Синхронизировать эмбеддинги с нодами холста
 * 
 * Удаляет эмбеддинги для нод, которых больше нет на холсте.
 * 
 * @param canvasId - ID холста
 * @param existingNodeIds - Массив ID существующих нод
 * @returns Количество удалённых эмбеддингов
 */
export async function syncEmbeddingsWithCanvas(
  canvasId: string,
  existingNodeIds: string[]
): Promise<number> {
  const database = getDatabase();
  
  // Получаем все эмбеддинги холста
  const embeddings = await getEmbeddingsByCanvas(canvasId);
  
  // Находим эмбеддинги для несуществующих нод
  const existingSet = new Set(existingNodeIds);
  const orphanedIds = embeddings
    .filter((e) => !existingSet.has(e.nodeId))
    .map((e) => e.id);
  
  // Удаляем осиротевшие эмбеддинги
  if (orphanedIds.length > 0) {
    await database.embeddings.bulkDelete(orphanedIds);
    console.log(
      `[EmbeddingsDB] Удалено ${orphanedIds.length} осиротевших эмбеддингов для холста ${canvasId}`
    );
  }
  
  return orphanedIds.length;
}

/**
 * Глобальная синхронизация эмбеддингов со всеми холстами
 * 
 * Проходит по всем холстам и удаляет эмбеддинги для карточек,
 * которые больше не существуют. Используется для очистки
 * "призраков" в поиске.
 * 
 * @returns Общее количество удалённых эмбеддингов
 */
export async function syncAllEmbeddings(): Promise<number> {
  const database = getDatabase();
  
  console.log('[EmbeddingsDB] Запуск глобальной синхронизации эмбеддингов...');
  
  // Получаем все эмбеддинги
  const allEmbeddings = await database.embeddings.toArray();
  
  if (allEmbeddings.length === 0) {
    console.log('[EmbeddingsDB] Нет эмбеддингов для синхронизации');
    return 0;
  }
  
  // Группируем эмбеддинги по canvasId
  const embeddingsByCanvas = new Map<string, typeof allEmbeddings>();
  for (const emb of allEmbeddings) {
    const list = embeddingsByCanvas.get(emb.canvasId) || [];
    list.push(emb);
    embeddingsByCanvas.set(emb.canvasId, list);
  }
  
  console.log(`[EmbeddingsDB] Найдено ${allEmbeddings.length} эмбеддингов в ${embeddingsByCanvas.size} холстах`);
  
  // Для каждого холста загружаем данные и проверяем существование нод
  const orphanedIds: string[] = [];
  
  for (const [canvasId, embeddings] of embeddingsByCanvas) {
    try {
      // Загружаем данные холста через API
      const response = await fetch(`/api/canvas/${canvasId}`);
      
      if (!response.ok) {
        // Холст не существует - все его эмбеддинги "осиротели"
        console.log(`[EmbeddingsDB] Холст ${canvasId} не найден, удаляем ${embeddings.length} эмбеддингов`);
        orphanedIds.push(...embeddings.map(e => e.id));
        continue;
      }
      
      const canvasData = await response.json();
      const existingNodeIds = new Set(
        (canvasData.nodes || []).map((n: { id: string }) => n.id)
      );
      
      // Находим эмбеддинги для несуществующих нод
      for (const emb of embeddings) {
        if (!existingNodeIds.has(emb.nodeId)) {
          orphanedIds.push(emb.id);
        }
      }
    } catch (error) {
      console.error(`[EmbeddingsDB] Ошибка загрузки холста ${canvasId}:`, error);
      // При ошибке считаем все эмбеддинги холста осиротевшими
      orphanedIds.push(...embeddings.map(e => e.id));
    }
  }
  
  // Удаляем осиротевшие эмбеддинги
  if (orphanedIds.length > 0) {
    await database.embeddings.bulkDelete(orphanedIds);
    console.log(`[EmbeddingsDB] Глобальная синхронизация: удалено ${orphanedIds.length} осиротевших эмбеддингов`);
  } else {
    console.log('[EmbeddingsDB] Глобальная синхронизация: осиротевших эмбеддингов не найдено');
  }
  
  return orphanedIds.length;
}

/**
 * Получить статистику базы данных
 * 
 * @returns Объект со статистикой
 */
export async function getDatabaseStats(): Promise<{
  totalCount: number;
  canvasCounts: Record<string, number>;
  totalSize: number;
}> {
  const database = getDatabase();
  const embeddings = await database.embeddings.toArray();
  
  // Подсчёт по холстам
  const canvasCounts: Record<string, number> = {};
  let totalSize = 0;
  
  for (const record of embeddings) {
    canvasCounts[record.canvasId] = (canvasCounts[record.canvasId] || 0) + 1;
    // Примерный размер: вектор * 8 байт (float64) + строки
    totalSize +=
      record.embedding.length * 8 +
      record.prompt.length * 2 +
      record.responsePreview.length * 2;
  }
  
  return {
    totalCount: embeddings.length,
    canvasCounts,
    totalSize,
  };
}

// =============================================================================
// ЭКСПОРТ КЛАССА ДЛЯ ПРОДВИНУТОГО ИСПОЛЬЗОВАНИЯ
// =============================================================================

export { EmbeddingsDatabase, getDatabase };

