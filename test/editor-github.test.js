import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, GitHubError, decodeBase64Text } from '../src/editor/github.js';

function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const r = route(url, init);
    if (r instanceof Error) throw r;
    const [status, json] = r;
    return new Response(status === 204 ? null : JSON.stringify(json), { status });
  };
  fn.calls = calls;
  return fn;
}

test('sends the token and reads the head of main', async () => {
  const f = fakeFetch(() => [200, { object: { sha: 'abc' } }]);
  assert.equal(await createGitHub('tok', f).headSha(), 'abc');
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/nFaiz8/nfaiz8.github.io/git/ref/heads/main');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer tok');
});

test('write calls send the right bodies', async () => {
  const f = fakeFetch(() => [201, { sha: 'x', committer: { date: 'd' } }]);
  const gh = createGitHub('tok', f);
  await gh.createBlob('AAAA');
  await gh.createTree('t0', [{ path: 'p', mode: '100644', type: 'blob', sha: null }]);
  await gh.createCommit('msg', 't1', 'c0');
  await gh.updateRef('c1');
  assert.deepEqual(f.calls.map((c) => [c.method, c.url.replace(/^.*\.io/, ''), c.body]), [
    ['POST', '/git/blobs', { content: 'AAAA', encoding: 'base64' }],
    ['POST', '/git/trees', { base_tree: 't0', tree: [{ path: 'p', mode: '100644', type: 'blob', sha: null }] }],
    ['POST', '/git/commits', { message: 'msg', tree: 't1', parents: ['c0'] }],
    ['PATCH', '/git/refs/heads/main', { sha: 'c1', force: false }],
  ]);
});

test('errors carry the status; network failures are status 0', async () => {
  await assert.rejects(
    createGitHub('t', fakeFetch(() => [401, { message: 'Bad credentials' }])).repo(),
    (e) => e instanceof GitHubError && e.status === 401 && /Bad credentials/.test(e.message),
  );
  await assert.rejects(createGitHub('t', fakeFetch(() => new TypeError('Failed to fetch'))).repo(), (e) => e.status === 0);
});

test('decodeBase64Text handles UTF-8 and the line breaks GitHub adds', () => {
  const s = '{"a":{"place":"São Paulo"}}';
  const b64 = Buffer.from(s).toString('base64');
  assert.equal(decodeBase64Text(`${b64.slice(0, 10)}\n${b64.slice(10)}`), s);
});
