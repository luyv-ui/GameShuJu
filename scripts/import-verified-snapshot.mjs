import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareVerifiedSnapshot, importVerifiedSnapshot } from '../server/ingestion.js';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const filename = fileIndex >= 0 ? args[fileIndex + 1] : null;
const apply = args.includes('--apply');
if (!filename || (args.includes('--dry-run') && apply)) {
  console.error('用法: node scripts/import-verified-snapshot.mjs --file data/imports/<快照>.json [--apply]');
  process.exitCode = 2;
} else {
  try {
    const document = JSON.parse(await fs.readFile(path.resolve(filename), 'utf8'));
    const prepared = prepareVerifiedSnapshot(document);
    const result = apply ? importVerifiedSnapshot(document) : { verified: prepared.count, fetchedAt: prepared.fetchedAt, dryRun: true };
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`导入失败: ${error.message}`);
    process.exitCode = 1;
  }
}
