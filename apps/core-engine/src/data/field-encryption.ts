import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export class FieldEncryption {
  private readonly key: Buffer;

  constructor(encryptionKeyHex: string, encryptionSalt: string) {
    this.key = pbkdf2Sync(encryptionKeyHex, encryptionSalt, 100000, 32, 'sha256');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    if (ivHex === undefined || authTagHex === undefined || encrypted === undefined) {
      throw new Error('Invalid encrypted payload format');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}