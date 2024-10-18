// jest.d.ts
import 'jest';

declare global {
  namespace jest {
    interface Matchers<R> {
      toEqualIgnoringIndentation(expected: any): R;
    }
  }
}
