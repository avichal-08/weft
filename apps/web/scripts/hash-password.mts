import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { hashPassword } from '../lib/password.ts';

const MIN_CHARS = 12;

let muted = false;
const output = new Writable({
  write(chunk, _enc, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  const { value } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  return String(value ?? '');
}

const password = await ask('Password: ');
const again = await ask('Again: ');
rl.close();
if (password.length < MIN_CHARS) {
  console.error(`Use at least ${MIN_CHARS} characters.`);
  process.exit(1);
}
if (again !== password) {
  console.error("The passwords don't match.");
  process.exit(1);
}
console.log(`WEFT_PASSWORD_HASH=${await hashPassword(password)}`);
