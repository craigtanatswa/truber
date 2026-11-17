import { normaliseReceiptRef } from '../src/billing/receivables.service';

describe('normaliseReceiptRef', () => {
  it.each([
    ['EC\u200b123'],
    ['\uFF25\uFF23123'],
    ['EC 123'],
    [' ec123 '],
    ['EC\u00a0123'],
    ['EC\ufeff123'],
  ])('folds %j to EC123', (input) => {
    expect(normaliseReceiptRef(input)).toBe('EC123');
  });

  it('keeps hyphens', () => {
    expect(normaliseReceiptRef(' eft-123 ')).toBe('EFT-123');
    expect(normaliseReceiptRef('EFT-123')).not.toBe(normaliseReceiptRef('EFT123'));
  });

  it('treats blank or invisible-only input as no reference', () => {
    expect(normaliseReceiptRef('   ')).toBeNull();
    expect(normaliseReceiptRef('\u200b\u3000')).toBeNull();
    expect(normaliseReceiptRef(undefined)).toBeNull();
  });
});
