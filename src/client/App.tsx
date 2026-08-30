import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { DashboardView } from './views/DashboardView';
import { DesignerView } from './views/DesignerView';
import { TasksView } from './views/TasksView';
import { QueueView } from './views/QueueView';
import { DatabaseView } from './views/DatabaseView';
import { ProductsView } from './views/ProductsView';
import { LogsView } from './views/LogsView';
import { SettingsView } from './views/SettingsView';
import { PromptLogView } from './views/PromptLogView';
import { SystemPromptsView } from './views/SystemPromptsView';

import { ErrorBoundary } from './components/ErrorBoundary';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
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
          if (data.tier !== undefined) setTier(data.tier);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen bg-background text-slate-100 flex flex-col overflow-hidden">
      {/* Top Header */}
      <Header 
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
            <ErrorBoundary fallbackTitle="Fehler beim Laden dieser Ansicht">
              {activeTab === 'dashboard' && <DashboardView onNavigateTab={setActiveTab} />}
              {activeTab === 'promptlog' && <PromptLogView />}
              {activeTab === 'systemprompts' && <SystemPromptsView />}
              {activeTab === 'designer' && <DesignerView />}
              {activeTab === 'tasks' && <TasksView />}
              {activeTab === 'queue' && <QueueView />}
              {activeTab === 'products' && <ProductsView />}
              {activeTab === 'database' && <DatabaseView />}
              {activeTab === 'logs' && <LogsView />}
              {activeTab === 'settings' && <SettingsView />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
