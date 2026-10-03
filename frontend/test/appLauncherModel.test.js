import test from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, availableApps, DEFAULT_FAVORITES, internalRoute, splitApps, toggleFavorite } from '../src/components/appLauncherModel.js';

test('Admin console is only offered to users who can manage users', () => {
  assert.equal(availableApps([]).some((app) => app.id === 'admin'), false);
  assert.equal(availableApps(['user.manage']).some((app) => app.id === 'admin'), true);
});

test('links open the signed-in user\'s own Google account', () => {
  const gmail = availableApps([]).find((app) => app.id === 'gmail');
  assert.equal(appUrl(gmail, 'imelda@prakasafoods.com'), 'https://mail.google.com/mail/?authuser=imelda%40prakasafoods.com');
  assert.equal(appUrl(gmail, ''), 'https://mail.google.com/mail/');
});

test('favourites keep the user order, the rest keep catalogue order, unavailable ids are dropped', () => {
  const apps = availableApps([]);
  const { favorites, others } = splitApps(apps, ['meet', 'admin', 'gmail', 'nope']);
  assert.deepEqual(favorites.map((a) => a.id), ['meet', 'gmail']);
  assert.ok(!others.some((a) => ['meet', 'gmail'].includes(a.id)));
  assert.equal(others[0].id, 'account');
});

test('no saved favourites falls back to the defaults; toggling adds or removes', () => {
  const { favorites } = splitApps(availableApps([]), null);
  assert.deepEqual(favorites.map((a) => a.id), DEFAULT_FAVORITES.filter((id) => id !== 'analytics'));
  assert.deepEqual(toggleFavorite(['gmail', 'drive'], 'drive'), ['gmail']);
  assert.deepEqual(toggleFavorite(['gmail'], 'meet'), ['gmail', 'meet']);
});

test('apps with an in-app page open inside Prakasa Workspace only when the user may use that page', () => {
  const apps = availableApps(['analytics.view']);
  const byId = (id) => apps.find((a) => a.id === id);
  assert.equal(internalRoute(byId('gmail'), ['google.mail.use']), '/mail');
  assert.equal(internalRoute(byId('gmail'), []), null);
  assert.equal(internalRoute(byId('meet'), ['google.mail.use']), null);
  assert.equal(internalRoute(byId('analytics'), ['analytics.view']), '/analytics');
});
