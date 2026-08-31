import fs from 'fs';
import path from 'path';

export interface TrademarkWhitelistData {
  GLOBAL: string[];
  USPTO: string[];
  EUIPO: string[];
  DPMA: string[];
  [key: string]: string[];
}

export class TrademarkWhitelistService {
  private static filePath = path.join(process.cwd(), 'data', 'trademark_whitelist.json');

  private static defaultWhitelist: TrademarkWhitelistData = {
    GLOBAL: ['apparel', 'collection', 'vintage', 'retro', 'classic', 'style', 'clothing', 'wear', 'design', 'graphic'],
    USPTO: ['girl', 'girls', 'boy', 'boys', 'mama', 'papa', 'queen', 'king', 'teacher', 'mom', 'dad', 'nurse', 'grandma', 'grandpa'],
    EUIPO: ['girl', 'girls', 'boy', 'boys', 'mama', 'papa', 'queen', 'king', 'teacher'],
    DPMA: ['mädchen', 'junge', 'mama', 'papa', 'königin', 'könig', 'lehrer', 'oma', 'opa']
  };

  /**
   * Loads the current whitelist configuration from disk
   */
  static getWhitelist(): TrademarkWhitelistData {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.saveWhitelist(this.defaultWhitelist);
        return this.defaultWhitelist;
      }
      const data = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        GLOBAL: Array.isArray(parsed.GLOBAL) ? parsed.GLOBAL : this.defaultWhitelist.GLOBAL,
        USPTO: Array.isArray(parsed.USPTO) ? parsed.USPTO : this.defaultWhitelist.USPTO,
        EUIPO: Array.isArray(parsed.EUIPO) ? parsed.EUIPO : this.defaultWhitelist.EUIPO,
        DPMA: Array.isArray(parsed.DPMA) ? parsed.DPMA : this.defaultWhitelist.DPMA
      };
    } catch (err) {
      console.error('[TrademarkWhitelistService] Error reading whitelist:', err);
      return this.defaultWhitelist;
    }
  }

  /**
   * Persists whitelist configuration to disk
   */
  static saveWhitelist(data: TrademarkWhitelistData): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[TrademarkWhitelistService] Error saving whitelist:', err);
    }
  }

  /**
   * Checks whether a given word or phrase is on the whitelist for a specific marketplace/office
   */
  static isWhitelisted(term: string, office: string = 'GLOBAL'): boolean {
    if (!term || typeof term !== 'string') return false;
    const cleanTerm = term.trim().toLowerCase();
    if (!cleanTerm) return false;

    const wl = this.getWhitelist();
    const globalList = (wl.GLOBAL || []).map(w => w.toLowerCase().trim());
    if (globalList.includes(cleanTerm)) return true;

    const normalizedOffice = office.toUpperCase();
    const officeList = (wl[normalizedOffice] || []).map(w => w.toLowerCase().trim());
    return officeList.includes(cleanTerm);
  }

  /**
   * Adds a term to a marketplace whitelist
   */
  static addTerm(office: string, term: string): TrademarkWhitelistData {
    const normOffice = office.toUpperCase();
    const cleanTerm = term.trim().toLowerCase();
    if (!cleanTerm) return this.getWhitelist();

    const current = this.getWhitelist();
    if (!current[normOffice]) {
      current[normOffice] = [];
    }

    if (!current[normOffice].map(w => w.toLowerCase()).includes(cleanTerm)) {
      current[normOffice].push(cleanTerm);
      this.saveWhitelist(current);
    }
    return current;
  }

  /**
   * Removes a term from a marketplace whitelist
   */
  static removeTerm(office: string, term: string): TrademarkWhitelistData {
    const normOffice = office.toUpperCase();
    const cleanTerm = term.trim().toLowerCase();
    const current = this.getWhitelist();

    if (current[normOffice]) {
      current[normOffice] = current[normOffice].filter(w => w.toLowerCase() !== cleanTerm);
      this.saveWhitelist(current);
    }
    return current;
  }

  /**
   * Batch adds multiple terms
   */
  static addTermsBatch(office: string, terms: string[]): TrademarkWhitelistData {
    const normOffice = office.toUpperCase();
    const current = this.getWhitelist();
    if (!current[normOffice]) current[normOffice] = [];

    let changed = false;
    for (const term of terms) {
      const cleanTerm = term.trim().toLowerCase();
      if (cleanTerm && !current[normOffice].map(w => w.toLowerCase()).includes(cleanTerm)) {
        current[normOffice].push(cleanTerm);
        changed = true;
      }
    }

    if (changed) {
      this.saveWhitelist(current);
    }
    return current;
  }
}
