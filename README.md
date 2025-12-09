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
- **Automatic Context**: parent cards form the context for children

### 🔍 Smart Search (RRF)
Combines 4 search methods for perfect results:
1. **BM25** (Keyword matching)
2. **Semantic Search** (Vector search by meaning)
3. **Fuzzy Search** (Typo-tolerant search)
4. **Exact Match** (Precise phrase matching)

### ⚙️ Advanced Capabilities
- **Embeddings Model Selection**: tune search quality (`text-embedding-3`, `multilingual-e5`, etc.)
- **Corporate Mode**: work in networks with SSL inspection
- **Summarization**: automatic compression of long contexts
- **Local Storage**: all data is stored only on your device

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

## 🚀 Build from Source

### Requirements
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/Alexandrisius/secondbrain.git
cd neurocanvas

# Install dependencies
npm install

# Run in development mode (Next.js + Electron)
npm run electron:dev

# Or build the application
npm run electron:build:win
```

---

## ⌨️ Hotkeys

| Key | Action |
|-----|--------|
| `Double Click` | Create new card |
| `Tab` | Create child card (from selection) |
| `Ctrl + Enter` | Create sibling card |
| `Space` | Collapse/Expand answer |
| `Delete` | Delete selected cards |
| `Ctrl + P` | Open search |
| `Ctrl + Z` / `Y` | Undo / Redo action |

---

## 🤝 Support the Project

If this application helps you in your work, you can support its development:

- 🇷🇺 **[Boosty](https://boosty.to/klimovich_alexandr)** (Russian cards)
- 🌍 **[Ko-fi](https://ko-fi.com/klimovich_alexandr)** (PayPal, International cards)

---

## 📄 License

MIT © 2024-2025 NeuroCanvas Team

<p align="center">
  Made with ❤️ for productive work with AI
</p>
