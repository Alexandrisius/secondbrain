/**
 * @file index.ts
 * @description Экспорты компонентов холста
 * 
 * Централизованный экспорт всех компонентов из папки canvas/
 */

// Основной компонент холста
export { Canvas } from './Canvas';

// Контент холста (React Flow обёртка)
export { CanvasContent } from './CanvasContent';

// Компонент ноды (карточки)
export { NeuroNode } from './NeuroNode';

// Поисковая панель
export { SearchBar } from './SearchBar';

// Модальное окно настроек
export { SettingsModal, SettingsButton } from './SettingsModal';

// Модальное окно просмотра контекста
export { ContextViewerModal } from './ContextViewerModal';

// Модальное окно донатов/поддержки
export { DonateModal, DonateButtonTrigger } from './DonateModal';

// Режим полноэкранного чтения карточек
export { ReadingModeModal } from './ReadingModeModal';