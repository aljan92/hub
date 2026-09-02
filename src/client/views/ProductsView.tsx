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
  ShieldCheck,
  Sliders,
  Scissors
} from 'lucide-react';

interface MerchColorDef {
  id: string;
  displayName: string;
  hexPreview?: string;
  avoidRule?: 'none' | 'white' | 'black';
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
  colorMode: 'predefined' | 'customPicker' | 'none' | 'failed';
  colors: MerchColorDef[];
  fitTypes: MerchFitTypeDef[];
  availableMarketplaces: string[];
  sortOrder: number;
  presetHexColors?: string[];
  lastUpdated: string;
  isDropAllowed?: boolean;
  dropPriorityOrder?: number;
  niceClass?: number;
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
  const [filterMode, setFilterMode] = useState<'all' | 'predefined' | 'customPicker' | 'droppable'>('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [maxDroppableCapacity, setMaxDroppableCapacity] = useState(0);
  const [queueTolerance, setQueueTolerance] = useState(10);
  const [isUpdatingDropConfig, setIsUpdatingDropConfig] = useState(false);

  const handleCycleColorAvoidRule = async (productId: string, colorId: string, currentRule?: 'none' | 'white' | 'black') => {
    const nextRule: 'none' | 'white' | 'black' = 
      (!currentRule || currentRule === 'none') ? 'white' :
      currentRule === 'white' ? 'black' : 'none';

    // Optimistically update local state immediately
    setProducts(prev => prev.map(prod => {
      if (prod.id !== productId) return prod;
      return {
        ...prod,
        colors: (prod.colors || []).map(col => {
          if (col.id !== colorId) return col;
          return { ...col, avoidRule: nextRule };
        })
      };
    }));

    try {
      await fetch('/api/v1/products/color-avoid-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, colorId, avoidRule: nextRule })
      });
    } catch (err) {
      console.error('Failed to update color avoid rule:', err);
      fetchCatalogData(); // Revert on failure
    }
  };

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

      // Fetch queue state for capacity comparisons
      const qRes = await fetch('/api/v1/queue');
      const qData = await qRes.json();
      if (qData.success) {
        setMaxDroppableCapacity(qData.maxDroppableCapacity || 0);
        if (qData.maxDropPerDesign !== undefined) setQueueTolerance(qData.maxDropPerDesign);
      }
    } catch (err) {
      console.error('Error fetching product catalog:', err);
    }
  };

  useEffect(() => {
    fetchCatalogData();
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

  const handleToggleDropAllowed = async (productId: string, currentVal: boolean, currentOrder: number) => {
    setIsUpdatingDropConfig(true);
    const updatedProducts = products.map(p => {
      if (p.id === productId) {
        return { ...p, isDropAllowed: !currentVal, dropPriorityOrder: currentOrder || 1 };
      }
      return p;
    });
    setProducts(updatedProducts);

    try {
      const configs = updatedProducts.map(p => ({
        id: p.id,
        isDropAllowed: p.isDropAllowed ?? false,
        dropPriorityOrder: p.dropPriorityOrder ?? 99
      }));

      const res = await fetch('/api/v1/products/drop-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs })
      });
      const data = await res.json();
      if (data.success) {
        if (data.maxDroppableCapacity !== undefined) setMaxDroppableCapacity(data.maxDroppableCapacity);
      }
    } catch (err) {
      console.error('Drop config update error:', err);
    } finally {
      setIsUpdatingDropConfig(false);
    }
  };

  const handleChangeDropPriority = async (productId: string, newOrder: number) => {
    const updatedProducts = products.map(p => {
      if (p.id === productId) {
        return { ...p, dropPriorityOrder: newOrder };
      }
      return p;
    });
    setProducts(updatedProducts);

    try {
      const configs = updatedProducts.map(p => ({
        id: p.id,
        isDropAllowed: p.isDropAllowed ?? false,
        dropPriorityOrder: p.dropPriorityOrder ?? 99
      }));

      await fetch('/api/v1/products/drop-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs })
      });
    } catch (err) {
      console.error('Priority update error:', err);
    }
  };

  const handleUpdateNiceClass = async (productId: string, newClass: number) => {
    const updatedProducts = products.map(p => {
      if (p.id === productId) {
        return { ...p, niceClass: newClass };
      }
      return p;
    });
    setProducts(updatedProducts);

    try {
      await fetch('/api/v1/products/nice-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, niceClass: newClass })
      });
    } catch (err) {
      console.error('Nice class update error:', err);
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
    const matchesFilter = filterMode === 'all' || 
                          (filterMode === 'droppable' ? product.isDropAllowed : product.colorMode === filterMode);
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
                Automatisch gescannte Merch by Amazon Produkte, Farbvarianten, Kürzungs-Kaskade und Slot-Berechnungen
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

        {/* Droppable Capacity Indicator */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Kürzungs-Kapazität</span>
            <Scissors className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-amber-400 font-mono">{maxDroppableCapacity}</span>
            <span className="text-xs text-slate-400">Slots abwählbar</span>
          </div>
          <div className="text-[11px] mt-1 flex items-center gap-1">
            {maxDroppableCapacity >= queueTolerance ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Reicht für Queue-Toleranz ({queueTolerance})
              </span>
            ) : (
              <span className="text-amber-400/90 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Nur {maxDroppableCapacity} freigegeben (Toleranz: {queueTolerance})
              </span>
            )}
          </div>
        </div>

        {/* US Protection & Scan Status */}
        <div className="bg-surface/80 border border-slate-800/80 rounded-2xl p-4 shadow-sm backdrop-blur-md relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">US-Marktplatz Schutz</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-sm font-bold text-emerald-400 font-mono">100% Geschützt</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
            <span>.com bleibt immer aktiv</span>
            {scannerState.nextScheduledScan && (
              <span className="text-amber-400 font-mono font-medium">
                Scan ~{formatScheduledTime(scannerState.nextScheduledScan)}
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
              <div className="flex items-center space-x-1.5 text-xs overflow-x-auto pb-1">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-all ${
                    filterMode === 'all'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Alle ({products.length})
                </button>
                <button
                  onClick={() => setFilterMode('droppable')}
                  className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-all ${
                    filterMode === 'droppable'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Abwählbar ({products.filter(p => p.isDropAllowed).length})
                </button>
                <button
                  onClick={() => setFilterMode('predefined')}
                  className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-all ${
                    filterMode === 'predefined'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  Swatches ({products.filter(p => p.colorMode === 'predefined').length})
                </button>
                <button
                  onClick={() => setFilterMode('customPicker')}
                  className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition-all ${
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
                const nonUsSlots = product.availableMarketplaces.filter(mp => mp.toUpperCase() !== 'US').length;

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
                        <div className="flex items-center space-x-2">
                          <div className={`text-sm font-bold transition-colors ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                            {product.displayName}
                          </div>
                          <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Kl. {product.niceClass || 25}
                          </span>
                          {product.isDropAllowed && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Prio #{product.dropPriorityOrder || 1}
                            </span>
                          )}
                          {product.colors.filter(c => c.avoidRule && c.avoidRule !== 'none').length > 0 && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                              {product.colors.filter(c => c.avoidRule && c.avoidRule !== 'none').length} Farbregeln
                            </span>
                          )}
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
                          product.isDropAllowed
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {product.isDropAllowed ? `Kürzbar (${nonUsSlots} Slots)` : 'Fix (Nicht kürzbar)'}
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
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Nizza-Klasse {selectedProduct.niceClass || 25}
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

                {/* Nice Trademark Class Configuration Box */}
                <div className="bg-slate-900/80 border border-indigo-500/30 rounded-2xl p-4 space-y-3 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                          <span>Nizza-Klasse (Trademark Schutz)</span>
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                            Klasse {selectedProduct.niceClass || 25}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Bestimmt, bei welchen Trademark-Klassenkonflikten dieses Produkt gezielt freigegeben oder gesperrt wird.
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <select
                        value={selectedProduct.niceClass || 25}
                        onChange={(e) => handleUpdateNiceClass(selectedProduct.id, Number(e.target.value))}
                        className="bg-slate-800 border border-indigo-500/40 rounded-xl px-3 py-1.5 text-xs text-indigo-200 font-bold focus:outline-none focus:border-indigo-400 shadow-inner cursor-pointer"
                      >
                        <option value={25}>Kl. 25 – Bekleidung &amp; Textilien (Shirts, Hoodies, Pullover, Tank Tops)</option>
                        <option value={18}>Kl. 18 – Taschen, Rucksäcke &amp; Lederwaren (Tote Bag, Sport-Rucksack)</option>
                        <option value={20}>Kl. 20 – Möbel, Kissen &amp; Wohnen (Throw Pillow)</option>
                        <option value={21}>Kl. 21 – Trinkbehälter &amp; Haushaltswaren (Tumbler, Tassen, Flaschen)</option>
                        <option value={9}>Kl. 9 – Elektronik &amp; Cases (iPhone &amp; Samsung Cases, PopSockets)</option>
                        <option value={16}>Kl. 16 – Papier- &amp; Schreibwaren (Hardcover Journal)</option>
                        <option value={14}>Kl. 14 – Schmuck &amp; Uhren</option>
                        <option value={24}>Kl. 24 – Decken &amp; Heimtextilien</option>
                        <option value={28}>Kl. 28 – Spiele &amp; Sportartikel</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Slot-Optimizer & Drop Candidate Configuration Box */}
                <div className="bg-slate-900/80 border border-amber-500/20 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                        <Scissors className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-100">Slot-Optimierung & Kürzungs-Freigabe</div>
                        <div className="text-[11px] text-slate-400">
                          Darf dieses Produkt bei Slot-Mangel automatisch reduziert werden?
                        </div>
                      </div>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedProduct.isDropAllowed ?? false}
                        onChange={() => handleToggleDropAllowed(
                          selectedProduct.id,
                          selectedProduct.isDropAllowed ?? false,
                          selectedProduct.dropPriorityOrder ?? 1
                        )}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                    </label>
                  </div>

                  {selectedProduct.isDropAllowed && (
                    <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-300 font-medium">Kürzungs-Priorität:</span>
                        <select
                          value={selectedProduct.dropPriorityOrder || 1}
                          onChange={(e) => handleChangeDropPriority(selectedProduct.id, Number(e.target.value))}
                          className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-amber-300 font-bold focus:outline-none focus:border-amber-500"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                            <option key={num} value={num}>Priorität #{num} {num === 1 ? '(Zuerst kürzen)' : ''}</option>
                          ))}
                        </select>
                      </div>

                      <div className="text-[11px] text-amber-400 font-mono flex items-center gap-1">
                        <span>Drop-Kette:</span>
                        <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          JP ➔ ES ➔ IT ➔ FR ➔ DE ➔ GB
                        </span>
                        <span className="text-emerald-400 font-bold ml-1">(US geschützt)</span>
                      </div>
                    </div>
                  )}
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
                      const isUs = mp.id.toUpperCase() === 'US';

                      return (
                        <div
                          key={mp.id}
                          className={`p-2.5 rounded-xl border transition-all ${
                            isAvailable
                              ? isUs
                                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                                : 'bg-indigo-950/20 border-indigo-500/30 text-indigo-200'
                              : 'bg-slate-900/40 border-slate-800/40 text-slate-600 opacity-60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs">{mp.displayName}</span>
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              isUs ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700' : 'bg-slate-900 border border-slate-700'
                            }`}>
                              {mp.id} {isUs ? '★' : ''}
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
                          : selectedProduct.colorMode === 'customPicker'
                          ? 'Color Picker & Hex-Presets'
                          : selectedProduct.colorMode === 'failed'
                          ? 'Farb-Discovery fehlgeschlagen'
                          : 'Keine Farbkonfiguration'}
                      </span>
                    </h3>
                    {copiedColor && (
                      <span className="text-[11px] font-semibold text-emerald-400 animate-fadeIn">
                        ✓ Farb-ID "{copiedColor}" kopiert!
                      </span>
                    )}
                  </div>

                  {selectedProduct.colorMode === 'predefined' ? (
                    <div className="space-y-2.5">
                      {/* Guide Banner */}
                      <div className="text-[11px] text-slate-400 bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <Sliders className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
                          <span>
                            <strong>3-State Farbregel:</strong> Klicke auf eine Farbe zum Durchschalten:
                            <span className="inline-flex items-center gap-1.5 ml-2 font-mono text-[10px]">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">Immer aktiv</span>
                              <span>➔</span>
                              <span className="px-1.5 py-0.5 rounded bg-white/20 text-white border border-white/40">⚪ Weiß meiden</span>
                              <span>➔</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">⚫ Schwarz meiden</span>
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
                        {selectedProduct.colors.map((color) => {
                          const rule = color.avoidRule || 'none';
                          const isAvoidWhite = rule === 'white';
                          const isAvoidBlack = rule === 'black';

                          return (
                            <div
                              key={color.id}
                              onClick={() => handleCycleColorAvoidRule(selectedProduct.id, color.id, color.avoidRule)}
                              className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all select-none group ${
                                isAvoidWhite
                                  ? 'bg-slate-800/90 border-white/40 shadow-sm shadow-white/10 ring-1 ring-white/20'
                                  : isAvoidBlack
                                    ? 'bg-amber-950/20 border-amber-500/40 shadow-sm shadow-amber-500/10 ring-1 ring-amber-500/20'
                                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                              }`}
                              title={`Klicke zum Ändern der Farbregel (Aktuell: ${isAvoidWhite ? 'Bei Weiß vermeiden' : isAvoidBlack ? 'Bei Schwarz vermeiden' : 'Immer aktiv'})`}
                            >
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <span
                                  style={{ backgroundColor: color.hexPreview || '#4a5568' }}
                                  className="w-5 h-5 rounded-full border border-slate-700/80 shrink-0 shadow-sm"
                                />
                                <div className="overflow-hidden">
                                  <div className="text-xs font-semibold text-slate-100 truncate">
                                    {color.displayName}
                                  </div>
                                  <div className="text-[9px] font-mono text-slate-400 truncate">
                                    .{color.id}-checkbox
                                  </div>
                                </div>
                              </div>

                              {/* 3-State Avoid Rule Badge */}
                              <div className="shrink-0 ml-1.5">
                                {isAvoidWhite ? (
                                  <span
                                    className="px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 bg-white/20 text-white border border-white/40 shadow-sm"
                                    title="⚪ Bei Weiß meiden (Wird bei hellem Artwork auf Amazon abgewählt)"
                                  >
                                    <span>⚪</span>
                                    <span>Meide Weiß</span>
                                  </span>
                                ) : isAvoidBlack ? (
                                  <span
                                    className="px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                                    title="⚫ Bei Schwarz meiden (Wird bei dunklem Artwork auf Amazon abgewählt)"
                                  >
                                    <span>⚫</span>
                                    <span>Meide Schwarz</span>
                                  </span>
                                ) : (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9px] text-slate-500 group-hover:text-slate-400"
                                    title="Immer aktiv (Klicken zum Durchschalten)"
                                  >
                                    Aktiv
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : selectedProduct.colorMode === 'customPicker' ? (
                    /* Color Picker Mode (e.g. PopSockets, Cases, Pillows, Tote Bags) */
                    <div className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center space-x-3 text-xs text-purple-300 bg-purple-950/30 border border-purple-500/20 p-3 rounded-xl">
                        <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
                        <div>
                          Dieses Produkt unterstützt <strong>freie Hex-Farbwahlen</strong> via Color Picker. 
                          Beim Upload kann jeder beliebige Hintergrund-Farbcode (z. B. <code>#000000</code> oder <code>#FFFFFF</code>) übergeben werden.
                        </div>
                      </div>

                      {selectedProduct.presetHexColors && selectedProduct.presetHexColors.length > 0 && (
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
                  ) : selectedProduct.colorMode === 'failed' ? (
                    <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-xl flex items-center space-x-3 text-xs text-rose-300">
                      <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                      <div>
                        <strong>Farb-Discovery unvollständig:</strong> Die Farbvarianten für dieses Produkt konnten beim letzten Scan nicht aus dem DOM gelesen werden. Der Upload für dieses Produkt ist gesperrt, bis ein erneuter Scan erfolgreich ist.
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center space-x-3 text-xs text-slate-400">
                      <Info className="w-4 h-4 text-slate-500 shrink-0" />
                      <div>
                        Keine Farbkonfiguration erforderlich (Direct-Artwork / Vollflächiger Druck).
                      </div>
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
