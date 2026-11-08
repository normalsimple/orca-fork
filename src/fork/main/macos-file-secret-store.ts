import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, linkSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { bestEffortFsyncDirectorySync, writeSecureFile } from '../../shared/secure-storage/secure-file'
import type { SecretStore } from '../../shared/secret-store'

export const LOCAL_SECRET_STORAGE = {
  root: '.orca',
  directory: 'secrets',
  keyFile: 'macos-key-v1',
  prefix: Buffer.from('orca-sealed-v1\0'),
  cipher: 'aes-256-gcm',
  keyBytes: 32,
  nonceBytes: 12,
  tagBytes: 16,
  unavailable: 'Local credential key is unavailable; existing credentials were preserved.',
  invalidKey: 'Local credential key is invalid; restore the key file from backup.',
  invalidCiphertext: 'Unsupported or damaged local credential ciphertext.'
} as const

/**
 * Random file key for the packaged macOS app. Reinstalls keep reading the same file,
 * independent of the code-signing hash. A missing or corrupt key throws; it never
 * falls back to plaintext.
 */
export class MacosFileSecretStore implements SecretStore {
  private key: Buffer | undefined

  constructor(private readonly directory: string) {}

  isEncryptionAvailable(): boolean {
    // File errors throw on read/write. Reporting "unavailable" would let callers store plaintext.
    return true
  }

  describeProtectionGap(): string | null {
    // Sealed with the file key. Do not probe the login keychain from this backend.
    return null
  }

  encryptString(plaintext: string): Buffer {
    const key = this.loadKey(true)
    const nonce = randomBytes(LOCAL_SECRET_STORAGE.nonceBytes)
    const cipher = createCipheriv(LOCAL_SECRET_STORAGE.cipher, key, nonce)
    cipher.setAAD(LOCAL_SECRET_STORAGE.prefix)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([LOCAL_SECRET_STORAGE.prefix, nonce, ciphertext, cipher.getAuthTag()])
  }

  decryptString(ciphertext: Buffer): string {
    const prefix = LOCAL_SECRET_STORAGE.prefix
    if (!ciphertext.subarray(0, prefix.length).equals(prefix)) {
      throw new Error(LOCAL_SECRET_STORAGE.invalidCiphertext)
    }
    const payload = ciphertext.subarray(prefix.length)
    if (payload.length < LOCAL_SECRET_STORAGE.nonceBytes + LOCAL_SECRET_STORAGE.tagBytes) {
      throw new Error(LOCAL_SECRET_STORAGE.invalidCiphertext)
    }
    const decipher = createDecipheriv(
      LOCAL_SECRET_STORAGE.cipher,
      this.loadKey(false),
      payload.subarray(0, LOCAL_SECRET_STORAGE.nonceBytes)
    )
    decipher.setAAD(prefix)
    decipher.setAuthTag(payload.subarray(-LOCAL_SECRET_STORAGE.tagBytes))
    const body = payload.subarray(LOCAL_SECRET_STORAGE.nonceBytes, -LOCAL_SECRET_STORAGE.tagBytes)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  }

  private loadKey(allowNew: boolean): Buffer {
    if (this.key) {
      return this.key
    }
    const path = join(this.directory, LOCAL_SECRET_STORAGE.keyFile)
    try {
      const stat = lstatSync(path)
      if (!stat.isFile()) {
        throw new Error(LOCAL_SECRET_STORAGE.invalidKey)
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error
      }
      if (!allowNew) {
        throw new Error(LOCAL_SECRET_STORAGE.unavailable)
      }
      this.publishNewKey(path)
    }
    chmodSync(path, 0o600)
    const encoded = readFileSync(path, 'utf8')
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== LOCAL_SECRET_STORAGE.keyBytes || key.toString('base64') !== encoded) {
      throw new Error(LOCAL_SECRET_STORAGE.invalidKey)
    }
    this.key = key
    return key
  }

  // Hard link publishes once. A concurrent process keeps the winner's key; this one never overwrites it.
  private publishNewKey(path: string): void {
    const candidate = randomBytes(LOCAL_SECRET_STORAGE.keyBytes)
    const staged = join(this.directory, randomUUID())
    try {
      writeSecureFile(staged, candidate.toString('base64'), { durable: true })
      try {
        linkSync(staged, path)
        bestEffortFsyncDirectorySync(this.directory)
      } catch (publishError) {
        if (
          !(publishError instanceof Error) ||
          !('code' in publishError) ||
          publishError.code !== 'EEXIST'
        ) {
          throw publishError
        }
      }
    } finally {
      candidate.fill(0)
      rmSync(staged, { force: true })
    }
  }
}
