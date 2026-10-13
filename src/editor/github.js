// The few GitHub REST calls the editor needs. `fetchFn` is injectable so tests can stand in for GitHub.
import { API, OWNER, REPO, BRANCH } from './config.js';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // 0 = never reached GitHub
  }
}

export function decodeBase64Text(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function createGitHub(token, fetchFn = (...a) => fetch(...a)) {
  const base = `${API}/repos/${OWNER}/${REPO}`;
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, `Network error: ${e.message}`);
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try { message = (await res.json()).message || message; } catch {}
      throw new GitHubError(res.status, message);
    }
    return res.status === 204 ? null : res.json();
  }
  return {
    repo: () => call('GET', ''),
    headSha: async () => (await call('GET', `/git/ref/heads/${BRANCH}`)).object.sha,
    commit: (sha) => call('GET', `/git/commits/${sha}`),
    tree: async (sha) => (await call('GET', `/git/trees/${sha}?recursive=1`)).tree,
    blobText: async (sha) => decodeBase64Text((await call('GET', `/git/blobs/${sha}`)).content),
    createBlob: async (base64) => (await call('POST', '/git/blobs', { content: base64, encoding: 'base64' })).sha,
    createTree: async (baseTree, entries) => (await call('POST', '/git/trees', { base_tree: baseTree, tree: entries })).sha,
    createCommit: (message, tree, parent) => call('POST', '/git/commits', { message, tree, parents: [parent] }),
    updateRef: (sha) => call('PATCH', `/git/refs/heads/${BRANCH}`, { sha, force: false }),
  };
}
