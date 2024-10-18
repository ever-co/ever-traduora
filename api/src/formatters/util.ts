// utils.ts
export const toEqualIgnoringIndentation = {
  toEqualIgnoringIndentation(received, expected) {
    const normalizeString = (str: string) => {
      return str
        .split('\n') // Split into lines
        .map(line => line.trim()) // Trim each line
        .join(' ') // Join all lines with a single space
        .replace(/\s+/g, ' '); // Replace multiple spaces with a single space
    };

    const normalizedReceived = normalizeString(received);
    const normalizedExpected = normalizeString(expected);

    const pass = normalizedReceived === normalizedExpected;

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
