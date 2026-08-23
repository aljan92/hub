import React, { useState, useEffect } from 'react';
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
  const [taskCount, setTaskCount] = useState(0);
  const [queueCount, setQueueCount] = useState(0);

  const fetchStats = () => {
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTaskCount(data.tasksCount || 0);
          setQueueCount(data.queueCount || 0);
          if (data.slots) setActiveSlots(data.slots);
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
    fetch('/api/v1/stats')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTaskCount(data.tasksCount || 0);
          setQueueCount(data.queueCount || 0);
        }
      })
      .finally(() => {
        setIsSyncing(false);
        alert('MBA Database Sync erfolgreich ausgeführt!');
      });
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
            {activeTab === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
