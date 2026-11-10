/*
 * Generates the cleanup SQL for one test seed batch from backend/.seed-output.json.
 * It never connects to a database. Review the file, then run it (e.g. via the
 * Supabase MCP), then run the -verify file and expect every count to be 0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildCleanupSql, buildCleanupVerifySql, CleanupInput } from './seed-sql';
import type { SeedOutput } from './seed-test-env';

export function cleanupInputFromOutput(output: SeedOutput): CleanupInput {
  const ids = output.createdIds;
  if (!ids || !output.batchId || !output.schema) {
    throw new Error('seed output file has no batch id, schema or created ids');
  }
  return {
    schema: output.schema,
    batchId: output.batchId,
    userIds: ids.users,
    companyIds: ids.companies,
    loadIds: ids.loads,
    reportIds: ids.offPlatformReports,
    findingIds: ids.offPlatformFindings,
    banIds: ids.offPlatformBans,
  };
}

function main(): void {
  const outFile = resolve(process.env.SEED_OUTPUT_FILE ?? resolve(__dirname, '..', '.seed-output.json'));
  const sqlDir = resolve(process.env.SEED_SQL_DIR ?? resolve(__dirname, '..', '.seed-sql'));
  if (!existsSync(outFile)) throw new Error(`no seed output file at ${outFile}`);
  const input = cleanupInputFromOutput(JSON.parse(readFileSync(outFile, 'utf8')) as SeedOutput);
  mkdirSync(sqlDir, { recursive: true, mode: 0o700 });
  const cleanup = resolve(sqlDir, `${input.batchId}-90-cleanup.sql`);
  const verify = resolve(sqlDir, `${input.batchId}-91-cleanup-verify.sql`);
  writeFileSync(cleanup, buildCleanupSql(input), { mode: 0o600 });
  writeFileSync(verify, buildCleanupVerifySql(input), { mode: 0o600 });
  process.stdout.write(
    [
      `Cleanup for batch ${input.batchId} (schema ${input.schema}):`,
      `  ${input.userIds.length} users, ${input.companyIds.length} companies, ${input.loadIds.length} loads,`,
      `  ${input.reportIds.length} reports, ${input.findingIds.length} findings, ${input.banIds.length} bans recorded`,
      '  (plus sessions, OTP, reset tokens, idempotency, outbox and rate-limit rows of those users,',
      '   and any loads testers created in the TEST companies).',
      `1. Review, then run: ${cleanup}`,
      '   It returns one row per table with the number deleted, or fails and deletes nothing.',
      `2. Then run: ${verify}  (every count should be 0)`,
      '',
    ].join('\n'),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[seed:cleanup] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
