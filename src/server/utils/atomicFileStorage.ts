import fs from 'fs';
import path from 'path';

export interface AtomicWriteOptions {
  backup?: boolean;
  backupExt?: string;
  space?: number;
}

export interface LoadJsonRecoveryOptions<T> {
  backupExt?: string;
  validate?: (data: any) => boolean;
  defaultValue?: T;
}

export interface LoadJsonRecoveryResult<T> {
  success: boolean;
  data: T;
  recoveredFromBackup: boolean;
  corrupted: boolean;
  error?: string;
}

/**
 * Registry of file paths that have entered fail-safe (corrupted) mode.
 * Any write attempt to a registered path is strictly blocked to prevent destructive overwriting.
 */
const failSafeRegistry = new Set<string>();

export function isFileInFailSafe(filePath: string): boolean {
  return failSafeRegistry.has(path.resolve(filePath));
}

export function setFileFailSafe(filePath: string, inFailSafe: boolean): void {
  const resolved = path.resolve(filePath);
  if (inFailSafe) {
    failSafeRegistry.add(resolved);
  } else {
    failSafeRegistry.delete(resolved);
  }
}

/**
 * Cleans up any orphaned temporary files (.tmp.*) in a directory that may have been
 * left over from prior process crashes.
 */
export function cleanupOrphanedTmpFiles(dirPath: string): number {
  let cleanedCount = 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath);
    for (const file of entries) {
      if (file.includes('.tmp.') || file.endsWith('.tmp')) {
        const fullPath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(fullPath);
          // Only clean if it is a regular file
          if (stats.isFile()) {
            fs.unlinkSync(fullPath);
            cleanedCount++;
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn(`[AtomicStorage] Warning during tmp cleanup in ${dirPath}:`, err.message);
  }
  return cleanedCount;
}

/**
 * Atomically writes content to a target file.
 *
 * Algorithm:
 * 1. Checks if the file is in FAIL-SAFE mode (throws error / blocks write).
 * 2. Writes content to a unique .tmp file in the same directory.
 * 3. Calls fsyncSync to ensure bytes are committed to physical storage.
 * 4. If backup is requested and target file exists:
 *    - Copies current valid target file to a backup .tmp file.
 *    - Fsyncs and atomically renames backup .tmp to .bak.
 * 5. Atomically renames .tmp to target file.
 */
export function atomicWriteFile(
  filePath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {}
): void {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  const backupExt = options.backupExt || '.bak';
  const shouldBackup = options.backup !== false;

  // Fail-Safe check: Never allow write if storage is marked corrupted
  if (failSafeRegistry.has(resolvedPath)) {
    throw new Error(
      `[AtomicStorage] 🚨 REFUSED: File '${resolvedPath}' is in FAIL-SAFE (CORRUPTED) mode. Writes are blocked to prevent destructive data loss.`
    );
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = `${resolvedPath}.tmp.${nonce}`;

  try {
    // 1. Write to temporary file with strict fsync
    const fd = fs.openSync(tmpPath, 'w');
    try {
      if (typeof content === 'string') {
        fs.writeSync(fd, content, 0, 'utf-8');
      } else {
        fs.writeSync(fd, content);
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // 2. Rotate backup safely if existing file is present and non-empty
    if (shouldBackup && fs.existsSync(resolvedPath)) {
      try {
        const currentStats = fs.statSync(resolvedPath);
        if (currentStats.size > 0) {
          const bakPath = `${resolvedPath}${backupExt}`;
          const bakTmpPath = `${bakPath}.tmp.${nonce}`;

          // Copy current file to backup temp, fsync, then rename
          fs.copyFileSync(resolvedPath, bakTmpPath);
          const bakFd = fs.openSync(bakTmpPath, 'r');
          try {
            fs.fsyncSync(bakFd);
          } finally {
            fs.closeSync(bakFd);
          }
          fs.renameSync(bakTmpPath, bakPath);
        }
      } catch (backupErr: any) {
        console.warn(`[AtomicStorage] Warning: Failed to create backup for ${resolvedPath}:`, backupErr.message);
      }
    }

    // 3. Atomically replace target file
    fs.renameSync(tmpPath, resolvedPath);

    // 4. Directory fsync for maximum crash-durability on Linux/NAS filesystems (commits dentry)
    try {
      const dirFd = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {}
  } catch (err: any) {
    // Clean up temporary file on failure
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    throw err;
  }
}

/**
 * Atomically serializes and writes JSON data to a target file.
 * Defaults to compact JSON (no indentation) to minimize disk I/O, file size, and fsync latency.
 */
export function atomicWriteJson<T>(
  filePath: string,
  data: T,
  options: AtomicWriteOptions = {}
): void {
  const space = options.space !== undefined ? options.space : undefined;
  const jsonStr = space !== undefined ? JSON.stringify(data, null, space) : JSON.stringify(data);
  if (!jsonStr) {
    throw new Error(`[AtomicStorage] JSON serialization produced empty string for '${filePath}'`);
  }
  atomicWriteFile(filePath, jsonStr, options);
}

/**
 * Safely loads JSON data from disk with automatic corruption detection and backup recovery.
 *
 * Scenarios handled:
 * 1. File does not exist (and no backup) -> Returns defaultValue (Clean start).
 * 2. File exists and valid -> Returns parsed data.
 * 3. File exists but is corrupt / 0-bytes / syntax error:
 *    - Checks for .bak file.
 *    - If .bak is valid: restores main file atomically and returns backup data.
 *    - If .bak is also corrupt or missing: enters FAIL-SAFE mode, marks file as corrupted,
 *      and REFUSES to return a destructive empty array.
 */
export function loadJsonWithBackupRecovery<T>(
  filePath: string,
  options: LoadJsonRecoveryOptions<T> = {}
): LoadJsonRecoveryResult<T> {
  const resolvedPath = path.resolve(filePath);
  const backupExt = options.backupExt || '.bak';
  const bakPath = `${resolvedPath}${backupExt}`;
  const validate = options.validate || (() => true);

  // Scenario 1: Neither main nor backup exists
  if (!fs.existsSync(resolvedPath) && !fs.existsSync(bakPath)) {
    failSafeRegistry.delete(resolvedPath);
    return {
      success: true,
      data: options.defaultValue as T,
      recoveredFromBackup: false,
      corrupted: false
    };
  }

  // Attempt reading main file
  let mainValid = false;
  let mainData: any = null;
  let mainError: string | null = null;

  if (fs.existsSync(resolvedPath)) {
    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8').trim();
      if (content.length === 0) {
        throw new Error('File is 0 bytes (empty/truncated)');
      }
      const parsed = JSON.parse(content);
      if (!validate(parsed)) {
        throw new Error('Data validation check failed');
      }
      mainValid = true;
      mainData = parsed;
    } catch (err: any) {
      mainError = err.message || 'JSON parse error';
    }
  } else {
    mainError = 'Main file does not exist, but backup exists';
  }

  // Scenario 2: Main file is healthy
  if (mainValid) {
    failSafeRegistry.delete(resolvedPath);
    return {
      success: true,
      data: mainData as T,
      recoveredFromBackup: false,
      corrupted: false
    };
  }

  // Scenario 3: Main file is corrupt -> Attempt backup recovery
  console.warn(`[AtomicStorage] ⚠️ Corrupted or invalid JSON detected in '${resolvedPath}' (${mainError}). Checking backup '${bakPath}'...`);

  if (fs.existsSync(bakPath)) {
    try {
      const bakContent = fs.readFileSync(bakPath, 'utf-8').trim();
      if (bakContent.length === 0) {
        throw new Error('Backup file is 0 bytes (empty/truncated)');
      }
      const parsedBak = JSON.parse(bakContent);
      if (!validate(parsedBak)) {
        throw new Error('Backup data validation check failed');
      }

      console.warn(`[AtomicStorage] 🛡️ Valid backup found! Restoring '${resolvedPath}' from '${bakPath}'...`);
      // Restore main file without creating another backup of the corrupted file
      atomicWriteJson(resolvedPath, parsedBak, { backup: false, space: options.defaultValue ? 2 : 0 });

      failSafeRegistry.delete(resolvedPath);
      return {
        success: true,
        data: parsedBak as T,
        recoveredFromBackup: true,
        corrupted: false
      };
    } catch (bakErr: any) {
      console.error(`[AtomicStorage] ❌ Backup '${bakPath}' is ALSO corrupt or invalid:`, bakErr.message);
    }
  } else {
    console.error(`[AtomicStorage] ❌ No backup file exists at '${bakPath}'!`);
  }

  // Scenario 4: Both main and backup are corrupt -> ENTER FAIL-SAFE!
  console.error(
    `[AtomicStorage] 🚨 CRITICAL: Main file '${resolvedPath}' and backup could not be parsed!`
  );
  console.error(
    `[AtomicStorage] 🚨 TASK STORAGE WRITES HAVE BEEN DISABLED (FAIL-SAFE) TO PREVENT DESTRUCTIVE OVERWRITE.`
  );

  failSafeRegistry.add(resolvedPath);

  return {
    success: false,
    data: (null as unknown) as T,
    recoveredFromBackup: false,
    corrupted: true,
    error: `Both '${resolvedPath}' and backup are corrupt or unreadable (${mainError})`
  };
}
