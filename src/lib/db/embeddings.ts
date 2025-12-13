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
// ТИП ДЛЯ MULTI-VECTOR (CHUNK) ЭМБЕДДИНГОВ
// =============================================================================

/**
 * Запись эмбеддинга для фрагмента (чанка) ответа карточки.
 *
 * Зачем это нужно:
 * - “Одна карточка = один вектор” плохо работает на длинных ответах:
 *   нужная деталь может быть “спрятана” в одном разделе и размывается общим смыслом.
 * - Multi-vector подход: создаём несколько эмбеддингов по разным фрагментам ответа
 *   и используем их ТОЛЬКО для скоринга (поиска релевантности).
 *
 * ВАЖНОЕ ТРЕБОВАНИЕ ПРОЕКТА:
 * - Если совпал хотя бы 1 чанк, мы подключаем всю карточку как виртуального родителя,
 *   то есть в контекст LLM подмешивается ПОЛНЫЙ ответ карточки.
 * - Поэтому `chunkText` здесь хранится для отладки/опционального UI,
 *   но “источником правды” для полного текста остаётся каноническая запись `EmbeddingRecord`
 *   (где `responsePreview` хранит полный ответ).
 */
export interface EmbeddingChunkRecord {
  /**
   * Уникальный ID чанка.
   *
   * Обычно формируется как `${nodeId}::c${chunkIndex}` — так:
   * - легко дебажить,
   * - легко удалять “все чанки ноды” по nodeId,
   * - не конфликтует с канонической записью, у которой id == nodeId.
   */
  id: string;

  /** ID ноды (карточки) */
  nodeId: string;

  /** ID холста */
  canvasId: string;

  /** Индекс чанка внутри карточки (0..chunkTotal-1) */
  chunkIndex: number;

  /** Общее число чанков для этой карточки (для UI/отладки) */
  chunkTotal: number;

  /**
   * Путь заголовков markdown (контекст раздела), где лежит чанк.
   * Это маленькое поле, но сильно помогает дебажить “почему совпало”.
   */
  headingPath: string;

  /**
   * Текст чанка (обычно markdown-фрагмент ответа).
   *
   * ВАЖНО:
   * - Это НЕ то, что мы подмешиваем в LLM контекст для виртуального родителя.
   * - Это хранится для:
   *   1) возможного UI “где совпало”,
   *   2) диагностики качества чанкинга,
   *   3) деградации в крайних случаях (если канонический full response отсутствует).
   */
  chunkText: string;

  /** Промпт карточки (для UI результатов) */
  prompt: string;

  /** Вектор эмбеддинга этого чанка */
  embedding: number[];

  /** Временная метка обновления чанка */
  updatedAt: number;

  /** Размерность вектора (зависит от модели) */
  dimension: number;
}

// =============================================================================
// МЕТАДАННЫЕ ИНДЕКСА ЭМБЕДДИНГОВ (ВАЖНО ДЛЯ UX)
// =============================================================================

/**
 * Метаданные текущего embedding-индекса (глобально для всей IndexedDB базы).
 *
 * Зачем это нужно:
 * - Эмбеддинги, рассчитанные разными моделями (и/или через разные embeddingsBaseUrl),
 *   в общем случае НЕСОВМЕСТИМЫ:
 *   - размерности могут различаться,
 *   - распределение векторов и “пространство” может быть другим,
 *   - сравнение cosine similarity перестаёт быть корректным.
 *
 * Ранее приложение меняло `embeddingsModel` при смене провайдера (см. useSettingsStore.setApiProvider),
 * но база эмбеддингов в IndexedDB оставалась “старой” — и мы не могли честно сказать пользователю,
 * что индекс нужно пересобрать.
 *
 * Это поле (EmbeddingsIndexMeta) — минимальный “паспорт” индекса,
 * который позволяет UI:
 * - показать, чем индекс был построен,
 * - понять, что текущие настройки отличаются от индекса,
 * - подсветить предупреждение и предложить переиндексацию.
 *
 * ВАЖНО:
 * - Это метаданные именно “глобального” индекса (по всем холстам),
 *   потому что таблица `embeddings` хранит записи для разных canvasId в одной базе Dexie.
 * - Мы НЕ храним здесь apiKey/секреты (никогда!).
 */
export interface EmbeddingsIndexMeta {
  /**
   * ID записи меты.
   *
   * Сейчас у нас ровно ОДНА запись на всю базу, поэтому используем константу.
   * Если когда-нибудь понадобится хранить мету по холстам — можно расширить схему
   * и заводить записи вида `canvas:${canvasId}`.
   */
  id: 'global';

  /**
   * Какая модель эмбеддингов использовалась при построении индекса.
   *
   * ВАЖНО:
   * - Здесь мы храним “как вернул провайдер” (если доступно),
   *   чтобы совпадение сравнивалось строка-в-строку.
   * - Для OpenRouter это часто `vendor/model`, для custom — может быть `text-embedding-3-small`.
   */
  embeddingsModel: string;

  /**
   * Какой embeddingsBaseUrl использовался при построении индекса.
   *
   * Почему это важно:
   * - Пользователь может сменить сервер/провайдер (например, другой OpenAI-compatible),
   *   и даже при “той же” модели результаты могут отличаться (или модель может означать другое).
   */
  embeddingsBaseUrl: string;

  /**
   * Когда мета была обновлена в последний раз.
   *
   * Это удобно для UI (“когда пересобирали индекс”) и для отладки.
   */
  updatedAt: number;
}

/**
 * Константа ID единственной записи метаданных.
 *
 * Вынесено в константу, чтобы избежать магических строк и опечаток.
 */
const GLOBAL_EMBEDDINGS_INDEX_META_ID: EmbeddingsIndexMeta['id'] = 'global';

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

  /**
   * Таблица чанков (multi-vector) для длинных ответов
   * Индексы: id (primary), nodeId, canvasId, updatedAt
   */
  embeddingChunks!: Table<EmbeddingChunkRecord, string>;

  /**
   * Таблица метаданных embedding-индекса (обычно одна запись: id='global').
   *
   * Храним отдельно, чтобы:
   * - не расширять каждую запись эмбеддинга,
   * - иметь быстрый доступ к “паспорту” индекса,
   * - не зависеть от количества записей.
   */
  embeddingsMeta!: Table<EmbeddingsIndexMeta, string>;

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

    /**
     * Версия 2: добавляем таблицу чанков (multi-vector).
     *
     * ВАЖНО:
     * - Dexie требует перечислить ВСЕ таблицы для версии.
     * - Мы не меняем схему embeddings (чтобы не ломать существующие данные).
     * - Просто добавляем новую таблицу embeddingChunks.
     */
    this.version(2).stores({
      embeddings: 'id, nodeId, canvasId, updatedAt',
      embeddingChunks: 'id, nodeId, canvasId, updatedAt',
    });

    /**
     * Версия 3: добавляем таблицу метаданных embedding-индекса.
     *
     * ВАЖНО:
     * - Мы НЕ меняем схему `embeddings`/`embeddingChunks`, чтобы не ломать существующие данные.
     * - Просто добавляем новую таблицу `embeddingsMeta`.
     */
    this.version(3).stores({
      embeddings: 'id, nodeId, canvasId, updatedAt',
      embeddingChunks: 'id, nodeId, canvasId, updatedAt',
      // Индексируем updatedAt, чтобы при желании можно было сортировать/проверять “актуальность”.
      embeddingsMeta: 'id, updatedAt',
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
  // ВАЖНО: удаляем и канонический эмбеддинг, и все chunk-эмбеддинги этой карточки,
  // чтобы не оставлять “призраков” в NeuroSearch.
  await database.embeddings.delete(nodeId);
  await database.embeddingChunks.where('nodeId').equals(nodeId).delete();
  console.log(`[EmbeddingsDB] Удалён эмбеддинг и чанки для ноды ${nodeId}`);
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
  // Удаляем и канонические эмбеддинги, и chunk-эмбеддинги
  const embeddingsCount = await database.embeddings.where('canvasId').equals(canvasId).delete();
  const chunksCount = await database.embeddingChunks.where('canvasId').equals(canvasId).delete();
  console.log(
    `[EmbeddingsDB] Удалено ${embeddingsCount} эмбеддингов и ${chunksCount} чанков для холста ${canvasId}`
  );
  return embeddingsCount + chunksCount;
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
  await database.embeddingChunks.clear();
  // ВАЖНО:
  // Если мы очищаем базу эмбеддингов, мы обязаны также очистить метаданные индекса.
  // Иначе UI будет думать, что “индекс построен моделью X”, хотя записей уже нет.
  await database.embeddingsMeta.clear();
  console.log('[EmbeddingsDB] Все эмбеддинги (включая чанки) удалены');
}

// =============================================================================
// API ДЛЯ МЕТАДАННЫХ ИНДЕКСА (EmbeddingsIndexMeta)
// =============================================================================

/**
 * Получить метаданные текущего embedding-индекса (если они есть).
 *
 * Поведение:
 * - Если приложение обновилось с версии, где меты не было, функция вернёт `undefined`.
 * - UI должен уметь корректно показывать “Неизвестно / индекс из старой версии”.
 *
 * @returns Метаданные индекса или undefined
 */
export async function getEmbeddingsIndexMeta(): Promise<EmbeddingsIndexMeta | undefined> {
  const database = getDatabase();
  return database.embeddingsMeta.get(GLOBAL_EMBEDDINGS_INDEX_META_ID);
}

/**
 * Установить/обновить метаданные текущего embedding-индекса.
 *
 * ВАЖНО:
 * - Мы делаем `put`, потому что запись может уже существовать.
 * - Это безопасно вызывать часто (например, при индексации каждой карточки),
 *   но UI/перформанс предпочтительно обновлять мету “пакетно”, если появится потребность.
 *
 * @param meta - Новые метаданные индекса
 */
export async function setEmbeddingsIndexMeta(meta: Omit<EmbeddingsIndexMeta, 'id' | 'updatedAt'> & Partial<Pick<EmbeddingsIndexMeta, 'updatedAt'>>): Promise<void> {
  const database = getDatabase();

  // Нормализуем поля, чтобы в базе не было undefined/null.
  const record: EmbeddingsIndexMeta = {
    id: GLOBAL_EMBEDDINGS_INDEX_META_ID,
    embeddingsModel: String(meta.embeddingsModel ?? '').trim(),
    embeddingsBaseUrl: String(meta.embeddingsBaseUrl ?? '').trim(),
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : Date.now(),
  };

  await database.embeddingsMeta.put(record);
}

/**
 * Очистить метаданные индекса (НЕ трогая сами эмбеддинги).
 *
 * Полезно, если:
 * - нужно сбросить “паспорт” индекса без удаления данных (редко),
 * - или если в будущем появятся сценарии миграции/восстановления.
 */
export async function clearEmbeddingsIndexMeta(): Promise<void> {
  const database = getDatabase();
  await database.embeddingsMeta.clear();
}

// =============================================================================
// CRUD ДЛЯ CHUNK ЭМБЕДДИНГОВ (MULTI-VECTOR)
// =============================================================================

/**
 * Сохранить чанки эмбеддингов для одной ноды.
 *
 * Стратегия: “replace-all”.
 * - Перед сохранением удаляем старые чанки этой ноды, чтобы:
 *   1) не копить мусор при переиндексации,
 *   2) избежать ситуаций, когда old chunks смешиваются с new chunks.
 */
export async function saveEmbeddingChunksForNode(
  nodeId: string,
  canvasId: string,
  chunks: Array<{
    chunkIndex: number;
    chunkTotal: number;
    headingPath: string;
    chunkText: string;
    prompt: string;
    embedding: number[];
  }>
): Promise<void> {
  const database = getDatabase();

  // Если чанков нет — просто очищаем старые и выходим
  if (!chunks.length) {
    await database.embeddingChunks.where('nodeId').equals(nodeId).delete();
    return;
  }

  // Удаляем старые чанки этой ноды
  await database.embeddingChunks.where('nodeId').equals(nodeId).delete();

  // Формируем записи
  const now = Date.now();
  const records: EmbeddingChunkRecord[] = chunks.map((c) => ({
    id: `${nodeId}::c${c.chunkIndex}`,
    nodeId,
    canvasId,
    chunkIndex: c.chunkIndex,
    chunkTotal: c.chunkTotal,
    headingPath: c.headingPath,
    chunkText: c.chunkText,
    prompt: c.prompt,
    embedding: c.embedding,
    updatedAt: now,
    dimension: c.embedding.length,
  }));

  // bulkPut быстрее, чем put по одному
  await database.embeddingChunks.bulkPut(records);
  console.log(`[EmbeddingsDB] Сохранено ${records.length} chunk-эмбеддингов для ноды ${nodeId}`);
}

/**
 * Получить все chunk-эмбеддинги для холста.
 */
export async function getEmbeddingChunksByCanvas(canvasId: string): Promise<EmbeddingChunkRecord[]> {
  const database = getDatabase();
  return database.embeddingChunks.where('canvasId').equals(canvasId).toArray();
}

/**
 * Получить все chunk-эмбеддинги (глобально).
 */
export async function getAllEmbeddingChunks(): Promise<EmbeddingChunkRecord[]> {
  const database = getDatabase();
  return database.embeddingChunks.toArray();
}

/**
 * Удалить все chunk-эмбеддинги конкретной ноды.
 */
export async function deleteEmbeddingChunksByNode(nodeId: string): Promise<number> {
  const database = getDatabase();
  return database.embeddingChunks.where('nodeId').equals(nodeId).delete();
}

/**
 * Синхронизировать chunk-эмбеддинги с нодами холста (удалить “призраков”).
 *
 * Похоже на syncEmbeddingsWithCanvas(), но для таблицы embeddingChunks.
 */
export async function syncEmbeddingChunksWithCanvas(
  canvasId: string,
  existingNodeIds: string[]
): Promise<number> {
  const database = getDatabase();

  // Получаем все чанки холста
  const chunks = await getEmbeddingChunksByCanvas(canvasId);

  const existingSet = new Set(existingNodeIds);
  const orphanedChunkIds = chunks
    .filter((c) => !existingSet.has(c.nodeId))
    .map((c) => c.id);

  if (orphanedChunkIds.length > 0) {
    await database.embeddingChunks.bulkDelete(orphanedChunkIds);
    console.log(
      `[EmbeddingsDB] Удалено ${orphanedChunkIds.length} осиротевших chunk-эмбеддингов для холста ${canvasId}`
    );
  }

  return orphanedChunkIds.length;
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

