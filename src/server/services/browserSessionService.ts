import { chromium, BrowserContext, Page, CDPSession } from 'playwright';
import path from 'path';
import fs from 'fs';

export type BrowserSessionType = 'sync' | 'upload';

interface ActiveSession {
  type: BrowserSessionType;
  page: Page;
  cdp: CDPSession;
  currentUrl: string;
  title: string;
  isStreaming: boolean;
}

function findChromiumExecutable(): string | undefined {
  // 1. Direct environment variable
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  // 2. Search common Playwright directories (/ms-playwright, ~/.cache/ms-playwright, etc.)
  const candidateDirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright',
    path.join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
    path.join(process.env.HOME || '/root', 'Library', 'Caches', 'ms-playwright')
  ];

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files: string[] = [];
        const scan = (d: string, depth = 0) => {
          if (depth > 4) return;
          const items = fs.readdirSync(d, { withFileTypes: true });
          for (const item of items) {
            const p = path.join(d, item.name);
            if (item.isDirectory()) scan(p, depth + 1);
            else files.push(p);
          }
        };
        scan(dir);

        // Priority 1: chrome-headless-shell
        const headlessShell = files.find(f => f.endsWith('/chrome-headless-shell') || f.endsWith('\\chrome-headless-shell.exe'));
        if (headlessShell) return headlessShell;

        // Priority 2: chrome / google-chrome
        const chrome = files.find(f => f.endsWith('/chrome') || f.endsWith('Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing') || f.endsWith('\\chrome.exe'));
        if (chrome) return chrome;
      } catch {}
    }
  }

  // 3. System installed Chromium / Google Chrome
  const systemCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const sc of systemCandidates) {
    if (fs.existsSync(sc)) return sc;
  }

  return undefined;
}

export class BrowserSessionService {
  private static context: BrowserContext | null = null;
  private static sessions: Map<BrowserSessionType, ActiveSession> = new Map();
  private static frameBroadcasters: ((session: BrowserSessionType, base64Data: string, metadata: any) => void)[] = [];
  private static isInitializing = false;

  private static getProfileDir(): string {
    const dir = path.resolve(process.cwd(), 'data', 'chrome-profile');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Register a frame listener (used by WebSocket server to stream frames to clients)
   */
  static onFrame(callback: (session: BrowserSessionType, base64Data: string, metadata: any) => void) {
    this.frameBroadcasters.push(callback);
  }

  /**
   * Ensure browser context is launched with macOS stealth settings
   */
  private static async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.context) return this.context;
    }

    this.isInitializing = true;
    try {
      const profileDir = this.getProfileDir();
      const macUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      const executablePath = findChromiumExecutable();

      console.log('[BrowserSession] Launching persistent Chromium with Mac Stealth profile:', profileDir);
      console.log('[BrowserSession] Using executable path:', executablePath || 'Default Playwright auto-resolution');

      const launchOptions: any = {
        headless: true,
        viewport: { width: 1440, height: 900 },
        userAgent: macUserAgent,
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-infobars',
          '--window-size=1440,900',
          '--start-maximized',
          '--disable-gpu',
          '--disable-setuid-sandbox'
        ]
      };

      if (executablePath) {
        launchOptions.executablePath = executablePath;
      }

      this.context = await chromium.launchPersistentContext(profileDir, launchOptions);

      // Inject Mac Stealth script to evade Amazon / AWS bot detection
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        Object.defineProperty(navigator, 'platform', {
          get: () => 'MacIntel',
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['de-DE', 'de', 'en-US', 'en'],
        });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock WebGL Vendor for macOS
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return 'Apple';
          if (parameter === 37446) return 'Apple M2 Pro Metal Engine';
          return getParameter.apply(this, [parameter]);
        };
      });

      this.context.on('close', () => {
        console.log('[BrowserSession] Browser context closed');
        this.context = null;
        this.sessions.clear();
      });

      return this.context;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Get or launch a specific session (sync or upload)
   */
  static async getSession(type: BrowserSessionType): Promise<ActiveSession> {
    let session = this.sessions.get(type);
    if (session && !session.page.isClosed()) {
      return session;
    }

    const context = await this.ensureContext();
    const page = await context.newPage();

    // Default target for Merch on Demand
    const defaultUrl = 'https://merch.amazon.com/dashboard';
    
    // Set custom viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    const cdp = await page.context().newCDPSession(page);

    session = {
      type,
      page,
      cdp,
      currentUrl: defaultUrl,
      title: 'Amazon Merch on Demand',
      isStreaming: false
    };

    this.sessions.set(type, session);

    // Track navigation events
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && session) {
        session.currentUrl = page.url();
        page.title().then(t => { if (session) session.title = t; }).catch(() => {});
      }
    });

    page.on('close', () => {
      this.sessions.delete(type);
    });

    // Start screencast stream on this page
    await this.startScreencast(type);

    // Navigate to default URL
    page.goto(defaultUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
      console.warn(`[BrowserSession] Initial navigation warning for ${type}:`, err.message);
    });

    return session;
  }

  /**
   * Start CDP screencast on a session
   */
  static async startScreencast(type: BrowserSessionType) {
    const session = this.sessions.get(type);
    if (!session || session.page.isClosed()) return;

    try {
      await session.cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1440,
        maxHeight: 900,
        everyNthFrame: 1
      });

      session.isStreaming = true;

      session.cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
        try {
          await session.cdp.send('Page.screencastFrameAck', { sessionId });
        } catch {}

        for (const broadcaster of this.frameBroadcasters) {
          broadcaster(type, data, metadata);
        }
      });

      console.log(`[BrowserSession] Screencast active for session: ${type}`);
    } catch (err: any) {
      console.error(`[BrowserSession] Failed to start screencast for ${type}:`, err.message);
    }
  }

  /**
   * Forward mouse events (clicks, movement, wheel scroll) to CDP
   */
  static async dispatchMouseEvent(type: BrowserSessionType, event: any) {
    const session = this.sessions.get(type);
    if (!session || session.page.isClosed()) return;

    try {
      await session.cdp.send('Input.dispatchMouseEvent', {
        type: event.type, // 'mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'
        x: Math.round(event.x),
        y: Math.round(event.y),
        button: event.button || 'left',
        clickCount: event.clickCount || 1,
        deltaX: event.deltaX || 0,
        deltaY: event.deltaY || 0,
        modifiers: event.modifiers || 0
      });
    } catch (err: any) {
      // Ignore transient input errors during page transition
    }
  }

  /**
   * Forward keyboard events to CDP
   */
  static async dispatchKeyEvent(type: BrowserSessionType, event: any) {
    const session = this.sessions.get(type);
    if (!session || session.page.isClosed()) return;

    try {
      await session.cdp.send('Input.dispatchKeyEvent', {
        type: event.type, // 'keyDown', 'keyUp', 'rawKeyDown', 'char'
        key: event.key,
        code: event.code,
        text: event.text,
        unmodifiedText: event.unmodifiedText || event.text,
        windowsVirtualKeyCode: event.keyCode,
        nativeVirtualKeyCode: event.keyCode,
        modifiers: event.modifiers || 0
      });
    } catch (err: any) {
      // Ignore transient key errors
    }
  }

  /**
   * Navigate active session to URL
   */
  static async navigate(type: BrowserSessionType, url: string): Promise<{ success: boolean; url: string }> {
    const session = await this.getSession(type);
    try {
      let targetUrl = url;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
      }
      await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true, url: session.page.url() };
    } catch (err: any) {
      return { success: false, url: session.page.url() };
    }
  }

  /**
   * Reload active session
   */
  static async reload(type: BrowserSessionType) {
    const session = this.sessions.get(type);
    if (session && !session.page.isClosed()) {
      await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  }

  /**
   * Go back in history
   */
  static async goBack(type: BrowserSessionType) {
    const session = this.sessions.get(type);
    if (session && !session.page.isClosed()) {
      await session.page.goBack().catch(() => {});
    }
  }

  /**
   * Go forward in history
   */
  static async goForward(type: BrowserSessionType) {
    const session = this.sessions.get(type);
    if (session && !session.page.isClosed()) {
      await session.page.goForward().catch(() => {});
    }
  }

  /**
   * Restart / Refresh session page
   */
  static async restartSession(type: BrowserSessionType): Promise<{ success: boolean; message: string }> {
    try {
      const existing = this.sessions.get(type);
      if (existing && !existing.page.isClosed()) {
        await existing.page.close().catch(() => {});
      }
      this.sessions.delete(type);

      // Launch fresh page with shared cookies/profile
      await this.getSession(type);

      return { 
        success: true, 
        message: `Chrome ${type === 'sync' ? 'Session 1 (Sync & Login)' : 'Session 2 (Upload Worker)'} erfolgreich neu gestartet!` 
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Get overall browser & session status
   */
  static getStatus() {
    const syncSession = this.sessions.get('sync');
    const uploadSession = this.sessions.get('upload');

    return {
      isContextActive: !!this.context,
      sync: {
        active: !!syncSession && !syncSession.page.isClosed(),
        url: syncSession?.page.url() || 'https://merch.amazon.com/dashboard',
        title: syncSession?.title || 'Amazon Merch on Demand',
        isStreaming: syncSession?.isStreaming || false
      },
      upload: {
        active: !!uploadSession && !uploadSession.page.isClosed(),
        url: uploadSession?.page.url() || 'https://merch.amazon.com/dashboard',
        title: uploadSession?.title || 'Amazon Merch on Demand',
        isStreaming: uploadSession?.isStreaming || false
      }
    };
  }
}
