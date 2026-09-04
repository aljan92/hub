import { chromium, Page } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findChromiumExecutable } from './browserSessionService';

const execute = promisify(execFile);

/** Sample aggregate RSS of this job's Chromium process tree, not unrelated upload
 * sessions. Shared pages can be counted more than once; this is not physical RAM. */
async function processTreeRss(root: number): Promise<number> {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss='], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
  const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const included = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows) if (included.has(parent) && !included.has(pid)) { included.add(pid); changed = true; }
  }
  return rows.reduce((total, [pid, , rss]) => total + (included.has(pid) ? rss : 0), 0) / 1024;
}

/** One isolated Chromium process per job; shared gate includes master and variants.
 * Closing the process releases native allocations even after a failed render. */
export class ArtworkRenderSession {
  private static tail: Promise<void> = Promise.resolve();
  static async run<T>(work: (page: Page) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let server: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sampler: ReturnType<typeof setInterval> | undefined;
    let sampleInFlight: Promise<void> | undefined;
    let peakProcessTreeRssMiB: number | null = null;
    const started = Date.now();
    try {
      server = await chromium.launchServer({ executablePath: findChromiumExecutable() || undefined, headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
      browser = await chromium.connect(server.wsEndpoint());
      const pid = server.process().pid;
      const sample = () => {
        if (!pid || sampleInFlight) return;
        sampleInFlight = processTreeRss(pid).then(rss => { peakProcessTreeRssMiB = Math.max(peakProcessTreeRssMiB || 0, rss); })
          .catch(() => {}).finally(() => { sampleInFlight = undefined; });
      };
      sample(); sampler = setInterval(sample, 1000);
      const context = await browser.newContext({ viewport: { width: 4500, height: 5400 }, deviceScaleFactor: 1 });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      await page.setContent('<html><head><style>*{margin:0;padding:0}body{background:transparent}img{display:block}</style><script>window.__name=t=>t;</script></head><body><img id="output"></body></html>');
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
        reject(new Error('Artwork-Renderzeit überschritten (10 Minuten)'));
        void browser?.close();
      }, 600000); });
      return await Promise.race([work(page), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      if (sampler) clearInterval(sampler);
      await sampleInFlight;
      try { await browser?.close(); } finally {
        try { await server?.close(); } finally {
          console.log('[ArtworkRenderer] Job-Ressourcen', JSON.stringify({ ms: Date.now() - started, peakProcessTreeRssMiB, sampleIntervalMs: 1000 }));
          release();
        }
      }
    }
  }
}
