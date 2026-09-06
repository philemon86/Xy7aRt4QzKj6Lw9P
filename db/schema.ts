import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tenant: text('tenant').notNull(),
  date: text('date').notNull(),
  status: text('status').notNull().default('open'),
  pricing: text('pricing').notNull().default('website'),
  state: text('state').notNull().default('{}'),
  revision: integer('revision').notNull().default(0),
  updated: text('updated').notNull(),
  actor: text('actor').notNull(),
});
export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  role: text('role').notNull(),
  tenant: text('tenant').notNull(),
  expires: integer('expires').notNull(),
});
export const churches = sqliteTable('churches', {
  code: text('code').primaryKey(),
  password: text('password').notNull(),
  enabled: integer('enabled').notNull().default(1),
});
export const limits = sqliteTable('limits', {
  key: text('key').primaryKey(),
  n: integer('n').notNull(),
  expires: integer('expires').notNull(),
});
export const audit = sqliteTable('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event: text('event').notNull(),
  revision: integer('revision').notNull(),
  state: text('state').notNull(),
  actor: text('actor').notNull(),
  created: text('created').notNull(),
});
export const closings = sqliteTable('closings', {
  id: text('id').primaryKey(),
  event: text('event').notNull(),
  day: text('day').notNull(),
  snapshot: text('snapshot').notNull(),
  created: text('created').notNull(),
});
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const shop = sqliteTable('shop', {
  code: text('code').primaryKey(),
  data: text('data').notNull(),
});
