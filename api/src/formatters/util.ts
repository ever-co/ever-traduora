// utils.ts
export const toEqualIgnoringIndentation = {
  toEqualIgnoringIndentation(received, expected) {
    let parsedReceived;
    let parsedExpected;

    try {
      parsedReceived = JSON.parse(received);
      parsedExpected = JSON.parse(expected);
    } catch (error) {
      return {
        message: () => `One or both of the values are not valid JSON strings.`,
        pass: false,
      };
    }

    const pass = this.equals(parsedReceived, parsedExpected);

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
