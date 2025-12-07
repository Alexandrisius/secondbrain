/**
 * English translations
 * 
 * @module i18n/en
 */

import type { TranslationKeys } from './ru';

export const en: TranslationKeys = {
  // ===========================================================================
  // COMMON
  // ===========================================================================
  common: {
    done: 'Done',
    cancel: 'Cancel',
    delete: 'Delete',
    save: 'Save',
    edit: 'Edit',
    copy: 'Copy',
    rename: 'Rename',
    close: 'Close',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    update: 'Update',
    create: 'Create',
  },
  
  // ===========================================================================
  // SETTINGS
  // ===========================================================================
  settings: {
    title: 'Settings',
    description: 'Global application settings. Changes are saved automatically.',
    
    // API Section
    apiSection: 'API Settings',
    apiKey: 'API Key',
    apiKeyDescription: 'Enter your API key from vsellm.ru to access LLM models.',
    apiKeyPlaceholder: 'sk-...',
    apiKeyRequired: 'API key is required for the application to work. Generation is impossible without it.',
    showKey: 'Show key',
    hideKey: 'Hide key',
    
    // Model
    model: 'Model',
    modelDescription: 'Select a model or enter the name manually (format: provider/model).',
    modelPlaceholder: 'openai/chatgpt-4o-latest',
    selectModel: '-- Select a model --',
    customModel: 'Or enter model name manually:',
    
    // Context
    contextSection: 'Context Settings',
    summarization: 'Context Summarization',
    summarizationDescription: 'When enabled, distant ancestors (grandparents and beyond) use a brief summary instead of the full response. Saves tokens but loses details.',
    summarizationEnabled: 'Token saving mode:',
    summarizationEnabledDescription: 'Distant ancestors pass a brief summary or shortened response. Suitable for models with limited context.',
    summarizationDisabled: 'Full context mode:',
    summarizationDisabledDescription: 'All ancestors pass the full response without truncation. Ideal for models with large context windows (GPT-4, Claude, etc.)',
    toggleSummarization: 'Toggle summarization',
    
    // Language
    languageSection: 'Interface Language',
    language: 'Language',
    languageDescription: 'Select the application interface language.',
    russian: 'Русский',
    english: 'English',
    
    // Reset
    resetSettings: 'Reset Settings',
  },
  
  // ===========================================================================
  // SIDEBAR
  // ===========================================================================
  sidebar: {
    canvases: 'NeuroCanvas',
    allCanvases: 'All Canvases',
    recent: 'Recent',
    newCanvas: 'Canvas',
    newFolder: 'New Folder',
    noCanvases: 'No canvases',
    createHint: 'Click + to create',
    expandPanel: 'Expand panel',
    collapsePanel: 'Collapse panel',
    resizePanel: 'Resize width (double-click to reset)',
    version: 'NeuroCanvas v0.2',
    
    // Search
    searchPlaceholder: 'Search canvases...',
    searchNoResults: 'Nothing found',
    searchHint: 'Ctrl+K to search',
    canvas: 'Canvas',
    folder: 'Folder',
    
    // Folder context menu
    createCanvasInside: 'Create canvas inside',
    createSubfolder: 'Create subfolder',
    
    // Recent context menu
    removeFromRecent: 'Remove from recent',
    openInNewTab: 'Open',
    
    // Counters
    itemsCount: '{count} items',
    
    // Canvas actions
    deleteCanvas: 'Delete canvas',
    deleteCanvasConfirm: 'Delete canvas "{name}"?',
    
    // Folder actions
    deleteFolder: 'Delete folder',
    deleteFolderConfirm: 'Delete folder "{name}"?',
    folderActions: 'Action:\n1 - Rename\n2 - Delete\n3 - Cancel',
  },
  
  // ===========================================================================
  // CANVAS
  // ===========================================================================
  canvas: {
    // Loading
    loadingNotes: 'Loading notes...',
    restoringData: 'Restoring your data',
    
    // Save status
    saving: 'Saving...',
    unsaved: 'Unsaved',
    saved: 'Saved',
    ready: 'Ready',
    saveManually: 'Save manually',
    
    // Settings button
    openSettings: 'Open settings',
    settings: 'Settings',
  },
  
  // ===========================================================================
  // NODE (CARD)
  // ===========================================================================
  node: {
    // Placeholder
    promptPlaceholder: 'What are you thinking about?...',
    promptPlaceholderWithContext: 'Continue the thought...',
    
    // Buttons
    generateResponse: 'Generate response',
    regenerateResponse: 'Update response',
    copyResponse: 'Copy response',
    deleteCard: 'Delete card',
    showResponse: 'Show response',
    hideResponse: 'Hide',
    
    // Parent context
    parentContextUsed: 'Parent node context used',
    multipleParentContextUsed: 'Context from {count} parent nodes used',
    viewFullContext: 'Click to view full context',
    
    // Stale state
    staleContext: 'Context changed — regeneration required',
    staleConnections: 'Connections changed — regeneration required',
    
    // Quoting
    quoteFromParent: 'Quote from parent card',
    selectQuote: 'Select quote',
    cancelQuote: 'Cancel quoting',
    createQuoteCard: 'Create card from selection',
    updateQuote: 'Update quote in child card',
    changeQuote: 'Change',
    selectAnotherQuote: 'Select another quote',
    quoteInvalidated: 'Source text changed — quote is invalid',
    selectNewQuote: 'Select new quote',
    selectTextForQuote: 'Select text to create a quote card',
    selectTextForQuoteUpdate: 'Select text to update quote in child card',
    
    // Errors
    apiKeyMissing: 'API key not specified. Please add it in settings.',
  },
  
  // ===========================================================================
  // CONTEXT MODAL
  // ===========================================================================
  contextModal: {
    title: 'Card Context',
    description: 'Context from {count} ancestor used',
    descriptionPlural: 'Context from {count} ancestors used',
    noContext: 'No context from parent cards',
    rootCard: 'This is a root card without parents',
    
    // Levels
    parent: 'Parent',
    parentN: 'Parent {n}',
    ancestor: 'Ancestor [{n}]',
    
    // Context types
    contextTypes: 'Context types:',
    fullResponse: 'Full Response',
    quote: 'Quote',
    summary: 'Summary',
    full: 'Full',
    
    // Labels
    question: 'Question:',
    response: 'Response:',
    quoteLabel: 'Quote:',
  },
  
  // ===========================================================================
  // SEMANTIC SEARCH
  // ===========================================================================
  search: {
    // Title and placeholder
    title: 'Semantic Search',
    placeholder: 'Search by meaning...',
    hint: 'Enter a query to find similar cards',
    
    // Search modes
    currentCanvas: 'Current canvas',
    allCanvases: 'All canvases',
    current: 'Current',
    all: 'All',
    toggleScope: 'toggle',
    
    // Results
    noResults: 'No similar cards found',
    noResponse: 'No response',
    untitled: 'Untitled',
    searchError: 'Search error',
    indexedCards: 'Indexed cards: {count}',
    
    // Navigation
    navigate: 'navigate',
    select: 'select',
    close: 'close',
    
    // Reindex
    reindex: 'Index',
    reindexing: 'Indexing...',
    
    // Hotkey
    hotkeyHint: 'Ctrl+P to search',
  },
  
  // ===========================================================================
  // DONATE AND SUPPORT
  // ===========================================================================
  donate: {
    title: 'Support the Project',
    description: 'If NeuroCanvas is useful to you, you can support its development.',
    support: 'Support',
    supportProject: 'Support the project',
    freeNotice: 'NeuroCanvas is a free and open-source application. Your API key is used directly, without intermediaries.',
    boostyDescription: 'For Russia and CIS (rubles, Russian cards)',
    kofiDescription: 'For international payments (PayPal)',
    githubDescription: 'Give us a star on GitHub!',
    thanks: 'Thank you for using NeuroCanvas!',
  },
};
