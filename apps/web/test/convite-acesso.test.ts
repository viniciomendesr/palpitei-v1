import assert from 'node:assert/strict';
import test from 'node:test';
import { acaoDoConvite } from '../src/lib/convite-acesso.ts';
import { entradaDaSala } from '../src/lib/sala-entrada.ts';

const pronto = { hydrated: true, privyReady: true } as const;

test('convite: fã autenticado na Privy entra, mesmo sem sessão local (a regressão)', () => {
  // A shared link always opens a fresh tab; the local session lives in sessionStorage
  // (per tab), so it is null here. Privy is the authority — and the join authenticates
  // with its Bearer, not with the local session.
  assert.equal(
    acaoDoConvite({ ...pronto, privyAuthenticated: true, authMethod: null }),
    'join',
  );
});

test('convite: enquanto a Privy não está ready, o botão carrega — nunca oferece login', () => {
  // Closes the race: between hydrated=true and privy.ready=true an authenticated fan
  // still looks logged out. A fast tapper must not be routed to login.
  assert.equal(
    acaoDoConvite({ ...pronto, privyReady: false, privyAuthenticated: false, authMethod: null }),
    'loading',
  );
});

test('convite: antes da hidratação o botão carrega', () => {
  assert.equal(
    acaoDoConvite({ ...pronto, hydrated: false, privyAuthenticated: false, authMethod: null }),
    'loading',
  );
});

test('convite: fã de demo precisa de conta real antes de um lobby que vale ranking', () => {
  assert.equal(
    acaoDoConvite({ ...pronto, privyAuthenticated: false, authMethod: 'demo' }),
    'login',
  );
});

test('convite: sessão demo com Privy autenticada entra — a Privy é a autoridade', () => {
  // Deliberate. The local cache may say "demo" in one tab while Privy
  // (localStorage/cookie, cross-tab) is authenticated. Routing to login would be
  // exactly the bug this file fixes; and what the server sees on join is the verified
  // privy_did from the Bearer, never the demo account. Rule 3 still holds: demo itself
  // makes no network call — only this fan, who ALREADY has a real account, uses theirs.
  assert.equal(
    acaoDoConvite({ ...pronto, privyAuthenticated: true, authMethod: 'demo' }),
    'join',
  );
});

test('sala: Privy autenticada + id numérico cai no lobby REAL, não no mock', () => {
  // Without this, the join redirect (/sala/:id?party=CODE) sends the fan back to login:
  // a null local session renders SalaMock -> useRequireSession -> router.replace('/').
  assert.equal(
    entradaDaSala({ ...pronto, roomId: '18257865', privyAuthenticated: true, authMethod: null }),
    'lobby',
  );
  assert.equal(
    entradaDaSala({ ...pronto, roomId: 'treino-18257865', privyAuthenticated: true, authMethod: null }),
    'lobby',
  );
});

test('sala: o demo nunca espera a rede e nunca cai no lobby real', () => {
  // Rule 3: the judge's path must not depend on Privy ever becoming ready.
  assert.equal(
    entradaDaSala({ hydrated: true, privyReady: false, roomId: 'arg-cab', privyAuthenticated: false, authMethod: 'demo' }),
    'mock',
  );
  assert.equal(
    entradaDaSala({ ...pronto, roomId: '18257865', privyAuthenticated: false, authMethod: 'demo' }),
    'mock',
  );
});

test('sala: sem hidratação ou sem Privy pronta, ninguém decide — o mock redireciona sozinho', () => {
  assert.equal(
    entradaDaSala({ hydrated: false, privyReady: true, roomId: '18257865', privyAuthenticated: false, authMethod: null }),
    'loading',
  );
  assert.equal(
    entradaDaSala({ hydrated: true, privyReady: false, roomId: '18257865', privyAuthenticated: false, authMethod: null }),
    'loading',
  );
});

test('sala: sessão real sem Privy autenticada preserva o comportamento antigo', () => {
  assert.equal(
    entradaDaSala({ ...pronto, roomId: '18257865', privyAuthenticated: false, authMethod: 'google' }),
    'lobby',
  );
  assert.equal(
    entradaDaSala({ ...pronto, roomId: 'arg-cab', privyAuthenticated: true, authMethod: 'google' }),
    'mock',
  );
});
