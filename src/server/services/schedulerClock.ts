export const UPLOAD_SCHEDULER_TIME_ZONE = 'Europe/Berlin';

export interface SchedulerClockParts {
  date: string;
  time: string;
  hour: number;
  minute: number;
  second: number;
}

export function getSchedulerClock(now = new Date()): SchedulerClockParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UPLOAD_SCHEDULER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '00';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const second = Number(value('second'));

  return {
    date: `${year}-${month}-${day}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
    hour,
    minute,
    second
  };
}
