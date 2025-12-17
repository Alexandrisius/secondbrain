# API Reference & Class Documentation

Этот документ описывает ключевые классы, методы и модули управления состоянием, используемые в проекте.
Архитектура строится на сочетании React (UI), Zustand (State Management), Dexie (Local Database) и кастомных классов для поиска.

---

## 1. State Management (Zustand Stores)

Приложение использует Zustand для управления глобальным состоянием. Сторы разделены по доменным областям.

### `useCanvasStore`
Центральное хранилище для работы с текущим активным холстом.
Это монолитный стор (в процессе рефакторинга на слайсы), управляющий графом нод.

**Ключевые методы:**
*   **`updateNodeData(id, partialData)`**: Обновление данных конкретной ноды (например, prompt, response). Иммутабельно обновляет state.
*   **`createLinkedNode(parentId, position)`**: Создание новой ноды, связанной ребром с родительской.
*   **`deleteNode(id)`**: Удаление ноды и всех связанных ребер.
*   **`computeContextHash(nodeId)`**: (Internal) Вычисляет хэш контекста для определения `isStale`.
*   **`checkAndClearStale(nodeId)`**: Рекурсивно проверяет, стал ли контекст ноды актуальным, и снимает флаг `isStale`.
*   **`getFlow()`**: Возвращает сырой объект React Flow (nodes, edges, viewport) для сохранения.

**Почему используется:**
Обеспечивает реактивность UI при изменении графа, undo/redo (через `zundo`) и синхронизацию с React Flow.

---

### `useWorkspaceStore`
Управляет структурой папок и списком холстов (левый сайдбар).

**Ключевые методы:**
*   **`refreshWorkspace()`**: Загружает `index.json` с сервера/файловой системы.
*   **`createCanvas(folderId, name)`**: Создает новый холст и обновляет индекс.
*   **`createFolder(name)`**: Создает виртуальную папку в индексе.
*   **`moveCanvas(canvasId, targetFolderId)`**: Перемещает холст между папками.

**Почему используется:**
Разделяет навигацию от содержимого холста. Позволяет быстро переключаться между холстами без полной перезагрузки приложения.

---

### `useLibraryStore`
Управляет глобальной библиотекой документов и состоянием правого сайдбара (вложения).

**Ключевые методы:**
*   **`refreshLibrary()`**: Загружает `library-index.json`.
*   **`uploadFiles(files)`**: Загружает файлы через API и обновляет список.
*   **`deleteDoc(docId)`**: Помечает документ как удаленный (trash).

**Почему используется:**
Глобальная библиотека (`LibraryIndex`) существует независимо от холстов. Стор позволяет компонентам (например, `AttachmentPicker`) получать список файлов без прямых API вызовов.

---

### `useNeuroSearchStore`
Управляет состоянием поиска (строка запроса, результаты, фильтры).

**Ключевые методы:**
*   **`performSearch(query)`**: Инициирует поиск через `HybridSearchEngine`.
*   **`setScope(scope)`**: Переключает область поиска (Current Canvas / Full Workspace).

---

## 2. Search Engine (NeuroSearch)

Система "NeuroSearch" — это гибридный поисковый движок, реализованный в `src/lib/search`.
Он объединяет несколько алгоритмов для максимальной релевантности (Reciprocal Rank Fusion).

### `class HybridSearchEngine` (`src/lib/search/hybrid.ts`)
Главный класс-оркестратор поиска (Facade pattern).

**Методы:**
*   **`search(query, limit)`**: Выполняет параллельный поиск всеми методами и объединяет результаты через RRF.
*   **`addDocument(doc)`**: Индексирует документ во всех субиндексах (BM25, Fuzzy, etc).
*   **`setEmbeddingFunction(fn)`**: Инъекция зависимости для получения векторов (чтобы не привязывать движок к API).

**Компоненты:**
1.  **`BM25Index`**: Классический полнотекстовый поиск (TF-IDF улучшенный). Хорош для точных совпадений ключевых слов.
2.  **`FuzzyIndex`**: Нечеткий поиск (Levenshtein distance). Находит результаты при опечатках.
3.  **`SemanticSearch`**: Векторный поиск (Cosine Similarity). Находит результаты по "смыслу", даже если слова разные.
4.  **`ExactMatch`**: Бонусная логика для точного совпадения фраз (дает сильный буст).

**Почему используется:**
Чистый векторный поиск часто упускает точные термины. Чистый BM25 не понимает синонимов. Гибридный подход ("Mini-Google") решает обе проблемы.

---

## 3. Database Layer (IndexedDB)

Для хранения векторов (эмбеддингов) используется IndexedDB, так как они слишком велики для `localStorage` или JSON файлов.

### `class EmbeddingsDatabase` (`src/lib/db/embeddings.ts`)
Обертка над `Dexie.js`.

**Схема данных:**
*   **`embeddings` table**:
    *   `id` (PK): `nodeId`
    *   `canvasId`: для фильтрации по холсту
    *   `embedding`: `number[]` (Float32Array)
    *   `responsePreview`: Полный текст ответа (для контекста при поиске)
*   **`embeddingChunks` table**:
    *   Multi-vector представление для длинных карточек. Позволяет находить конкретные параграфы внутри больших ответов.

**Ключевые методы:**
*   **`saveEmbedding(...)`**: Сохраняет вектор и метаданные.
*   **`syncEmbeddingsWithCanvas(canvasId, nodeIds)`**: "Сборщик мусора". Удаляет вектора для удаленных нод.

**Почему используется:**
Обеспечивает персистентность векторов на клиенте. Позволяет делать Semantic Search локально без постоянных запросов к API.

---

## 4. Library System (File System)

Логика работы с файлами вынесена в `src/lib/libraryIndex.ts` и `src/lib/libraryFs.ts`.

### `interface LibraryDoc` (Type)
Единица хранения в библиотеке.

```typescript
type LibraryDoc = {
  docId: string;        // UUID + ext
  name: string;         // Оригинальное имя файла
  kind: 'text' | 'image';
  fileHash: string;     // SHA-256 для детекта дубликатов
  analysis?: {          // Результаты AI-анализа (будущее)
    summary?: string;
    description?: string; // Для изображений
  }
}
```

**Ключевые концепции:**
*   **Canonical Storage**: Файлы хранятся в плоской структуре `data/library/files/`.
*   **Virtual Folder Structure**: Папки существуют только в `library-index.json`.
*   **Usage Index**: `data/library/usage-index.json` отслеживает, на каких холстах используется файл. Это аналог "Foreign Keys" для предотвращения удаления используемых файлов.

---

## 5. AI Catalog

### `src/lib/aiCatalog.ts`
Реестр ("Configuration as Code") доступных LLM моделей.

**Зачем:**
Централизованное место для настройки `maxContextTokens`, `displayName` и группировки моделей по вендорам (OpenAI, Anthropic, Google).
Позволяет UI рендерить списки моделей без хардкода строк по всему проекту.
