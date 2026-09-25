import { TaskRepository } from '../storage/taskRepository';
import { TaskExecutionLock } from './taskExecutionLock';
import { PipelineExecutionCoordinator } from './pipelineExecutionCoordinator';
import { TaskLogService } from './taskLogService';
import { UpdateBackfillService } from './updateBackfillService';
import type { DesignTaskLog, TaskStatus } from '../../types/tasks';

export type PipelineStep = NonNullable<NonNullable<DesignTaskLog['executionControl']>['nextStep']>;

/** Durable user control at safe pipeline boundaries. No external operation is interrupted. */
export class TaskExecutionControl {
  private static afterCancellation(task: DesignTaskLog): void {
    if (task.source !== 'UPDATE' && task.suffix !== 'U') return;
    const designId = String(task.payload?.designId || task.designId || '').trim();
    if (designId) {
      UpdateBackfillService.addRecentlyCancelledDesign(designId);
      UpdateBackfillService.releaseInFlight(designId);
    }
    UpdateBackfillService.scheduleNextCycleAfterCancel();
  }
  private static save(taskId: string, phase: NonNullable<DesignTaskLog['executionControl']>['phase'],
    status: TaskStatus, nextStep?: PipelineStep, previousStatus?: TaskStatus): DesignTaskLog {
    const task = TaskRepository.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);
    const control = task.executionControl;
    const now = new Date().toISOString();
    const saved = TaskLogService.updateTaskStatus(taskId, {
      status,
      executionControl: {
        phase, nextStep: nextStep ?? control?.nextStep,
        previousStatus: previousStatus ?? control?.previousStatus,
        enqueuedAt: phase === 'queued' ? (control?.phase === 'queued' ? control.enqueuedAt || now : now) : control?.enqueuedAt,
        attempt: control?.attempt || 1, updatedAt: now
      }
    });
    if (!saved) throw new Error('Task-Steuerung konnte nicht gespeichert werden.');
    return saved;
  }

  static markWaiting(taskId: string, nextStep?: PipelineStep): void {
    const task = TaskRepository.getTaskById(taskId);
    if (!task || task.status === 'CANCELLED' || ['paused', 'pause_requested', 'cancel_requested'].includes(task.executionControl?.phase || '')) return;
    this.save(taskId, 'queued', 'WAITING', nextStep, task.executionControl?.previousStatus || task.status);
  }

  static beforeStep(taskId: string, step: PipelineStep): 'run' | 'paused' | 'cancelled' {
    const task = TaskRepository.getTaskById(taskId);
    if (!task || task.status === 'CANCELLED' || task.executionControl?.phase === 'cancel_requested') {
      if (task && task.status !== 'CANCELLED') this.afterCancellation(this.save(taskId, 'finished', 'CANCELLED', step));
      return 'cancelled';
    }
    if (task.executionControl?.phase === 'paused' || task.executionControl?.phase === 'pause_requested') {
      if (task.status !== 'PAUSED') this.save(taskId, 'paused', 'PAUSED', step);
      return 'paused';
    }
    this.save(taskId, 'running', task.status === 'WAITING' ? (task.executionControl?.previousStatus || 'PROCESSING') : task.status, step);
    return 'run';
  }

  static afterStep(taskId: string, nextStep?: PipelineStep): 'run' | 'paused' | 'cancelled' {
    const task = TaskRepository.getTaskById(taskId);
    if (!task) return 'cancelled';
    const phase = task.executionControl?.phase;
    if (phase === 'cancel_requested' || task.status === 'CANCELLED') {
      if (task.status !== 'CANCELLED') this.afterCancellation(this.save(taskId, 'finished', 'CANCELLED', nextStep));
      return 'cancelled';
    }
    if (phase === 'pause_requested' || phase === 'paused') {
      if (nextStep) this.save(taskId, 'paused', 'PAUSED', nextStep);
      else this.save(taskId, 'finished', task.executionControl?.previousStatus || task.status);
      return nextStep ? 'paused' : 'run';
    }
    if (task.checkpoint || task.status.startsWith('AWAITING_')) {
      if (phase === 'running') this.save(taskId, 'finished', task.status);
      return 'run';
    }
    if (nextStep && phase === 'running') this.save(taskId, 'running', task.status, nextStep);
    else if (!nextStep && phase === 'running') this.save(taskId, 'finished', task.status);
    return 'run';
  }

  static finishIdle(taskId: string): void {
    const task = TaskRepository.getTaskById(taskId);
    if (task?.executionControl?.phase === 'running') this.save(taskId, 'finished', task.status);
  }

  static requestPause(taskId: string): DesignTaskLog {
    const task = TaskRepository.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);
    if (!task.executionControl?.nextStep || task.checkpoint || task.inQueue) throw new Error('Dieser Task hat keinen sicheren Fortsetzungspunkt.');
    if (task.executionControl.phase === 'paused' || task.executionControl.phase === 'pause_requested') return task;
    if (!['running', 'queued', 'pause_requested'].includes(task.executionControl.phase) || ['CANCELLED', 'COMPLETED', 'UPDATE_QUEUED', 'REJECTED', 'ERROR'].includes(task.status)) throw new Error('Task ist nicht in einer pausierbaren Pipeline.');
    const active = TaskExecutionLock.isLocked(taskId) || PipelineExecutionCoordinator.getSnapshot().activeTaskId === taskId || task.executionControl.phase === 'running';
    const saved = this.save(taskId, active ? 'pause_requested' : 'paused', active ? 'PAUSE_REQUESTED' : 'PAUSED');
    if (!active) PipelineExecutionCoordinator.cancelWaiting(taskId);
    TaskLogService.addEvent(taskId, { timestamp: new Date().toISOString(), type: 'TASK_HANDOFF', title: active ? 'Pause angefordert' : 'Task pausiert', content: { action: 'PAUSE' } });
    return saved;
  }

  static requestCancel(taskId: string, reason: string): DesignTaskLog {
    const task = TaskRepository.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} nicht gefunden.`);
    if (['COMPLETED', 'UPDATE_QUEUED'].includes(task.status)) throw new Error('Ein bereits abgeschlossener oder übergebener Task kann hier nicht mehr abgebrochen werden.');
    if (task.status === 'CANCELLED') return task;
    const active = TaskExecutionLock.isLocked(taskId) || PipelineExecutionCoordinator.getSnapshot().activeTaskId === taskId || task.executionControl?.phase === 'running';
    if (task.executionControl?.phase === 'cancel_requested' && active) return task;
    const saved = this.save(taskId, active ? 'cancel_requested' : 'finished', active ? 'CANCEL_REQUESTED' : 'CANCELLED');
    if (!active) PipelineExecutionCoordinator.cancelWaiting(taskId);
    if (!active) this.afterCancellation(saved);
    TaskLogService.updateTaskStatus(taskId, { checkpoint: undefined, hasError: false, errorDetails: reason });
    TaskLogService.addEvent(taskId, { timestamp: new Date().toISOString(), type: 'TASK_HANDOFF', title: active ? 'Abbruch angefordert' : 'Task manuell abgebrochen', content: { action: 'CANCEL', reason } });
    return saved;
  }

  static resume(taskId: string): PipelineStep {
    const task = TaskRepository.getTaskById(taskId);
    if (!task || task.executionControl?.phase !== 'paused' || task.status !== 'PAUSED') throw new Error('Task ist nicht pausiert.');
    const step = task.executionControl.nextStep;
    if (!step || task.checkpoint || task.inQueue) throw new Error('Fortsetzungspunkt ist unklar; bitte Task prüfen.');
    if (step.startsWith('U') !== (task.source === 'UPDATE' || task.suffix === 'U')) throw new Error('Fortsetzungsschritt passt nicht zur Task-Pipeline.');
    this.save(taskId, 'queued', 'WAITING', step);
    TaskLogService.addEvent(taskId, { timestamp: new Date().toISOString(), type: 'TASK_HANDOFF', title: 'Task fortgesetzt', content: { action: 'RESUME', nextStep: step } });
    return step;
  }
}
