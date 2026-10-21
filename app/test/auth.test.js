import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as session } from '../functions/api/session.js';

// The secret is a binding, so tests supply their own instead of depending on .dev.vars.
const authEnv = { ...env, EDIT_PASSWORD: 'correct horse battery staple' };

const post = (body) =>
  login({ request: new Request('http://test/api/login', { method: 'POST', body: JSON.stringify(body) }), env: authEnv });

const get = (headers) => session({ request: new Request('http://test/api/session', { headers }), env: authEnv });

const tokenFor = async (password) => (await (await post({ password })).json()).token;

it('POST /api/login accepts the correct password and returns a token', async () => {
  const response = await post({ password: 'correct horse battery staple' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}$/) });
});

it('POST /api/login rejects a wrong password', async () => {
  const response = await post({ password: 'hunter2' });

  expect(response.status).toBe(401);
  expect(await response.json()).not.toHaveProperty('token');
});

it('POST /api/login rejects a prefix of the real password, an empty one, and no password at all', async () => {
  expect((await post({ password: 'correct horse' })).status).toBe(401);
  expect((await post({ password: '' })).status).toBe(401);
  expect((await post({})).status).toBe(401);
});

// A leaked token must not crack back to the shared password, so it is stretched, not just hashed.
it('the token is not a bare hash of the password', async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('correct horse battery staple'));
  const bareHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  expect(await tokenFor('correct horse battery staple')).not.toBe(bareHash);
});

it('POST /api/login rejects everything when the secret is not configured', async () => {
  const request = new Request('http://test/api/login', { method: 'POST', body: JSON.stringify({ password: '' }) });

  expect((await login({ request, env: { ...env, EDIT_PASSWORD: undefined } })).status).toBe(401);
});

it('a protected endpoint accepts a valid token', async () => {
  const response = await get({ Authorization: `Bearer ${await tokenFor('correct horse battery staple')}` });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

it('a protected endpoint rejects a missing token', async () => {
  expect((await get({})).status).toBe(401);
});

it('a protected endpoint rejects a wrong token', async () => {
  expect((await get({ Authorization: `Bearer ${'a'.repeat(64)}` })).status).toBe(401);
});

it('a protected endpoint rejects a malformed token', async () => {
  for (const header of ['', 'Bearer', 'Bearer ', 'bogus', 'Basic abc', 'Bearer a b', `Bearer ${'a'.repeat(5000)}`])
    expect((await get({ Authorization: header })).status).toBe(401);
});

it('a protected endpoint stays shut when the secret is not configured', async () => {
  const token = await tokenFor('correct horse battery staple');
  const request = new Request('http://test/api/session', { headers: { Authorization: `Bearer ${token}` } });

  expect((await session({ request, env: { ...env, EDIT_PASSWORD: undefined } })).status).toBe(401);
});

it('a protected endpoint rejects the password itself as a token', async () => {
  expect((await get({ Authorization: 'Bearer correct horse battery staple' })).status).toBe(401);
});
