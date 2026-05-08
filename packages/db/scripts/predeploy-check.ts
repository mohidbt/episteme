import {
  formatPredeployFailure,
  runPredeployChecks,
} from "../src/schema-drift";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for db predeploy checks");
  }

  const summary = await runPredeployChecks(databaseUrl);
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    throw new Error(formatPredeployFailure(summary));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
