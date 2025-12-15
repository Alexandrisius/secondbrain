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

    // Secure API key storage
    apiKeyStorage: 'Key storage',
    apiKeyStorageDescription: 'Choose where to store the API key. The key is no longer saved in localStorage.',
    apiKeyStorageMemory: 'Do not save',
    apiKeyStorageMemoryHint: 'Key is kept only in memory. You must enter it again after restart.',
    apiKeyStorageOsVault: 'OS vault',
    apiKeyStorageOsVaultHint: 'Store the key securely using the OS vault (Desktop only).',
    apiKeyStorageOsVaultDesktopOnly: 'Available only in the desktop app.',
    apiKeyStorageOsVaultUnavailable: 'OS vault is unavailable on this system (safeStorage unavailable).',
    apiKeyStorageLocalStorageNotice: 'The API key is no longer stored in localStorage. In “Do not save” mode it lives only in memory.',
    apiKeyStorageStatusIdle: 'Status: ready',
    apiKeyStorageStatusSaving: 'Saving key to OS vault...',
    apiKeyStorageStatusLoading: 'Loading key from OS vault...',
    apiKeyStorageStatusDeleting: 'Deleting key from OS vault...',
    apiKeyStorageStatusSaved: 'Key saved to OS vault.',
    apiKeyStorageStatusDeleted: 'Key deleted from OS vault.',
    apiKeyStorageStatusError: 'OS vault error.',
    apiKeyStorageSaveToVault: 'Save to vault',
    apiKeyStorageSavingButton: 'Saving...',
    /**
     * Button label after a successful save.
     *
     * Keep it short:
     * - status line uses a full sentence (`apiKeyStorageStatusSaved`)
     * - button needs a compact “state label”
     */
    apiKeyStorageSavedButton: 'Saved',
    apiKeyStorageDeleteFromVault: 'Delete',

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
    attachmentsContextUsed: 'Attachment context used',
    attachmentsSuffix: ' + attachments',
    viewFullContext: 'Click to view full context',
    // Marker on the context button (✱) — indicates that the user excluded
    // some context items (nodes/attachments), i.e. the context is "configured".
    contextHasExclusions: 'Context has exclusions',

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
    noAttachments: 'No attachments',
    noVirtualContext: 'No virtual context (NeuroSearch)',

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
    file: 'File:',
    attachmentText: 'Document text:',
    attachmentImage: 'Image:',
    attachmentsThisCard: 'This card attachments',
    attachmentsParent: 'Parent attachments',
    attachmentsParentN: 'Parent {n} attachments',
    attachmentsOfLevel: 'Attachments: {level}',
    excluded: 'Excluded from context',
    neuroSearchSimilar: 'Similar Topic (NeuroSearch)',

    // Labels for personal notes (NoteNode)
    noteTitle: 'Title:',
    noteContent: 'Content:',

    // -------------------------------------------------------------------------
    // UI: tabs and filters (context priority)
    // -------------------------------------------------------------------------
    tabLineage: 'Lineage',
    tabAttachments: 'Attachments',
    tabVirtual: 'NeuroSearch',
    tabLineageHint: 'Real links: parents and ancestors (primary context)',
    tabAttachmentsHint: 'This card attachments and inherited attachments',
    tabVirtualHint: 'Virtual context from NeuroSearch (often noisy)',

    // Excluded filter
    showExcluded: 'Show excluded',
    hideExcluded: 'Hide excluded',
    showExcludedToggleHint: 'Toggle visibility of excluded context blocks',

    // Tab descriptions (modal header)
    attachmentsTabDescription: 'Attachments: {count} files',
    virtualTabDescription: 'NeuroSearch: {count} results',
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
  // FILE MANAGER
  // ===========================================================================
  fileManager: {
    title: 'Files',
    all: 'All',
    trash: 'Trash',
    searchPlaceholder: 'Search documents...',
    /**
     * Tooltip for the “collapse” button in FileManagerSidebar.
     *
     * Note: this is not a generic “close” action (the panel can be expanded back),
     * so we keep a dedicated wording.
     */
    collapse: 'Collapse',

    /**
     * Compact “time ago” labels for file lists.
     * Keep them short (m/h/d) so the UI stays tight in both locales.
     */
    time: {
      justNow: 'just now',
      minutesAgo: '{count}m ago',
      hoursAgo: '{count}h ago',
      daysAgo: '{count}d ago',
    },
    
    // Toolbar
    newFolder: 'New Folder',
    upload: 'Upload',
    uploadTooltip: 'Upload files to current folder',
    gc: 'GC',
    gcTooltip: 'Permanently delete unlinked documents',
    /**
     * "Trash unlinked" button (move unlinked live docs to trash).
     *
     * Important:
     * - this is NOT "Empty trash" (that is permanent delete),
     * - and NOT "GC" (product meaning: permanent delete).
     * Here we do a soft cleanup: move "live" orphaned files into Trash.
     */
    trashUnlinkedTooltip: 'Move unlinked files to trash',
    /**
     * ARIA label for the numeric badge on the "unlinked" button.
     */
    trashUnlinkedCountAria: 'Unlinked files: {count}',
    /**
     * ARIA label for the Trash tab badge.
     */
    trashCountAria: 'Files in trash: {count}',
    emptyTrash: 'Empty',
    emptyTrashTooltip: 'Empty trash',
    refresh: 'Refresh',
    refreshTooltip: 'Recalculate links (usage-index)',
    filters: 'Filters',
    viewList: 'List',
    viewGrid: 'Grid',
    
    // Upload Zone
    dropFiles: 'Drop files here',
    clickToUpload: 'or click to select',
    uploadingTo: 'Uploading to:',
    root: 'root',

    // Upload Conflict Modal (when a folder already contains a file with the same name)
    conflicts: {
      title: 'File name conflict',
      description: 'Selected folder already contains documents with the same name. Choose an action for each file.',
      matchesInFolder: 'Matches in folder: {count}',
      // Strategies
      strategyReplace: 'Replace',
      strategyUploadAsNew: 'Upload as new',
      strategySkip: 'Skip',
      // Strategy hints
      replaceHint: 'We will replace the content of an existing document. Its docId will stay the same, but the file version (hash/updatedAt) will change.',
      replaceTarget: 'Replace target:',
      uploadAsNewHint: 'We will upload this as a new document (a new docId will be created). Provide a new name:',
      // Naming helpers
      copySuffix: '(copy)',
      defaultFileBaseName: 'file',
      newNamePlaceholder: 'Example: {example}',
      // Buttons
      apply: 'Apply',
    },

    // File/Folder item UI (tooltips, short labels)
    fileItem: {
      actionsTooltip: 'Actions',
      processingFallback: 'Processing...',
      staleFallback: 'Needs analysis/update',
      /**
       * Tooltip for the yellow "stale" status when API key is NOT set.
       *
       * Key UX case:
       * - user uploads files without an API key,
       * - background analysis cannot run,
       * - user still needs a clear explanation and a recovery path.
       */
      staleHintNoKey:
        'Needs analysis/update, but no API key is set. Open Settings, add a key, then run “Refresh LLM data”.',
      /**
       * Tooltip for the yellow "stale" status when API key IS set.
       * We explicitly point to the exact action so users don’t have to guess.
       */
      staleHintWithKey: 'Needs analysis/update. Right-click the file → “Refresh LLM data”.',
      errorFallback: 'Error',
      usedInCanvasesTooltip: 'Used in canvases: {count}',
    },
    folderItem: {
      actionsTooltip: 'Actions',
    },

    // FileDetails panel (if used in the UI)
    details: {
      panelTitle: 'Properties',
      tabView: 'View',
      tabMeta: 'Metadata',
      tabLinks: 'Links',
      root: 'Root',
      // Viewer / actions
      typeImage: 'Image',
      typeText: 'Text',
      openFileInNewTabTooltip: 'Open file in new tab',
      reloadTextTooltip: 'Reload text',
      fitImageTooltip: 'Fit image',
      zoomOutTooltip: 'Zoom out',
      zoomInTooltip: 'Zoom in',
      currentZoomTooltip: 'Current zoom',
      // Text viewer
      loadingText: 'Loading text…',
      failedToLoadText: 'Failed to load text',
      nonTextHint: 'Tip: if this is not a text document, use “Open in new tab”.',
      textTruncatedInfo: 'Showing first {limit} characters out of {total}.',
      showFullText: 'Show full text',
      showFullTextTooltip: 'Show full text (may be heavy for the browser)',
      // Quick labels
      sizeLabel: 'Size',
      updatedLabel: 'Updated',
      // Summary section
      descriptionTitle: 'Description',
      summaryTitle: 'Summary',
      noImageDescription:
        'No image description yet. It usually appears a few seconds after upload (analysis runs in the background). Check that an API key is set in Settings.',
      noSummary:
        'No summary yet. For texts an excerpt may be available right after upload; LLM summarization runs in the background.',
      // Meta tab
      nameLabel: 'Name',
      folderLabel: 'Folder',
      statusLabel: 'Status',
      // Links tab
      usedInTitle: 'Used in',
      canvasLabel: 'Canvas',
      cardLabel: 'Card',
      goToCardTooltip: 'Go to card (center + highlight)',
      noCardsInCanvas: 'No cards (canvas link only)',
      noLinkedCanvases: 'No linked canvases',
      // Footer action tooltips / labels
      trashedFirstRestore: 'Document is in trash: restore it first',
      renameTooltip: 'Rename document',
      moveTooltip: 'Move document',
      replaceTooltip: 'Replace file content (docId stays the same)',
      renameShort: 'Rename',
      moveShort: 'Move',
      replaceShort: 'Replace',
      download: 'Download',
    },
    
    // Actions
    actions: {
      open: 'Open',
      download: 'Download',
      rename: 'Rename',
      move: 'Move',
      replace: 'Replace file',
      /**
       * Manual trigger for LLM analysis for a library document.
       *
       * What analysis does:
       * - text: short summary
       * - image: caption-only description
       *
       * Why “Refresh”:
       * - analysis is idempotent; if already up to date, the server will skip.
       * - users think in terms of “rebuild missing context”.
       */
      analyzeLlm: 'Refresh LLM data',
      delete: 'Delete',
      restore: 'Restore',
      trash: 'Move to trash',
      createSubfolder: 'Create subfolder',
    },

    // Dialogs
    dialogs: {
      renameDocTitle: 'Rename document',
      renameDocDesc: 'docId: {id}',
      renameFolderTitle: 'Rename folder',
      renameFolderDesc: 'folderId: {id}',
      moveDocTitle: 'Move document',
      /**
       * Short description for the “move document” dialog.
       * Keep it a translation key to avoid hardcoded labels in JSX.
       */
      moveDocDesc: 'docId: {id}',
      createFolderTitle: 'New folder',
      deleteFolderTitle: 'Delete folder?',
      deleteFolderDesc: 'Folder will be deleted only if empty.',
      emptyTrashTitle: 'Empty trash?',
      /**
       * Important: "Empty trash" permanently deletes ALL documents in trash.
       *
       * Server semantics:
       * - first remove links from cards (unlink),
       * - then delete files physically.
       */
      emptyTrashDesc: 'All documents in trash will be permanently deleted. Links in cards will be removed automatically.',
      /**
       * Confirmation dialog for "trash unlinked".
       * This is a soft action: move to trash (NOT permanent delete).
       */
      trashUnlinkedTitle: 'Move unlinked files to trash?',
      trashUnlinkedDesc: '{count} unlinked documents will be moved to trash. This is not a permanent delete.',
      gcTitle: 'GC (Garbage Collection)',
      gcDesc: 'Delete unused documents?',
      /**
       * Label for the “GC include live” checkbox (dangerous action).
       */
      gcIncludeLiveLabel: 'Also delete “live” unlinked documents (dangerous)',
      trashUsedTitle: 'Document is in use',
      trashUsedDesc: 'This document is used in canvases. Links will remain, but the file will be in trash.',
      /**
       * Dialog shown when user tries to run analysis but has no API key.
       */
      llmMissingKeyTitle: 'API key is required for analysis',
      llmMissingKeyDesc:
        'Document: {name}. To restore summary/description, open Settings and provide an API key.',
      llmMissingKeyHint:
        'Tip: open Settings via the Settings button (gear) in the canvas toolbar. After adding the key, run “Refresh LLM data” again.',
      cancel: 'Cancel',
      save: 'Save',
      create: 'Create',
      delete: 'Delete',
      confirm: 'Confirm',
    },

    // Preview Modal
    preview: {
      title: 'Preview',
      openInNewTab: 'Open in new tab',
      download: 'Download',
      fileInfo: 'File Info',
      size: 'Size',
      created: 'Created',
      updated: 'Updated',
      type: 'Type',
      links: 'Links',
      noContent: 'Preview not available for this file type.',
      /**
       * Copy used both in the “Links” tab and in the “file is in use” delete warning.
       */
      linksUsedIn: 'Used in',
      linksCanvases: 'canvases',
      linksNoLinks: 'No links',
      linksNoCards: 'No linked cards',
      currentCanvasBadge: 'current',
      /**
       * Tooltip in the image viewer (“fit to screen”).
       */
      fitToScreen: 'Fit to screen',
      /**
       * Error shown when loading text preview failed (network/server error).
       */
      loadContentError: 'Failed to load file content',

      // Metadata fields
      docId: 'Doc ID',
      mimeType: 'MIME Type',
      fileHash: 'File Hash',
      aiDescription: 'AI Description',
      aiSummary: 'AI Summary',
    },
    
    // Filters
    filterCanvas: 'Filter by canvas',
    filterExt: 'Filter by extension',
    /**
     * Placeholder for the extensions input field.
     * Kept neutral; works for both locales.
     */
    filterExtPlaceholder: 'md, pdf, png',
    apply: 'Apply',
    reset: 'Reset',
    
    // Status
    itemsSelected: 'Selected: {count}',
    processing: 'Processing...',
    noFiles: 'No files',
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
