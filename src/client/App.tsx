import React, { useState } from 'react';
import { Header } from './components/Header';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { DashboardView } from './views/DashboardView';
import { DesignerView } from './views/DesignerView';
import { TasksView } from './views/TasksView';
import { QueueView } from './views/QueueView';
import { SettingsView } from './views/SettingsView';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeSlots, setActiveSlots] = useState({ used: 0, total: 100 });

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      alert('MBA Database Sync erfolgreich ausgeführt! 1.240 Designs und aktuelle Verkaufsdaten aktualisiert.');
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      {/* Top Header */}
      <Header 
        onSync={handleSync}
        isSyncing={isSyncing}
        activeSlots={activeSlots}
      />

      {/* Main Workspace Layout (Sidebar + Content View) */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar 
          activeTab={activeTab} 
          onSelectTab={setActiveTab}
          taskCount={1}
          queueCount={2}
        />

        {/* Scrollable View Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-gradient-to-b from-background via-surface/40 to-background">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <DashboardView onNavigateTab={setActiveTab} />}
            {activeTab === 'designer' && <DesignerView />}
            {activeTab === 'tasks' && <TasksView />}
            {activeTab === 'queue' && <QueueView />}
            {activeTab === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
