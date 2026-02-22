import { describe, expect, it } from 'vitest';

import {
  buildDiagnosticsSnapshot,
  decryptBackup,
  defaultAlertRules,
  defaultRunbookEntries,
  encryptBackup,
  generateEnvFile,
  renderLaunchdPlist,
  renderSystemdService,
} from '../../index.js';

describe('Phase 7 operations toolkit', () => {
  it('renders system service templates', () => {
    const systemd = renderSystemdService('aro-core', '/usr/bin/node dist/index.js');
    expect(systemd).toContain('Description=aro-core');

    const launchd = renderLaunchdPlist('com.aro.core', '/usr/local/bin/node');
    expect(launchd).toContain('<string>com.aro.core</string>');
  });

  it('generates installer env file', () => {
    const env = generateEnvFile({
      businessName: 'Smile Care',
      host: '127.0.0.1',
      port: 3000,
      databaseUrl: 'sqlite:aro.db',
      timezone: 'America/New_York',
    });

    expect(env).toContain('BUSINESS_NAME=Smile Care');
    expect(env).toContain('PORT=3000');
  });

  it('encrypts and decrypts backup payload', () => {
    const original = JSON.stringify({ appointments: 10, customers: 5 });
    const envelope = encryptBackup(original, 'backup-secret');
    const decrypted = decryptBackup(envelope, 'backup-secret');
    expect(decrypted).toBe(original);
  });

  it('builds diagnostics status from checks', () => {
    const snapshot = buildDiagnosticsSnapshot({
      service: 'core-engine',
      checks: { database: 'up', messaging: 'up' },
      uptimeSeconds: 123,
      memoryRssBytes: 1024,
    });

    expect(snapshot.status).toBe('healthy');
  });

  it('provides default alert rules and runbook entries', () => {
    expect(defaultAlertRules().length).toBeGreaterThan(0);
    expect(defaultRunbookEntries().length).toBeGreaterThan(0);
  });
});