import React, { useState, useEffect } from 'react';
import { 
  CheckSquare, 
  Sparkles, 
  Bot, 
  User, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  Layers, 
  Eye, 
  Edit3,
  Sliders,
  Scissors,
  RefreshCw
} from 'lucide-react';

export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [autoLoopEnabled, setAutoLoopEnabled] = useState(false);

  const fetchTasks = () => {
    setLoading(true);
    fetch('/api/v1/tasks')
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.tasks)) {
          setTasks(data.tasks);
          if (data.tasks.length > 0 && !selectedTaskId) {
            setSelectedTaskId(data.tasks[0].id);
          }
        }
      })
      .catch(err => console.warn('[Tasks] Fetch error:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const activeTask = tasks.find(t => t.id === selectedTaskId) || tasks[0];

  const handleApprove = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}/approve`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        alert('🎉 Task freigegeben! Das Design wurde in die Upload-Queue verschoben.');
        setTasks(prev => prev.filter(t => t.id !== taskId));
        if (tasks.length > 1) {
          const next = tasks.find(t => t.id !== taskId);
          if (next) setSelectedTaskId(next.id);
        }
      }
    } catch (err) {
      alert('Fehler beim Freigeben des Tasks.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center">
            <CheckSquare className="w-6 h-6 mr-2 text-primary-400" />
            Tasks &amp; Human-in-the-Loop
          </h2>
          <p className="text-sm text-slate-400">Verifiziere generierte Designs, beantworte Produktfragen oder lasse die KI autonom agieren.</p>
        </div>

        {/* AI Autonomy Toggle */}
        <div className="flex items-center space-x-3 bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2">
          <Bot className="w-4 h-4 text-primary-400" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-200">100% KI-Autonomie</span>
            <span className="text-[10px] text-slate-400">Human Loop überspringen</span>
          </div>
          <button
            onClick={() => setAutoLoopEnabled(!autoLoopEnabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ml-2 ${
              autoLoopEnabled ? 'bg-primary-500' : 'bg-slate-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform transform absolute top-1 ${
              autoLoopEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
          <h3 className="text-lg font-bold text-slate-200">Keine offenen Tasks</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Alle Aufgaben wurden geprüft oder von Hermes abgearbeitet. Neue Designs aus dem Designer oder von Hermes erscheinen automatisch hier.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Task List / Thumbnail (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
              <span>Wartende Designs ({tasks.length})</span>
              <button onClick={fetchTasks} className="hover:text-slate-200">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                className={`glass-card p-4 rounded-2xl cursor-pointer transition-all space-y-3 ${
                  selectedTaskId === task.id ? 'border-primary-500/60 ring-1 ring-primary-500/30' : ''
                }`}
              >
                <div className="flex space-x-3">
                  <img
                    src={task.imageUrl}
                    alt={task.title}
                    className="w-20 h-20 rounded-xl object-cover border border-slate-800 shrink-0 bg-slate-950"
                  />
                  <div className="space-y-1 overflow-hidden">
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-primary-500/10 text-primary-400 rounded-full border border-primary-500/20">
                      {task.source}
                    </span>
                    <h4 className="font-bold text-sm text-slate-100 truncate">{task.title}</h4>
                    {task.quote && <p className="text-xs text-slate-400 truncate">Quote: &quot;{task.quote}&quot;</p>}
                    <div className="text-[10px] text-slate-500">ID: {task.id}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Active Task Review & Questionnaire (8 cols) */}
          {activeTask && (
            <div className="lg:col-span-8 space-y-5">
              <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
                {/* Header Info */}
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-slate-100">{activeTask.title}</h3>
                    <p className="text-xs text-slate-400">{activeTask.prompt}</p>
                  </div>
                  <span className="px-3 py-1 text-xs font-mono font-semibold bg-accent-cyan/10 text-accent-cyan rounded-lg border border-accent-cyan/20">
                    {activeTask.id}
                  </span>
                </div>

                {/* Question Matrix */}
                <div className="space-y-4 pt-2 border-t border-slate-800">
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center">
                    <Sliders className="w-4 h-4 mr-1.5 text-primary-400" />
                    Produkt- &amp; Design-Fragen
                  </h4>

                  {/* Question 1: Zielgruppe */}
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">1. Welche Zielgruppe betrifft das Design?</span>
                      <span className="text-[11px] text-accent-cyan font-mono flex items-center">
                        <Bot className="w-3 h-3 mr-1" /> KI-Vorschlag: {activeTask.aiPrediction?.audience || 'Men, Women'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {['Men', 'Women', 'Youth', 'Men, Women', 'Alle'].map((val) => (
                        <button
                          key={val}
                          onClick={() => {
                            activeTask.audience = val;
                            setTasks([...tasks]);
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                            activeTask.audience === val 
                              ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Question 2: Zu vermeidende Farbe */}
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">2. Welche Produktfarbe sollte vermieden werden?</span>
                      <span className="text-[11px] text-accent-cyan font-mono flex items-center">
                        <Bot className="w-3 h-3 mr-1" /> KI-Vorschlag: {activeTask.aiPrediction?.avoidColor || 'Keine'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {['Schwarz', 'Weiß', 'Keine'].map((val) => (
                        <button
                          key={val}
                          onClick={() => {
                            activeTask.avoidColor = val;
                            setTasks([...tasks]);
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                            activeTask.avoidColor === val 
                              ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Question 3: Hintergrund */}
                  <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">3. Wird die Hintergrundfarbe als Design-Element wiederverwendet?</span>
                      <span className="text-[11px] text-accent-cyan font-mono flex items-center">
                        <Bot className="w-3 h-3 mr-1" /> KI-Vorschlag: {activeTask.aiPrediction?.reuseBackground || 'Nein'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {['Ja (Manuelle Maskierung)', 'Nein (Auto Background Removal)'].map((val) => (
                        <button
                          key={val}
                          onClick={() => {
                            activeTask.reuseBackground = val;
                            setTasks([...tasks]);
                          }}
                          className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                            activeTask.reuseBackground?.startsWith(val.slice(0, 2))
                              ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                              : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* AI Listing Preview */}
                <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800/90 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 flex items-center">
                      <Sparkles className="w-3.5 h-3.5 mr-1.5 text-accent-cyan" />
                      Erstelltes Amazon Listing (OpenRouter Vision AI)
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono">Confidence: {activeTask.aiPrediction?.confidence || '98%'} ✓</span>
                  </div>
                  <div className="text-xs space-y-1 text-slate-300">
                    <div><strong className="text-slate-400">Title:</strong> {activeTask.aiPrediction?.title}</div>
                    <div><strong className="text-slate-400">Brand:</strong> {activeTask.aiPrediction?.brand}</div>
                    <div><strong className="text-slate-400">Bullet 1:</strong> {activeTask.aiPrediction?.bullet1}</div>
                    <div><strong className="text-slate-400">Bullet 2:</strong> {activeTask.aiPrediction?.bullet2}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    onClick={() => handleApprove(activeTask.id)}
                    className="px-6 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20 flex items-center space-x-2 transition-all active:scale-98"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Freigeben &amp; In Queue verschieben</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
