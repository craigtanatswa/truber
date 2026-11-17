import { ApiException } from '../src/common/api.exception';
import { loadEnv, parseVerificationDocUriHosts } from '../src/config/env';
import { AccountStatus } from '../src/domain';
import { normalizeRegistrationNumber } from '../src/trucks/trucks.service';
import { isAllowedAccountStatusTransition } from '../src/users/account-status';
import { assertAllowedDocumentUri } from '../src/verification/document-uri';

const HOSTS = ['files.truber.local'];

function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function rejectedUri(raw: string, hosts: readonly string[] = HOSTS): ApiException {
  const error = thrownBy(() => assertAllowedDocumentUri(raw, hosts));
  expect(error).toBeInstanceOf(ApiException);
  const api = error as ApiException;
  expect(api.getStatus()).toBe(400);
  expect(['VALIDATION_ERROR', 'DOCUMENT_URI_NOT_ALLOWED']).toContain(api.code);
  const surfaced = JSON.stringify({ message: api.message, details: api.details });
  expect(surfaced).not.toContain(raw);
  return api;
}

describe('item 5 pure helpers', () => {
  describe('normalizeRegistrationNumber', () => {
    function invalidRegistration(raw: string): ApiException {
      const error = thrownBy(() => normalizeRegistrationNumber(raw));
      expect(error).toBeInstanceOf(ApiException);
      const api = error as ApiException;
      expect(api.getStatus()).toBe(400);
      expect(api.code).toBe('VALIDATION_ERROR');
      expect(api.details).toEqual({
        fields: {
          registrationNumber:
            'must contain 1 to 64 letters A-Z or digits 0-9 after removing spaces and punctuation',
        },
      });
      return api;
    }

    it('normalises Unicode, strips separators and punctuation, and upper-cases the result', () => {
      expect(normalizeRegistrationNumber('aez 12-34')).toBe('AEZ1234');
      expect(normalizeRegistrationNumber('aez\t12\t34')).toBe('AEZ1234');
      expect(normalizeRegistrationNumber('  aez - - 12   34  ')).toBe('AEZ1234');
      const equivalents = [
        'ABC\u200b123',
        'ABC\u200c123',
        'ABC\u200d123',
        '\ufeffABC123',
        'ABC\u00ad123',
        'ＡＢＣ１２３',
        'ABC.123',
        'ABC-123',
        'ABC 123',
        'ABC_123',
        'ABC/123',
        'abc\u00a0123',
        'ABC\u3000123',
      ];
      for (const value of equivalents) {
        expect(normalizeRegistrationNumber(value)).toBe('ABC123');
      }
    });

    it('rejects empty, non-ASCII, control and over-long results', () => {
      const invalid = [
        '',
        ' - . ',
        '\u200b',
        'АВС123',
        'ABCß',
        'ABC+123',
        'ABC\u0007123',
        'A'.repeat(63) + '\u338f',
      ];
      for (const value of invalid) {
        invalidRegistration(value);
      }
    });
  });

  describe('assertAllowedDocumentUri', () => {
    it('accepts https links on an allowed host, including upper-case host names', () => {
      expect(() =>
        assertAllowedDocumentUri('https://files.truber.local/docs/a.pdf', HOSTS),
      ).not.toThrow();
      expect(() => assertAllowedDocumentUri('https://FILES.truber.local/x', HOSTS)).not.toThrow();
    });

    it('rejects disallowed schemes, hosts, credentials, ports and malformed values', () => {
      const longUrl = `https://files.truber.local/${'a'.repeat(
        2049 - 'https://files.truber.local/'.length,
      )}`;
      expect(longUrl).toHaveLength(2049);
      const invalid = [
        'http://files.truber.local/docs/a.pdf',
        'ftp://files.truber.local/docs/a.pdf',
        'javascript:alert(1)',
        '/docs/a.pdf',
        'docs/a.pdf',
        'https://user:pw@files.truber.local/x',
        'https://files.truber.local:8443/x',
        'https://evil.example/x',
        'https://files.truber.local.evil.example/x',
        longUrl,
        'https://files.truber.local/a b.pdf',
      ];
      for (const uri of invalid) rejectedUri(uri);
    });

    it('rejects every link when no hosts are allowed', () => {
      const error = rejectedUri('https://files.truber.local/docs/a.pdf', []);
      expect(error.code).toBe('DOCUMENT_URI_NOT_ALLOWED');
    });
  });

  describe('isAllowedAccountStatusTransition', () => {
    it('allows only admin-settable target statuses and never a no-op', () => {
      const statuses: AccountStatus[] = ['pending_verification', 'active', 'suspended', 'disabled'];
      for (const from of statuses) {
        for (const to of statuses) {
          const expected = from !== to && to !== 'pending_verification';
          expect(isAllowedAccountStatusTransition(from, to)).toBe(expected);
        }
      }
      expect(isAllowedAccountStatusTransition('pending_verification', 'pending_verification')).toBe(false);
      expect(isAllowedAccountStatusTransition('pending_verification', 'active')).toBe(true);
      expect(isAllowedAccountStatusTransition('disabled', 'active')).toBe(true);
      expect(isAllowedAccountStatusTransition('active', 'pending_verification')).toBe(false);
    });
  });

  describe('parseVerificationDocUriHosts', () => {
    it('returns an empty allowlist when unset or blank', () => {
      expect(parseVerificationDocUriHosts(undefined)).toEqual([]);
      expect(parseVerificationDocUriHosts('')).toEqual([]);
    });

    it('trims, lower-cases and de-duplicates bare host names', () => {
      expect(parseVerificationDocUriHosts(' A.example.com , b.example.com,a.example.com')).toEqual([
        'a.example.com',
        'b.example.com',
      ]);
    });

    it('rejects schemes, wildcards, ports and paths', () => {
      for (const value of ['https://x.com', '*.x.com', 'x.com:443', 'x.com/path']) {
        expect(() => parseVerificationDocUriHosts(value)).toThrow(/bare hostnames/);
      }
    });
  });

  describe('loadEnv', () => {
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      DELIVERY_ADAPTER: 'dev',
    };

    it('defaults verificationDocUriHosts to an empty list', () => {
      expect(loadEnv(base).verificationDocUriHosts).toEqual([]);
    });
  });
});
