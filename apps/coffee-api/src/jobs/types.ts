export interface JobOutcome {
  itemsProcessed: number;
}

export interface JobDefinition {
  name: string;
  /** Repo-relative path, shown in the admin cron console. */
  path: string;
  cron: string;
  description: string;
  run: () => Promise<JobOutcome>;
}
