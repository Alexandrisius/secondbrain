<p align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/brain.svg" width="80" height="80" alt="NeuroCanvas Logo" />
</p>

<h1 align="center">🧠 NeuroCanvas</h1>

<p align="center">
  <strong>Visual AI canvas for prompt engineering and knowledge graphs</strong>
</p>

<p align="center">
  <a href="#-download">Download</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-hotkeys">Hotkeys</a> •
  <a href="#-api-setup">API Setup</a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-28-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
</p>

---

## 📥 Download

Download the latest version for Windows:

- [**Installer (.exe)**](https://github.com/Alexandrisius/secondbrain/releases/latest)
- [**Portable Version**](https://github.com/Alexandrisius/secondbrain/releases/latest)

---

## 🎯 What is it?

**NeuroCanvas** is an innovative tool for visually building AI prompts on an infinite canvas. Instead of a linear chat, you create a **knowledge graph** where each card connects to others, and context is passed automatically.

### 💡 The Problem
Traditional AI chats suffer from a critical issue: **linear history**. When exploring a complex topic, you inevitably drift into side branches, making it painful to return to the main conversation line.

### ✨ The Solution
NeuroCanvas allows you to:
- **Branch** dialogues like Git branches
- **Quote** specific parts of answers to continue
- **Visualize** connections between ideas
- **Search** across all canvases using hybrid AI search

---

## 🌟 Features

### 🤖 Multi-AI Support
- **OpenAI** (GPT-5.1, etc.)
- **OpenRouter** (Gemini 3 Pro, Claude 4.5 Opus, etc.)
- **Groq** (Ultra-fast inference)
- **Together AI** (Open-source models)
- **vsellm.ru** (Russian proxy, RUB payments)
- **Custom API** (Any OpenAI-compatible API, e.g., LM Studio or Ollama)

### 🎨 Visual Canvas
- **Infinite canvas** with navigation and zoom
- **Drag-to-Create**: drag a connection to create a card
- **Smart Selection**: intelligent selection and bulk operations
- **Dynamic Positioning**: new child cards automatically position to the right of parent with proper spacing
- **Resizable Cards**: drag the right edge to adjust card width
- **Automatic Context**: parent cards form the context for children

### 📝 Card Types
- **AI Cards**: interact with LLM, generate responses, support context inheritance
- **Note Cards**: personal notes with double-click to edit, formatted as context for AI
  - Title and content stored separately
  - Auto-summarization for context compression
  - Can be quoted and referenced like AI cards

### 💬 Quote System
- **Quote from Response**: select text from any card's response to create a linked card
- **Context Preservation**: quoted text is included in context along with full response/summary
- **Quote Invalidation**: automatic detection when source response changes
- **Quote Update**: re-select quote when source is modified
- **Visual Highlighting**: quoted sections highlighted in context viewer

### 🔍 Smart Search (RRF)
Combines 4 search methods for perfect results:
1. **BM25** (Keyword matching)
2. **Semantic Search** (Vector search by meaning)
3. **Fuzzy Search** (Typo-tolerant search)
4. **Exact Match** (Precise phrase matching)

**Enhanced Navigation**:
- **Keyboard Navigation**: arrow keys to navigate results
- **Auto-scroll**: selected result stays in view
- **Visual Highlighting**: clear indication of selected item
- **Quick Access**: `Ctrl+P` or `Ctrl+Л` (Russian layout)

### 🎯 Context Management
- **Context Viewer**: see full context hierarchy sent to LLM
- **Exclude from Context**: manually exclude specific ancestor cards
- **Expand/Collapse All**: quickly manage context visibility
- **Smart Context Types**: 
  - Full response for direct parents
  - Quotes for referenced sections
  - Summaries for distant ancestors

### ⚙️ Advanced Capabilities
- **Embeddings Model Selection**: tune search quality (`text-embedding-3`, `multilingual-e5`, etc.)
- **Corporate Mode**: work in networks with SSL inspection
- **Summarization**: automatic compression of long contexts
- **Local Storage**: all data is stored only on your device
- **Undo/Redo**: full history with `Ctrl+Z` / `Ctrl+Y`
- **Batch Operations**: mass collapse/expand for selected cards
- **Stale Detection**: automatic tracking of outdated cards when context changes

---

## 🔑 API Setup

To use the application, **you need your own API key** from your chosen provider (OpenAI, OpenRouter, etc.).

1. Open settings (⚙️) in the top right corner.
2. Select a provider (e.g., OpenAI or OpenRouter).
3. Enter your API key.
4. Select a chat model and (optionally) an embeddings model.

> 🎁 **Need a test key?**
> 
> If you don't have a key, I'm ready to provide a **free test key** in exchange for a Star ⭐️ on this repository!
> 
> 1. Give this project a Star ⭐.
> 2. Email me at: **klim95alex@yandex.by** with the subject "NeuroCanvas Key".

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 14 + React 18 + TypeScript 5
- **Desktop**: Electron 39 with auto-updates
- **Canvas**: React Flow (@xyflow/react) for infinite canvas
- **State Management**: Zustand with Immer for immutable updates
- **History**: Zundo for undo/redo functionality
- **Database**: Dexie (IndexedDB wrapper) for local storage
- **Search**: Hybrid RRF (Reciprocal Rank Fusion) with BM25, semantic, fuzzy, and exact matching
- **Styling**: Tailwind CSS with custom design system
- **Markdown**: React Markdown with GFM support

### Key Components
- **NeuroNode**: AI-powered card with prompt/response
- **NoteNode**: Personal note card with title/content
- **ContextViewerModal**: Hierarchical context viewer
- **SearchBar**: Hybrid search with keyboard navigation
- **Canvas**: Infinite workspace with React Flow

### Data Flow
1. User creates/edits cards on canvas
2. Context automatically built from parent chain
3. LLM request with full context hierarchy
4. Response streamed and displayed
5. Auto-summarization for context compression
6. All data persisted locally in IndexedDB

---

## 🚀 Build from Source

### Requirements
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Alexandrisius/secondbrain.git

# Install dependencies
npm install

# Run in development mode (Next.js + Electron)
npm run electron:dev

# Or build the application
npm run electron:build:win
```

---

## 🎮 Card Interactions

### Creating Cards
- **AI Card**: Double-click on empty canvas space
- **Note Card**: Right-click → "Create Note" or use hotkey
- **Child Card**: Select parent card → press `Tab`
- **Sibling Card**: Select card → press `Ctrl+Enter`
- **Quote Card**: Select text in response → click "Quote" button

### Editing Cards
- **AI Card**: Click prompt area to edit, auto-focus on creation
- **Note Card**: Double-click title or content to enter edit mode
- **Move Card**: Drag from any part of the card
- **Resize Card**: Drag the right edge handle

### Card States
- **Expanded/Collapsed**: Click answer section or press `Space`
- **Stale (Outdated)**: Orange badge when parent context changes
- **Quote Invalidated**: Red badge when quoted source changes
- **Generating**: Loading animation during AI response

---

## ⌨️ Hotkeys

| Key | Action |
|-----|--------|
| `Double Click` (on canvas) | Create new AI card |
| `Double Click` (on Note card) | Edit note title/content |
| `Tab` | Create child card (from selection) |
| `Ctrl + Enter` | Create sibling card |
| `Space` | Collapse/Expand answer (for selected cards) |
| `Delete` | Delete selected cards |
| `Ctrl + P` / `Ctrl + Л` | Open search (supports Russian layout) |
| `Ctrl + Z` / `Y` | Undo / Redo action |
| `Arrow Keys` | Navigate search results |
| `Enter` | Select search result / Submit prompt |
| `Right Mouse Button` | Pan canvas (drag) |

---

## 🤝 Support the Project

If this application helps you in your work, you can support its development:

- 🇷🇺 **[Boosty](https://boosty.to/klimovich_alexandr)** (Russian cards)
- 🌍 **[Ko-fi](https://ko-fi.com/klimovich_alexandr)** (PayPal, International cards)

---

## 📄 License

MIT © 2025 Klimovich Alexandr

<p align="center">
  Made with ❤️ for productive work with AI
</p>
