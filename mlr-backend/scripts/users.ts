// Manages sign-in accounts (there is no sign-up page):
//   npm run user -w mlr-backend -- add --name "Pat Author" --role author
//   npm run user -w mlr-backend -- add --name "Robin Admin" --role rule_admin
//   npm run user -w mlr-backend -- passwd --name "Pat Author"
//   npm run user -w mlr-backend -- role --name "Pat Author" --role rule_admin
//   npm run user -w mlr-backend -- disable|enable --name "Pat Author"
//   npm run user -w mlr-backend -- list
// Passwords are asked for without echo, or read from stdin with --password-stdin (never argv).
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { RoleSchema } from '@pre-mlr/shared';
import { MIN_PASSWORD_LENGTH } from '../src/auth/password.js';
import { addUser, listUsers, updateUser } from '../src/auth/users.js';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/client.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    role: { type: 'string' },
    'password-stdin': { type: 'boolean', default: false },
  },
});

async function readPassword(): Promise<string> {
  if (values['password-stdin'] || !process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.replace(/\r?\n$/, '');
  }
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      // Hide what's typed: print the prompt once, then nothing.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
        if (s.startsWith(q)) process.stdout.write(q);
      };
      rl.question(q, (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
    });
  const first = await ask(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
  const second = await ask('Repeat password: ');
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

const actor = `cli:${process.env.USER ?? 'unknown'}`;
const need = <T>(v: T | undefined, flag: string): T => {
  if (v === undefined) throw new Error(`--${flag} is required`);
  return v;
};
const role = () => RoleSchema.parse(need(values.role, 'role'));

try {
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  runMigrations(db);
  const [command] = positionals;
  switch (command) {
    case 'add': {
      const name = need(values.name, 'name');
      const r = role();
      const u = await addUser(db, { name, role: r, password: await readPassword() }, actor);
      console.log(`Added ${u.name} (${u.role}).`);
      break;
    }
    case 'passwd': {
      const u = await updateUser(
        db,
        need(values.name, 'name'),
        { password: await readPassword() },
        actor,
      );
      console.log(`Password changed for ${u.name}; their sessions were signed out.`);
      break;
    }
    case 'role': {
      const u = await updateUser(db, need(values.name, 'name'), { role: role() }, actor);
      console.log(`${u.name} is now ${u.role}.`);
      break;
    }
    case 'disable':
    case 'enable': {
      const u = await updateUser(
        db,
        need(values.name, 'name'),
        { disabled: command === 'disable' },
        actor,
      );
      console.log(`${u.name} ${command}d.`);
      break;
    }
    case 'list':
      for (const u of listUsers(db)) {
        console.log(
          `${u.name}\t${u.role}${u.disabledAt ? '\tdisabled' : ''}\tlast sign-in: ${u.lastLoginAt ?? 'never'}`,
        );
      }
      break;
    default:
      throw new Error(
        'Usage: user add|passwd|role|disable|enable|list [--name ...] [--role author|rule_admin]',
      );
  }
  db.$client.close();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
