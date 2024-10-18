export const toEqualIgnoringIndentation = {
  toEqualIgnoringIndentation(received, expected) {
    const normalizeObject = obj => {
      if (typeof obj === 'string') {
        return obj.trim();
      }
      if (Array.isArray(obj)) {
        return obj.map(normalizeObject);
      }
      if (typeof obj === 'object' && obj !== null) {
        return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key.trim(), normalizeObject(value)]));
      }
      return obj;
    };

    const normalizedReceived = normalizeObject(received);
    const normalizedExpected = normalizeObject(expected);

    const pass = this.equals(normalizedReceived, normalizedExpected);

    if (pass) {
      return {
        message: () => `expected ${this.utils.printReceived(received)} not to equal (ignoring indentation) ${this.utils.printExpected(expected)}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${this.utils.printReceived(received)} to equal (ignoring indentation) ${this.utils.printExpected(expected)}`,
        pass: false,
      };
    }
  },
};
