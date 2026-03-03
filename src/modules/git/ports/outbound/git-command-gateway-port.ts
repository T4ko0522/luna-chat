export type GitCommitEntry = {
  hash: string;
  authorName: string;
  date: string;
  subject: string;
};

export type GitCommandGateway = {
  cloneOrPull: (input: {
    repoUrl: string;
    localDir: string;
  }) => Promise<{ action: "cloned" | "pulled" }>;
  logSince: (input: {
    localDir: string;
    since: string;
  }) => Promise<GitCommitEntry[]>;
  listTrackedFiles: (input: {
    localDir: string;
  }) => Promise<string[]>;
  readFileContent: (input: {
    localDir: string;
    filePath: string;
  }) => Promise<string | null>;
};
