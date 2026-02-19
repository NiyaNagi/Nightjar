// Approach 1: Return function directly (like real html2canvas CJS export)
const mockCanvas = { toDataURL: () => 'data:mock' };
const mockHtml2canvas = jest.fn().mockResolvedValue(mockCanvas);
jest.mock('html2canvas', () => mockHtml2canvas);

test('html2canvas mock works via dynamic import (function export)', async () => {
  const m = await import('html2canvas');
  console.log('import result keys:', Object.keys(m));
  console.log('typeof m:', typeof m);
  console.log('typeof m.default:', typeof m.default);
  const canvas = await m.default(document.body, {});
  console.log('canvas:', canvas);
  console.log('toDataURL:', canvas.toDataURL());
  expect(canvas.toDataURL()).toBe('data:mock');
});
