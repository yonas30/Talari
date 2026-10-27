// Checks that db/schema.ts (the Drizzle mirror) describes the database the real migrations build: the same tables, the same columns in each,
// the same column types, the same not-null flags and the same primary keys. The migrations are the truth; when one changes a table, this fails
// until the mirror is changed too. Run: npx tsx scripts/verify-schema-mirror.ts
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import { runMigrations, SCHEMA_VERSION, SqlRunner } from '../db/migrations';
import * as schema from '../db/schema';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

interface NodeStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown }
interface NodeDb { exec(sql: string): void; prepare(sql: string): NodeStatement }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
const db = new DatabaseSync(':memory:');
const runner: SqlRunner = {
  exec: (sql) => db.exec(sql),
  all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
  run: (sql, ...params) => {
    db.prepare(sql).run(...params);
  },
};
runMigrations(runner, 0);

interface RealColumn { name: string; type: string; notnull: number; pk: number }
const realTables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
const realColumns = (table: string): RealColumn[] => db.prepare(`PRAGMA table_info(${table})`).all() as unknown as RealColumn[];

const mirrored = Object.values(schema as Record<string, unknown>).filter((value): value is SQLiteTable => value instanceof SQLiteTable).map((table) => getTableConfig(table));

console.log('Tables');
check(`the migrations build the schema the app expects (version ${SCHEMA_VERSION})`, SCHEMA_VERSION === 9);
const mirrorNames = mirrored.map((table) => table.name).sort();
check('the mirror has every table the migrations create', realTables.every((name) => mirrorNames.includes(name)), `missing from the mirror: ${realTables.filter((name) => !mirrorNames.includes(name)).join(', ')}`);
check('the mirror has no table the migrations do not create', mirrorNames.every((name) => realTables.includes(name)), `not in the migrations: ${mirrorNames.filter((name) => !realTables.includes(name)).join(', ')}`);

console.log('Columns');
for (const table of mirrored) {
  if (!realTables.includes(table.name)) continue;
  const real = realColumns(table.name);
  const mirror = table.columns;
  check(`${table.name}: the same columns`, real.map((c) => c.name).sort().join() === mirror.map((c) => c.name).sort().join(), `real: ${real.map((c) => c.name).sort().join()} | mirror: ${mirror.map((c) => c.name).sort().join()}`);
  for (const column of mirror) {
    const actual = real.find((c) => c.name === column.name);
    if (!actual) continue;
    const sameType = actual.type.toLowerCase() === column.getSQLType().toLowerCase();
    // A primary key is not-null by definition in Drizzle; SQLite only records it when it was spelled out.
    const sameNull = column.primary ? true : (actual.notnull === 1) === column.notNull;
    const samePk = (actual.pk > 0) === column.primary;
    check(`${table.name}.${column.name}: type, not-null and key match`, sameType && sameNull && samePk, `real ${actual.type}${actual.notnull ? ' not null' : ''}${actual.pk ? ' pk' : ''} | mirror ${column.getSQLType()}${column.notNull ? ' not null' : ''}${column.primary ? ' pk' : ''}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
