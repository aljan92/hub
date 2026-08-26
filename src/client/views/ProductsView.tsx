import React, { useState, useEffect } from 'react';
import { 
  Shirt, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Layers, 
  Globe, 
  Clock, 
  Palette, 
  Sparkles, 
  Info,
  DollarSign,
  Check,
  X,
  SlidersHorizontal,
  ChevronRight,
  ExternalLink
} from 'lucide-react';

interface MerchColorDef {
  id: string;
  displayName: string;
  hexPreview?: string;
}

interface MerchFitTypeDef {
  id: string;
  displayName: string;
}

interface MerchMarketplace {
  id: string;
  displayName: string;
  defaultPrice: string;
}

interface MerchProduct {
  id: string;
  displayName: string;
  colorMode: 'predefined' | 'customPicker';
  colors: MerchColorDef[];
  fitTypes: MerchFitTypeDef[];
  availableMarketplaces: string[];
  sortOrder: number;
  presetHexColors?: string[];
  lastUpdated: string;
}

interface ProductCatalogStats {
  totalProducts: number;
  totalSlots: number;
  totalMarketplaces: number;
  lastScanDate: string | null;
}

interface ProductScanLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface ProductScannerState {
  isScanning: boolean;
  scanProgress: string;
  scanError: string | null;
  lastScanDate: string | null;
  nextScheduledScan: string | null;
  logs: ProductScanLog[];
}

export const ProductsView: React.FC = () => {
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [marketplaces, setMarketplaces] = useState<MerchMarketplace[]>([]);
  const [stats, setStats] = useState<ProductCatalogStats>({
    totalProducts: 0,
    totalSlots: 0,
    totalMarketplaces: 0,
    lastScanDate: null
  });
  const [scannerState, setScannerState] = useState<ProductScannerState>({
    isScanning: false,
    scanProgress: 'Bereit',
    scanError: null,
    lastScanDate: null,
    nextScheduledScan: null,
    logs: []
  });

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'predefined' | 'customPicker'>('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  // Fetch catalog & scanner state
  const fetchCatalogData = async () => {
    try {
      const res = await fetch('/api/v1/products/catalog');
      const data = await res.json();
      if (data.success) {
        setProducts(data.catalog.products || []);
        setMarketplaces(data.catalog.marketplaces || []);
        if (data.stats) setStats(data.stats);
        if (data.scannerState) setScannerState(data.scannerState);

        // Auto-select first product only if no valid product is currently selected
        if (data.catalog.products && data.catalog.products.length > 0) {
          setSelectedProductId(prev => {
            if (prev && data.catalog.products.some((p: MerchProduct) => p.id === prev)) {
              return prev; // Keep user's active selection
            }
            return data.catalog.products[0].id;
          });
        }
      }
    } catch (err) {
      console.error('Error fetching product catalog:', err);
    }
  };

  useEffect(() => {
    fetchCatalogData();
    // Poll status frequently during active scan, otherwise every 8s
    const interval = setInterval(fetchCatalogData, scannerState.isScanning ? 2000 : 8000);
    return () => clearInterval(interval);
  }, [scannerState.isScanning]);

  const handleStartScan = async () => {
    setIsTriggering(true);
    try {
      const res = await fetch('/api/v1/products/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setScannerState(prev => ({
          ...prev,
          isScanning: true,
          scanProgress: 'Scan gestartet...'
        }));
      }
    } catch (err) {
      console.error('Scan trigger error:', err);
    } finally {
      setIsTriggering(false);
      fetchCatalogData();
    }
  };

  const handleClearAndRescan = async () => {
    setShowDeleteModal(false);
    setIsTriggering(true);
    try {
      const res = await fetch('/api/v1/products/catalog', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setProducts([]);
        setSelectedProductId(null);
        setScannerState(prev => ({
          ...prev,
          isScanning: true,
          scanProgress: 'Datenbank geleert. Neu-Scan gestartet...'
        }));
      }
    } catch (err) {
      console.error('Clear error:', err);
    } finally {
      setIsTriggering(false);
      fetchCatalogData();
    }
  };

  const handleCopyColor = (colorId: string) => {
    navigator.clipboard.writeText(colorId);
    setCopiedColor(colorId);
    setTimeout(() => setCopiedColor(null), 2000);
  };

  // Filter products
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          product.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterMode === 'all' || product.colorMode === filterMode;
    return matchesSearch && matchesFilter;
  });

  const selectedProduct = products.find(p => p.id === selectedProductId) || (products.length > 0 ? products[0] : null);

  const formatTimeAgo = (isoDate: string | null) => {
    if (!isoDate) return 'Noch nie gescannt';
    const date = new Date(isoDate);
    const diffMin = Math.round((Date.now() - date.getTime()) / (60 * 1000));
    if (diffMin < 1) return 'Gerade eben';
    if (diffMin < 60) return `Vor ${diffMin} Min.`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `Vor ${diffHours} Std.`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatScheduledTime = (isoDate: string | null) => {
    if (!isoDate) return 'Nicht geplant';
    const date = new Date(isoDate);
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner / Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-primary-500/10 border border-primary-500/20 text-primary-400">
              <Shirt className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                MBA Produktdatenbank
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                  Live CDP
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Automatisch gescannte Merch by Amazon Produkte, Farbvarianten, Color-Picker und Slot-Berechnungen
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={handleStartScan}
            disabled={scannerState.isScanning || isTriggering}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-semibold text-xs transition-all shadow-lg ${
              scannerState.isScanning
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-500/20 hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${scannerState.isScanning ? 'animate-spin text-amber-400' : ''}`} />
            <span>{scannerState.isScanning ? 'Scanne Produkte...' : 'Jetzt scannen'}</span>
          </button>

          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={scannerState.isScanning || isTriggering}
            className="flex items-center space-x-2 px-3.5 py-2.5 rounded-xl font-semibold text-xs bg-slate-800/80 hover:bg-red-950/40 text-slate-400 hover:text-red-400 border border-slate-700/60 hover:border-red-500/30 transition-all"
            title="Datenbank leeren & neuen Scan erzwingen"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Datenbank leeren</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Products */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Verfügbare Produkte</span>
            <Shirt className="w-4 h-4 text-primary-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-100 font-mono">{stats.totalProducts}</span>
            <span className="text-xs text-slate-400">Produkttypen</span>
          </div>
          <div className="text-[11px] text-emerald-400/90 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>100% dynamisch synchronisiert</span>
          </div>
        </div>

        {/* Total Slots Calculation */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Gesamt-Slots</span>
            <Layers className="w-4 h-4 text-accent-cyan" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-accent-cyan font-mono">{stats.totalSlots}</span>
            <span className="text-xs text-slate-400">Slots gesamt</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Jedes Produkt auf jedem MP = 1 Slot
          </div>
        </div>

        {/* Marketplaces */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Marktplätze</span>
            <Globe className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-100 font-mono">{stats.totalMarketplaces}</span>
            <span className="text-xs text-slate-400">Regionen</span>
          </div>
          <div className="text-[11px] text-indigo-300/90 mt-1 font-mono">
            US, GB, DE, FR, IT, ES, JP
          </div>
        </div>

        {/* Scan Status & Schedule */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Scan-Intervall</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-sm font-bold text-slate-100 font-mono">
              {formatTimeAgo(stats.lastScanDate)}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
            <span>Auto: 12-18h Jitter</span>
            {scannerState.nextScheduledScan && (
              <span className="text-amber-400 font-mono font-medium">
                ~{formatScheduledTime(scannerState.nextScheduledScan)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Active Scan Live Banner */}
      {scannerState.isScanning && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-600/15 to-amber-500/10 border border-amber-500/30 rounded-2xl p-4 shadow-lg backdrop-blur-md flex items-center justify-between animate-pulse">
          <div className="flex items-center space-x-3">
            <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
            <div>
              <div className="text-sm font-bold text-amber-200">Produkt-Scan läuft in Session 1</div>
              <div className="text-xs text-amber-300/80 font-mono">{scannerState.scanProgress}</div>
            </div>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Chrome Session 1
          </span>
        </div>
      )}

      {/* Empty Database State */}
      {products.length === 0 && !scannerState.isScanning && (
        <div className="bg-surface/60 border border-dashed border-slate-700/80 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-500/10 border border-primary-500/20 text-primary-400 flex items-center justify-center mx-auto">
            <Shirt className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Produktdatenbank ist aktuell leer</h3>
            <p className="text-xs text-slate-400 mt-1">
              Starte den Scan, damit Chrome Session 1 alle verfügbaren Produkte, Farben und Marktplätze direkt aus Merch by Amazon ausliest.
            </p>
          </div>
          <button
            onClick={handleStartScan}
            disabled={isTriggering}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/25 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Jetzt Live-Scan starten</span>
          </button>
        </div>
      )}

      {/* Main 2-Column Workspace */}
      {products.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Product List & Filters (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Search & Filter Bar */}
            <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-3 backdrop-blur-md space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Produkt suchen (z. B. Standard T-Shirt, Pullover)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900/90 border border-slate-700/60 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                />
              </div>

              {/* Filter Chips */}
              <div className="flex items-center space-x-1.5 text-xs">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    filterMode === 'all'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Alle ({products.length})
                </button>
                <button
                  onClick={() => setFilterMode('predefined')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    filterMode === 'predefined'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Swatches ({products.filter(p => p.colorMode === 'predefined').length})
                </button>
                <button
                  onClick={() => setFilterMode('customPicker')}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    filterMode === 'customPicker'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Color Picker ({products.filter(p => p.colorMode === 'customPicker').length})
                </button>
              </div>
            </div>

            {/* Product Cards List */}
            <div className="space-y-2.5 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {filteredProducts.map((product) => {
                const isSelected = selectedProduct?.id === product.id;
                const slotCount = product.availableMarketplaces.length;

                return (
                  <div
                    key={product.id}
                    onClick={() => setSelectedProductId(product.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden ${
                      isSelected
                        ? 'bg-primary-600/15 border-primary-500/50 shadow-md shadow-primary-500/10'
                        : 'bg-surface/80 border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className={`text-sm font-bold transition-colors ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                          {product.displayName}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {product.id}
                        </div>
                      </div>

                      {/* Slot Badge */}
                      <div className="flex flex-col items-end gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                          {slotCount} {slotCount === 1 ? 'Slot' : 'Slots'}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                          product.colorMode === 'predefined'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                            : 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                        }`}>
                          {product.colorMode === 'predefined' ? `${product.colors.length} Farben` : 'Color Picker'}
                        </span>
                      </div>
                    </div>

                    {/* Color Swatch Preview Dots */}
                    {product.colors.length > 0 && (
                      <div className="flex items-center space-x-1 mt-3 overflow-hidden">
                        {product.colors.slice(0, 14).map((c) => (
                          <span
                            key={c.id}
                            style={{ backgroundColor: c.hexPreview || '#4a5568' }}
                            className="w-3 h-3 rounded-full border border-slate-700/80 shrink-0 shadow-xs"
                            title={c.displayName}
                          />
                        ))}
                        {product.colors.length > 14 && (
                          <span className="text-[9px] font-mono text-slate-400 pl-1">
                            +{product.colors.length - 14}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-xs">
                  Keine Produkte für die aktuelle Suche gefunden.
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Selected Product Detail View (7 Cols) */}
          <div className="lg:col-span-7">
            {selectedProduct ? (
              <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-6 shadow-sm backdrop-blur-md space-y-6">
                {/* Product Detail Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h2 className="text-xl font-bold text-slate-100">{selectedProduct.displayName}</h2>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {selectedProduct.id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Letzte Aktualisierung: {new Date(selectedProduct.lastUpdated).toLocaleDateString('de-DE')} um {new Date(selectedProduct.lastUpdated).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-xl text-xs font-bold font-mono bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30">
                      {selectedProduct.availableMarketplaces.length} Marktplatz-Slots
                    </span>
                  </div>
                </div>

                {/* Marketplace Slots Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Verfügbare Marktplätze & Standard-Preise</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {marketplaces.map((mp) => {
                      const isAvailable = selectedProduct.availableMarketplaces.includes(mp.id);
                      return (
                        <div
                          key={mp.id}
                          className={`p-2.5 rounded-xl border transition-all ${
                            isAvailable
                              ? 'bg-indigo-950/20 border-indigo-500/30 text-indigo-200'
                              : 'bg-slate-900/40 border-slate-800/40 text-slate-600 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs">{mp.displayName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">
                              {mp.id}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] font-mono text-slate-400">
                            {isAvailable ? `Standard: ${mp.defaultPrice}` : 'Nicht aktiv'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Fit Types (if available) */}
                {selectedProduct.fitTypes.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                      <span>Verfügbare Fit-Types ({selectedProduct.fitTypes.length})</span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedProduct.fitTypes.map((fit) => (
                        <span
                          key={fit.id}
                          className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700/80 text-xs font-semibold text-slate-200 flex items-center space-x-1.5"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{fit.displayName}</span>
                          <span className="text-[9px] font-mono text-slate-400">({fit.id}-label)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Colors Section: Swatches or Color Picker */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-primary-400" />
                      <span>
                        {selectedProduct.colorMode === 'predefined'
                          ? `Farbvarianten (${selectedProduct.colors.length} Swatches)`
                          : 'Color Picker & Hex-Presets'}
                      </span>
                    </h3>
                    {copiedColor && (
                      <span className="text-[11px] font-semibold text-emerald-400 animate-fadeIn">
                        ✓ Farb-ID "{copiedColor}" kopiert!
                      </span>
                    )}
                  </div>

                  {selectedProduct.colorMode === 'predefined' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                      {selectedProduct.colors.map((color) => (
                        <div
                          key={color.id}
                          onClick={() => handleCopyColor(color.id)}
                          className="flex items-center space-x-2.5 p-2 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-primary-500/40 hover:bg-slate-800/50 cursor-pointer transition-all group"
                          title="Klicke um Farb-ID zu kopieren"
                        >
                          <span
                            style={{ backgroundColor: color.hexPreview || '#4a5568' }}
                            className="w-5 h-5 rounded-full border border-slate-700/80 shrink-0 shadow-sm"
                          />
                          <div className="overflow-hidden">
                            <div className="text-xs font-medium text-slate-200 truncate group-hover:text-white">
                              {color.displayName}
                            </div>
                            <div className="text-[9px] font-mono text-slate-400 truncate">
                              .{color.id}-checkbox
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Color Picker Mode (e.g. PopSockets, Cases, Pillows, Tote Bags) */
                    <div className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center space-x-3 text-xs text-purple-300 bg-purple-950/30 border border-purple-500/20 p-3 rounded-xl">
                        <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
                        <div>
                          Dieses Produkt unterstützt <strong>freie Hex-Farbwahlen</strong> via Color Picker. 
                          Beim Upload kann jeder beliebige Hintergrund-Farbcode (z. B. <code>#000000</code> oder <code>#FFFFFF</code>) übergeben werden.
                        </div>
                      </div>

                      {selectedProduct.presetHexColors && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-semibold text-slate-400">Standard Hex-Presets:</div>
                          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                            {selectedProduct.presetHexColors.map((hex) => (
                              <div
                                key={hex}
                                onClick={() => handleCopyColor(hex)}
                                className="flex flex-col items-center p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-purple-500/40 cursor-pointer transition-all group text-center"
                                title="Kopieren"
                              >
                                <span
                                  style={{ backgroundColor: hex }}
                                  className="w-6 h-6 rounded-full border border-slate-700 shadow-sm mb-1"
                                />
                                <span className="text-[9px] font-mono text-slate-400 group-hover:text-purple-300">
                                  {hex}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Audit & DOM Details */}
                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>DOM Selector: <code>#config-{selectedProduct.id}</code></span>
                  <span>Sort Order: #{selectedProduct.sortOrder}</span>
                </div>
              </div>
            ) : (
              <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-400 text-xs">
                Wähle ein Produkt auf der linken Seite aus, um Details anzuzeigen.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete / Clear Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center space-x-3 text-red-400">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Produktdatenbank leeren?</h3>
                <p className="text-xs text-slate-400">Vollständiger Reset & sofortiger Neu-Scan</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
              Möchtest du die gespeicherte Produktdatenbank wirklich leeren? 
              <br /><br />
              <strong>Wichtig:</strong> Es wird kein statischer Standard verwendet. Die Datenbank wird gelöscht und <strong>Session 1 startet sofort automatisch einen frischen Live-Scan</strong> auf Merch by Amazon.
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 border border-slate-700/60 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleClearAndRescan}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20 transition-all"
              >
                Datenbank leeren & neu scannen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsView;
