import { loadConfig } from '../config.js';
import { createDb, runMigrations } from './client.js';

// The app also migrates on startup; this script is for applying migrations without starting the server.
const db = createDb(loadConfig().DATABASE_URL);
runMigrations(db);
db.$client.close();
console.log('Migrations applied.');
