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

    // Provider
    apiProvider: 'API Provider',
    apiProviderDescription: 'Select an API provider. All providers use OpenAI-compatible format.',

    // API Key
    apiKey: 'API Key',
    apiKeyDescription: 'Enter the API key from your selected provider.',
    apiKeyPlaceholder: 'sk-...',
    apiKeyRequired: 'API key is required for the application to work. Generation is impossible without it.',
    showKey: 'Show key',
    hideKey: 'Hide key',

    // Custom URL
    customApiUrl: 'Chat API URL',
    customApiUrlDescription: 'Base URL for OpenAI-compatible API (without /chat/completions).',
    customEmbeddingsUrl: 'Embeddings API URL',
    customEmbeddingsUrlDescription: 'URL for embeddings API (leave empty if not used).',
    currentApiUrl: 'Chat API',
    currentEmbeddingsUrl: 'Embeddings API',
    noEmbeddingsSupport: 'This provider does not support embeddings (semantic search unavailable)',

    // Model
    model: 'Model',
    modelDescription: 'Select a model or enter the name manually (format: provider/model).',
    modelPlaceholder: 'google/gemini-2.5-flash',
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

    // Interface
    interfaceSection: 'Interface',
    defaultCardWidth: 'Default Card Width',
    defaultCardWidthDescription: 'Specify the width (in pixels) for new cards.',
    defaultCardContentHeight: 'Default Card Content Height',
    defaultCardContentHeightDescription: 'Specify the maximum height (in pixels) of the scrollable content area (answers and notes).',

    // Reset
    resetSettings: 'Reset Settings',

    // Corporate mode
    corporateSection: 'Corporate Network',
    corporateMode: 'Corporate Mode',
    corporateModeDescription: 'Disables SSL certificate verification. Enable if you work in a corporate network with SSL inspection (DLP, proxy).',
    corporateModeEnabled: 'Mode enabled:',
    corporateModeEnabledDescription: 'SSL verification disabled. Use only in trusted corporate networks!',
    corporateModeDisabled: 'Mode disabled:',
    corporateModeDisabledDescription: 'Full SSL certificate verification (recommended).',
    corporateModeWarning: '⚠️ Warning: disabling SSL verification reduces security. Do not use in public networks (cafes, airports)!',
    toggleCorporateMode: 'Toggle corporate mode',

    // Provider descriptions
    providers: {
      openrouter: 'Model aggregator (GPT, Claude, Llama, etc.)',
      custom: 'Any OpenAI-compatible API (default: VSELLM)',
    },

    // Embeddings section
    embeddingsSection: 'Semantic Search',
    embeddingsModel: 'Embeddings Model',
    embeddingsModelDescription: 'Model for text vectorization in semantic search. Different providers support different models.',
    embeddingsDimension: 'Dimension',
    indexedCards: 'Indexed',
    embeddingsModelChangeWarning: 'Reindexing required!',
    embeddingsModelChangeDescription: 'When changing the model, you need to clear the current index ({count} cards) and reindex, as different models create incompatible vectors.',
    clearAndChange: 'Clear and change',
    clearingIndex: 'Clearing index...',
    reindexingCards: 'Reindexing cards...',
    reindexingProgress: '{current} / {total}',
    reindexAllCanvases: 'Reindex all canvases',
    reindexAllPreparing: 'Preparing: clearing old index before reindexing...',
    reindexAllProgress: 'Canvas {canvasCurrent}/{canvasTotal} ({canvasName}) • {cardCurrent}/{cardTotal}',
    embeddingsIndexUnknownWarning: 'Index exists but model metadata is missing (it may have been created by an older app version). Reindexing is recommended.',
    embeddingsIndexStaleWarning: 'Index was built with model "{indexedModel}" and URL "{indexedUrl}". Current settings: model "{currentModel}" and URL "{currentUrl}". Reindexing is required for correct search.',

    // NeuroSearch sensitivity
    neuroSearchSensitivity: 'NeuroSearch Sensitivity',
    neuroSearchSensitivityDescription: 'Minimum semantic similarity threshold (0..1). Lower = more results (more noise), higher = fewer results (stricter).',
    neuroSearchSensitivityLow: 'More results',
    neuroSearchSensitivityHigh: 'Stricter',

    // Context window
    contextWindowSection: 'Model Context Window',
    maxContextTokens: 'Maximum Context',
    maxContextTokensDescription: 'Token limit for the selected model context window. Automatically detected for known models.',
    autoDetected: 'Auto-detected',
    autoDetectedDescription: 'Limit automatically determined based on the selected model.',
    manualOverride: 'Override manually',
    manualOverrideDescription: 'Specify your own limit if auto-detection is incorrect.',
    tokensPlaceholder: 'Number of tokens',
    unknownModel: 'Model not recognized, using default value.',
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
    version: 'NeuroCanvas v{version}',

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

    // Undo/Redo
    undo: 'Undo',
    redo: 'Redo',
    undoTooltip: 'Undo last action',
    redoTooltip: 'Redo undone action',
    noUndoAvailable: 'Nothing to undo',
    noRedoAvailable: 'Nothing to redo',
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
    neuroSearchContext: 'NeuroSearch Context',
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

    // Stop generation
    stopGeneration: 'Stop generation',

    // Resize
    resizeCard: 'Resize card width',

    // Context tokens
    tokens: 'tokens',
    contextUsage: 'Context usage',
    tokensUsed: '{used} / {max} tokens ({percent}%)',
    contextOverflow: 'Context exceeds model limit!',
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
    excluded: 'Excluded from context',
    neuroSearchSimilar: 'Similar Topic (NeuroSearch)',

    // Labels for personal notes (NoteNode)
    noteTitle: 'Title:',
    noteContent: 'Content:',
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
  // BATCH REGENERATION
  // ===========================================================================
  batchRegenerate: {
    /** Button without counter (when no stale nodes) */
    button: 'Update stale',
    /** Button with counter */
    buttonWithCount: 'Update {count}',
    /** Progress */
    progress: 'Updating {completed}/{total}...',
    /** Cancel */
    cancel: 'Cancel',
    /** No stale */
    noStale: 'No stale cards',
    /** Button tooltip */
    tooltip: 'Regenerate all stale cards in order from ancestors to descendants',
  },

  // ===========================================================================
  // CARD CREATION BUTTONS
  // ===========================================================================
  toolButtons: {
    createAiCard: 'AI Card',
    createAiCardTooltip: 'Create an AI card for LLM conversation',
    createNoteCard: 'Note',
    createNoteCardTooltip: 'Create a personal note',
  },

  // ===========================================================================
  // PERSONAL NOTE (NoteNode)
  // ===========================================================================
  noteNode: {
    titlePlaceholder: 'Note title',
    contentPlaceholder: 'Write your note...',
    emptyNote: 'Empty note',
    quoteSelectionMode: 'Text selection mode',
    chars: 'chars',
    summarizing: 'Summarizing...',
  },

  // ===========================================================================
  // READING MODE
  // ===========================================================================
  readingMode: {
    title: 'Reading Mode',
    openReadingMode: 'Open in reading mode',
    close: 'Close',
    
    // Navigation
    goToParent: 'Go to parent card',
    goToChild: 'Go to child card',
    toParent: 'To parent',
    toChild: 'To child',
    goBack: 'Back',
    noParents: 'No parents',
    noChildren: 'No children',
    
    // Multiple connections
    selectParent: 'Select parent card',
    selectChild: 'Select child card',
    parentsCount: '{count} parents',
    childrenCount: '{count} children',
    
    // Breadcrumb and progress
    rootCard: 'Root',
    currentCard: 'Current',
    cardPosition: 'Card {current} of {total}',
    
    // Card types
    aiCard: 'AI card',
    noteCard: 'Note',
    untitled: 'Untitled',
    
    // Mini-graph
    graphNeighborhood: 'Card neighborhood',
    
    // Shortcuts
    shortcuts: 'Keyboard shortcuts',
    shortcutEscape: 'Escape — close',
    shortcutArrows: 'Arrows ← → — navigate',
    shortcutBackspace: 'Backspace — go back in history',
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

  // ===========================================================================
  // CLOSE CONFIRMATION DIALOG (ELECTRON)
  // ===========================================================================
  closeConfirm: {
    title: 'Close NeuroCanvas?',
    message: 'Are you sure you want to close the application?',
    detail: 'All data will be saved before closing.',
    saveAndExit: 'Save and Exit',
    cancel: 'Cancel',
    saveErrorTitle: 'Save Error',
    saveErrorMessage: 'Could not save data',
    saveErrorDetail: 'Exit without saving anyway?',
    exitWithoutSaving: 'Exit Without Saving',
    errorTitle: 'Close Application?',
    errorMessage: 'An error occurred',
    errorDetail: 'Could not save. Exit anyway?',
    exit: 'Exit',
  },

  // ===========================================================================
  // SYSTEM PROMPT
  // ===========================================================================
  systemPrompt: {
    title: 'System Prompt',
    description: 'This prompt applies to all cards on this canvas. The global prompt is added automatically.',
    globalSection: 'Global Prompt',
    globalDescription: 'This prompt applies to all canvases and cannot be modified.',
    canvasSection: 'Canvas Prompt',
    canvasDescription: 'Additional prompt for this canvas. Added after the global prompt.',
    placeholder: 'E.g., "Be concise and to the point" or "Use technical writing style"',
    clear: 'Clear',
    unsavedChanges: 'Unsaved changes',
    hint: 'The system prompt is sent to the LLM at the beginning of each request. Use it to customize response style, specify a role, or add project context.',
    buttonTooltip: 'System prompt for LLM',
  },
};
