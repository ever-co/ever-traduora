import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'containsChars', async: false })
export class IsNotOnlyWhitespace implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    if (typeof text !== 'string') {
      return false;
    }
    return (text || '').trim().length > 0;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Text ($value) does not contain chars, it is either empty or only whitespace';
  }
}
