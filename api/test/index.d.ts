declare namespace jest {
  interface Matchers<R> {
    toHaveExactProperties: (expectedProps: string[]) => void;
  }

  interface Expect {
    toHaveExactProperties: (expectedProps: string[]) => void;
  }
}
