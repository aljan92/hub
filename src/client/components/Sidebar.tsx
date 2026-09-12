import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Sparkles, 
  CheckSquare, 
  UploadCloud, 
  Database, 
  Terminal,
  Settings as SettingsIcon,
  Bot,
  Sliders,
  Shirt,
  ShieldCheck,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

export type ActiveTab = 'dashboard' | 'designer' | 'tasks' | 'queue' | 'promptlog' | 'products' | 'database' | 'systemprompts' | 'trademark' | 'settings' | 'logs';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  taskCount: number;
  queueCount: number;
}

const SIDEBAR_COLLAPSED_KEY = 'mba_sidebar_collapsed_v1';

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  onSelectTab, 
  taskCount, 
  queueCount 
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Status & Topologie',
    },
    {
      id: 'designer' as ActiveTab,
      label: 'Designer',
      icon: Sparkles,
      description: 'Prompt Generator & KI',
    },
    {
      id: 'tasks' as ActiveTab,
      label: 'Tasks',
      icon: CheckSquare,
      badge: taskCount > 0 ? taskCount : undefined,
      badgeColor: 'bg-primary-500 text-white',
      description: 'Human-in-the-Loop',
    },
    {
      id: 'queue' as ActiveTab,
      label: 'Queue',
      icon: UploadCloud,
      badge: queueCount > 0 ? queueCount : undefined,
      badgeColor: 'bg-accent-cyan text-slate-900',
      description: 'Upload & Slot-Filling',
    },
    {
      id: 'promptlog' as ActiveTab,
      label: 'Prompt Log',
      icon: Terminal,
      description: 'Hermes & Ingestion',
    },
    {
      id: 'products' as ActiveTab,
      label: 'Products',
      icon: Shirt,
      description: 'Produktdatenbank & Slots',
    },
    {
      id: 'database' as ActiveTab,
      label: 'Database',
      icon: Database,
      description: 'MBA ⇄ Supabase Sync',
    },
    {
      id: 'systemprompts' as ActiveTab,
      label: 'Systemprompts',
      icon: Sliders,
      description: 'Art Director & Vorlagen',
    },
    {
      id: 'trademark' as ActiveTab,
      label: 'Trademark',
      icon: ShieldCheck,
      description: 'Whitelist & Ausnahmen',
    },
    {
      id: 'settings' as ActiveTab,
      label: 'Settings',
      icon: SettingsIcon,
      description: 'APIs & Produktregeln',
    },
    {
      id: 'logs' as ActiveTab,
      label: 'Logs',
      icon: Bot,
      description: 'Live-Protokoll & Events',
    },
  ];

  return (
    <aside 
      className={`border-r border-slate-800/80 bg-surface/80 backdrop-blur-md flex flex-col shrink-0 h-full select-none transition-all duration-200 overflow-hidden ${
        isCollapsed ? 'w-[68px] p-2' : 'w-60 p-3'
      }`}
    >
      <div className="flex-1 space-y-1 overflow-hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center rounded-xl text-left transition-all duration-150 group relative ${
                isCollapsed 
                  ? 'justify-center p-2.5' 
                  : 'justify-between px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-primary-600/15 text-white font-semibold border border-primary-500/30 shadow-sm shadow-primary-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'}`}>
                <div className={`p-2 rounded-lg transition-colors relative ${
                  isActive 
                    ? 'bg-primary-500 text-white shadow-md shadow-primary-500/30' 
                    : 'bg-slate-800 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-700'
                }`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {isCollapsed && item.badge !== undefined && (
                    <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${item.badgeColor}`} />
                  )}
                </div>
                {!isCollapsed && (
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate leading-tight">{item.label}</div>
                    <div className="text-[10px] text-slate-400 font-normal truncate leading-tight mt-0.5">{item.description}</div>
                  </div>
                )}
              </div>

              {!isCollapsed && item.badge !== undefined && (
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full shrink-0 ${item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse / Expand Button at Bottom */}
      <div className="pt-2 border-t border-slate-800/80 mt-auto">
        <button
          type="button"
          onClick={toggleCollapse}
          title={isCollapsed ? 'Sidebar ausklappen' : 'Sidebar minimieren'}
          className="w-full flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors py-2 text-xs font-medium"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};
