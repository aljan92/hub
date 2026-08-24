import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { DashboardView } from './views/DashboardView';
import { DesignerView } from './views/DesignerView';
import { TasksView } from './views/TasksView';
import { QueueView } from './views/QueueView';
import { DatabaseView } from './views/DatabaseView';
import { LogsView } from './views/LogsView';
import { SettingsView } from './views/SettingsView';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isSyncing, setIsSyncing] = useState(false);
  const [tier, setTier] = useState<number | undefined>(undefined);
  const [taskCount, setTaskCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);

  const fetchStats = () => {
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTaskCount(data.tasksCount || 0);
          setQueueCount(data.queueCount || 0);
          if (data.tier) setTier(data.tier);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const handleSync = () => {
    setIsSyncing(true);
    fetch('/api/v1/sync/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'quick_products' })
    })
      .then(res => res.json())
      .finally(() => {
        setIsSyncing(false);
        fetchStats();
        alert('MBA Quick Sync erfolgreich gestartet! Prüfe den Status im Tab "Database".');
      });
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      {/* Top Header */}
      <Header 
        onSync={handleSync}
        isSyncing={isSyncing}
        tier={tier}
      />

      {/* Main Workspace Layout (Sidebar + Content View) */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar 
          activeTab={activeTab} 
          onSelectTab={setActiveTab}
          taskCount={taskCount}
          queueCount={queueCount}
        />

        {/* Scrollable View Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-gradient-to-b from-background via-surface/40 to-background">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <DashboardView onNavigateTab={setActiveTab} />}
            {activeTab === 'designer' && <DesignerView />}
            {activeTab === 'tasks' && <TasksView />}
            {activeTab === 'queue' && <QueueView />}
            {activeTab === 'database' && <DatabaseView />}
            {activeTab === 'logs' && <LogsView />}
            {activeTab === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
