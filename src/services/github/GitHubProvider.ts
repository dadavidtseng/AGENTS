/**
 * @fileoverview GitHub API provider using Octokit.
 */
import { Octokit } from '@octokit/rest';
import { McpError, JsonRpcErrorCode } from '@/types-global/errors.js';
import { config } from '@/config/index.js';
import { logger } from '@/utils/index.js';

export class GitHubProvider {
  private octokit: Octokit;

  constructor() {
    if (!config.githubToken) {
      throw new McpError(
        JsonRpcErrorCode.Unauthorized,
        'GITHUB_PERSONAL_ACCESS_TOKEN is required',
      );
    }

    this.octokit = new Octokit({
      auth: config.githubToken,
      baseUrl: config.githubHost
        ? `${config.githubHost}/api/v3`
        : config.githubApiUrl,
    });

    logger.info('GitHubProvider initialized');
  }

  get client(): Octokit {
    return this.octokit;
  }

  // ── Pull Requests ───────────────────────────────────────────────────────

  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body?: string;
    draft?: boolean;
    maintainer_can_modify?: boolean;
  }) {
    const { data } = await this.octokit.pulls.create(params);
    return {
      success: true,
      number: data.number,
      url: data.url,
      html_url: data.html_url,
      state: data.state,
      title: data.title,
      head: data.head.ref,
      base: data.base.ref,
      draft: data.draft,
    };
  }

  async mergePullRequest(params: {
    owner: string;
    repo: string;
    pull_number: number;
    merge_method?: 'merge' | 'squash' | 'rebase';
    commit_title?: string;
    commit_message?: string;
  }) {
    const { data } = await this.octokit.pulls.merge(params);
    return {
      success: true,
      sha: data.sha,
      message: data.message,
      merged: data.merged,
    };
  }

  async listPullRequests(params: {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
    head?: string;
    base?: string;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: 'asc' | 'desc';
    per_page?: number;
    page?: number;
  }) {
    const { data } = await this.octokit.pulls.list(params);
    return {
      success: true,
      total_count: data.length,
      pull_requests: data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft,
        user: pr.user?.login || 'unknown',
        head: pr.head.ref,
        base: pr.base.ref,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        html_url: pr.html_url,
      })),
    };
  }

  async getPullRequest(params: {
    owner: string;
    repo: string;
    pull_number: number;
    include_diff?: boolean;
    include_files?: boolean;
  }) {
    const { data } = await this.octokit.pulls.get({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pull_number,
    });

    let diff: string | undefined;
    if (params.include_diff) {
      const diffResponse = await this.octokit.pulls.get({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pull_number,
        mediaType: { format: 'diff' },
      });
      diff = diffResponse.data as unknown as string;
    }

    let files: Array<{ filename: string; status: string; additions: number; deletions: number }> | undefined;
    if (params.include_files) {
      const filesResponse = await this.octokit.pulls.listFiles({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.pull_number,
      });
      files = filesResponse.data.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      }));
    }

    return {
      success: true,
      number: data.number,
      title: data.title,
      state: data.state,
      draft: data.draft,
      body: data.body || '',
      user: data.user?.login || 'unknown',
      head: data.head.ref,
      base: data.base.ref,
      html_url: data.html_url,
      mergeable: data.mergeable,
      merged: data.merged,
      comments_count: data.comments,
      review_comments_count: data.review_comments,
      additions: data.additions,
      deletions: data.deletions,
      changed_files: data.changed_files,
      diff,
      files,
    };
  }

  async updatePullRequest(params: {
    owner: string;
    repo: string;
    pull_number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    base?: string;
    maintainer_can_modify?: boolean;
  }) {
    const { data } = await this.octokit.pulls.update(params);
    return {
      success: true,
      number: data.number,
      url: data.url,
      html_url: data.html_url,
      title: data.title,
      state: data.state,
    };
  }
}
