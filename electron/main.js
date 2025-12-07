/**
 * @file electron/main.js
 * @description Главный процесс Electron для NeuroCanvas
 * 
 * Этот файл запускается первым при старте приложения.
 * Он создаёт окно браузера, запускает Next.js сервер
 * и управляет жизненным циклом приложения.
 * 
 * АРХИТЕКТУРА:
 * - В development: подключаемся к внешнему Next.js dev серверу
 * - В production: запускаем встроенный Next.js standalone сервер
 */

const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');

// =============================================================================
// КОНСТАНТЫ И НАСТРОЙКИ
// =============================================================================

/**
 * Проверяем, запущено ли приложение в режиме разработки
 * В dev режиме мы подключаемся к Next.js dev серверу
 * В production режиме запускаем standalone сервер
 */
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Порт для Next.js сервера
 */
const PORT = 3000;

/**
 * URL приложения
 */
const APP_URL = `http://localhost:${PORT}`;

// =============================================================================
// ГЛАВНОЕ ОКНО И СЕРВЕР
// =============================================================================

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;

/**
 * Запускает Next.js standalone сервер в production режиме
 * 
 * Standalone сервер находится в:
 * - Development: .next/standalone/server.js
 * - Production (packaged): resources/standalone/server.js
 * 
 * Это минимальный Node.js сервер созданный при npm run build
 */
async function startProductionServer() {
  return new Promise((resolve, reject) => {
    console.log('[Electron] Запуск production сервера...');
    
    // Определяем путь к standalone серверу
    // В упакованном приложении ресурсы в process.resourcesPath
    let serverPath;
    let serverCwd;
    
    if (app.isPackaged) {
      // Production: ресурсы в resources/standalone/
      serverPath = path.join(process.resourcesPath, 'standalone', 'server.js');
      serverCwd = path.join(process.resourcesPath, 'standalone');
    } else {
      // Development: рядом с исходниками
      serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js');
      serverCwd = path.join(__dirname, '..', '.next', 'standalone');
    }
    
    console.log('[Electron] Путь к серверу:', serverPath);
    console.log('[Electron] Рабочая директория:', serverCwd);
    
    // Запускаем сервер как дочерний процесс
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: PORT.toString(),
        NODE_ENV: 'production',
      },
      cwd: serverCwd,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    
    // Логируем вывод сервера
    serverProcess.stdout?.on('data', (data) => {
      console.log(`[Next.js] ${data.toString().trim()}`);
    });
    
    serverProcess.stderr?.on('data', (data) => {
      console.error(`[Next.js Error] ${data.toString().trim()}`);
    });
    
    // Обрабатываем ошибки
    serverProcess.on('error', (error) => {
      console.error('[Electron] Ошибка запуска сервера:', error);
      reject(error);
    });
    
    // Ждём запуска сервера (проверяем доступность)
    let attempts = 0;
    const maxAttempts = 30; // 30 секунд максимум
    
    const checkServer = setInterval(async () => {
      attempts++;
      
      try {
        const response = await fetch(APP_URL);
        if (response.ok || response.status === 404) {
          // Сервер отвечает (404 тоже ок - значит сервер запущен)
          clearInterval(checkServer);
          console.log('[Electron] Production сервер запущен на порту', PORT);
          resolve();
        }
      } catch (error) {
        // Сервер ещё не готов
        if (attempts >= maxAttempts) {
          clearInterval(checkServer);
          reject(new Error('Таймаут запуска сервера'));
        }
      }
    }, 1000);
  });
}

/**
 * Создаёт главное окно приложения
 * Настраивает размеры, preload скрипт и поведение окна
 */
function createWindow() {
  // Создаём окно браузера с настройками
  mainWindow = new BrowserWindow({
    // Размеры окна
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    
    // Заголовок окна
    title: 'NeuroCanvas',
    
    // Иконка приложения (для Windows)
    icon: path.join(__dirname, 'icon.ico'),
    
    // Настройки веб-контента
    webPreferences: {
      // Preload скрипт для безопасного взаимодействия с Node.js
      preload: path.join(__dirname, 'preload.js'),
      
      // Отключаем Node.js интеграцию в рендерере для безопасности
      nodeIntegration: false,
      
      // Включаем изоляцию контекста для безопасности
      contextIsolation: true,
      
      // Разрешаем загрузку локальных ресурсов
      webSecurity: true,
    },
    
    // Показываем окно только когда оно готово (избегаем белого экрана)
    show: false,
    
    // Цвет фона (Catppuccin Mocha)
    backgroundColor: '#1e1e2e',
  });

  // =============================================================================
  // ЗАГРУЗКА КОНТЕНТА
  // =============================================================================
  
  // Загружаем приложение с локального сервера
  console.log('[Electron] Загрузка приложения с', APP_URL);
  mainWindow.loadURL(APP_URL);
  
  // В dev режиме открываем DevTools
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // =============================================================================
  // СОБЫТИЯ ОКНА
  // =============================================================================

  // Показываем окно когда оно готово к отображению
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[Electron] Окно готово и отображено');
  });

  // Обрабатываем закрытие окна
  mainWindow.on('closed', () => {
    mainWindow = null;
    console.log('[Electron] Главное окно закрыто');
  });

  // =============================================================================
  // ОБРАБОТКА ВНЕШНИХ ССЫЛОК
  // =============================================================================
  
  /**
   * Перехватываем клики по внешним ссылкам
   * Открываем их в системном браузере, а не в Electron
   * Это важно для ссылок на донаты (Boosty, Ko-fi и т.д.)
   */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Проверяем, что это внешняя ссылка (не localhost)
    if ((url.startsWith('http://') || url.startsWith('https://')) && 
        !url.includes('localhost')) {
      // Открываем в системном браузере
      shell.openExternal(url);
      console.log('[Electron] Открыта внешняя ссылка:', url);
      
      // Запрещаем открытие в Electron
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Также перехватываем навигацию по внешним ссылкам
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Если это не наш localhost сервер
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
      console.log('[Electron] Перенаправлена внешняя навигация:', url);
    }
  });
}

// =============================================================================
// МЕНЮ ПРИЛОЖЕНИЯ
// =============================================================================

/**
 * Создаёт кастомное меню приложения
 * Добавляем ссылки на донаты и полезные действия
 */
function createMenu() {
  const template = [
    // Меню "Файл"
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Обновить',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          },
        },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    
    // Меню "Вид"
    {
      label: 'Вид',
      submenu: [
        {
          label: 'Полный экран',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Увеличить',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(currentZoom + 0.1);
            }
          },
        },
        {
          label: 'Уменьшить',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            if (mainWindow) {
              const currentZoom = mainWindow.webContents.getZoomFactor();
              mainWindow.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
            }
          },
        },
        {
          label: 'Сбросить масштаб',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.setZoomFactor(1);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'DevTools',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          },
        },
      ],
    },
    
    // Меню "Помощь"
    {
      label: 'Помощь',
      submenu: [
        {
          label: '❤️ Поддержать проект (Boosty)',
          click: () => {
            shell.openExternal('https://boosty.to/klimovich_alexandr');
          },
        },
        {
          label: '☕ Support (Ko-fi)',
          click: () => {
            shell.openExternal('https://ko-fi.com/klimovich_alexandr');
          },
        },
        { type: 'separator' },
        {
          label: '📖 Документация',
          click: () => {
            shell.openExternal('https://github.com/Alexandrisius/secondbrain');
          },
        },
        {
          label: '🐛 Сообщить об ошибке',
          click: () => {
            shell.openExternal('https://github.com/Alexandrisius/secondbrain/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О NeuroCanvas',
              message: 'NeuroCanvas',
              detail: `Версия: ${app.getVersion()}\n\nВизуальный AI-холст для построения промптов и графов знаний.\n\nСделано с ❤️`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  // На macOS добавляем меню приложения
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'О NeuroCanvas' },
        { type: 'separator' },
        { role: 'hide', label: 'Скрыть' },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: 'Выйти' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// =============================================================================
// IPC ОБРАБОТЧИКИ
// =============================================================================

/**
 * Обработчик для открытия внешних ссылок из рендерера
 * Используется компонентом DonateModal
 */
ipcMain.handle('open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

/**
 * Получение информации о версии приложения
 */
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

/**
 * Проверка, запущено ли в Electron
 */
ipcMain.handle('is-electron', () => {
  return true;
});

// =============================================================================
// ЖИЗНЕННЫЙ ЦИКЛ ПРИЛОЖЕНИЯ
// =============================================================================

// Когда Electron готов к работе
app.whenReady().then(async () => {
  console.log('[Electron] Приложение готово');
  console.log('[Electron] Режим:', isDev ? 'development' : 'production');
  
  // Создаём меню
  createMenu();
  
  // В production режиме запускаем Next.js сервер
  if (!isDev) {
    try {
      await startProductionServer();
    } catch (error) {
      console.error('[Electron] Не удалось запустить сервер:', error);
      
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Ошибка запуска',
        `Не удалось запустить приложение.\n\n${error.message}\n\nПожалуйста, переустановите приложение.`
      );
      
      app.quit();
      return;
    }
  }
  
  // Создаём главное окно
  createWindow();

  // На macOS: пересоздаём окно при клике на иконку в dock
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Закрываем приложение когда все окна закрыты (кроме macOS)
app.on('window-all-closed', () => {
  // На macOS приложения обычно остаются активными
  if (process.platform !== 'darwin') {
    console.log('[Electron] Все окна закрыты, завершаем работу');
    app.quit();
  }
});

// Обрабатываем завершение приложения
app.on('before-quit', () => {
  console.log('[Electron] Приложение завершается...');
  
  // Останавливаем Next.js сервер
  if (serverProcess) {
    console.log('[Electron] Остановка Next.js сервера...');
    serverProcess.kill();
    serverProcess = null;
  }
});

// =============================================================================
// БЕЗОПАСНОСТЬ
// =============================================================================

// Отключаем небезопасные функции
app.on('web-contents-created', (event, contents) => {
  // Запрещаем навигацию на внешние страницы
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    // Разрешаем только localhost
    if (parsedUrl.hostname !== 'localhost') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
});

console.log('[Electron] Main process инициализирован');
