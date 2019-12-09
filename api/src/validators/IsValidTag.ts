import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'containsChars', async: false })
export class IsValidTag implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    if (typeof text !== 'string') {
      return false;
    }
    const notOnlyWhiteSpace = (text || '').trim().length > 0;
    const hasNewLine = text.indexOf('\n') >= 0;
    return !hasNewLine && notOnlyWhiteSpace;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Text ($value) does not contain chars, it is either empty or only whitespace or contains newlines';
  }
}
