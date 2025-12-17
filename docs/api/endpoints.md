# API Endpoints Documentation

## Обзор
Приложение использует Next.js App Router для реализации API. Все эндпоинты расположены в `src/app/api`.
Большинство операций (кроме AI генерации) работают с локальной файловой системой (Electron `userData` или `./data` в dev-режиме).

---

## 1. Chat & AI (Core)

### `POST /api/chat`
Основной эндпоинт для генерации ответов. Проксирует запросы к LLM провайдеру (OpenAI-compatible).

-   **Метод**: `POST`
-   **Описание**: Принимает историю сообщений, генерирует ответ в режиме streaming (Server-Sent Events).
-   **Ключевые особенности**:
    -   **Streaming**: Возвращает `text/event-stream` в формате OpenAI delta.
    -   **Attachments**: Сервер сам читает файлы из библиотеки (`data/library/...`) и подмешивает их в контекст.
    -   **Demo Mode**: Если `apiKey` пустой, переключается на встроенный бесплатный ключ (OpenRouter) и фильтрует изображения (так как free-модели часто не мультимодальны).
    -   **System Prompts**: Автоматически собирает глобальный промпт + промпт холста + контекст родителей.

**Request Body:**
```typescript
interface ChatRequestBody {
  messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>;
  context?: string;          // Собранный контекст от родителей
  systemPrompt?: string;     // Инструкция холста
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  temperature?: number;
  // Вложения (ссылаются на файлы глобальной библиотеки)
  attachments?: Array<{
     attachmentId: string; // == docId
     originalName?: string;
  }>;
}
```

**Response**:
-   `200 OK` + `Content-Type: text/event-stream`
-   Поток событий `data: JSON`, содержащих дельты текста.

---

### `POST /api/embeddings`
Векторизация текста для NeuroSearch.

-   **Метод**: `POST`
-   **Описание**: Превращает текст в вектор (1536d по умолчанию).
-   **Модель**: `text-embedding-3-small` (по умолчанию) или из настроек.

**Request Body:**
```typescript
{
  text: string;
  apiKey?: string;
  embeddingsBaseUrl?: string; // Провайдер эмбеддингов
}
```

**Response:**
```json
{
  "embedding": [0.123, -0.456, ...],
  "dimension": 1536
}
```

---

### `POST /api/summarize`
Генерация кратких саммари для передачи контекста "внукам".

-   **Метод**: `POST`
-   **Описание**: Быстрая не-стриминговая генерация сжатого содержания текста (2-3 предложения).
-   **Особенности**:
    -   Использует системный промпт для детекта языка и сжатия.
    -   Не требует ключа в Demo Mode.

**Request Body:**
```json
{
  "text": "Длинный текст..."
}
```

**Response:**
```json
{
  "summary": "Краткая выжимка."
}
```

---

## 2. Canvas Management (Управление холстами)

### `GET /api/canvas/[id]`
Загрузка конкретного холста.

-   **Параметры**: `id` - ID холста (имя файла).
-   **Возвращает**: Полный JSON объекта холста.
-   **Логика**: Читает `data/canvases/[id].json`. При загрузке делает "Best-effort reconciliation" — проверяет актуальность метаданных вложений.

### `POST /api/canvas/[id]`
Сохранение или дублирование холста.

-   **Режимы**:
    1.  **Save**: Обновляет `nodes`, `edges`, `systemPrompt`. Также обновляет индекс использования (`usage-index.json`) для вложений.
    2.  **Duplicate**: `{ action: 'duplicate', newId, newName }` — копирует файл холста, создавая новую запись в `index.json`.

### `DELETE /api/canvas/[id]`
Удаление холста.

-   **Действие**: Удаляет `.json` файл холста и запись из `index.json`. Очищает ссылки на вложения в `usage-index.json`.

---

## 3. Workspace (Рабочее пространство)

### `GET /api/workspace`
Получение индекса всего пространства.

-   **Возвращает**: Структуру папок, список холстов, список недавних (`recent`) и активный холст.
-   **Источник**: `data/index.json`.

### `POST /api/workspace`
Управление структурой.

-   **Действия**:
    -   **Full Save**: Сохраняет весь индекс (папки, порядок холстов).
    -   **Create Canvas**: `{ action: 'createCanvas' }` — создает запись и файл.
    -   **Create Folder**: `{ action: 'createFolder' }`.

---

## 4. Global Library (Библиотека документов)

### `GET /api/library`
(или алиас `GET /api/library/list`)
Список всех документов.

-   **Возвращает**: Flat list всех документов и папок из `library-index.json`.

### `POST /api/library/upload`
Загрузка файлов.

-   **Content-Type**: `multipart/form-data`
-   **Параметры**:
    -   `files`: Один или несколько файлов.
    -   `folderId`: Опциональная папка назначения.
-   **Логика**:
    1.  Считает SHA-256 хэш.
    2.  Определяет `kind` (text/image) и MIME.
    3.  Сохраняет файл в `data/library/files/<UUID>.<ext>`.
    4.  Создает запись в `library-index.json`.
    5.  Если текст — генерирует превью (`excerpt`).

---

## Структура хранения данных (File System Maps)

Приложение хранит данные в:
*   Electron: `%APPDATA%/NeuroCanvas/data/`
*   Dev: `./data/`

```text
data/
├── index.json                 # Индекс workspace (папки, холсты)
├── canvases/                  # Файлы самих холстов
│   └── canvas-xyz.json
└── library/
    ├── library-index.json     # Индекс всех документов
    ├── usage-index.json       # Обратный индекс (какой документ где используется)
    ├── files/                 # Сами файлы (UUID имена)
    └── .trash/                # Корзина удаленных файлов
```
