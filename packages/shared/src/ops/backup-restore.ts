import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export interface BackupEnvelope {
  ivHex: string;
  authTagHex: string;
  encryptedHex: string;
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'aro-backup-salt', 32);
}

export function encryptBackup(plaintext: string, secret: string): BackupEnvelope {
  const iv = randomBytes(16);
  const key = deriveKey(secret);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    ivHex: iv.toString('hex'),
    authTagHex: cipher.getAuthTag().toString('hex'),
    encryptedHex: encrypted,
  };
}

export function decryptBackup(envelope: BackupEnvelope, secret: string): string {
  const key = deriveKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.authTagHex, 'hex'));

  let decrypted = decipher.update(envelope.encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}