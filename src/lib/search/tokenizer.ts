/**
 * @file tokenizer.ts
 * @description Модуль токенизации и нормализации текста для поиска
 * 
 * Функционал:
 * - Токенизация текста на слова
 * - Нормализация (lowercase, удаление пунктуации)
 * - Стемминг для русского и английского языков
 * - Удаление стоп-слов
 * - N-грамм генерация для нечёткого поиска
 */

// =============================================================================
// СТОП-СЛОВА
// =============================================================================

/**
 * Русские стоп-слова - частые слова без семантической нагрузки
 * Удаляем их для повышения качества поиска
 */
const RUSSIAN_STOP_WORDS = new Set([
  // Предлоги
  'в', 'на', 'с', 'со', 'к', 'ко', 'о', 'об', 'от', 'по', 'за', 'из', 'у', 'до',
  'для', 'при', 'про', 'без', 'над', 'под', 'между', 'через', 'после', 'перед',
  // Союзы
  'и', 'а', 'но', 'или', 'да', 'что', 'чтобы', 'если', 'когда', 'как', 'так',
  'то', 'же', 'ли', 'бы', 'ни', 'не', 'ведь', 'даже', 'только', 'уже', 'ещё',
  // Местоимения
  'я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'это', 'этот', 'эта', 'эти',
  'тот', 'та', 'те', 'такой', 'такая', 'такие', 'какой', 'какая', 'какие',
  'который', 'которая', 'которые', 'чей', 'чья', 'чьи', 'свой', 'своя', 'свои',
  'мой', 'моя', 'мои', 'твой', 'твоя', 'твои', 'его', 'её', 'их', 'наш', 'ваш',
  'весь', 'вся', 'все', 'сам', 'сама', 'само', 'сами', 'себя', 'себе',
  // Глаголы-связки
  'быть', 'был', 'была', 'было', 'были', 'есть', 'будет', 'будут', 'буду',
  'является', 'являются', 'стать', 'стал', 'стала', 'стало', 'стали',
  // Частицы
  'вот', 'вон', 'лишь', 'почти', 'уж', 'разве', 'неужели',
  // Наречия
  'очень', 'более', 'менее', 'много', 'мало', 'где', 'куда', 'откуда',
  'там', 'тут', 'здесь', 'туда', 'сюда', 'оттуда', 'отсюда', 'везде', 'нигде',
  'всегда', 'никогда', 'иногда', 'теперь', 'сейчас', 'тогда', 'потом', 'затем',
  // Числительные
  'один', 'одна', 'одно', 'два', 'две', 'три', 'четыре', 'пять',
  // Прочее
  'можно', 'нужно', 'надо', 'нельзя', 'хорошо', 'плохо', 'лучше', 'хуже',
]);

/**
 * Английские стоп-слова
 */
const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
  'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'what',
  'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
]);

/**
 * Объединённый набор стоп-слов
 */
const ALL_STOP_WORDS = new Set([...RUSSIAN_STOP_WORDS, ...ENGLISH_STOP_WORDS]);

// =============================================================================
// ПРОСТОЙ РУССКИЙ СТЕММЕР (Porter-подобный)
// =============================================================================

/**
 * Окончания для русского стемминга (в порядке убывания длины)
 * Группы окончаний по частям речи
 */
const RUSSIAN_ENDINGS = {
  // Окончания причастий и деепричастий
  perfectiveGerund: [
    'ившись', 'ывшись', 'авшись', 'явшись',
    'ивши', 'ывши', 'авши', 'явши',
    'ив', 'ыв', 'ав', 'яв',
  ],
  // Окончания прилагательных
  adjective: [
    'ейшими', 'айшими', 'ейшего', 'айшего', 'ейшему', 'айшему',
    'ейшими', 'айшими', 'ейшая', 'айшая', 'ейшее', 'айшее',
    'ейший', 'айший', 'ейшую', 'айшую', 'ейших', 'айших',
    'ыми', 'ими', 'ого', 'его', 'ому', 'ему',
    'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ие', 'ые',
    'ий', 'ый', 'ой', 'ей', 'их', 'ых',
  ],
  // Окончания причастий
  participle: [
    'ующими', 'ющими', 'ащими', 'ящими',
    'ующий', 'ющий', 'ащий', 'ящий',
    'ующая', 'ющая', 'ащая', 'ящая',
    'ующее', 'ющее', 'ащее', 'ящее',
    'уемый', 'емый', 'имый',
    'ованн', 'еванн', 'анн', 'янн', 'енн', 'нн',
    'вш', 'ющ', 'ущ', 'ащ', 'ящ', 'ем', 'им',
  ],
  // Окончания глаголов
  verb: [
    'ировать', 'овать', 'евать', 'ывать', 'ивать',
    'уйте', 'ейте', 'йте', 'ите', 'ете',
    'ует', 'ют', 'ут', 'ат', 'ят', 'ит', 'ет',
    'уй', 'ей', 'й', 'ешь', 'ишь',
    'ла', 'ло', 'ли', 'л', 'ть', 'ти',
  ],
  // Окончания существительных
  noun: [
    'иями', 'ями', 'ами', 'ием', 'ьем', 'ем', 'ом',
    'иях', 'ях', 'ах', 'ии', 'ий', 'ей', 'ой', 'ью',
    'ия', 'ье', 'ие', 'ья', 'ев', 'ов',
    'ю', 'у', 'и', 'ы', 'е', 'о', 'а', 'я', 'ь',
  ],
  // Суффикс -ость
  derivational: ['ость', 'ост'],
  // Суперлативные суффиксы
  superlative: ['ейш', 'айш'],
};

/**
 * Простой стеммер для русского языка
 * Удаляет типичные окончания слов
 * 
 * @param word - Слово для стемминга
 * @returns Основа слова (stem)
 */
function stemRussian(word: string): string {
  // Минимальная длина для стемминга
  if (word.length < 4) {
    return word;
  }
  
  let stem = word;
  
  // Пробуем удалить окончания в порядке приоритета
  const allEndings = [
    ...RUSSIAN_ENDINGS.perfectiveGerund,
    ...RUSSIAN_ENDINGS.adjective,
    ...RUSSIAN_ENDINGS.participle,
    ...RUSSIAN_ENDINGS.verb,
    ...RUSSIAN_ENDINGS.derivational,
    ...RUSSIAN_ENDINGS.superlative,
    ...RUSSIAN_ENDINGS.noun,
  ];
  
  // Сортируем по длине (сначала длинные)
  allEndings.sort((a, b) => b.length - a.length);
  
  for (const ending of allEndings) {
    if (stem.endsWith(ending) && stem.length - ending.length >= 2) {
      stem = stem.slice(0, -ending.length);
      break; // Удаляем только одно окончание
    }
  }
  
  // Удаляем мягкий знак в конце если остался
  if (stem.endsWith('ь')) {
    stem = stem.slice(0, -1);
  }
  
  return stem;
}

/**
 * Простой стеммер для английского языка (Porter-подобный)
 * 
 * @param word - Слово для стемминга
 * @returns Основа слова
 */
function stemEnglish(word: string): string {
  if (word.length < 3) {
    return word;
  }
  
  let stem = word;
  
  // Суффиксы в порядке убывания длины
  const suffixes = [
    'ational', 'tional', 'ization', 'fulness', 'ousness', 'iveness',
    'ation', 'ness', 'ment', 'able', 'ible', 'ence', 'ance', 'ious',
    'eous', 'ally', 'tion', 'sion',
    'ing', 'ies', 'ied', 'ful', 'ess', 'ous', 'ive', 'ize', 'ise',
    'ly', 'ed', 'er', 'es', 's',
  ];
  
  for (const suffix of suffixes) {
    if (stem.endsWith(suffix) && stem.length - suffix.length >= 2) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  
  return stem;
}

// =============================================================================
// ОСНОВНЫЕ ФУНКЦИИ ТОКЕНИЗАЦИИ
// =============================================================================

/**
 * Определить является ли символ кириллицей
 */
function isCyrillic(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x0400 && code <= 0x04FF) || // Основная кириллица
         (code >= 0x0500 && code <= 0x052F);   // Дополнительная кириллица
}

/**
 * Определить является ли слово преимущественно русским
 */
function isRussianWord(word: string): boolean {
  let cyrillicCount = 0;
  for (const char of word) {
    if (isCyrillic(char)) cyrillicCount++;
  }
  return cyrillicCount > word.length / 2;
}

/**
 * Нормализовать текст
 * - Приводит к нижнему регистру
 * - Удаляет лишние пробелы
 * - Заменяет ё на е
 * 
 * @param text - Исходный текст
 * @returns Нормализованный текст
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Токенизировать текст на слова
 * Разбивает текст на отдельные слова, удаляя пунктуацию
 * 
 * @param text - Исходный текст
 * @returns Массив токенов (слов)
 */
export function tokenize(text: string): string[] {
  // Нормализуем текст
  const normalized = normalizeText(text);
  
  // Разбиваем на слова (оставляем буквы и цифры)
  // Регулярка для слов: буквы (кириллица + латиница) и цифры
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  
  // Фильтруем слишком короткие токены
  return tokens.filter((token) => token.length >= 2);
}

/**
 * Токенизировать с удалением стоп-слов
 * 
 * @param text - Исходный текст
 * @param removeStopWords - Удалять ли стоп-слова (по умолчанию true)
 * @returns Массив токенов без стоп-слов
 */
export function tokenizeWithStopWords(
  text: string,
  removeStopWords: boolean = true
): string[] {
  const tokens = tokenize(text);
  
  if (!removeStopWords) {
    return tokens;
  }
  
  return tokens.filter((token) => !ALL_STOP_WORDS.has(token));
}

/**
 * Токенизировать и применить стемминг
 * 
 * @param text - Исходный текст
 * @param removeStopWords - Удалять ли стоп-слова
 * @returns Массив стемов (основ слов)
 */
export function tokenizeAndStem(
  text: string,
  removeStopWords: boolean = true
): string[] {
  const tokens = tokenizeWithStopWords(text, removeStopWords);
  
  return tokens.map((token) => {
    // Определяем язык и применяем соответствующий стеммер
    if (isRussianWord(token)) {
      return stemRussian(token);
    } else {
      return stemEnglish(token);
    }
  });
}

/**
 * Получить уникальные стемы с их частотой
 * 
 * @param text - Исходный текст
 * @returns Map со стемами и их частотой
 */
export function getTermFrequencies(text: string): Map<string, number> {
  const stems = tokenizeAndStem(text);
  const frequencies = new Map<string, number>();
  
  for (const stem of stems) {
    frequencies.set(stem, (frequencies.get(stem) || 0) + 1);
  }
  
  return frequencies;
}

// =============================================================================
// N-ГРАММ ГЕНЕРАЦИЯ
// =============================================================================

/**
 * Генерировать символьные n-граммы для слова
 * Используется для нечёткого поиска
 * 
 * @param word - Исходное слово
 * @param n - Размер n-граммы (по умолчанию 3 - триграммы)
 * @returns Set уникальных n-грамм
 */
export function generateNgrams(word: string, n: number = 3): Set<string> {
  const ngrams = new Set<string>();
  const normalized = normalizeText(word);
  
  // Добавляем маркеры начала и конца для лучшего matching
  const padded = `$${normalized}$`;
  
  for (let i = 0; i <= padded.length - n; i++) {
    ngrams.add(padded.slice(i, i + n));
  }
  
  return ngrams;
}

/**
 * Генерировать n-граммы для всего текста
 * 
 * @param text - Исходный текст
 * @param n - Размер n-граммы
 * @returns Set всех n-грамм из текста
 */
export function generateTextNgrams(text: string, n: number = 3): Set<string> {
  const tokens = tokenize(text);
  const allNgrams = new Set<string>();
  
  for (const token of tokens) {
    const tokenNgrams = generateNgrams(token, n);
    for (const ngram of tokenNgrams) {
      allNgrams.add(ngram);
    }
  }
  
  return allNgrams;
}

/**
 * Вычислить коэффициент Jaccard между двумя множествами n-грамм
 * Используется для нечёткого сравнения строк
 * 
 * @param ngrams1 - Первый набор n-грамм
 * @param ngrams2 - Второй набор n-грамм
 * @returns Коэффициент Jaccard [0, 1]
 */
export function jaccardSimilarity(
  ngrams1: Set<string>,
  ngrams2: Set<string>
): number {
  if (ngrams1.size === 0 && ngrams2.size === 0) {
    return 1;
  }
  
  if (ngrams1.size === 0 || ngrams2.size === 0) {
    return 0;
  }
  
  // Пересечение
  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) {
      intersection++;
    }
  }
  
  // Объединение = |A| + |B| - |A ∩ B|
  const union = ngrams1.size + ngrams2.size - intersection;
  
  return intersection / union;
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Подсчитать количество слов в тексте
 */
export function countWords(text: string): number {
  return tokenize(text).length;
}

/**
 * Извлечь ключевые слова из текста (топ-N по частоте)
 * 
 * @param text - Исходный текст
 * @param topN - Количество ключевых слов
 * @returns Массив ключевых слов
 */
export function extractKeywords(text: string, topN: number = 10): string[] {
  const frequencies = getTermFrequencies(text);
  
  // Сортируем по частоте
  const sorted = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  
  return sorted.map(([word]) => word);
}

/**
 * Проверить, является ли токен стоп-словом
 */
export function isStopWord(token: string): boolean {
  return ALL_STOP_WORDS.has(token.toLowerCase());
}

/**
 * Получить стем для одного слова
 */
export function stem(word: string): string {
  const normalized = normalizeText(word);
  if (isRussianWord(normalized)) {
    return stemRussian(normalized);
  }
  return stemEnglish(normalized);
}

// =============================================================================
// ЭКСПОРТЫ ДЛЯ ТЕСТИРОВАНИЯ
// =============================================================================

export const _internal = {
  stemRussian,
  stemEnglish,
  isRussianWord,
  isCyrillic,
  RUSSIAN_STOP_WORDS,
  ENGLISH_STOP_WORDS,
};

