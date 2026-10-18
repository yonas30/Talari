import { SqlRunner } from './migrations';

// Which notifications the user has already seen. Notifications themselves are recomputed from the data every
// launch; only the "seen" flag needs to survive a restart, otherwise the bell's red badge would come back every time
// the app opens for something already viewed.

export function getReadIds(db: SqlRunner): string[] {
  return db.all<{ id: string }>('SELECT id FROM notification_reads').map((row) => row.id);
}

export function markRead(db: SqlRunner, ids: string[], nowIso: string): void {
  for (const id of ids) {
    db.run('INSERT OR IGNORE INTO notification_reads (id, read_at) VALUES (?, ?)', id, nowIso);
  }
}

// A deleted, expired or cleared notification has no use for its read record.
export function forgetReads(db: SqlRunner, ids: string[]): void {
  for (const id of ids) {
    db.run('DELETE FROM notification_reads WHERE id = ?', id);
  }
}

// Read flags for notifications that stopped existing months ago are just clutter.
export function pruneReads(db: SqlRunner, olderThanIso: string): void {
  db.run('DELETE FROM notification_reads WHERE read_at < ?', olderThanIso);
}
