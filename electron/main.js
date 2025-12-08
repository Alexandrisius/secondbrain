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

const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const detectPort = require('detect-port');

// =============================================================================
// АВТООБНОВЛЕНИЯ
// =============================================================================

/**
 * Модуль для автоматического обновления приложения через GitHub Releases
 * Загружается только в production режиме
 */
let autoUpdater = null;

/**
 * Флаг для отслеживания ручной проверки обновлений
 * Если true - показываем диалог даже если обновлений нет
 * При автоматической проверке при старте - не показываем
 */
let isManualUpdateCheck = false;

/**
 * Флаг для отслеживания процесса скачивания обновления
 * Если true - показываем ошибки скачивания
 */
let isDownloadingUpdate = false;

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
 * Базовый порт для Next.js сервера (с которого начинаем поиск)
 * Если этот порт занят, будет автоматически выбран следующий свободный
 */
const DEFAULT_PORT = 3000;

/**
 * Текущий используемый порт (будет определён динамически)
 * @type {number}
 */
let PORT = DEFAULT_PORT;

/**
 * URL приложения (будет обновлён после определения порта)
 * @type {string}
 */
let APP_URL = `http://localhost:${PORT}`;

// =============================================================================
// ПОИСК СВОБОДНОГО ПОРТА
// =============================================================================

/**
 * Находит свободный порт, начиная с указанного
 * Если startPort занят, возвращает ближайший свободный порт
 * 
 * @param {number} startPort - Порт с которого начинаем поиск
 * @returns {Promise<number>} - Свободный порт
 */
async function findAvailablePort(startPort) {
  try {
    const availablePort = await detectPort(startPort);
    
    if (availablePort !== startPort) {
      console.log(`[Electron] ⚠️ Порт ${startPort} занят, используем порт ${availablePort}`);
    } else {
      console.log(`[Electron] ✓ Порт ${startPort} свободен`);
    }
    
    return availablePort;
  } catch (error) {
    console.error('[Electron] Ошибка при поиске свободного порта:', error);
    // В случае ошибки возвращаем дефолтный порт
    return startPort;
  }
}

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
 * 
 * ВАЖНО: Автоматически находит свободный порт, если дефолтный занят
 */
async function startProductionServer() {
  // Сначала находим свободный порт
  PORT = await findAvailablePort(DEFAULT_PORT);
  APP_URL = `http://localhost:${PORT}`;
  
  return new Promise((resolve, reject) => {
    console.log('[Electron] Запуск production сервера на порту', PORT);
    
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
    
    // Определяем путь для хранения пользовательских данных
    // app.getPath('userData') возвращает:
    // - Windows: %APPDATA%\NeuroCanvas
    // - macOS: ~/Library/Application Support/NeuroCanvas
    // - Linux: ~/.config/NeuroCanvas
    const userDataPath = app.getPath('userData');
    console.log('[Electron] Путь к данным пользователя:', userDataPath);
    
    // Запускаем сервер как дочерний процесс
    // Передаём USER_DATA_PATH чтобы Next.js знал куда сохранять данные
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: PORT.toString(),
        NODE_ENV: 'production',
        // Путь для хранения данных пользователя (холсты, настройки)
        USER_DATA_PATH: userDataPath,
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
          label: '🔄 Проверить обновления',
          click: async () => {
            if (autoUpdater && !isDev) {
              try {
                // Устанавливаем флаг ручной проверки для показа диалога
                isManualUpdateCheck = true;
                await autoUpdater.checkForUpdates();
              } catch (error) {
                isManualUpdateCheck = false;
                dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Ошибка',
                  message: 'Не удалось проверить обновления',
                  detail: error.message,
                });
              }
            } else if (isDev) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Режим разработки',
                message: 'Автообновления недоступны в режиме разработки',
              });
            }
          },
        },
        { type: 'separator' },
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

/**
 * Ручная проверка обновлений (вызывается из меню или из React-приложения)
 * Устанавливает флаг isManualUpdateCheck для показа диалога о результате
 */
ipcMain.handle('check-for-updates', async () => {
  if (autoUpdater && !isDev) {
    try {
      // Устанавливаем флаг ручной проверки для показа диалога
      isManualUpdateCheck = true;
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      isManualUpdateCheck = false;
      console.error('[Updater] Ошибка проверки обновлений:', error);
      return false;
    }
  }
  return false;
});

// =============================================================================
// АВТООБНОВЛЕНИЯ
// =============================================================================

/**
 * Инициализирует систему автообновлений
 * Настраивает обработчики событий и запускает проверку обновлений
 */
function initAutoUpdater() {
  // Автообновления работают только в production режиме
  if (isDev) {
    console.log('[Updater] Автообновления отключены в dev режиме');
    return;
  }
  
  try {
    // Динамически загружаем electron-updater
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;
    
    // Настройки
    autoUpdater.autoDownload = false; // Не скачивать автоматически, спросить пользователя
    autoUpdater.autoInstallOnAppQuit = true; // Установить при выходе
    
    // =========================================================================
    // ОБРАБОТЧИКИ СОБЫТИЙ
    // =========================================================================
    
    /**
     * Проверка обновлений началась
     */
    autoUpdater.on('checking-for-update', () => {
      console.log('[Updater] Проверка обновлений...');
    });
    
    /**
     * Найдено новое обновление
     * Диалог показывается только при ручной проверке (из меню)
     * При автоматической проверке при запуске - только логируем
     */
    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Доступно обновление:', info.version);
      
      // Показываем диалог только при ручной проверке
      if (isManualUpdateCheck) {
        isManualUpdateCheck = false; // Сбрасываем флаг
        
        // Показываем диалог пользователю
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Доступно обновление',
          message: `Доступна новая версия ${info.version}`,
          detail: `Текущая версия: ${app.getVersion()}\nНовая версия: ${info.version}\n\nХотите скачать и установить обновление?`,
          buttons: ['Скачать', 'Позже'],
          defaultId: 0,
          cancelId: 1,
        }).then(({ response }) => {
          if (response === 0) {
            // Пользователь согласился - начинаем скачивание
            console.log('[Updater] Пользователь согласился на обновление, начинаем скачивание...');
            
            // Устанавливаем флаг скачивания
            isDownloadingUpdate = true;
            
            // Показываем уведомление о начале скачивания
            if (mainWindow) {
              mainWindow.setTitle('NeuroCanvas - Подготовка к скачиванию...');
              mainWindow.setProgressBar(0.01); // Минимальный прогресс чтобы показать что процесс идёт
            }
            
            // Запускаем скачивание
            autoUpdater.downloadUpdate().catch((err) => {
              isDownloadingUpdate = false;
              console.error('[Updater] Ошибка при скачивании:', err);
              if (mainWindow) {
                mainWindow.setProgressBar(-1);
                mainWindow.setTitle('NeuroCanvas');
              }
              dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Ошибка скачивания',
                message: 'Не удалось скачать обновление',
                detail: err.message || String(err),
                buttons: ['OK'],
              });
            });
          } else {
            console.log('[Updater] Пользователь отложил обновление');
          }
        });
      } else {
        // При автоматической проверке при запуске - только логируем
        console.log('[Updater] Обновление доступно (автопроверка), диалог не показываем');
      }
    });
    
    /**
     * Обновлений нет - версия актуальна
     * При ручной проверке показываем диалог пользователю
     */
    autoUpdater.on('update-not-available', (info) => {
      console.log('[Updater] Обновлений нет, текущая версия актуальна:', info.version);
      
      // Показываем диалог только при ручной проверке (из меню или через IPC)
      if (isManualUpdateCheck) {
        isManualUpdateCheck = false; // Сбрасываем флаг
        
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Обновления',
          message: 'Версия программы актуальная',
          detail: `Установлена последняя версия ${app.getVersion()}.\nОбновлений не найдено.`,
          buttons: ['OK'],
        });
      }
    });
    
    /**
     * Прогресс скачивания
     * Показываем прогресс в заголовке окна и в прогресс-баре на панели задач
     */
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      const downloaded = (progress.transferred / 1024 / 1024).toFixed(1);
      const total = (progress.total / 1024 / 1024).toFixed(1);
      
      console.log(`[Updater] Скачивание: ${percent}% (${downloaded}/${total} MB)`);
      
      // Обновляем прогресс в заголовке окна и прогресс-баре
      if (mainWindow) {
        mainWindow.setProgressBar(progress.percent / 100);
        mainWindow.setTitle(`NeuroCanvas - Скачивание ${percent}% (${downloaded}/${total} MB)`);
      }
    });
    
    /**
     * Обновление скачано и готово к установке
     * Показываем диалог с предложением перезапустить приложение
     */
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[Updater] Обновление скачано:', info.version);
      
      // Сбрасываем флаг скачивания
      isDownloadingUpdate = false;
      
      // Сбрасываем прогресс-бар и обновляем заголовок
      if (mainWindow) {
        mainWindow.setProgressBar(-1);
        mainWindow.setTitle('NeuroCanvas - Обновление готово!');
      }
      
      // Показываем диалог для перезапуска
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Обновление готово к установке',
        message: `Версия ${info.version} скачана!`,
        detail: 'Для установки обновления необходимо перезапустить приложение.\n\nВсе несохранённые данные будут потеряны.',
        buttons: ['Перезапустить сейчас', 'Установить позже'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) {
          // Перезапускаем приложение для установки обновления
          console.log('[Updater] Перезапуск для установки обновления...');
          
          // Показываем что идёт установка
          if (mainWindow) {
            mainWindow.setTitle('NeuroCanvas - Установка обновления...');
          }
          
          // quitAndInstall: первый параметр - isSilent (без диалогов установщика)
          // второй параметр - isForceRunAfter (запустить после установки)
          autoUpdater.quitAndInstall(false, true);
        } else {
          console.log('[Updater] Обновление будет установлено при следующем запуске');
          if (mainWindow) {
            mainWindow.setTitle('NeuroCanvas');
          }
        }
      });
    });
    
    /**
     * Ошибка при обновлении (проверка или скачивание)
     */
    autoUpdater.on('error', (error) => {
      console.error('[Updater] Ошибка:', error);
      
      // Сохраняем и сбрасываем флаги
      const wasManualCheck = isManualUpdateCheck;
      const wasDownloading = isDownloadingUpdate;
      isManualUpdateCheck = false;
      isDownloadingUpdate = false;
      
      // Сбрасываем прогресс-бар при ошибке
      if (mainWindow) {
        mainWindow.setProgressBar(-1);
        mainWindow.setTitle('NeuroCanvas');
        
        // Показываем диалог с ошибкой при ручной проверке или скачивании
        if (wasManualCheck || wasDownloading) {
          const title = wasDownloading ? 'Ошибка скачивания' : 'Ошибка проверки обновлений';
          const message = wasDownloading 
            ? 'Не удалось скачать обновление' 
            : 'Не удалось проверить обновления';
          
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title,
            message,
            detail: `${error.message || error}`,
            buttons: ['OK'],
          });
        }
      }
    });
    
    // =========================================================================
    // ЗАПУСК ПРОВЕРКИ
    // =========================================================================
    
    // Проверяем обновления через 5 секунд после запуска
    // (даём приложению время загрузиться)
    setTimeout(() => {
      console.log('[Updater] Запуск проверки обновлений...');
      autoUpdater.checkForUpdates().catch((error) => {
        console.error('[Updater] Ошибка при проверке обновлений:', error);
      });
    }, 5000);
    
    console.log('[Updater] Система автообновлений инициализирована');
    
  } catch (error) {
    console.error('[Updater] Не удалось инициализировать автообновления:', error);
  }
}

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
      
      dialog.showErrorBox(
        'Ошибка запуска',
        `Не удалось запустить приложение.\n\n${error.message}\n\nПожалуйста, переустановите приложение.`
      );
      
      app.quit();
      return;
    }
  } else {
    // В dev режиме проверяем, на каком порту запущен Next.js dev server
    // Next.js может автоматически выбрать другой порт, если 3000 занят
    // Пробуем найти запущенный сервер на портах 3000-3010
    console.log('[Electron] Поиск запущенного Next.js dev сервера...');
    
    let foundPort = null;
    for (let port = DEFAULT_PORT; port <= DEFAULT_PORT + 10; port++) {
      try {
        const response = await fetch(`http://localhost:${port}`, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(500) // Таймаут 500мс
        });
        // Сервер отвечает на этом порту
        foundPort = port;
        break;
      } catch (error) {
        // Этот порт не отвечает, пробуем следующий
        continue;
      }
    }
    
    if (foundPort) {
      PORT = foundPort;
      APP_URL = `http://localhost:${PORT}`;
      console.log(`[Electron] ✓ Найден Next.js dev сервер на порту ${PORT}`);
    } else {
      console.log(`[Electron] ⚠️ Next.js dev сервер не найден, используем порт ${DEFAULT_PORT}`);
      console.log('[Electron] Убедитесь, что "npm run dev" запущен');
    }
  }
  
  // Создаём главное окно
  createWindow();
  
  // Инициализируем автообновления (только в production)
  initAutoUpdater();

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

// =============================================================================
// КОРПОРАТИВНЫЙ РЕЖИМ: ОБРАБОТКА ОШИБОК SSL СЕРТИФИКАТОВ
// =============================================================================

/**
 * Обработчик ошибок SSL сертификатов для корпоративных сетей
 * 
 * В корпоративных сетях часто используется SSL-инспекция (MITM),
 * где трафик перехватывается и сертификаты подменяются на корпоративные.
 * 
 * Этот обработчик позволяет доверять таким сертификатам для известных API.
 * 
 * ВНИМАНИЕ: Это снижает безопасность! Используется только когда
 * пользователь явно включил "Корпоративный режим" в настройках.
 */
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Список доверенных API хостов
  const trustedHosts = [
    'api.vsellm.ru',
    'api.openai.com',
    'openrouter.ai',
    'api.groq.com',
    'api.together.xyz',
  ];
  
  // Проверяем, является ли URL одним из доверенных API
  const parsedUrl = new URL(url);
  const isTrustedHost = trustedHosts.some(host => parsedUrl.hostname.includes(host));
  
  if (isTrustedHost) {
    console.log(`[Security] Принимаем SSL сертификат для ${parsedUrl.hostname} (корпоративный режим)`);
    console.log(`[Security] Издатель: ${certificate.issuerName}, Субъект: ${certificate.subjectName}`);
    
    // Предотвращаем стандартное поведение (отклонение сертификата)
    event.preventDefault();
    // Принимаем сертификат
    callback(true);
  } else {
    // Для других хостов используем стандартное поведение
    console.log(`[Security] Отклоняем SSL сертификат для неизвестного хоста: ${parsedUrl.hostname}`);
    callback(false);
  }
});

console.log('[Electron] Main process инициализирован');
