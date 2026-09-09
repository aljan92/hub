import { useRef, useState } from 'react';
import { DesignTaskLog } from '../../types/tasks';

/** One draft per loaded review. Setters are capabilities bound to that exact session. */
export function useReviewSession<T extends object>(task: DesignTaskLog | null, initialize: (task: DesignTaskLog) => T) {
  const key = task ? `${task.id}:${task.reviewVersion || ''}` : '';
  const make = () => ({ key, taskId: task?.id, version: task?.reviewVersion, draft: task ? initialize(task) : null, dirty: false });
  const [session, setSession] = useState(make);
  const currentKey = useRef({ key, generation: 0 });
  if (currentKey.current.key !== key) currentKey.current = { key, generation: currentKey.current.generation + 1 };
  const generation = currentKey.current.generation;
  const conflict = session.key !== key && session.taskId === task?.id && session.dirty;
  // React restarts this component's render before committing children. No frame may
  // display a new owner with the previous owner's fields (unlike an effect reset).
  if (session.key !== key && !conflict) setSession(make());
  const ready = Boolean(task && task.reviewVersion && session.key === key);
  return {
    taskId: session.taskId, version: session.version, draft: session.draft,
    dirty: session.dirty, ready, conflict,
    reload: () => setSession(make()),
    setter: <K extends keyof T>(field: K, markDirty = true) => (value: T[K] | ((previous: T[K]) => T[K])) => {
      const owner = session.key;
      setSession(previous => {
        if (!owner || currentKey.current.key !== owner || currentKey.current.generation !== generation || previous.key !== owner || !previous.draft) return previous;
        const next = typeof value === 'function' ? (value as (p: T[K]) => T[K])(previous.draft[field]) : value;
        if (Object.is(previous.draft[field], next)) return previous;
        return { ...previous, dirty: previous.dirty || markDirty, draft: { ...previous.draft, [field]: next } };
      });
    }
  };
}
