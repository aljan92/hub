import React from 'react';
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
  ShieldCheck
} from 'lucide-react';

export type ActiveTab = 'dashboard' | 'promptlog' | 'systemprompts' | 'designer' | 'tasks' | 'trademark' | 'queue' | 'products' | 'database' | 'logs' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  taskCount: number;
  queueCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  onSelectTab, 
  taskCount, 
  queueCount 
}) => {
  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Status & Topologie',
    },
    {
      id: 'promptlog' as ActiveTab,
      label: 'Prompt Log',
      icon: Terminal,
      description: 'Hermes & Ingestion',
    },
    {
      id: 'systemprompts' as ActiveTab,
      label: 'Systemprompts',
      icon: Sliders,
      description: 'Art Director & Vorlagen',
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
      id: 'trademark' as ActiveTab,
      label: 'Trademark',
      icon: ShieldCheck,
      description: 'Whitelist & Ausnahmen',
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
      id: 'logs' as ActiveTab,
      label: 'Logs',
      icon: Bot,
      description: 'Live-Protokoll & Events',
    },
    {
      id: 'settings' as ActiveTab,
      label: 'Settings',
      icon: SettingsIcon,
      description: 'APIs & Produktregeln',
    },
  ];

  return (
    <aside className="w-64 border-r border-slate-800/80 bg-surface/80 backdrop-blur-md flex flex-col p-4 shrink-0 overflow-y-auto h-full sticky top-16 select-none">
      <div className="space-y-1">
        <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition-all duration-200 group ${
                isActive
                  ? 'bg-primary-600/15 text-white font-semibold border border-primary-500/30 shadow-sm shadow-primary-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-primary-500 text-white shadow-md shadow-primary-500/30' 
                    : 'bg-slate-800 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-700'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm">{item.label}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{item.description}</div>
                </div>
              </div>

              {item.badge !== undefined && (
                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${item.badgeColor}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
};
