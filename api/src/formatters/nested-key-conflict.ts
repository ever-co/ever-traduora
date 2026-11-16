// Nested formats (JSON nested, YAML nested) write the term "app.title" as the key "title" inside the object "app".
// A project that also has the term "app" would need "app" to be a value and an object at once, which these formats cannot hold.

export class NestedKeyConflictError extends Error {
  constructor(format: string, term: string, subTerm: string) {
    super(
      `${format} cannot hold the term "${term}" together with "${subTerm}": a key cannot have both a value and sub keys. ` +
        'Rename the term or export in a flat format.',
    );
    // keep instanceof working when compiled to ES5/ES6 targets
    Object.setPrototypeOf(this, NestedKeyConflictError.prototype);
    this.name = 'NestedKeyConflictError';
  }
}
