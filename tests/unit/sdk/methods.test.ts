import { describe, expect, it } from 'vitest';

import {
  AssetTransferExtraSchema,
  ScriptExtraSchema,
  resolveAssetTransferMethod,
} from '../../../src/sdk/methods.js';

describe('resolveAssetTransferMethod', () => {
  it('returns "default" when extra is null/undefined', () => {
    expect(resolveAssetTransferMethod(null)).toBe('default');
    expect(resolveAssetTransferMethod(undefined)).toBe('default');
  });

  it('returns "default" when extra has no assetTransferMethod field', () => {
    expect(resolveAssetTransferMethod({})).toBe('default');
    expect(resolveAssetTransferMethod({ unrelated: 'x' })).toBe('default');
  });

  it('returns "default" for the explicit "default" literal', () => {
    expect(resolveAssetTransferMethod({ assetTransferMethod: 'default' })).toBe('default');
  });

  it('returns "script" for the "script" literal', () => {
    expect(resolveAssetTransferMethod({ assetTransferMethod: 'script' })).toBe('script');
  });

  it('returns "unknown" for any other literal', () => {
    expect(resolveAssetTransferMethod({ assetTransferMethod: 'banana' })).toBe('unknown');
    expect(resolveAssetTransferMethod({ assetTransferMethod: 'something-else' })).toBe(
      'unknown'
    );
  });
});

describe('ScriptExtraSchema', () => {
  it('accepts scriptHash alone', () => {
    const r = ScriptExtraSchema.safeParse({
      assetTransferMethod: 'script' as const,
      scriptHash: 'a'.repeat(56),
    });
    expect(r.success).toBe(true);
  });

  it('accepts inline script alone', () => {
    const r = ScriptExtraSchema.safeParse({
      assetTransferMethod: 'script' as const,
      script: { type: 'plutusV3' as const, code: 'deadbeef' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects when neither scriptHash nor script is supplied', () => {
    const r = ScriptExtraSchema.safeParse({
      assetTransferMethod: 'script' as const,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid scriptHash length', () => {
    const r = ScriptExtraSchema.safeParse({
      assetTransferMethod: 'script' as const,
      scriptHash: 'abc',
    });
    expect(r.success).toBe(false);
  });
});

describe('AssetTransferExtraSchema discriminated union', () => {
  it('accepts a default member with explicit literal', () => {
    expect(
      AssetTransferExtraSchema.safeParse({ assetTransferMethod: 'default' as const }).success
    ).toBe(true);
  });

  it('accepts a script member with scriptHash', () => {
    expect(
      AssetTransferExtraSchema.safeParse({
        assetTransferMethod: 'script' as const,
        scriptHash: 'a'.repeat(56),
      }).success
    ).toBe(true);
  });

  it('rejects an unknown discriminant', () => {
    expect(
      AssetTransferExtraSchema.safeParse({ assetTransferMethod: 'something-else' }).success
    ).toBe(false);
  });
});
