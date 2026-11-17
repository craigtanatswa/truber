import { ApiException } from '../common/api.exception';

// eslint-disable-next-line no-control-regex
const FORBIDDEN_URI_CHARS = /[\s\u0000-\u001f\u007f]/;

// The contract has no mimeType or size fields, so none are accepted
// (forbidNonWhitelisted returns 400 for them).
export function assertAllowedDocumentUri(raw: string, allowedHosts: readonly string[]): void {
  if (
    typeof raw !== 'string' ||
    raw.length < 1 ||
    raw.length > 2048 ||
    FORBIDDEN_URI_CHARS.test(raw)
  ) {
    throw new ApiException(400, 'VALIDATION_ERROR', 'Request validation failed', {
      fields: { documentUri: 'must be an absolute https URL of at most 2048 characters' },
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw notAllowedError();
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443')
  ) {
    throw notAllowedError();
  }

  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.includes(hostname)) {
    throw notAllowedError();
  }
}

function notAllowedError(): ApiException {
  return new ApiException(
    400,
    'DOCUMENT_URI_NOT_ALLOWED',
    'Document links must be https links on an approved file host.',
  );
}
