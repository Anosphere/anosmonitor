import { Injectable } from '@angular/core';
import { words } from '../words';

/** A Uint8Array over its own ArrayBuffer, which WebAuthn requires. */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Copies any byte view into a fresh ArrayBuffer-backed array. */
export function toBuffer(source: Uint8Array | ArrayBuffer): Bytes {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}

const CEREMONY_TIMEOUT_MS = 120_000;

/**
 * The WebAuthn ceremonies (docs/schemas.md section 11.2): the wallet's
 * passkey.service.ts without PRF and without the language service. The
 * monitor makes no keys from a passkey; it only needs to know that it is
 * the owner. Both calls require user verification and hand back the
 * credential in the form the browser's toJSON() gives it, which is what the
 * server's checks take.
 *
 * The challenge, the relying-party id, the user handle and the ids to
 * exclude all come from the server, with POST /api/passkey/challenge: the
 * challenge and the user handle as hex, the ids as base64url. The
 * relying-party id is the server's RP_ID, not the page's host. A challenge
 * is used the first time a request brings it, so the page asks for a new
 * one at every press of a button.
 *
 * A call that the device or the browser does not finish throws; the page
 * shows one line for it (words.passkeyFailure).
 */
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  /**
   * Makes a discoverable passkey: the owner's first, or one more. Every
   * passkey of the owner carries the same user handle, so a phone lists
   * them as one account. `exclude` is the ids of the passkeys there are: a
   * device that holds one of them makes no second one.
   */
  async register(challengeHex: string, rpId: string, userHandleHex: string, exclude: string[]): Promise<Record<string, unknown>> {
    const credential = await credentials().create({
      publicKey: {
        rp: { name: words.passkey.rpName, id: rpId },
        user: { id: toBuffer(hexToBytes(userHandleHex)), name: words.passkey.userName, displayName: words.passkey.displayName },
        challenge: toBuffer(hexToBytes(challengeHex)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        attestation: 'none',
        excludeCredentials: exclude.map((id) => ({ type: 'public-key' as const, id: toBuffer(base64UrlToBytes(id)) })),
        timeout: CEREMONY_TIMEOUT_MS,
      },
    });
    return toJson(asPublicKeyCredential(credential, words.passkey.noCredential));
  }

  /**
   * Signs in with any passkey of this site. No list of allowed passkeys is
   * given: the device offers the one it has.
   */
  async assert(challengeHex: string, rpId: string): Promise<Record<string, unknown>> {
    const credential = await credentials().get({
      publicKey: {
        challenge: toBuffer(hexToBytes(challengeHex)),
        rpId,
        userVerification: 'required',
        timeout: CEREMONY_TIMEOUT_MS,
      },
    });
    return toJson(asPublicKeyCredential(credential, words.passkey.noCredential));
  }
}

/**
 * The browser's own door to passkeys. A browser has none on a page that is
 * not served over https or from localhost, and an old browser has none at
 * all: the call then throws a line that says so, not a line about a missing
 * property.
 */
function credentials(): CredentialsContainer {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new Error(words.passkey.noPasskeys);
  }
  return navigator.credentials;
}

/** The credential as a PublicKeyCredential; `noCredential` is the sentence thrown when it is not one. */
function asPublicKeyCredential(credential: Credential | null, noCredential: string): PublicKeyCredential {
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error(noCredential);
  }
  return credential;
}

/**
 * The credential in the form PublicKeyCredential.toJSON() gives it:
 * base64url everywhere. Always built by hand, never with the browser's own
 * toJSON(), as in the wallet, where WebKit on iOS 18 trapped inside
 * PublicKeyCredential.toJSON() when PRF outputs were present (its
 * serialiser read the largeBlob output, which was never asked for), which
 * killed the page process where no JavaScript can catch it. Seen
 * 2026-11-05 on an iPhone 11, iOS 18.7.8. The monitor asks for no PRF; it
 * keeps the form built by hand all the same, so both pages send what the
 * same server library has been seen to take.
 */
function toJson(pkc: PublicKeyCredential): Record<string, unknown> {
  const response: Record<string, unknown> = { clientDataJSON: toBase64Url(pkc.response.clientDataJSON) };
  if (pkc.response instanceof AuthenticatorAttestationResponse) {
    response['attestationObject'] = toBase64Url(pkc.response.attestationObject);
    response['transports'] = typeof pkc.response.getTransports === 'function' ? pkc.response.getTransports() : [];
  } else if (pkc.response instanceof AuthenticatorAssertionResponse) {
    response['authenticatorData'] = toBase64Url(pkc.response.authenticatorData);
    response['signature'] = toBase64Url(pkc.response.signature);
    response['userHandle'] = pkc.response.userHandle ? toBase64Url(pkc.response.userHandle) : null;
  }
  return {
    id: pkc.id,
    rawId: toBase64Url(pkc.rawId),
    type: pkc.type,
    authenticatorAttachment: pkc.authenticatorAttachment,
    response,
    clientExtensionResults: pkc.getClientExtensionResults(),
  };
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Hex to bytes: the challenge's 64 characters, the user handle's 32. Written
 * by hand; the wallet takes it from a package the monitor does not hold.
 * Throws on a text that is not hex of an even length.
 */
function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(words.passkey.unreadable);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Base64url to bytes: the id of a passkey there is already, as the server
 * hands it out. The reverse of toBase64Url. Throws on a text that is not
 * base64url.
 */
function base64UrlToBytes(text: string): Uint8Array {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error(words.passkey.unreadable);
  }
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < out.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
